// Vercel Serverless Function: /api/kamai-notify
// Authenticated (Bearer user JWT). Sends the admin email for notifications that are still
// pending/failed (attempts < 5). Platform admins process all tenants; other users only their own
// tenants (owner/manager). Idempotent: rows are claimed atomically, sent rows are never re-sent.
import { createClient } from "@supabase/supabase-js";
import { deliverPending } from "./_kamai-mail.js";

const ALLOWED_ORIGINS = [
  "https://apt.assorted.group",
  "https://apt.assortedtrade.com",
  "https://aptsystems.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    let sameHost = false;
    try { sameHost = !!req.headers.host && new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
    if (!sameHost && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ ok: false, error: "Origin not allowed" });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return res.status(401).json({ ok: false, error: "Missing bearer token" });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: "Server is not configured" });

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.auth.getUser(m[1].trim());
    if (error || !data?.user) return res.status(401).json({ ok: false, error: "Invalid or expired token" });
    const uid = data.user.id;

    const [pa, ur, mem] = await Promise.all([
      db.from("kamai_platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").limit(1),
      db.from("kamai_memberships").select("tenant_id,role").eq("user_id", uid).eq("status", "active"),
    ]);
    if (mem.error || pa.error) throw mem.error || pa.error;
    const isAdmin = !!pa.data || (ur.data?.length ?? 0) > 0;
    const tenantIds = isAdmin ? null
      : (mem.data ?? []).filter((r) => ["owner", "manager"].includes(r.role)).map((r) => r.tenant_id);
    if (!isAdmin && !tenantIds.length) return res.status(403).json({ ok: false, error: "Forbidden" });

    const result = await deliverPending(db, { tenantIds });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("[kamai-notify]", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}
