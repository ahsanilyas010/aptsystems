// Shared mail helpers for Kamai OS (underscore prefix => not a Vercel route).
// Resend over plain fetch. Without RESEND_API_KEY every send is reported as 'skipped' (never an error).
// All user supplied text MUST go through esc() before it reaches HTML.

export const MAX_EMAIL_ATTEMPTS = 5;
const RESEND_URL = "https://api.resend.com/emails";

export const cfg = () => ({
  adminEmail: (process.env.KAMAI_ADMIN_EMAIL || "ahsanilyas35@gmail.com").trim(),
  from: (process.env.KAMAI_FROM_EMAIL || "Kamai OS <onboarding@resend.dev>").trim(),
  publicUrl: (process.env.KAMAI_PUBLIC_URL || "https://aptsystems.vercel.app").trim().replace(/\/+$/, ""),
});

export function esc(x) {
  return String(x ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/`/g, "&#96;");
}
// single-line, length-capped plain text (subjects, text bodies)
const line = (x, max = 200) => String(x ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** @returns {Promise<{status:'sent'|'skipped'|'failed', error?:string}>} never throws */
export async function sendAdminEmail({ subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "skipped" };
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.from, to: [c.adminEmail], subject: line(subject, 200), html, text }),
      signal: ctrl.signal,
    });
    if (r.ok) return { status: "sent" };
    let detail = "";
    try { detail = line(await r.text(), 300); } catch { /* ignore */ }
    return { status: "failed", error: `Resend ${r.status}${detail ? `: ${detail}` : ""}` };
  } catch (e) {
    return { status: "failed", error: line(e?.name === "AbortError" ? "Resend timeout" : e?.message || "send failed", 300) };
  } finally {
    clearTimeout(timer);
  }
}

function layout(title, rowsHtml, linkUrl, linkLabel) {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 12px">${esc(title)}</h2>
${rowsHtml}
<p style="margin:20px 0"><a href="${esc(linkUrl)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(linkLabel)}</a></p>
<p style="color:#888;font-size:12px">Kamai OS notification</p></body></html>`;
}
const kv = (rows) => `<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
  `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666;width:140px">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(v)}</td></tr>`).join("")}</table>`;

export function signupEmail(p = {}) {
  const link = `${cfg().publicUrl}/os/reviews`;
  const rows = [["Company", p.company], ["Contact", p.contact_name], ["Mobile", p.mobile], ["City", p.city], ["Email", p.email]];
  return {
    subject: `New distributor sign-up: ${line(p.company, 80)}`,
    html: layout("New distributor sign-up", kv(rows), link, "Review application"),
    text: `New distributor sign-up\n${rows.map(([k, v]) => `${k}: ${line(v)}`).join("\n")}\n\nReview: ${link}`,
  };
}

export function productsSubmittedEmail(p = {}) {
  const link = `${cfg().publicUrl}/os/reviews`;
  const names = (Array.isArray(p.product_names) ? p.product_names : []).slice(0, 10);
  const count = Number.isFinite(Number(p.count)) ? Number(p.count) : names.length;
  const list = names.length ? `<ul style="padding-left:18px">${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const more = count > names.length ? `<p style="color:#666">and ${esc(count - names.length)} more</p>` : "";
  return {
    subject: `${count} product${count === 1 ? "" : "s"} submitted by ${line(p.tenant_name, 80)}`,
    html: layout("Products submitted for review", kv([["Distributor", p.tenant_name], ["Products", count]]) + list + more, link, "Review products"),
    text: `Products submitted for review\nDistributor: ${line(p.tenant_name)}\nCount: ${count}\n${names.map((n) => `- ${line(n)}`).join("\n")}${count > names.length ? `\n... and ${count - names.length} more` : ""}\n\nReview: ${link}`,
  };
}

export function buildEmailFor(n) {
  if (n?.kind === "distributor_signup") return signupEmail(n.payload || {});
  if (n?.kind === "products_submitted") return productsSubmittedEmail(n.payload || {});
  return null;
}

/** Record the outcome of an attempt. attempts must already be counted by the caller. */
export async function recordResult(db, id, r) {
  const patch = r.status === "sent"
    ? { email_status: "sent", email_error: null, emailed_at: new Date().toISOString() }
    : r.status === "skipped"
      ? { email_status: "skipped", email_error: null }
      : { email_status: "failed", email_error: line(r.error || "send failed", 500) };
  const { error } = await db.from("kamai_admin_notifications").update(patch).eq("id", id);
  if (error) console.error("[kamai-mail] could not record result", error.message);
}

/**
 * Send emails for notifications that are pending/failed with attempts < MAX. One email per row.
 * Each row is claimed with an optimistic attempt-counter bump so concurrent callers never double send.
 * tenantIds: array => restrict to those tenants; null => no filter (platform admin / cron).
 * Never throws; returns {processed, sent, skipped, failed}.
 */
export async function deliverPending(db, { tenantIds = null, limit = 20 } = {}) {
  const out = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  if (Array.isArray(tenantIds) && !tenantIds.length) return out;
  try {
    let q = db.from("kamai_admin_notifications")
      .select("id,kind,tenant_id,payload,email_status,email_attempts")
      .in("email_status", ["pending", "failed"]).lt("email_attempts", MAX_EMAIL_ATTEMPTS)
      .order("created_at", { ascending: true }).limit(limit);
    if (Array.isArray(tenantIds)) q = q.in("tenant_id", tenantIds);
    const { data, error } = await q;
    if (error) { console.error("[kamai-mail] list failed", error.message); return out; }
    for (const n of data ?? []) {
      const claim = await db.from("kamai_admin_notifications")
        .update({ email_attempts: (n.email_attempts ?? 0) + 1 })
        .eq("id", n.id).eq("email_attempts", n.email_attempts ?? 0).in("email_status", ["pending", "failed"])
        .select("id");
      if (claim.error || !claim.data?.length) continue; // someone else owns it
      const mail = buildEmailFor(n);
      const r = mail ? await sendAdminEmail(mail) : { status: "failed", error: "unknown notification kind" };
      await recordResult(db, n.id, r);
      out.processed++; out[r.status]++;
    }
  } catch (e) {
    console.error("[kamai-mail] deliverPending", e?.message);
  }
  return out;
}
