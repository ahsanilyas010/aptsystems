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
  let userId, login, actionLink;
  if (email) {
    login = { kind: "email_invite", identifier: email };
    const existing = await findUserByEmail(db, email);
    if (existing) {
      userId = existing.id;
    } else {
      const redirectTo = "https://apt.assorted.group/auth/accept";
      const inv = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: meta });
      if (!inv.error && inv.data?.user) {
        userId = inv.data.user.id;
      } else {
        console.error("[kamai-admin] invite failed, falling back to generateLink:", inv.error?.message);
        const gl = await db.auth.admin.generateLink({ type: "invite", email, options: { redirectTo, data: meta } });
        if (gl.error || !gl.data?.user) {
          if (gl.error && isExists(gl.error)) {
            const again = await findUserByEmail(db, email);
            if (!again) throw gl.error;
            userId = again.id;
          } else throw gl.error || new Error("invite failed");
        } else {
          userId = gl.data.user.id;
          actionLink = gl.data.properties?.action_link;
        }
      }
    }
  } else {
    const prefix = role === "store" ? "store" : "user";
    const identifier = `${prefix}-${mobile}@kamai.assorted.group`;
    login = { kind: "mobile_pin", identifier };
    const created = await db.auth.admin.createUser({ email: identifier, password: pin, email_confirm: true, user_metadata: meta });
    if (created.error) {
      if (!isExists(created.error)) throw created.error;
      const existing = await findUserByEmail(db, identifier);
      if (!existing) throw created.error;
      userId = existing.id;
      const upd = await db.auth.admin.updateUserById(userId, { password: pin, user_metadata: { ...(existing.user_metadata || {}), ...meta } });
      if (upd.error) throw upd.error;
    } else userId = created.data.user.id;
  }

  // The live handle_new_user trigger grants 'rider' to every new user; remove it for other personas.
  if (role !== "rider") {
    const del = await db.from("user_roles").delete().eq("user_id", userId).eq("role", "rider");
    if (del.error) console.error("[kamai-admin] user_roles cleanup:", del.error.message);
  }
  const mem = await db.from("kamai_memberships").upsert(
    { tenant_id: tenantId, user_id: userId, role, store_id: role === "store" ? storeId : null, status: "active", created_by: c.user.id },
    { onConflict: "tenant_id,user_id" });
  if (mem.error) throw mem.error;
  if (role === "store") {
    const wa = await db.from("kamai_wa_contacts").upsert(
      { tenant_id: tenantId, wa_id: mobile, store_id: storeId }, { onConflict: "tenant_id,wa_id" });
    if (wa.error) console.error("[kamai-admin] wa_contacts upsert:", wa.error.message);
  }
  return { ok: true, user_id: userId, login, ...(actionLink ? { action_link: actionLink } : {}) };
}

// Tenants (among the caller's manageable ones) where the target user has a membership.
async function manageableTenantsOf(db, c, userId) {
  const { data, error } = await db.from("kamai_memberships").select("tenant_id").eq("user_id", userId);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.tenant_id);
  if (!ids.length) throw new HttpError(404, "User has no Kamai membership");
  const allowed = c.isAdmin ? ids : ids.filter((t) => hasRole(c, t, MANAGE_ROLES));
  if (!allowed.length) throw forbidden();
  return allowed;
}

async function resetPin(db, c, p) {
  const userId = v.uuid(p.user_id, "user_id");
  const pin = v.pin(p.pin);
  await manageableTenantsOf(db, c, userId);
  const { error } = await db.auth.admin.updateUserById(userId, { password: pin });
  if (error) throw error;
  return { ok: true };
}

async function disableUser(db, c, p) {
  const userId = v.uuid(p.user_id, "user_id");
  if (userId === c.user.id) throw bad("You cannot disable yourself");
  const tenants = await manageableTenantsOf(db, c, userId);
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

async function sendWhatsapp(db, c, p) {
  const tenantId = v.uuid(p.tenant_id, "tenant_id");
  requireRole(c, tenantId, WA_SENDER_ROLES);
  const to = v.mobile(p.to, true);
  const templateName = v.str(p.template_name, "template_name", 100, false);
  const text = v.str(p.text, "text", 1024, false);
  if (!templateName && !text) throw bad("template_name or text is required");
  const language = v.str(p.language, "language", 10, false) || "en";
  const components = p.components == null ? undefined : p.components;
  if (components !== undefined && !Array.isArray(components)) throw bad("components must be an array");
  const orderId = p.related_order_id ? v.uuid(p.related_order_id, "related_order_id") : null;
  const invoiceId = p.related_invoice_id ? v.uuid(p.related_invoice_id, "related_invoice_id") : null;
  return deliverWhatsapp(db, { tenantId, to, templateName, text, language, components, orderId, invoiceId });
}

async function deliverWhatsapp(db, { tenantId, to, templateName, text, language = "en", components, orderId = null, invoiceId = null, category: forcedCategory }) {
  const fallback_url = waLink(to, text || (templateName ? `[${templateName}]` : ""));
  let category = forcedCategory;
  if (templateName && !category) {
    const t = await db.from("kamai_wa_templates").select("category").eq("tenant_id", tenantId).eq("name", templateName).eq("language_code", language).maybeSingle();
    category = t.data?.category ? String(t.data.category).toLowerCase() : null;
  }
  const { data: contact } = await db.from("kamai_wa_contacts").select("opted_in_at,opted_out_at,last_inbound_at,store_id").eq("tenant_id", tenantId).eq("wa_id", to).maybeSingle();
  let optedIn = contact?.opted_in_at;
  if (!optedIn && contact?.store_id) {
    const s = await db.from("kamai_stores").select("wa_opt_in_at").eq("id", contact.store_id).maybeSingle();
    optedIn = s.data?.wa_opt_in_at;
  }
  const windowOpen = !!contact?.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 3600 * 1000;
  const businessInitiated = !!templateName;
  if (contact?.opted_out_at && category !== "authentication") return { ok: false, delivered: false, reason: "OPTED_OUT", fallback_url };
  if (businessInitiated && !optedIn && category !== "authentication") return { ok: false, delivered: false, reason: "NO_OPT_IN", fallback_url };
  if (!templateName && !windowOpen) return { ok: false, delivered: false, reason: "OUTSIDE_24H_WINDOW", fallback_url };

  const payload = templateName
    ? { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
        template: { name: templateName, language: { code: language }, ...(components ? { components } : {}) } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } };
  const base = { tenant_id: tenantId, wa_id: to, direction: "out", type: payload.type, template_name: templateName || null,
    category: category || null, related_order_id: orderId, related_invoice_id: invoiceId };
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
    await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, status: "failed", error_code: "network" });
    return { ok: false, delivered: false, reason: "NETWORK_ERROR", fallback_url };
  }
  const wamid = body?.messages?.[0]?.id;
  if (r.ok && wamid) {
    const ins = await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, wamid, status: "sent", status_at: new Date().toISOString() });
    if (ins.error) console.error("[kamai-admin] sent insert:", ins.error.message);
    return { ok: true, delivered: true, wamid };
  }
  const code = String(body?.error?.code ?? r.status);
  await db.from("kamai_wa_messages").insert({ ...base, payload: logPayload, status: "failed", error_code: code });
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

  // Run the RPC as the caller so auth.uid() and its own checks apply.
  const caller = getCallerClient(c.token);
  const rpc = await caller.rpc("kamai_issue_delivery_otp", { p_order_id: orderId });
  if (rpc.error) throw new HttpError(rpc.error.code === "42501" ? 403 : 400, rpc.error.message);
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
