// Vercel Serverless Function: /api/kamai-admin
// Privileged Kamai OS actions that need the service-role key: user provisioning, PIN reset,
// account disable, WhatsApp sends and delivery OTP delivery. Every call is authenticated with
// the caller's Supabase access token and authorised against kamai_memberships / platform admin.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const ALLOWED_ORIGINS = [
  "https://apt.assorted.group",
  "https://apt.assortedtrade.com",
  "https://aptsystems.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];
const ROLES = ["owner", "manager", "booker", "finance", "viewer", "rider", "store"];
const WA_SENDER_ROLES = ["owner", "manager", "booker", "finance"];
const OTP_ROLES = ["owner", "manager", "booker"];
const MANAGE_ROLES = ["owner", "manager"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ok(res, data) { return res.status(200).json(data); }
function err(res, msg, status = 400, extra = {}) { return res.status(status).json({ success: false, ok: false, error: msg, ...extra }); }

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = "Forbidden") => new HttpError(403, m);

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, "Server is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function getCallerClient(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// ---- tiny validators ---------------------------------------------------------------------
const v = {
  uuid: (x, n) => { if (typeof x !== "string" || !UUID_RE.test(x)) throw bad(`${n} must be a uuid`); return x; },
  str: (x, n, max = 500, req = true) => {
    if (x == null || x === "") { if (req) throw bad(`${n} is required`); return undefined; }
    if (typeof x !== "string" || x.length > max) throw bad(`${n} must be a string up to ${max} chars`);
    return x.trim();
  },
  pin: (x, n = "pin") => { if (typeof x !== "string" || !/^\d{6}$/.test(x)) throw bad(`${n} must be exactly 6 digits`); return x; },
  email: (x) => { const e = v.str(x, "email", 254, false); if (e === undefined) return undefined; if (!EMAIL_RE.test(e)) throw bad("email is invalid"); return e.toLowerCase(); },
  mobile: (x, req = false) => {
    const s = v.str(x, "mobile", 20, req); if (s === undefined) return undefined;
    const d = normDigits(s); if (d.length < 11 || d.length > 15) throw bad("mobile is invalid"); return d;
  },
};
// digits only, Pakistan default: 03001234567 -> 923001234567
function normDigits(s) {
  let d = String(s).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "92" + d.slice(1);
  else if (d.length === 10 && d.startsWith("3")) d = "92" + d;
  return d;
}

// ---- caller context ----------------------------------------------------------------------
async function loadCaller(db, req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Missing bearer token");
  const token = m[1].trim();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired token");
  const user = data.user;
  const [pa, ur, mem] = await Promise.all([
    db.from("kamai_platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").limit(1),
    db.from("kamai_memberships").select("tenant_id,role,store_id,status").eq("user_id", user.id).eq("status", "active"),
  ]);
  if (mem.error) throw mem.error;
  return {
    token, user,
    isAdmin: !!pa.data || (ur.data?.length ?? 0) > 0,
    memberships: mem.data ?? [],
  };
}
const hasRole = (c, tenantId, roles) => c.isAdmin || c.memberships.some((m) => m.tenant_id === tenantId && roles.includes(m.role));
function requireRole(c, tenantId, roles) { if (!hasRole(c, tenantId, roles)) throw forbidden(); }

// ---- helpers -------------------------------------------------------------------------------
async function findUserByEmail(db, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}
const isExists = (e) => /already|registered|exists|duplicate/i.test(`${e?.message || ""} ${e?.code || ""}`);
const tempPassword = () => randomBytes(18).toString("base64url");
const waLink = (digits, text) => `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// ---- actions ------------------------------------------------------------------------------
// Role hierarchy: a caller may only act on a user whose role in every tenant is strictly below the
// caller's own role in that tenant.
const RANK = { owner: 4, manager: 3, booker: 2, finance: 2, viewer: 1, rider: 1, store: 1 };
const callerRank = (c, tenantId) => Math.max(0, ...c.memberships.filter((m) => m.tenant_id === tenantId).map((m) => RANK[m.role] ?? 0));
const PIN_DOMAIN = "@kamai.assorted.group";

async function isPlatformAdminUser(db, userId) {
  const [pa, ur] = await Promise.all([
    db.from("kamai_platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").limit(1),
  ]);
  if (pa.error) throw pa.error;
  if (ur.error) throw ur.error;
  return !!pa.data || (ur.data?.length ?? 0) > 0;
}
async function membershipsOf(db, userId) {
  const { data, error } = await db.from("kamai_memberships").select("tenant_id,role,status").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

// Authorise acting (reset PIN / disable) on an existing user. Never platform admins; every tenant the
// target belongs to (any status) must be managed by the caller, who must outrank the target there.
async function guardTarget(db, c, userId) {
  if (await isPlatformAdminUser(db, userId)) throw forbidden("Platform admins cannot be managed here");
  const rows = await membershipsOf(db, userId);
  if (!rows.length) throw new HttpError(404, "User has no Kamai membership");
  if (c.isAdmin) return rows;
  for (const r of rows) {
    if (!hasRole(c, r.tenant_id, MANAGE_ROLES)) throw forbidden("User also belongs to a tenant you do not manage");
    if (callerRank(c, r.tenant_id) <= (RANK[r.role] ?? 0)) throw forbidden("Your role does not outrank this user's role");
  }
  return rows;
}

async function provisionUser(db, c, p) {
  const tenantId = v.uuid(p.tenant_id, "tenant_id");
  const role = v.str(p.role, "role", 20);
  if (!ROLES.includes(role)) throw bad("role is invalid");
  requireRole(c, tenantId, MANAGE_ROLES);
  if (role === "owner" && !hasRole(c, tenantId, ["owner"])) throw forbidden("Only an owner or platform admin can create owners");
  const fullName = v.str(p.full_name, "full_name", 200);
  const email = v.email(p.email);
  const mobile = v.mobile(p.mobile, role === "store");
  const storeId = p.store_id ? v.uuid(p.store_id, "store_id") : null;
  if (role === "store" && !storeId) throw bad("store_id is required for role store");
  if (!email && !mobile) throw bad("email or mobile is required");
  const pin = email ? undefined : v.pin(p.pin);

  if (storeId) {
    const { data: st, error } = await db.from("kamai_stores").select("id").eq("id", storeId).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!st) throw bad("store_id does not belong to this tenant");
  }

  const meta = { kamai: true, full_name: fullName, mobile: mobile ? `+${mobile}` : null, persona: role };
  let userId, login, actionLink, existing = null, isNew = false;
  if (email) {
    login = { kind: "email_invite", identifier: email };
    existing = await findUserByEmail(db, email);
    if (!existing) {
      const redirectTo = "https://apt.assorted.group/auth/accept";
      const inv = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: meta });
      if (!inv.error && inv.data?.user) {
        userId = inv.data.user.id; isNew = true;
      } else {
        console.error("[kamai-admin] invite failed, falling back to generateLink:", inv.error?.message);
        const gl = await db.auth.admin.generateLink({ type: "invite", email, options: { redirectTo, data: meta } });
        if (gl.error || !gl.data?.user) {
          if (gl.error && isExists(gl.error)) {
            existing = await findUserByEmail(db, email);
            if (!existing) throw gl.error;
          } else throw gl.error || new Error("invite failed");
        } else {
          userId = gl.data.user.id; isNew = true;
          actionLink = gl.data.properties?.action_link;
        }
      }
    }
  } else {
    const prefix = role === "store" ? "store" : "user";
    const identifier = `${prefix}-${mobile}${PIN_DOMAIN}`;
    login = { kind: "mobile_pin", identifier };
    const created = await db.auth.admin.createUser({ email: identifier, password: pin, email_confirm: true, user_metadata: meta });
    if (created.error) {
      if (!isExists(created.error)) throw created.error;
      existing = await findUserByEmail(db, identifier);
      if (!existing) throw created.error;
    } else { userId = created.data.user.id; isNew = true; }
  }

  // An account that already exists is never taken over: its password and metadata are not touched.
  if (existing) {
    userId = existing.id;
    const mems = await membershipsOf(db, userId);
    const platformAdmin = await isPlatformAdminUser(db, userId);
    if (platformAdmin && !c.isAdmin) throw forbidden("Platform admins cannot be provisioned into a tenant here");
    if (mems.some((m) => m.tenant_id === tenantId)) throw new HttpError(409, "User is already a member of this tenant");
    if (!c.isAdmin && mems.length) throw forbidden("User already belongs to another tenant; ask a platform admin");
    if (!email) {
      // Mobile/PIN login that already exists: only an orphan from an interrupted provisioning
      // (no membership anywhere, not an admin, created by Kamai) may be adopted and get this PIN.
      const orphan = !mems.length && !platformAdmin && existing.user_metadata?.kamai === true;
      if (!orphan) throw new HttpError(409, "A login for this mobile already exists; use reset_pin");
      const upd = await db.auth.admin.updateUserById(userId, { password: pin, user_metadata: { ...(existing.user_metadata || {}), ...meta } });
      if (upd.error) throw upd.error;
    }
  }

  // The live handle_new_user trigger grants 'rider' to every new user; remove it for other personas.
  // Only for users created by this call, never for an existing account.
  if (isNew && role !== "rider") {
    const del = await db.from("user_roles").delete().eq("user_id", userId).eq("role", "rider");
    if (del.error) console.error("[kamai-admin] user_roles cleanup:", del.error.message);
  }
  // Plain insert: an existing membership (role, status) is never overwritten or re-activated here.
  const mem = await db.from("kamai_memberships").insert(
    { tenant_id: tenantId, user_id: userId, role, store_id: role === "store" ? storeId : null, status: "active", created_by: c.user.id });
  if (mem.error) {
    if (mem.error.code === "23505") throw new HttpError(409, "User is already a member of this tenant");
    throw mem.error;
  }
  if (role === "store") {
    const wa = await db.from("kamai_wa_contacts").upsert(
      { tenant_id: tenantId, wa_id: mobile, store_id: storeId }, { onConflict: "tenant_id,wa_id" });
    if (wa.error) console.error("[kamai-admin] wa_contacts upsert:", wa.error.message);
  }
  return { ok: true, user_id: userId, login, ...(actionLink ? { action_link: actionLink } : {}) };
}

async function resetPin(db, c, p) {
  const userId = v.uuid(p.user_id, "user_id");
  const pin = v.pin(p.pin);
  await guardTarget(db, c, userId);
  // Only mobile/PIN logins created by provisioning may be reset here, never email accounts.
  const { data, error: ge } = await db.auth.admin.getUserById(userId);
  if (ge || !data?.user) throw new HttpError(404, "User not found");
  if (!(data.user.email || "").toLowerCase().endsWith(PIN_DOMAIN)) throw bad("User does not have a mobile PIN login");
  const { error } = await db.auth.admin.updateUserById(userId, { password: pin });
  if (error) throw error;
  return { ok: true };
}

async function disableUser(db, c, p) {
  const userId = v.uuid(p.user_id, "user_id");
  if (userId === c.user.id) throw bad("You cannot disable yourself");
  const tenants = (await guardTarget(db, c, userId)).map((r) => r.tenant_id);
  const m = await db.from("kamai_memberships").update({ status: "disabled" }).eq("user_id", userId).in("tenant_id", tenants);
  if (m.error) throw m.error;
  // Only ban the login when every membership of the user is now disabled.
  const left = await db.from("kamai_memberships").select("tenant_id").eq("user_id", userId).eq("status", "active");
  if (left.error) throw left.error;
  // auth.admin.signOut(jwt, scope) in the installed auth-js takes the user's JWT, not the user id,
  // so a global sign-out by id is skipped; the ban blocks refresh and new sign-ins and the access
  // token lapses at the project JWT expiry.
  let banned = false;
  const signedOut = false;
  if (!left.data?.length) {
    const ban = await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (ban.error) throw ban.error;
    banned = true;
  }
  return { ok: true, disabled_tenants: tenants, banned, signed_out: signedOut,
    note: banned ? "Login banned; existing access token lapses at JWT expiry (sessions cannot be revoked by user id)." : "Membership disabled; user keeps other active memberships." };
}

// Template components from API callers: text/payload parameters only (no media links), bounded size.
function validateComponents(components) {
  if (!Array.isArray(components) || components.length > 10) throw bad("components must be an array of up to 10 items");
  if (JSON.stringify(components).length > 4096) throw bad("components is too large");
  for (const comp of components) {
    if (!comp || typeof comp !== "object" || !["header", "body", "button"].includes(comp.type)) throw bad("component type is invalid");
    const params = comp.parameters ?? [];
    if (!Array.isArray(params) || params.length > 10) throw bad("component parameters are invalid");
    for (const prm of params) {
      if (!prm || !["text", "payload"].includes(prm.type)) throw bad("only text and payload parameters are allowed");
      if (typeof (prm.type === "text" ? prm.text : prm.payload) !== "string") throw bad("parameter value must be a string");
    }
  }
}

async function sendWhatsapp(db, c, p) {
  const tenantId = v.uuid(p.tenant_id, "tenant_id");
  requireRole(c, tenantId, WA_SENDER_ROLES);
  const to = v.mobile(p.to, true);
  const templateName = v.str(p.template_name, "template_name", 100, false);
  const text = v.str(p.text, "text", 1024, false);
  if (!templateName && !text) throw bad("template_name or text is required");
  const language = v.str(p.language, "language", 10, false) || "en";
  const components = p.components == null ? undefined : p.components;
  if (components !== undefined) validateComponents(components);
  const orderId = p.related_order_id ? v.uuid(p.related_order_id, "related_order_id") : null;
  const invoiceId = p.related_invoice_id ? v.uuid(p.related_invoice_id, "related_invoice_id") : null;
  return deliverWhatsapp(db, { tenantId, to, templateName, text, language, components, orderId, invoiceId, external: true });
}

async function deliverWhatsapp(db, { tenantId, to, templateName, text, language = "en", components, orderId = null, invoiceId = null, category: forcedCategory, external = false }) {
  const fallback_url = waLink(to, text || (templateName ? `[${templateName}]` : ""));
  let category = forcedCategory;
  if (templateName && !category) {
    const t = await db.from("kamai_wa_templates").select("category").eq("tenant_id", tenantId).eq("name", templateName).eq("language_code", language).maybeSingle();
    category = t.data?.category ? String(t.data.category).toLowerCase() : null;
  }
  // Authentication templates (which skip the consent gates) are reserved for the internal OTP path.
  if (external && category === "authentication") return { ok: false, delivered: false, reason: "TEMPLATE_NOT_ALLOWED", fallback_url };
  const { data: contact } = await db.from("kamai_wa_contacts").select("id,opted_in_at,opted_out_at,last_inbound_at,store_id").eq("tenant_id", tenantId).eq("wa_id", to).maybeSingle();
  let optedIn = contact?.opted_in_at;
  if (!optedIn && contact?.store_id) {
    const s = await db.from("kamai_stores").select("wa_opt_in_at").eq("id", contact.store_id).maybeSingle();
    optedIn = s.data?.wa_opt_in_at;
  }
  // Public sends only go to known contacts of the tenant.
  if (external && !contact) return { ok: false, delivered: false, reason: "UNKNOWN_CONTACT", fallback_url };
  const windowOpen = !!contact?.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 3600 * 1000;
  const businessInitiated = !!templateName;
  if (contact?.opted_out_at && category !== "authentication") return { ok: false, delivered: false, reason: "OPTED_OUT", fallback_url };
  if (businessInitiated && !optedIn && category !== "authentication") return { ok: false, delivered: false, reason: "NO_OPT_IN", fallback_url };
  if (!templateName && !windowOpen) return { ok: false, delivered: false, reason: "OUTSIDE_24H_WINDOW", fallback_url };

  const payload = templateName
    ? { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
        template: { name: templateName, language: { code: language }, ...(components ? { components } : {}) } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } };
  const base = { tenant_id: tenantId, contact_id: contact?.id ?? null, store_id: contact?.store_id ?? null, to_wa_id: to, direction: "out",
    template_name: templateName || null, category: category || null, order_id: orderId, invoice_id: invoiceId };
  // Never persist OTP values in the message log.
  const logPayload = category === "authentication" ? { ...payload, template: { ...payload.template, components: "[redacted]" } } : payload;

  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    const ins = await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, status: "queued" });
    if (ins.error) console.error("[kamai-admin] queue insert:", ins.error.message);
    return { ok: true, delivered: false, queued: true, fallback_url };
  }
  const ver = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
  let r, body;
  try {
    r = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    body = await r.json().catch(() => ({}));
  } catch (e) {
    console.error("[kamai-admin] graph fetch:", e);
    const f = await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, status: "failed", error: "network" });
    if (f.error) console.error("[kamai-admin] failed insert:", f.error.message);
    return { ok: false, delivered: false, reason: "NETWORK_ERROR", fallback_url };
  }
  const wamid = body?.messages?.[0]?.id;
  if (r.ok && wamid) {
    const ins = await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, wamid, status: "sent", sent_at: new Date().toISOString() });
    if (ins.error) console.error("[kamai-admin] sent insert:", ins.error.message);
    return { ok: true, delivered: true, wamid };
  }
  const code = String(body?.error?.code ?? r.status);
  const fi = await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, status: "failed", error: `${code}: ${String(body?.error?.message || "").slice(0, 300)}` });
  if (fi.error) console.error("[kamai-admin] failed insert:", fi.error.message);
  console.error("[kamai-admin] graph error", code, body?.error?.message);
  return { ok: false, delivered: false, reason: "GRAPH_ERROR", error_code: code, fallback_url };
}

async function sendDeliveryOtp(db, c, p) {
  const orderId = v.uuid(p.order_id, "order_id");
  const { data: order, error } = await db.from("kamai_orders").select("id,tenant_id,store_id,rider_user_id,order_no").eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order) throw new HttpError(404, "Order not found");
  const isAssignedRider = order.rider_user_id === c.user.id && hasRole(c, order.tenant_id, ["rider"]);
  if (!isAssignedRider) requireRole(c, order.tenant_id, OTP_ROLES);

  // Throttle for every caller (the RPC only throttles non-managers): 60 s between issues and at most
  // 5 OTP WhatsApp messages per order per hour, so a loop cannot burn billable messages or lockouts.
  const live = await db.from("kamai_delivery_otps").select("created_at").eq("order_id", orderId).maybeSingle();
  if (live.data?.created_at && Date.now() - new Date(live.data.created_at).getTime() < 60 * 1000) throw new HttpError(429, "OTP was issued moments ago", { reason: "OTP_RATE_LIMITED" });
  const sentCount = await db.from("kamai_wa_messages").select("id", { count: "exact", head: true })
    .eq("order_id", orderId).eq("template_name", "kamai_delivery_otp").gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((sentCount.count ?? 0) >= 5) throw new HttpError(429, "OTP send limit reached for this order", { reason: "OTP_SEND_LIMIT" });

  // Run the RPC as the caller so auth.uid() and its own checks apply (it also enforces reissue limits).
  const caller = getCallerClient(c.token);
  const rpc = await caller.rpc("kamai_issue_delivery_otp", { p_order_id: orderId });
  if (rpc.error) {
    const limited = /OTP_RATE_LIMITED|OTP_REISSUE_LIMIT/.test(rpc.error.message || "");
    throw new HttpError(rpc.error.code === "42501" ? 403 : limited ? 429 : 400, rpc.error.message);
  }
  let code = null;
  const q = await db.from("kamai_delivery_otps").select("code,expires_at").eq("order_id", orderId).order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (!q.error && q.data?.code) code = String(q.data.code);
  else if (rpc.data && typeof rpc.data === "object" && rpc.data.code) code = String(rpc.data.code);
  const expiresAt = q.data?.expires_at ?? rpc.data?.expires_at ?? null;
  const note = "Store sees the code in /store";
  if (!code) return { ok: true, delivered: false, expires_at: expiresAt, note };

  const { data: store } = await db.from("kamai_stores").select("mobile").eq("id", order.store_id).maybeSingle();
  const configured = process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!store?.mobile || !configured) return { ok: true, delivered: false, expires_at: expiresAt, note };
  const res = await deliverWhatsapp(db, {
    tenantId: order.tenant_id, to: normDigits(store.mobile), templateName: "kamai_delivery_otp", language: "en", category: "authentication",
    orderId: order.id,
    components: [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ],
  });
  if (!res.ok || !res.delivered) return { ok: true, delivered: false, expires_at: expiresAt, note, reason: res.reason };
  return { ok: true, delivered: true, expires_at: expiresAt };
}

const ACTIONS = {
  provision_user: provisionUser, reset_pin: resetPin, disable_user: disableUser,
  send_whatsapp: sendWhatsapp, send_delivery_otp: sendDeliveryOtp,
};

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) return err(res, "Origin not allowed", 403);
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return err(res, "Method not allowed", 405);

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { throw bad("Invalid JSON"); } }
    if (!body || typeof body !== "object") throw bad("Body must be a JSON object");
    const { action, ...params } = body;
    const fn = ACTIONS[action];
    if (!fn) throw bad("Unknown action");
    const db = getAdmin();
    const caller = await loadCaller(db, req);
    const result = await fn(db, caller, params);
    return ok(res, result);
  } catch (e) {
    if (e instanceof HttpError) return err(res, e.message, e.status, e.extra);
    console.error("[kamai-admin]", e);
    return err(res, "Internal error", 500);
  }
}
