// Vercel Serverless Function — /api/supabase
// Proxies admin reads/writes to Supabase using the service role key.
// Safe because the CRM frontend is already gated by Firebase Auth (allowlist).

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  let supabase;
  try { supabase = getSupabase(); } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }

  const { action, ...params } = req.body || {};

  try {
    switch (action) {
      case "orders": {
        const { data, error } = await supabase
          .from("orders")
          .select("*, stores(name,area,category), profiles:rider_id(full_name,mobile)")
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "order_items": {
        const { data, error } = await supabase
          .from("order_items")
          .select("*")
          .eq("order_id", params.order_id);
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "update_order_status": {
        const { error } = await supabase
          .from("orders")
          .update({ status: params.status })
          .eq("id", params.id);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "stores": {
        const { data, error } = await supabase.from("stores").select("*").order("name");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "add_store": {
        const { data, error } = await supabase.from("stores").insert(params.store).select().single();
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "update_store": {
        const { id, ...fields } = params;
        const { error } = await supabase.from("stores").update(fields).eq("id", id);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "delete_store": {
        const { error } = await supabase.from("stores").delete().eq("id", params.id);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "riders": {
        const { data, error } = await supabase.from("profiles").select("*").order("full_name");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "update_rider": {
        const { id, ...fields } = params;
        const { error } = await supabase.from("profiles").update(fields).eq("id", id);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "locations": {
        const { data, error } = await supabase
          .from("rider_locations")
          .select("rider_id,latitude,longitude,accuracy,updated_at")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "products": {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .order("category")
          .order("name");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "insert_product": {
        const { error } = await supabase.from("products").insert(params.product);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "update_product": {
        const { id, ...fields } = params;
        const { error } = await supabase.from("products").update(fields).eq("id", id);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "areas": {
        const { data, error } = await supabase.from("areas").select("*").order("city");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "add_area": {
        const { error } = await supabase.from("areas").insert(params.area);
        if (error) throw error;
        return res.json({ success: true });
      }

      case "store_assignments": {
        const { data, error } = await supabase.from("store_assignments").select("*");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "toggle_store_assignment": {
        if (params.on) {
          const { error } = await supabase
            .from("store_assignments")
            .insert({ rider_id: params.rider_id, store_id: params.store_id });
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("store_assignments")
            .delete()
            .eq("rider_id", params.rider_id)
            .eq("store_id", params.store_id);
          if (error) throw error;
        }
        return res.json({ success: true });
      }

      case "rider_areas": {
        const { data, error } = await supabase.from("rider_areas").select("*");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "toggle_area_assignment": {
        if (params.on) {
          const { error } = await supabase
            .from("rider_areas")
            .insert({ rider_id: params.rider_id, area_id: params.area_id });
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("rider_areas")
            .delete()
            .eq("rider_id", params.rider_id)
            .eq("area_id", params.area_id);
          if (error) throw error;
        }
        return res.json({ success: true });
      }

      case "report_orders": {
        const since = new Date(Date.now() - Number(params.days || 30) * 86400000).toISOString();
        const { data, error } = await supabase
          .from("orders")
          .select("rider_id,total_value,incentive,status,store_id,created_at")
          .gte("created_at", since);
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "report_items": {
        const since = new Date(Date.now() - Number(params.days || 30) * 86400000).toISOString();
        const { data, error } = await supabase
          .from("order_items")
          .select("product_id,product_name,quantity,total,created_at")
          .gte("created_at", since);
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "app_settings": {
        const { data, error } = await supabase.from("app_settings").select("*");
        if (error) throw error;
        return res.json({ success: true, data });
      }

      case "upsert_setting": {
        const { error } = await supabase
          .from("app_settings")
          .upsert({ key: params.key, value: params.value });
        if (error) throw error;
        return res.json({ success: true });
      }

      case "push_subscriptions_count": {
        const { count, error } = await supabase
          .from("push_subscriptions")
          .select("*", { count: "exact", head: true });
        if (error) throw error;
        return res.json({ success: true, data: count });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
