// Vercel Serverless Function — /api/supabase
// Proxies rider-data reads/writes to the apt-rider-connect app's /api/admin
// endpoint, which holds the Supabase service role key server-side (Lovable
// Cloud does not expose that key to other projects). Auth between the two
// apps is a shared secret (ADMIN_SYNC_KEY) sent as a Bearer token.
// Safe because the CRM frontend is already gated by Firebase Auth (allowlist).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const baseUrl = process.env.RIDER_CONNECT_API_URL;
  const adminKey = process.env.ADMIN_SYNC_KEY;
  if (!baseUrl || !adminKey) {
    console.error("api/supabase: RIDER_CONNECT_API_URL or ADMIN_SYNC_KEY not configured");
    return res.status(500).json({ success: false, error: "RIDER_CONNECT_API_URL or ADMIN_SYNC_KEY not configured" });
  }

  try {
    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.error(`api/supabase: upstream non-JSON response (${upstream.status}) from ${baseUrl}: ${text.slice(0, 300)}`);
      return res.status(502).json({
        success: false,
        error: `Upstream non-JSON response (${upstream.status}): ${text.slice(0, 200)}`,
      });
    }
    if (!upstream.ok) {
      console.error(`api/supabase: upstream ${upstream.status} from ${baseUrl}: ${text.slice(0, 300)}`);
    }
    return res.status(upstream.status).json(json);
  } catch (e) {
    console.error(`api/supabase: fetch to ${baseUrl} failed: ${e.message}`);
    return res.status(500).json({ success: false, error: e.message });
  }
}
