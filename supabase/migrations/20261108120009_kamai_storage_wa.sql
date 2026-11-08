-- Kamai OS migration 009: proof-of-delivery storage, WhatsApp opt-in RPC, brand sell-through RPC.
-- Depends on 001..008 (kamai_stores, kamai_orders, kamai_wa_contacts, kamai_audit_log, private helpers).

-- ---------------------------------------------------------------------------
-- 1. Private storage bucket kamai-pod. Object names are '<tenant_id>/<order_id>/photo.jpg',
--    '<tenant_id>/<order_id>/signature.png' and '<tenant_id>/cash/<yyyy-mm-dd>/slip.jpg'.
--    The bucket is private: clients read it through signed URLs, never getPublicUrl.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kamai-pod', 'kamai-pod', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Access by the tenant folder prefix (first path segment) and the caller's role in that tenant:
--   read/write: owner, manager, booker; read only: finance, viewer;
--   rider: cash-day slips and the orders assigned to the rider; store: only the folders of its own store's orders.
--   delete: owner, manager.
create or replace function private.kamai_pod_access(p_name text, p_mode text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_t uuid;
  v_seg text;
  v_role text;
  v_store uuid;
begin
  if p_name is null or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+' then
    return false;
  end if;
  v_t := split_part(p_name, '/', 1)::uuid;
  v_seg := split_part(p_name, '/', 2);
  v_role := private.kamai_my_role(v_t);
  if v_role is null then return false; end if;
  if p_mode = 'delete' then return v_role in ('owner','manager'); end if;
  if v_role in ('owner','manager','booker') then return true; end if;
  if v_role in ('finance','viewer') then return p_mode = 'read'; end if;
  if v_role = 'rider' then
    return v_seg = 'cash'
        or (v_seg ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.kamai_orders o
                        where o.id = v_seg::uuid and o.tenant_id = v_t and o.rider_user_id = (select auth.uid())));
  end if;
  if v_role = 'store' then
    select m.store_id into v_store from public.kamai_memberships m
    where m.tenant_id = v_t and m.user_id = (select auth.uid()) and m.status = 'active';
    return v_store is not null
       and v_seg ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and exists (select 1 from public.kamai_orders o where o.id = v_seg::uuid and o.tenant_id = v_t and o.store_id = v_store);
  end if;
  return false;
end;
$$;
revoke execute on function private.kamai_pod_access(text, text) from public, anon;
grant execute on function private.kamai_pod_access(text, text) to authenticated, service_role;

drop policy if exists kamai_pod_select on storage.objects;
create policy kamai_pod_select on storage.objects for select to authenticated
  using (bucket_id = 'kamai-pod' and (select private.kamai_pod_access(name, 'read')));
drop policy if exists kamai_pod_insert on storage.objects;
create policy kamai_pod_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kamai-pod' and (select private.kamai_pod_access(name, 'write')));
drop policy if exists kamai_pod_update on storage.objects;
create policy kamai_pod_update on storage.objects for update to authenticated
  using (bucket_id = 'kamai-pod' and (select private.kamai_pod_access(name, 'write')))
  with check (bucket_id = 'kamai-pod' and (select private.kamai_pod_access(name, 'write')));
drop policy if exists kamai_pod_delete on storage.objects;
create policy kamai_pod_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kamai-pod' and (select private.kamai_pod_access(name, 'delete')));

-- ---------------------------------------------------------------------------
-- 2. kamai_set_wa_opt_in: consent register for a store. Store members cannot update kamai_stores directly,
--    so the store app calls this RPC. Callable by the member linked to that store, owner/manager of the tenant,
--    platform admins and the server. Writes kamai_stores, the WhatsApp contact registry and an audit row.
-- ---------------------------------------------------------------------------
create or replace function public.kamai_set_wa_opt_in(p_store_id uuid, p_opt_in boolean, p_source text default 'store_app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.kamai_stores;
  v_src text;
  v_wa text;
  v_now timestamptz := now();
  v_allowed boolean;
begin
  if p_opt_in is null then
    raise exception 'kamai: p_opt_in is required' using errcode = '22023';
  end if;
  select * into v_s from public.kamai_stores where id = p_store_id for update;
  if not found then
    raise exception 'kamai: store not found' using errcode = '22023';
  end if;
  v_allowed := (select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
    or (select private.kamai_has_role(v_s.tenant_id, array['owner','manager']))
    or exists (select 1 from public.kamai_memberships m
               join public.kamai_tenants t on t.id = m.tenant_id and t.status = 'active'
               where m.tenant_id = v_s.tenant_id and m.user_id = (select auth.uid()) and m.status = 'active'
                 and m.role = 'store' and m.store_id = v_s.id);
  if not v_allowed then
    raise exception 'kamai: not allowed to change WhatsApp consent of this store' using errcode = '42501';
  end if;
  v_src := lower(coalesce(nullif(btrim(p_source), ''), 'store_app'));
  if v_src !~ '^[a-z0-9_:.-]{1,40}$' then
    raise exception 'kamai: invalid opt-in source' using errcode = '22023';
  end if;

  if p_opt_in then
    update public.kamai_stores set wa_opt_in_at = v_now, wa_opt_in_source = v_src where id = v_s.id returning * into v_s;
  else
    update public.kamai_stores set wa_opt_in_at = null, wa_opt_in_source = 'opt_out:' || v_src where id = v_s.id returning * into v_s;
  end if;

  if v_s.mobile is not null then
    v_wa := regexp_replace(v_s.mobile, '[^0-9]', '', 'g');
    if p_opt_in then
      insert into public.kamai_wa_contacts (tenant_id, wa_id, store_id, opted_in_at, opt_in_source, opted_out_at)
      values (v_s.tenant_id, v_wa, v_s.id, v_now, v_src, null)
      on conflict (tenant_id, wa_id) do update
        set store_id = excluded.store_id, opted_in_at = v_now, opt_in_source = v_src, opted_out_at = null;
    else
      update public.kamai_wa_contacts set opted_out_at = v_now where tenant_id = v_s.tenant_id and wa_id = v_wa;
    end if;
  end if;

  insert into public.kamai_audit_log (table_name, op, record_id, tenant_id, actor, changed_keys, new_row)
  values ('kamai_wa_opt_in', 'UPDATE', v_s.id::text, v_s.tenant_id, auth.uid(), array['wa_opt_in_at','wa_opt_in_source'],
          jsonb_build_object('store_id', v_s.id, 'opt_in', p_opt_in, 'source', v_src, 'at', v_now));

  return jsonb_build_object('store_id', v_s.id, 'opt_in', p_opt_in, 'wa_opt_in_at', v_s.wa_opt_in_at,
                            'wa_opt_in_source', v_s.wa_opt_in_source);
end;
$$;
revoke execute on function public.kamai_set_wa_opt_in(uuid, boolean, text) from public, anon;
grant execute on function public.kamai_set_wa_opt_in(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. kamai_brand_sellthrough: the ONLY way a brand tenant reads distributor order data. One row per delivered line of the
--    brand's own SKUs, from distributors that granted the brand an active brand_view link. No store name, mobile, credit
--    or payment data: the store is an opaque id plus its area.
-- ---------------------------------------------------------------------------
create or replace function public.kamai_brand_sellthrough(p_days int default 90)
returns table (
  distributor_tenant_id uuid, product_id uuid, sku text, product_name text, order_id uuid, store_id uuid,
  area text, delivered_qty int, line_total_minor bigint, delivered_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select o.tenant_id, i.product_id, i.sku, i.name, o.id, o.store_id,
         coalesce(nullif(btrim(s.area), ''), 'Unknown'), i.delivered_qty, i.line_total_minor, o.delivered_at
  from public.kamai_products p
  join public.kamai_order_items i on i.product_id = p.id and i.tenant_id = p.tenant_id
  join public.kamai_orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
  join public.kamai_stores s on s.id = o.store_id
  where p.brand_tenant_id in (select m.tenant_id from public.kamai_memberships m
                              join public.kamai_tenants bt on bt.id = m.tenant_id and bt.status = 'active' and bt.type = 'brand'
                              where m.user_id = (select auth.uid()) and m.status = 'active'
                                and m.role in ('owner','manager','finance','viewer'))
    and exists (select 1 from public.kamai_tenant_links l
                join public.kamai_memberships lm on lm.tenant_id = l.grantee_tenant_id and lm.user_id = (select auth.uid())
                                                and lm.status = 'active' and lm.role in ('owner','manager','finance','viewer')
                where l.active and l.kind = 'brand_view' and l.grantor_tenant_id = p.tenant_id and l.grantee_tenant_id = p.brand_tenant_id)
    and o.fulfilment_status = 'delivered' and i.delivered_qty > 0
    and o.delivered_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));
$$;
revoke execute on function public.kamai_brand_sellthrough(int) from public, anon;
grant execute on function public.kamai_brand_sellthrough(int) to authenticated, service_role;
