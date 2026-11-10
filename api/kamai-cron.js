// Vercel Serverless Function: /api/kamai-cron
// Manual ops trigger for the daily job. pg_cron (01:30 UTC) is the primary scheduler.
// GET with 'Authorization: Bearer <CRON_SECRET>'.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { deliverPending } from "./_kamai-mail.js";

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });
  const secret = process.env.CRON_SECRET;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!secret || !m || !safeEqual(m[1].trim(), secret)) return res.status(401).json({ success: false, error: "Unauthorized" });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ success: false, error: "Server is not configured" });
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("kamai_run_daily");
    // also retry admin notification emails that are still pending/failed (attempts < 5)
    const notifications = await deliverPending(db, { tenantIds: null, limit: 50 });
    if (error) { console.error("[kamai-cron]", error.message); return res.status(500).json({ success: false, error: "kamai_run_daily failed", notifications }); }
    return res.status(200).json({ ok: true, result: data, notifications });
  } catch (e) {
    console.error("[kamai-cron]", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}
