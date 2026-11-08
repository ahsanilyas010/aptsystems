// Vercel Serverless Function: /api/kamai-whatsapp
// Meta WhatsApp Cloud API webhook. GET = verification handshake, POST = signed events.
// Answers 200 once a signed event is persisted; persistence errors answer 500 so Meta retries.
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

// Keywords must be the whole (trimmed) message, so "please do not stop my delivery" is not an opt-out.
const OPT_OUT_RE = /^(stop|stop all|stopall|unsubscribe|band|band karo)$/i;
const OPT_IN_RE = /^(start|unstop|subscribe|resume|shuru)$/i;

function messageText(m) {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
}

// Unknown phone numbers are NOT attributed to any tenant: the tenant must carry
// settings.wa_phone_number_id (see docs/KAMAI_RUNBOOK.md).
async function resolveTenantId(db, phoneNumberId, cache) {
  if (!phoneNumberId) return null;
  if (cache.has(phoneNumberId)) return cache.get(phoneNumberId);
  const { data, error } = await db.from("kamai_tenants").select("id").eq("settings->>wa_phone_number_id", phoneNumberId).limit(1).maybeSingle();
  if (error) throw error;
  const id = data?.id ?? null;
  cache.set(phoneNumberId, id);
  return id;
}

// A status may only move forward: queued -> sent -> delivered -> read; failed only from queued/sent.
const STATUS_FROM = {
  sent: ["queued"],
  delivered: ["queued", "sent"],
  read: ["queued", "sent", "delivered"],
  failed: ["queued", "sent"],
};

// Throws on persistence failure so the webhook answers 5xx and Meta retries (handlers are idempotent).
async function handleStatus(db, s) {
  if (!s?.id || !STATUS_FROM[s.status]) return;
  const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
  const patch = { status: s.status };
  if (s.status === "sent") patch.sent_at = at;
  if (s.pricing?.category) patch.pricing_category = s.pricing.category;
  if (s.status === "failed" && s.errors?.[0]) patch.error = `${s.errors[0].code ?? ""}: ${String(s.errors[0].title || s.errors[0].message || "").slice(0, 300)}`;
  const { error } = await db.from("kamai_wa_messages").update(patch).eq("wamid", s.id).in("status", STATUS_FROM[s.status]);
  if (error) throw new Error(`status update: ${error.message}`);
}

async function handleInbound(db, m, value, cache) {
  const waId = String(m.from || "").replace(/\D/g, "");
  if (!m.id || !waId) return;
  const tenantId = await resolveTenantId(db, value.metadata?.phone_number_id, cache);
  if (!tenantId) { console.error("[kamai-whatsapp] unmapped phone_number_id, event ignored"); return; }
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const text = messageText(m).trim();

  // A retried or replayed message changes nothing.
  const dup = await db.from("kamai_wa_messages").select("id").eq("wamid", m.id).maybeSingle();
  if (dup.error) throw new Error(`message lookup: ${dup.error.message}`);
  if (dup.data) return;

  const { data: existing, error: ce } = await db.from("kamai_wa_contacts").select("id,opted_in_at,opted_out_at,last_inbound_at")
    .eq("tenant_id", tenantId).eq("wa_id", waId).maybeSingle();
  if (ce) throw new Error(`contact lookup: ${ce.message}`);
  const newer = (prev) => !prev || new Date(at).getTime() > new Date(prev).getTime();
  const row = { tenant_id: tenantId, wa_id: waId };
  if (newer(existing?.last_inbound_at)) row.last_inbound_at = at;
  if (OPT_OUT_RE.test(text)) {
    if (newer(existing?.opted_out_at)) row.opted_out_at = at;
  } else if (OPT_IN_RE.test(text)) {
    // Explicit resume clears a previous STOP (only if it is newer than the STOP).
    if (newer(existing?.opted_out_at)) {
      row.opted_out_at = null;
      row.opted_in_at = at; row.opt_in_source = "inbound_whatsapp"; row.opt_in_scopes = ["utility"];
    }
  } else if (!existing?.opted_in_at && !existing?.opted_out_at) {
    // Any other inbound message is implicit opt-in for utility messages only, never after a STOP.
    row.opted_in_at = at; row.opt_in_source = "inbound_whatsapp"; row.opt_in_scopes = ["utility"];
  }
  const up = await db.from("kamai_wa_contacts").upsert(row, { onConflict: "tenant_id,wa_id" }).select("id").maybeSingle();
  if (up.error) throw new Error(`contact upsert: ${up.error.message}`);

  const ins = await db.from("kamai_wa_messages").insert(
    { tenant_id: tenantId, contact_id: up.data?.id ?? existing?.id ?? null, direction: "in", wamid: m.id, payload: m, status: "received" });
  if (ins.error && ins.error.code !== "23505") throw new Error(`message insert: ${ins.error.message}`);
}

async function processEvents(db, payload) {
  const cache = new Map();
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      for (const s of value.statuses ?? []) await handleStatus(db, s);
      for (const m of value.messages ?? []) await handleInbound(db, m, value, cache);
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
    if (!db) throw new Error("Supabase env missing");
    await processEvents(db, payload);
  } catch (e) {
    // Signed payload but persistence failed: answer 5xx so Meta retries (all handlers are idempotent).
    console.error("[kamai-whatsapp]", e);
    return res.status(500).send("retry");
  }
  return res.status(200).send("ok");
}
