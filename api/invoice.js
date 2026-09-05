// Vercel Serverless Function — /api/invoice
// Generates a PDF invoice via invoice-generator.com and stores it in Supabase storage.
// Replaces the old GAS proxy flow which required a Google Apps Script deployment.
import { createClient } from "@supabase/supabase-js";

const INVOICE_API = "https://invoice-generator.com";
const BUCKET = "order-invoices"; // shared Supabase storage bucket

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Missing env: ${[!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const apiKey = process.env.INV_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: "INV_API_KEY is not configured in Vercel environment variables" });

  const { invId } = req.body || {};
  if (!invId) return res.status(400).json({ success: false, error: "invId is required" });

  let db;
  try { db = getSupabase(); } catch (e) { return res.status(500).json({ success: false, error: e.message }); }

  try {
    const [{ data: inv, error: invErr }, { data: items, error: itemsErr }] = await Promise.all([
      db.from("invoices").select("*").eq("id", invId).single(),
      db.from("invoice_items").select("*").eq("invoice_id", invId),
    ]);

    if (invErr || !inv) throw new Error(invErr?.message || `Invoice ${invId} not found`);
    if (itemsErr) throw new Error(itemsErr.message);

    // Optionally fetch customer for address details
    let custAddress = "";
    if (inv.cust_id) {
      const { data: cust } = await db.from("customers").select("name,phone,address,city").eq("id", inv.cust_id).maybeSingle();
      if (cust) {
        custAddress = [cust.phone, cust.address, cust.city].filter(Boolean).join("\n");
      }
    }

    const logoUrl = process.env.BUSINESS_LOGO_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/logo.png`
        : null);

    const invoiceBody = {
      from: process.env.BUSINESS_NAME || "Kamai Distribution",
      to: [inv.cust_name || inv.cust_id, custAddress].filter(Boolean).join("\n"),
      number: invId,
      date: inv.date || new Date().toLocaleDateString("en-GB"),
      currency: "PKR",
      items: (items || []).map(it => ({
        name: it.product_name || "Item",
        quantity: Number(it.qty) || 1,
        unit_cost: Number(it.rate) || 0,
      })),
      ...(logoUrl ? { logo: logoUrl } : {}),
      ...(inv.notes ? { notes: inv.notes } : {}),
      ...(inv.pay_terms ? { terms: inv.pay_terms } : {}),
    };

    console.log("[invoice]", invId, "→ invoice-generator.com, items:", invoiceBody.items.length);

    const pdfRes = await fetch(INVOICE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(invoiceBody),
    });

    if (!pdfRes.ok) {
      const text = await pdfRes.text().catch(() => "");
      throw new Error(`invoice-generator.com error (${pdfRes.status}): ${text.slice(0, 300)}`);
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const fileName = `crm/${invId}.pdf`;

    const { error: uploadErr } = await db.storage
      .from(BUCKET)
      .upload(fileName, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(fileName);
    const pdfUrl = urlData.publicUrl;

    await db.from("invoices").update({ pdf_url: pdfUrl }).eq("id", invId);

    console.log("[invoice]", invId, "✓", pdfUrl);
    return res.status(200).json({ success: true, pdfUrl, url: pdfUrl });
  } catch (e) {
    console.error("[invoice]", invId, e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
