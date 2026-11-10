// Vercel Serverless Function: /api/kamai-signup
// PUBLIC distributor self sign-up. Creates an auth user (email pre-confirmed), a 'distributor' tenant
// (onboarding_status 'pending_review'), the owner membership and an admin notification + email.
// Same-origin only (no CORS headers are ever sent). Never logs passwords or raw PII.
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import { sendAdminEmail, signupEmail, recordResult } from "./_kamai-mail.js";

const ALLOWED_ORIGINS = [
  "https://apt.assorted.group",
  "https://apt.assortedtrade.com",
  "https://aptsystems.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC = "Could not create the account. If you already have one, log in.";
const IP_PER_HOUR = 5, EMAIL_PER_DAY = 3;
const MEM_WINDOW_MS = 10 * 60 * 1000, MEM_MAX = 10;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// tiny per-instance limiter (the DB log is the real limiter across instances)
const mem = new Map();
function memLimited(ipHash) {
  const now = Date.now();
  const arr = (mem.get(ipHash) || []).filter((t) => now - t < MEM_WINDOW_MS);
  arr.push(now);
  mem.set(ipHash, arr);
  if (mem.size > 5000) for (const [k, v] of mem) if (!v.some((t) => now - t < MEM_WINDOW_MS)) mem.delete(k);
  return arr.length > MEM_MAX;
}

const hash = (v) => {
  const salt = process.env.KAMAI_HASH_SALT
    || createHmac("sha256", "kamai-signup-salt-v1").update(process.env.SUPABASE_SERVICE_ROLE_KEY || "").digest("hex");
  return createHmac("sha256", salt).update(String(v)).digest("hex");
};
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  || req.socket?.remoteAddress || "unknown";

function normDigits(s) {
  let d = String(s).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "92" + d.slice(1);
  else if (d.length === 10 && d.startsWith("3")) d = "92" + d;
  return d;
}
const str = (x, name, min, max) => {
  if (typeof x !== "string") throw bad(`${name} is required`);
  const s = x.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}-${max} characters`);
  return s;
};
function validate(b) {
  const company = str(b.company, "Company name", 2, 120);
  const contact_name = str(b.contact_name, "Your name", 2, 100);
  const city = str(b.city, "City", 2, 80);
  const email = (typeof b.email === "string" ? b.email.trim().toLowerCase() : "");
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw bad("Enter a valid email address");
  if (typeof b.mobile !== "string" || b.mobile.length > 25) throw bad("Enter a valid mobile number");
  const d = normDigits(b.mobile);
  if (!/^92\d{10}$/.test(d)) throw bad("Enter a valid Pakistani mobile number, e.g. +92 300 1234567");
  const password = b.password;
  if (typeof password !== "string" || password.length < 8) throw bad("Password must be at least 8 characters");
  if (password.length > 72) throw bad("Password must be at most 72 characters");
  return { company, contact_name, city, email, mobile: `+${d}`, password };
}

function slugify(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28).replace(/-+$/g, "");
  return `${base || "dist"}-${randomBytes(3).toString("hex").slice(0, 4)}`;
}
const isExists = (e) => /already|registered|exists|duplicate/i.test(`${e?.message || ""} ${e?.code || ""}`);

export default async function handler(req, res) {
  // same-origin only: no CORS headers; a foreign Origin is refused
  const origin = req.headers.origin;
  if (origin) {
    let sameHost = false;
    try { sameHost = !!req.headers.host && new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
    if (!sameHost && !ALLOWED_ORIGINS.includes(origin)) return fail(res, 403, "Origin not allowed");
  }
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return fail(res, 400, "Invalid JSON"); } }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(res, 400, "Invalid request");

  // honeypot: bots fill it. Pretend success, do nothing.
  if (typeof body.website === "string" ? body.website.trim() !== "" : body.website != null && body.website !== false) {
    return res.status(200).json({ ok: true });
  }

  let input;
  try { input = validate(body); } catch (e) { return fail(res, e.status || 400, e.message); }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fail(res, 500, "Sign-up is temporarily unavailable");

  const ipHash = hash(`ip:${clientIp(req)}`);
  const emailHash = hash(`email:${input.email}`);
  if (memLimited(ipHash)) return fail(res, 429, "Too many attempts. Please try again later.");

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId = null, tenantId = null;
  try {
    // ---- DB rate limit (fails closed) ----
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [ipc, emc] = await Promise.all([
      db.from("kamai_signup_log").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo),
      db.from("kamai_signup_log").select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("created_at", dayAgo),
    ]);
    if (ipc.error || emc.error) throw ipc.error || emc.error;
    if ((ipc.count ?? 0) >= IP_PER_HOUR || (emc.count ?? 0) >= EMAIL_PER_DAY) return fail(res, 429, "Too many attempts. Please try again later.");
    const lg = await db.from("kamai_signup_log").insert({ ip_hash: ipHash, email_hash: emailHash });
    if (lg.error) throw lg.error;

    // ---- auth user (no enumeration detail on duplicates) ----
    const created = await db.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true,
      user_metadata: { kamai: true, persona: "distributor", full_name: input.contact_name, mobile: input.mobile },
    });
    if (created.error || !created.data?.user) {
      if (created.error && isExists(created.error)) return fail(res, 400, GENERIC);
      const st = created.error?.status;
      if (st === 422 || st === 400) return fail(res, 400, GENERIC); // e.g. weak/breached password policy
      throw created.error || new Error("createUser failed");
    }
    userId = created.data.user.id;

    // the handle_new_user trigger grants 'rider' to every new user; a distributor is not a rider
    const del = await db.from("user_roles").delete().eq("user_id", userId).eq("role", "rider");
    if (del.error) console.error("[kamai-signup] rider cleanup failed:", del.error.message);

    // ---- tenant (seeds ledger/credit/dunning/default price list) ----
    const settings = {
      onboarding_status: "pending_review",
      signup: { contact_name: input.contact_name, mobile: input.mobile, city: input.city, email: input.email, source: "self_signup" },
    };
    for (let i = 0; i < 4 && !tenantId; i++) {
      const r = await db.rpc("kamai_create_tenant", { p_slug: slugify(input.company), p_name: input.company, p_type: "distributor", p_settings: settings });
      if (r.error) {
        if (r.error.code === "23505" && i < 3) continue; // slug collision, retry with new suffix
        throw r.error;
      }
      tenantId = r.data;
    }
    if (!tenantId) throw new Error("tenant not created");

    const mb = await db.from("kamai_memberships").insert({ tenant_id: tenantId, user_id: userId, role: "owner", status: "active" });
    if (mb.error) throw mb.error;

    const note = await db.from("kamai_admin_notifications").insert({
      kind: "distributor_signup", tenant_id: tenantId,
      payload: { company: input.company, contact_name: input.contact_name, mobile: input.mobile, city: input.city, email: input.email },
    }).select("id").single();
    if (note.error) throw note.error;

    // ---- admin email (best effort; failure never fails the signup) ----
    try {
      const r = await sendAdminEmail(signupEmail({ company: input.company, contact_name: input.contact_name, mobile: input.mobile, city: input.city, email: input.email }));
      await db.from("kamai_admin_notifications").update({ email_attempts: 1 }).eq("id", note.data.id);
      await recordResult(db, note.data.id, r);
    } catch (e) { console.error("[kamai-signup] email step failed:", e?.message); }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[kamai-signup] failed, rolling back:", e?.message || e);
    // rollback best effort: tenant first (cascades memberships/notification), then the auth user
    if (tenantId) {
      try { await db.from("kamai_admin_notifications").delete().eq("tenant_id", tenantId); } catch { /* ignore */ }
      try { await db.from("kamai_memberships").delete().eq("tenant_id", tenantId); } catch { /* ignore */ }
      try { const d = await db.from("kamai_tenants").delete().eq("id", tenantId); if (d.error) console.error("[kamai-signup] tenant rollback:", d.error.message); } catch { /* ignore */ }
    }
    if (userId) {
      try { const d = await db.auth.admin.deleteUser(userId); if (d.error) console.error("[kamai-signup] user rollback:", d.error.message); } catch { /* ignore */ }
    }
    return fail(res, 500, "Sign-up failed. Please try again in a moment.");
  }
}
