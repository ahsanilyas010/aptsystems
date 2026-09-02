// Vercel Serverless Function — /api/supabase
// Handles all Supabase reads/writes directly using the service role key.
// The CRM frontend is already gated by Firebase Auth (allowlist).
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Missing env: ${[!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function ok(res, data) { return res.status(200).json(data); }
function err(res, msg, status = 400) { return res.status(status).json({ success: false, error: msg }); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return err(res, "Method not allowed", 405);

  const { action, ...params } = req.body || {};
  let db;
  try { db = getSupabase(); } catch (e) { return err(res, e.message, 500); }

  try {
    switch (action) {
      case "orders": {
        const [ordersRes, storesRes, profilesRes] = await Promise.all([
          db.from("orders").select("*").order("created_at", { ascending: false }).limit(500),
          db.from("stores").select("id,name,area,category"),
          db.from("profiles").select("id,full_name,mobile"),
        ]);
        if (ordersRes.error) throw ordersRes.error;
        const storeMap = Object.fromEntries((storesRes.data ?? []).map(s => [s.id, s]));
        const profileMap = Object.fromEntries((profilesRes.data ?? []).map(p => [p.id, p]));
        return ok(res, { success: true, data: (ordersRes.data ?? []).map(o => ({ ...o, stores: storeMap[o.store_id] ?? null, profiles: profileMap[o.rider_id] ?? null })) });
      }
      case "order_items": {
        const { data, error } = await db.from("order_items").select("product_id,product_name,quantity,total,trade_price").eq("order_id", params.order_id);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "stores": {
        const { data, error } = await db.from("stores").select("*").order("name");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "riders": {
        const { data, error } = await db.from("profiles").select("*").order("full_name");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "locations": {
        const { data, error } = await db.from("rider_locations").select("rider_id,latitude,longitude,accuracy,updated_at").order("updated_at", { ascending: false });
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "products": {
        const { data, error } = await db.from("products").select("*").order("category").order("name");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "areas": {
        const { data, error } = await db.from("areas").select("*").order("city");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "store_assignments": {
        const { data, error } = await db.from("store_assignments").select("*");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "rider_areas": {
        const { data, error } = await db.from("rider_areas").select("*");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "report_orders": {
        const days = Number(params.days) || 30;
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data, error } = await db.from("orders").select("id,rider_id,total_value,incentive,status,created_at").gte("created_at", since);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "report_items": {
        const days = Number(params.days) || 30;
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data: orderRows, error: oErr } = await db.from("orders").select("id").gte("created_at", since);
        if (oErr) throw oErr;
        const ids = (orderRows ?? []).map(o => o.id);
        if (!ids.length) return ok(res, { success: true, data: [] });
        const { data, error } = await db.from("order_items").select("product_id,product_name,quantity,total").in("order_id", ids);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "app_settings": {
        const { data, error } = await db.from("app_settings").select("*");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_setting": {
        const { error } = await db.from("app_settings").upsert({ key: params.key, value: params.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "push_subscriptions_count": {
        const { count, error } = await db.from("push_subscriptions").select("*", { count: "exact", head: true });
        if (error) throw error;
        return ok(res, { success: true, data: count ?? 0 });
      }
      case "update_order_status": {
        const { error } = await db.from("orders").update({ status: params.status }).eq("id", params.id);
        if (error) throw error;
        if (params.status === "Approved") {
          try {
            const { data: order } = await db.from("orders").select("rider_id,order_no,total_value").eq("id", params.id).single();
            if (order?.rider_id) {
              const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
              const subject = process.env.VAPID_SUBJECT || "mailto:admin@apt.local";
              if (pub && priv) {
                const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", order.rider_id);
                if (subs?.length) {
                  const webpush = await import("web-push");
                  webpush.setVapidDetails(subject, pub, priv);
                  const payload = JSON.stringify({ title: "Order Approved ✅", body: `Order #${order.order_no} has been approved.`, url: "/orders" });
                  for (const s of subs) {
                    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); }
                    catch (pe) { if (pe?.statusCode === 404 || pe?.statusCode === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
                  }
                }
              }
            }
          } catch { /* non-fatal */ }
        }
        return ok(res, { success: true });
      }
      case "update_store": {
        const { id, ...fields } = params;
        const { error } = await db.from("stores").update(fields).eq("id", id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "delete_store": {
        const { error } = await db.from("stores").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "add_store": {
        const { error } = await db.from("stores").insert(params.store);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "update_rider": {
        const { id, ...fields } = params;
        const { error } = await db.from("profiles").update(fields).eq("id", id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "update_product": {
        const { id, ...fields } = params;
        const { error } = await db.from("products").update(fields).eq("id", id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "insert_product": {
        const product = { ...params.product, id: params.product?.id || crypto.randomUUID() };
        const { error } = await db.from("products").insert(product);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "toggle_store_assignment": {
        if (params.on) {
          const { error } = await db.from("store_assignments").insert({ rider_id: params.rider_id, store_id: params.store_id });
          if (error) throw error;
        } else {
          const { error } = await db.from("store_assignments").delete().eq("rider_id", params.rider_id).eq("store_id", params.store_id);
          if (error) throw error;
        }
        return ok(res, { success: true });
      }
      case "toggle_area_assignment": {
        if (params.on) {
          const { error } = await db.from("rider_areas").insert({ rider_id: params.rider_id, area_id: params.area_id });
          if (error) throw error;
        } else {
          const { error } = await db.from("rider_areas").delete().eq("rider_id", params.rider_id).eq("area_id", params.area_id);
          if (error) throw error;
        }
        return ok(res, { success: true });
      }
      case "add_area": {
        const { error } = await db.from("areas").insert(params.area);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "returns": {
        const [returnsRes, storesRes, profilesRes] = await Promise.all([
          db.from("returns").select("*").order("created_at", { ascending: false }).limit(500),
          db.from("stores").select("id,name,area"),
          db.from("profiles").select("id,full_name"),
        ]);
        if (returnsRes.error) throw returnsRes.error;
        const storeMap = Object.fromEntries((storesRes.data ?? []).map(s => [s.id, s]));
        const profileMap = Object.fromEntries((profilesRes.data ?? []).map(p => [p.id, p]));
        return ok(res, { success: true, data: (returnsRes.data ?? []).map(r => ({ ...r, stores: storeMap[r.store_id] ?? null, profiles: profileMap[r.rider_id] ?? null })) });
      }
      case "return_items": {
        const { data, error } = await db.from("return_items").select("*").eq("return_id", params.return_id);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "admin_create_return": {
        const { store_id, order_id, gas_invoice_id, reason, items } = params;
        if (!items?.length) throw new Error("Return has no items");
        const total = items.reduce((s, it) => s + Number(it.qty) * Number(it.trade_price ?? 0), 0);
        const { data: ret, error: rErr } = await db.from("returns").insert({ store_id, order_id: order_id || null, gas_invoice_id: gas_invoice_id || null, reason, total }).select().single();
        if (rErr) throw rErr;
        const { error: iErr } = await db.from("return_items").insert(items.map(it => ({ return_id: ret.id, product_id: it.product_id, product_name: it.product_name, qty: Number(it.qty), trade_price: Number(it.trade_price ?? 0) })));
        if (iErr) throw iErr;
        for (const it of items) {
          const { data: prod } = await db.from("products").select("current_stock").eq("id", it.product_id).single();
          if (prod) await db.from("products").update({ current_stock: (prod.current_stock ?? 0) + Number(it.qty) }).eq("id", it.product_id);
        }
        return ok(res, { success: true, data: ret });
      }
      case "update_return": {
        const { id, ...fields } = params;
        const { error } = await db.from("returns").update(fields).eq("id", id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      // ── Financial tables ──
      case "customers": {
        const { data, error } = await db.from("customers").select("*").order("name");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_customer": {
        const { error } = await db.from("customers").upsert(params.customer, { onConflict: "id" });
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "delete_customer": {
        const { error } = await db.from("customers").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "vendors": {
        const { data, error } = await db.from("vendors").select("*").order("name");
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_vendor": {
        const { error } = await db.from("vendors").upsert(params.vendor, { onConflict: "id" });
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "delete_vendor": {
        const { error } = await db.from("vendors").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "invoices": {
        const days = params.days ? Number(params.days) : null;
        let q = db.from("invoices").select("*").order("date", { ascending: false });
        if (days) q = q.gte("date", new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
        if (params.status) q = q.eq("status", params.status);
        if (params.cust_id) q = q.eq("cust_id", params.cust_id);
        const { data, error } = await q.limit(params.limit ? Number(params.limit) : 1000);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "invoice_items": {
        const { data, error } = await db.from("invoice_items").select("*").eq("invoice_id", params.invoice_id);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_invoice": {
        const { items, ...header } = params.invoice;
        const { error: hErr } = await db.from("invoices").upsert(header, { onConflict: "id" });
        if (hErr) throw hErr;
        if (items?.length) {
          await db.from("invoice_items").delete().eq("invoice_id", header.id);
          const { error: iErr } = await db.from("invoice_items").insert(items.map(it => ({ ...it, invoice_id: header.id })));
          if (iErr) throw iErr;
        }
        return ok(res, { success: true });
      }
      case "delete_invoice": {
        const { error } = await db.from("invoices").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "save_pdf_url": {
        const { error } = await db.from("invoices").update({ pdf_url: params.pdf_url }).eq("id", params.inv_id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "adjust_stock": {
        const { data: prod, error: pErr } = await db.from("products").select("current_stock").eq("id", params.pid).single();
        if (pErr) throw pErr;
        const newStock = (prod.current_stock ?? 0) + Number(params.delta);
        const { error } = await db.from("products").update({ current_stock: newStock }).eq("id", params.pid);
        if (error) throw error;
        return ok(res, { success: true, stock: newStock });
      }
      case "purchases": {
        const days = params.days ? Number(params.days) : null;
        let q = db.from("vendors_purchases").select("*").order("date", { ascending: false });
        if (days) q = q.gte("date", new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
        if (params.vendor_id) q = q.eq("vendor_id", params.vendor_id);
        const { data, error } = await q.limit(params.limit ? Number(params.limit) : 1000);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "purchase_items": {
        const { data, error } = await db.from("purchase_items").select("*").eq("purchase_id", params.purchase_id);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_purchase": {
        const { items, ...header } = params.purchase;
        const { error: hErr } = await db.from("vendors_purchases").upsert(header, { onConflict: "id" });
        if (hErr) throw hErr;
        if (items?.length) {
          await db.from("purchase_items").delete().eq("purchase_id", header.id);
          const { error: iErr } = await db.from("purchase_items").insert(items.map(it => ({ ...it, purchase_id: header.id })));
          if (iErr) throw iErr;
        }
        return ok(res, { success: true });
      }
      case "delete_purchase": {
        const { error } = await db.from("vendors_purchases").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "payments": {
        const days = params.days ? Number(params.days) : null;
        let q = db.from("payments").select("*").order("date", { ascending: false });
        if (days) q = q.gte("date", new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
        if (params.type) q = q.eq("type", params.type);
        if (params.party_id) q = q.eq("party_id", params.party_id);
        const { data, error } = await q.limit(params.limit ? Number(params.limit) : 1000);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_payment": {
        const { error } = await db.from("payments").upsert(params.payment, { onConflict: "id" });
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "delete_payment": {
        const { error } = await db.from("payments").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "expenses": {
        const days = params.days ? Number(params.days) : null;
        let q = db.from("expenses").select("*").order("date", { ascending: false });
        if (days) q = q.gte("date", new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
        if (params.category) q = q.eq("category", params.category);
        const { data, error } = await q.limit(params.limit ? Number(params.limit) : 1000);
        if (error) throw error;
        return ok(res, { success: true, data });
      }
      case "upsert_expense": {
        const { error } = await db.from("expenses").upsert(params.expense, { onConflict: "id" });
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "delete_expense": {
        const { error } = await db.from("expenses").delete().eq("id", params.id);
        if (error) throw error;
        return ok(res, { success: true });
      }
      case "bulk_import_financial": {
        const { customers, vendors, invoices, invoice_items, purchases, purchase_items, payments, expenses } = params;
        // Deduplicate by id — GAS can produce duplicate rows with the same id
        const dedupById = (rows) => {
          if (!rows?.length) return rows ?? [];
          const seen = new Set();
          return rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        };
        // invoice_items / purchase_items: deduplicate by fk+product to avoid duplicate line items
        const dedupItems = (rows, fkField) => {
          if (!rows?.length) return [];
          const seen = new Set();
          return rows.filter(r => {
            const k = `${r[fkField]}:${r.product_id}:${r.product_name}`;
            if (seen.has(k)) return false; seen.add(k); return true;
          });
        };

        const upsertTable = async (table, rows) => {
          if (!rows?.length) return;
          const CHUNK = 500;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: "id" });
            if (error) throw new Error(`${table}: ${error.message}`);
          }
        };
        // invoice_items / purchase_items use bigint serial ids — delete+insert per batch
        const replaceItems = async (table, fkField, rows) => {
          if (!rows?.length) return;
          const parentIds = [...new Set(rows.map(r => r[fkField]).filter(Boolean))];
          if (parentIds.length) {
            const { error: delErr } = await db.from(table).delete().in(fkField, parentIds);
            if (delErr) throw new Error(`${table} delete: ${delErr.message}`);
          }
          // Strip id so the serial auto-increments
          const clean = rows.map(({ id: _id, ...rest }) => rest);
          const CHUNK = 500;
          for (let i = 0; i < clean.length; i += CHUNK) {
            const { error } = await db.from(table).insert(clean.slice(i, i + CHUNK));
            if (error) throw new Error(`${table}: ${error.message}`);
          }
        };

        const dedupedCustomers = dedupById(customers);
        const dedupedVendors   = dedupById(vendors);
        const dedupedInvoices  = dedupById(invoices);
        const dedupedPurchases = dedupById(purchases);
        const dedupedPayments  = dedupById(payments);
        const dedupedExpenses  = dedupById(expenses);
        const dedupedInvItems  = dedupItems(invoice_items ?? [], "invoice_id");
        const dedupedPurItems  = dedupItems(purchase_items ?? [], "purchase_id");

        await upsertTable("customers",         dedupedCustomers);
        await upsertTable("vendors",           dedupedVendors);
        await upsertTable("invoices",          dedupedInvoices);
        await upsertTable("vendors_purchases", dedupedPurchases);
        await upsertTable("payments",          dedupedPayments);
        await upsertTable("expenses",          dedupedExpenses);
        await replaceItems("invoice_items",  "invoice_id",  dedupedInvItems);
        await replaceItems("purchase_items", "purchase_id", dedupedPurItems);

        return ok(res, { success: true, counts: {
          customers: dedupedCustomers.length, vendors: dedupedVendors.length,
          invoices: dedupedInvoices.length, invoice_items: dedupedInvItems.length,
          purchases: dedupedPurchases.length, purchase_items: dedupedPurItems.length,
          payments: dedupedPayments.length, expenses: dedupedExpenses.length,
        }});
      }
      case "merge_customers": {
        const { groups } = params;
        const snapshotGroups = [];
        for (const group of groups) {
          const { keepId, mergeIds } = group;
          if (!keepId || !mergeIds?.length) continue;
          const [{ data: mergedCustomers }, { data: affectedInvoices }, { data: affectedPayments }] = await Promise.all([
            db.from("customers").select("*").in("id", mergeIds),
            db.from("invoices").select("id,cust_id").in("cust_id", mergeIds),
            db.from("payments").select("id,party_id").in("party_id", mergeIds).eq("type", "Received"),
          ]);
          if (affectedInvoices?.length) {
            const { error } = await db.from("invoices").update({ cust_id: keepId }).in("cust_id", mergeIds);
            if (error) throw error;
          }
          if (affectedPayments?.length) {
            const { error } = await db.from("payments").update({ party_id: keepId }).in("party_id", mergeIds).eq("type", "Received");
            if (error) throw error;
          }
          const { error: delErr } = await db.from("customers").delete().in("id", mergeIds);
          if (delErr) throw delErr;
          snapshotGroups.push({
            keepId, mergeIds,
            mergedCustomers: mergedCustomers || [],
            invoiceChanges: (affectedInvoices || []).map(inv => ({ id: inv.id, originalCustId: inv.cust_id })),
            paymentChanges: (affectedPayments || []).map(pay => ({ id: pay.id, originalPartyId: pay.party_id })),
          });
        }
        return ok(res, { success: true, data: { snapshot: { groups: snapshotGroups } } });
      }
      case "undo_merge_customers": {
        const { groups } = params;
        for (const group of groups) {
          const { mergedCustomers, invoiceChanges, paymentChanges } = group;
          if (mergedCustomers?.length) {
            const { error } = await db.from("customers").upsert(mergedCustomers, { onConflict: "id" });
            if (error) throw error;
          }
          for (const change of invoiceChanges || []) {
            const { error } = await db.from("invoices").update({ cust_id: change.originalCustId }).eq("id", change.id);
            if (error) throw error;
          }
          for (const change of paymentChanges || []) {
            const { error } = await db.from("payments").update({ party_id: change.originalPartyId }).eq("id", change.id);
            if (error) throw error;
          }
        }
        return ok(res, { success: true });
      }
      default:
        return err(res, `Unknown action: ${action}`);
    }
  } catch (e) {
    console.error("[api/supabase]", e);
    return err(res, e?.message || "Unknown error", 500);
  }
}
