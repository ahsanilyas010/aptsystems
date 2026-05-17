// Vercel Serverless Function — /api/gas
// Acts as a server-side proxy to the Google Apps Script Web App.
// This eliminates CORS issues since the request is made server-to-server.
// The GAS_URL and API_KEY are secret env vars (no VITE_ prefix = never sent to browser).

export default async function handler(req, res) {
  const GAS_URL = process.env.GAS_URL;
  const API_KEY = process.env.API_KEY;

  // CORS headers so the browser can call /api/gas from apt.assortedtrade.com
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!GAS_URL || !API_KEY) {
    return res.status(500).json({ success: false, error: "Server misconfigured: GAS_URL or API_KEY missing." });
  }

  try {
    if (req.method === "GET") {
      // Build the upstream GAS URL — inject the secret key server-side
      const url = new URL(GAS_URL);
      url.searchParams.set("key", API_KEY);
      // Forward all query params from the client except 'key' (client never sends it)
      const incoming = new URL(req.url, "http://localhost");
      incoming.searchParams.forEach((v, k) => {
        if (k !== "key") url.searchParams.set(k, v);
      });

      const upstream = await fetch(url.toString(), { redirect: "follow" });
      const data = await upstream.json();
      return res.status(upstream.status).json(data);

    } else if (req.method === "POST") {
      // Merge client body with secret key server-side
      const body = req.body || {};
      const upstream = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, key: API_KEY }),
        redirect: "follow",
      });
      const data = await upstream.json();
      return res.status(upstream.status).json(data);

    } else {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
