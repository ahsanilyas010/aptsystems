-- Kamai OS migration 008: OS tasks, KPI snapshots and KPIs, daily job, legacy import, seed tenants, pg_cron.

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_os_tasks (
  id          text primary key check (id ~ '^[a-z][a-z0-9_-]{0,30}$'),
  panel       text not null,
  title       text not null,
  meta        text,
  owner       text,
  priority    text check (priority is null or priority in ('P1','P2','P3')),
  sort        int not null default 0,
  done        boolean not null default false,
  done_at     timestamptz,
  note        text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
create index if not exists kamai_os_tasks_panel_idx on public.kamai_os_tasks (panel, sort);
alter table public.kamai_os_tasks enable row level security;

create table if not exists public.kamai_kpi_snapshots (
  snapshot_date date primary key,
  metrics       jsonb not null,
  created_at    timestamptz not null default now()
);
alter table public.kamai_kpi_snapshots enable row level security;

drop policy if exists kamai_os_tasks_all on public.kamai_os_tasks;
create policy kamai_os_tasks_all on public.kamai_os_tasks for all to authenticated
  using ((select private.kamai_is_platform_admin()))
  with check ((select private.kamai_is_platform_admin()));
drop policy if exists kamai_kpi_snapshots_select on public.kamai_kpi_snapshots;
create policy kamai_kpi_snapshots_select on public.kamai_kpi_snapshots for select to authenticated
  using ((select private.kamai_is_platform_admin()));

revoke all on public.kamai_os_tasks from anon;
grant select, insert, update, delete on public.kamai_os_tasks to authenticated;
grant all on public.kamai_os_tasks to service_role;
revoke all on public.kamai_kpi_snapshots from anon;
grant select on public.kamai_kpi_snapshots to authenticated;
grant all on public.kamai_kpi_snapshots to service_role;

-- tasks from the Kamai OS dashboard artifact
insert into public.kamai_os_tasks (id, panel, title, meta, owner, priority, sort) values
 ('t1','command','Run margin math on 10 APT SKUs - buy price vs petrol shop sell price','Olive oil, Manuka honey, Caprice, Smart Flamingo, orthopedic supports + 5 more','Ahsan / Mamoona','P1',1),
 ('t2','command','Call Bykea B2B/Enterprise team - ask about batched multi-stop delivery rate','Need per-drop cost for Rs 20,000+ B2B orders, not per-parcel consumer rate','Ahsan','P1',2),
 ('t3','command','Map 30 petrol stations and highway stops in Islamabad + Pindi with contact details','PSO, Shell, Total, Attock, BP stations on N-5, M-2, Islamabad highway, Murree road','Zohaib / Raheela','P1',3),
 ('t4','command','Identify 5 Islamabad Shopify/imported brands to pitch as distribution partners','Products already in D.Watson and Shams but not in petrol shops or general trade','Ahsan / Raheela','P1',4),
 ('t5','command','Send updated model summary email to Ali Raza','Petrol shop angle, sourcing from direct importers, Bykea delivery model','Ahsan','P2',5),
 ('t6','command','Update Kamai Hero commission tiers to show correctly on website and app','Current tiers: Rs 1,000 first order / Rs 500 repeat 10k+ / Rs 250 repeat below 10k','Abdurrahman','P2',6),
 ('t7','command','Draft one-page brand partnership pitch deck - "Sell through us"','Target: importers and Shopify brands with no general trade distribution','Ahsan / Barkha (design)','P2',7),
 ('t8','command','Reduce outstanding AR - chase top 10 unpaid APT invoices','Outstanding AR is live on the Command panel. Collection is the working capital for Kamai JIT sourcing','Zohaib / Mamoona','P1',8),
 ('g1','gaps','Expiry date management - imported products have fixed shelf life','Set a rule: no product within 6 months of expiry goes into the channel. Track batch dates in ERP.',null,null,1),
 ('g2','gaps','PSQCA labelling compliance for imported goods','Every imported product sold in Pakistan needs Urdu labelling and local importer information. Check every new SKU before it goes to stores.',null,null,2),
 ('g3','gaps','Hero fraud controls beyond the current rules','Add: max 3 new stores per Hero per day (prevents bulk fake registration), GPS radius check on store check-in, photo verification of shelf placement on first delivery.',null,null,3),
 ('g4','gaps','Seasonal demand planning','Honey, energy drinks, and personal care have seasonal peaks. Plan stock levels 60 days in advance for Ramadan, Eid, and summer.',null,null,4),
 ('g5','gaps','Warehouse capacity - can APT handle 2x the current SKU volume?','As you add new brands, storage becomes a constraint. Confirm current warehouse capacity and when you hit the ceiling.',null,null,5),
 ('g6','gaps','A competitor enters the petrol shop channel','Dawlance/SuperSave and similar players have tried retail distribution plays before. Monitor. Your defensibility is the Hero network and store relationships - not the product.',null,null,6)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- KPIs (platform admin only)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_os_kpis_core()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy jsonb;
  v_kamai jsonb;
begin
  select to_jsonb(r) into v_legacy from (select
    (select count(*) from public.invoices where status <> 'VOIDED') as invoices,
    (select count(*) from public.invoices where status = 'VOIDED') as voided,
    (select coalesce(sum(total), 0) from public.invoices where status <> 'VOIDED') as invoiced_total,
    (select coalesce(sum(total), 0) from public.invoices where status = 'Unpaid') as unpaid_total,
    (select coalesce(sum(open_bal), 0) from public.customers) as open_bal_total,
    (select coalesce(sum(total), 0) from public.invoices where status = 'Unpaid' and current_date - date >= 60) as ar_60plus,
    (select count(*) from public.invoices where status = 'Unpaid' and current_date - date >= 60) as ar_60plus_count,
    (select coalesce(sum(amount), 0) from public.payments where type = 'Received' and date >= current_date - 1) as collected_yesterday,
    (select count(*) from public.orders) as orders_all,
    (select count(*) from public.orders where status not in ('Rejected','Cancelled')) as live_orders,
    (select coalesce(sum(total_value), 0) from public.orders where status not in ('Rejected','Cancelled')) as live_value,
    (select count(*) from public.orders where status = 'Cancelled') as cancelled,
    (select count(*) from public.orders where status = 'Rejected') as rejected,
    (select count(*) from public.orders where status not in ('Rejected','Cancelled') and created_at >= now() - interval '7 days') as orders_7d,
    (select coalesce(sum(total_value), 0) from public.orders where status not in ('Rejected','Cancelled') and created_at >= now() - interval '7 days') as value_7d,
    (select count(distinct rider_id) from public.orders where status not in ('Rejected','Cancelled') and created_at >= now() - interval '7 days') as heroes_active_7d,
    (select count(*) from public.orders where status in ('Pending','Approved','Packed','Dispatched') and created_at < now() - interval '2 days') as stuck_orders,
    (select count(*) from public.stores) as stores,
    (select count(distinct store_id) from public.orders where status not in ('Rejected','Cancelled')) as stores_ordered,
    (select count(*) from public.user_roles where role = 'rider') as heroes_registered,
    (select count(distinct rider_id) from public.orders where status not in ('Rejected','Cancelled')) as heroes_active
  ) r;

  select jsonb_build_object(
    'kamai_tenants', (select count(*) from public.kamai_tenants where status = 'active'),
    'kamai_stores', (select count(*) from public.kamai_stores),
    'kamai_orders_by_state', coalesce((select jsonb_object_agg(fulfilment_status, c)
                                       from (select fulfilment_status, count(*) c from public.kamai_orders group by 1) o), '{}'::jsonb),
    'kamai_outstanding_minor', (select coalesce(sum(outstanding_minor), 0) from public.kamai_credit_exposures where status = 'open'),
    'kamai_par30', (select round(coalesce(sum(outstanding_minor) filter (where max_dpd > 30), 0)::numeric / nullif(sum(outstanding_minor), 0), 4)
                    from public.kamai_credit_snapshots where snapshot_date = (select max(snapshot_date) from public.kamai_credit_snapshots)),
    'kamai_wa_queued', (select count(*) from public.kamai_wa_messages where status = 'queued')
  ) into v_kamai;

  return v_legacy || v_kamai || jsonb_build_object('generated_at', now());
end;
$$;
revoke execute on function private.kamai_os_kpis_core() from public, anon, authenticated;
grant execute on function private.kamai_os_kpis_core() to service_role;

create or replace function public.kamai_os_kpis()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  return private.kamai_os_kpis_core();
end;
$$;
revoke execute on function public.kamai_os_kpis() from public, anon;
grant execute on function public.kamai_os_kpis() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- daily job
-- ---------------------------------------------------------------------------
create or replace function public.kamai_run_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_s record;
  v_x record;
  v_t record;
  v_n_eval int := 0;
  v_n_snap int := 0;
  v_n_dun int := 0;
  v_n_msg int := 0;
  v_paused int := 0;
  v_unpaused int := 0;
  v_par30 numeric;
  v_thr numeric;
  v_wa text;
  v_contact uuid;
  v_msg uuid;
begin
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    raise exception 'kamai: platform admins or the scheduler only' using errcode = '42501';
  end if;

  -- 1. re-evaluate stores with activity
  for v_s in select st.id from public.kamai_stores st
             where exists (select 1 from public.kamai_credit_exposures x where x.store_id = st.id and x.status = 'open')
                or exists (select 1 from public.kamai_orders o where o.store_id = st.id and o.created_at >= now() - interval '90 days')
                or exists (select 1 from public.kamai_credit_exposures x where x.store_id = st.id and x.closed_at >= now() - interval '180 days') loop
    perform private.kamai_evaluate_store_core(v_s.id);
    v_n_eval := v_n_eval + 1;
  end loop;

  -- 2. snapshots for every store with open exposure
  insert into public.kamai_credit_snapshots
    (snapshot_date, store_id, tenant_id, outstanding_minor, max_dpd, bucket, tier, limit_minor, status, eligible, ineligibility_reason)
  select v_today, x.store_id, x.tenant_id, sum(x.outstanding_minor)::bigint,
         max(greatest(0, v_today - x.due_date))::int,
         public.kamai_dpd_bucket(max(greatest(0, v_today - x.due_date))::int),
         a.tier, a.limit_minor, a.status,
         (max(greatest(0, v_today - x.due_date)) <= 90 and coalesce(a.status, 'active') <> 'written_off'),
         case when coalesce(a.status, '') = 'written_off' then 'WRITTEN_OFF'
              when max(greatest(0, v_today - x.due_date)) > 90 then 'DPD_OVER_90' end
  from public.kamai_credit_exposures x
  left join public.kamai_credit_accounts a on a.store_id = x.store_id
  where x.status = 'open' and x.outstanding_minor > 0
  group by x.store_id, x.tenant_id, a.tier, a.limit_minor, a.status
  on conflict (snapshot_date, store_id) do update set
    outstanding_minor = excluded.outstanding_minor, max_dpd = excluded.max_dpd, bucket = excluded.bucket, tier = excluded.tier,
    limit_minor = excluded.limit_minor, status = excluded.status, eligible = excluded.eligible, ineligibility_reason = excluded.ineligibility_reason;
  get diagnostics v_n_snap = row_count;

  -- 3. kill rules: PAR30 per tenant
  for v_t in select t.id, t.settings from public.kamai_tenants t where t.status = 'active' loop
    select coalesce(sum(outstanding_minor) filter (where max_dpd > 30), 0)::numeric / nullif(sum(outstanding_minor), 0)
      into v_par30 from public.kamai_credit_snapshots where tenant_id = v_t.id and snapshot_date = v_today;
    v_thr := coalesce((private.kamai_rules(v_t.id) ->> 'par30_pause_pct')::numeric, 8) / 100;
    if v_par30 is not null and v_par30 > v_thr and coalesce(v_t.settings ->> 'credit_paused', 'false') <> 'true' then
      update public.kamai_tenants set settings = settings || jsonb_build_object('credit_paused', 'true', 'credit_paused_by', 'auto', 'credit_paused_at', now())
      where id = v_t.id;
      v_paused := v_paused + 1;
    elsif (v_par30 is null or v_par30 <= v_thr) and v_t.settings ->> 'credit_paused_by' = 'auto'
          and coalesce(v_t.settings ->> 'credit_paused', 'false') = 'true' then
      update public.kamai_tenants set settings = (settings - 'credit_paused' - 'credit_paused_by' - 'credit_paused_at') where id = v_t.id;
      v_unpaused := v_unpaused + 1;
    end if;
  end loop;

  -- 4. dunning
  for v_x in
    select x.id as exposure_id, x.tenant_id, x.store_id, x.outstanding_minor, x.due_date, r.id as rule_id, r.offset_days, r.action,
           r.template_name, s.name as store_name, s.mobile, s.wa_opt_in_at, i.display_number
    from public.kamai_credit_exposures x
    join public.kamai_dunning_rules r on r.tenant_id = x.tenant_id and r.active and r.offset_days = (v_today - x.due_date)
    join public.kamai_stores s on s.id = x.store_id
    left join public.kamai_invoices i on i.id = x.invoice_id
    where x.status = 'open' and x.outstanding_minor > 0
      and not exists (select 1 from public.kamai_dunning_events e where e.exposure_id = x.id and e.offset_days = r.offset_days)
  loop
    v_msg := null;
    if v_x.mobile is not null and v_x.wa_opt_in_at is not null then
      v_wa := regexp_replace(v_x.mobile, '[^0-9]', '', 'g');
      insert into public.kamai_wa_contacts (tenant_id, wa_id, store_id, opted_in_at, opt_in_source)
      values (v_x.tenant_id, v_wa, v_x.store_id, v_x.wa_opt_in_at, 'store_record')
      on conflict (tenant_id, wa_id) do update set store_id = excluded.store_id
      returning id into v_contact;
      insert into public.kamai_wa_messages (tenant_id, contact_id, store_id, to_wa_id, direction, template_name, category, payload, status)
      values (v_x.tenant_id, v_contact, v_x.store_id, v_wa, 'out', v_x.template_name, 'utility',
              jsonb_build_object('params', jsonb_build_array(v_x.store_name, coalesce(v_x.display_number, ''),
                                 (v_x.outstanding_minor / 100)::text, v_x.due_date::text), 'exposure_id', v_x.exposure_id),
              'queued')
      returning id into v_msg;
      v_n_msg := v_n_msg + 1;
    end if;
    insert into public.kamai_dunning_events (tenant_id, exposure_id, store_id, rule_id, offset_days, action, status, wa_message_id)
    values (v_x.tenant_id, v_x.exposure_id, v_x.store_id, v_x.rule_id, v_x.offset_days, v_x.action,
            case when v_msg is null then 'skipped' else 'queued' end, v_msg);
    v_n_dun := v_n_dun + 1;
  end loop;

  -- 5. KPI snapshot
  insert into public.kamai_kpi_snapshots (snapshot_date, metrics)
  values (v_today, private.kamai_os_kpis_core())
  on conflict (snapshot_date) do update set metrics = excluded.metrics;

  return jsonb_build_object('date', v_today, 'stores_evaluated', v_n_eval, 'snapshots', v_n_snap, 'dunning_events', v_n_dun,
                            'wa_queued', v_n_msg, 'tenants_paused', v_paused, 'tenants_unpaused', v_unpaused);
end;
$$;
revoke execute on function public.kamai_run_daily() from public, anon;
grant execute on function public.kamai_run_daily() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- legacy import (read-only on legacy tables)
-- ---------------------------------------------------------------------------
create or replace function public.kamai_import_legacy(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.kamai_tenants;
  v_list uuid;
  v_s record;
  v_terms int;
  v_mobile text;
  v_digits text;
  v_new uuid;
  v_n_stores int := 0;
  v_n_products int := 0;
  v_n_accounts int := 0;
  v_policy uuid;
begin
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  select * into v_t from public.kamai_tenants where id = p_tenant_id;
  if not found then
    raise exception 'kamai: tenant not found' using errcode = '22023';
  end if;
  insert into public.kamai_price_lists (tenant_id, name, tier, is_default) values (p_tenant_id, 'Default', 'default', true)
  on conflict do nothing;
  select id into v_list from public.kamai_price_lists where tenant_id = p_tenant_id and is_default limit 1;
  select p.id into v_policy from public.kamai_credit_policies p where p.tenant_id = p_tenant_id order by version desc limit 1;

  -- products
  insert into public.kamai_products (tenant_id, sku, name, name_ur, category, legacy_product_id, trade_price_minor, active)
  select p_tenant_id, regexp_replace(pr.id, '[^A-Za-z0-9._-]', '-', 'g'), left(pr.name, 200), pr.name_ur, pr.category, pr.id,
         round(coalesce(pr.trade_price, 0) * 100)::bigint, coalesce(pr.active, true)
  from public.products pr
  where not exists (select 1 from public.kamai_products kp where kp.tenant_id = p_tenant_id and kp.legacy_product_id = pr.id)
  on conflict (tenant_id, sku) do nothing;
  get diagnostics v_n_products = row_count;

  -- stores
  for v_s in select st.* from public.stores st
             where not exists (select 1 from public.kamai_stores ks where ks.tenant_id = p_tenant_id and ks.legacy_store_id = st.id)
             order by st.created_at loop
    v_terms := case v_s.payment_terms::text when 'bill_to_bill' then 7 when 'credit_25_days' then 25 else 0 end;
    v_digits := regexp_replace(coalesce(v_s.mobile, ''), '[^0-9]', '', 'g');
    v_mobile := case when v_digits ~ '^0[0-9]{10}$' then '+92' || substr(v_digits, 2)
                     when v_digits ~ '^92[0-9]{10}$' then '+' || v_digits
                     else null end;
    insert into public.kamai_stores
      (tenant_id, legacy_store_id, legacy_customer_id, name, owner_name, mobile, address, area, area_id, latitude, longitude, category,
       price_list_id, payment_terms_days, credit_limit_minor, credit_status, payment_ref_code)
    values (p_tenant_id, v_s.id, v_s.gas_customer_id, left(v_s.name, 200), v_s.owner_name, v_mobile, v_s.address, v_s.area, v_s.area_id,
            v_s.latitude, v_s.longitude, v_s.category::text, v_list, v_terms,
            case when v_terms > 0 then 2500000 else 0 end,
            case when v_terms > 0 then 'active' else 'cash_only' end,
            'KM-' || upper(v_t.slug) || '-' || lpad(public.kamai_next_counter(p_tenant_id, 'store_ref')::text, 4, '0'))
    returning id into v_new;
    insert into public.kamai_credit_accounts (store_id, tenant_id, tier, floor_tier, limit_minor, tenor_days, status, policy_id, reason_codes, last_reviewed_at)
    values (v_new, p_tenant_id, case when v_terms > 0 then 1 else 0 end, case when v_terms > 0 then 1 else 0 end,
            case when v_terms > 0 then 2500000 else 0 end, v_terms,
            case when v_terms > 0 then 'active' else 'cash_only' end, v_policy,
            case when v_terms > 0 then array['LEGACY_TERMS'] else array['CASH_ONLY'] end, now())
    on conflict (store_id) do nothing;
    v_n_stores := v_n_stores + 1;
    v_n_accounts := v_n_accounts + 1;
  end loop;
  return jsonb_build_object('tenant_id', p_tenant_id, 'stores_created', v_n_stores, 'products_created', v_n_products,
                            'credit_accounts_created', v_n_accounts);
end;
$$;
revoke execute on function public.kamai_import_legacy(uuid) from public, anon;
grant execute on function public.kamai_import_legacy(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- seed tenants, memberships, legacy import for 'apt'
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin constant uuid := 'ae9b1695-6121-4005-a2a1-08b5db4f8570';
  v_kamai uuid;
  v_apt uuid;
begin
  select id into v_kamai from public.kamai_tenants where slug = 'kamai';
  if v_kamai is null then
    v_kamai := public.kamai_create_tenant('kamai', 'Kamai', 'platform', '{}'::jsonb);
  end if;
  select id into v_apt from public.kamai_tenants where slug = 'apt';
  if v_apt is null then
    v_apt := public.kamai_create_tenant('apt', 'APT', 'vertical', '{"lane":"C"}'::jsonb);
  end if;
  update public.kamai_tenants set invoice_prefix = 'KM' where id = v_kamai and invoice_prefix is null;
  update public.kamai_tenants set invoice_prefix = 'APT' where id = v_apt and invoice_prefix is null;

  if exists (select 1 from auth.users where id = v_admin) then
    insert into public.kamai_memberships (tenant_id, user_id, role, status)
    values (v_kamai, v_admin, 'owner', 'active'), (v_apt, v_admin, 'owner', 'active')
    on conflict (tenant_id, user_id) do nothing;
  end if;

  perform public.kamai_import_legacy(v_apt);
end $$;

-- ---------------------------------------------------------------------------
-- pg_cron: daily at 01:30 UTC = 06:30 PKT. cron.schedule upserts by job name.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('kamai-daily', '30 1 * * *', $cron$select public.kamai_run_daily()$cron$);
  end if;
end $$;
