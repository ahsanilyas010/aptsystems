// Vercel Serverless Function: /api/kamai-whatsapp
// Meta WhatsApp Cloud API webhook. GET = verification handshake, POST = signed events.
// Always answers 200 quickly once the signature is valid; errors are logged server-side only.
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const config = { api: { bodyParser: false } };

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw new Error("payload too large");
    chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  }
  return Buffer.concat(chunks);
}

function signatureValid(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const OPT_OUT_RE = /\b(stop|band|unsubscribe)\b/i;

function messageText(m) {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
}

async function resolveTenantId(db, phoneNumberId, cache) {
  if (cache.has(phoneNumberId)) return cache.get(phoneNumberId);
  let id = null;
  if (phoneNumberId) {
    const { data } = await db.from("kamai_tenants").select("id").eq("settings->>wa_phone_number_id", phoneNumberId).limit(1).maybeSingle();
    id = data?.id ?? null;
  }
  if (!id) {
    const { data } = await db.from("kamai_tenants").select("id").eq("slug", "kamai").limit(1).maybeSingle();
    id = data?.id ?? null;
  }
  cache.set(phoneNumberId, id);
  return id;
}

async function handleStatus(db, s) {
  if (!s?.id) return;
  const patch = { status: s.status, status_at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString() };
  if (s.pricing?.category) patch.pricing_category = s.pricing.category;
  if (typeof s.pricing?.billable === "boolean") patch.pricing_billable = s.pricing.billable;
  if (s.errors?.[0]?.code != null) patch.error_code = String(s.errors[0].code);
  const { error } = await db.from("kamai_wa_messages").update(patch).eq("wamid", s.id);
  if (error) console.error("[kamai-whatsapp] status update:", error.message);
}

async function handleInbound(db, m, value, cache) {
  const waId = String(m.from || "").replace(/\D/g, "");
  if (!m.id || !waId) return;
  const tenantId = await resolveTenantId(db, value.metadata?.phone_number_id, cache);
  if (!tenantId) { console.error("[kamai-whatsapp] no tenant resolved"); return; }
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const text = messageText(m);

  const ins = await db.from("kamai_wa_messages").upsert(
    { tenant_id: tenantId, wa_id: waId, direction: "in", wamid: m.id, type: m.type || "text", payload: m, status: "received", status_at: at },
    { onConflict: "wamid", ignoreDuplicates: true });
  if (ins.error) console.error("[kamai-whatsapp] message insert:", ins.error.message);

  const { data: existing } = await db.from("kamai_wa_contacts").select("opted_in_at,opted_out_at").eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
  const row = { tenant_id: tenantId, wa_id: waId, last_inbound_at: at, last_inbound_wamid: m.id };
  if (OPT_OUT_RE.test(text)) {
    row.opted_out_at = new Date().toISOString();
  } else if (!existing?.opted_in_at) {
    // Any inbound message is implicit opt-in, for utility messages only.
    row.opted_in_at = new Date().toISOString();
    row.opt_in_source = "inbound_whatsapp";
    row.opt_in_scopes = ["utility"];
    if (existing?.opted_out_at) row.opted_out_at = null;
  }
  const up = await db.from("kamai_wa_contacts").upsert(row, { onConflict: "tenant_id,wa_id" });
  if (up.error) console.error("[kamai-whatsapp] contact upsert:", up.error.message);
}

async function processEvents(db, payload) {
  const cache = new Map();
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      for (const s of value.statuses ?? []) await handleStatus(db, s).catch((e) => console.error("[kamai-whatsapp] status:", e));
      for (const m of value.messages ?? []) await handleInbound(db, m, value, cache).catch((e) => console.error("[kamai-whatsapp] inbound:", e));
    }
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (token && q["hub.mode"] === "subscribe" && q["hub.verify_token"] === token) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(String(q["hub.challenge"] ?? ""));
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let raw;
  try { raw = await readRaw(req); } catch (e) { console.error("[kamai-whatsapp] read:", e.message); return res.status(200).send("ok"); }
  if (!signatureValid(raw, req.headers["x-hub-signature-256"])) return res.status(401).send("Invalid signature");

  try {
    const payload = JSON.parse(raw.toString("utf8"));
    const db = getAdmin();
    if (!db) console.error("[kamai-whatsapp] Supabase env missing");
    else await processEvents(db, payload);
  } catch (e) {
    console.error("[kamai-whatsapp]", e);
  }
  return res.status(200).send("ok");
}
