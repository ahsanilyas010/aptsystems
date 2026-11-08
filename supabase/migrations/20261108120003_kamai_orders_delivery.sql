-- Kamai OS migration 003: orders, order items/events, delivery proofs and OTPs, order RPCs.
-- Depends on 001 (tenancy, helpers, counters, audit) and 002 (stores, products, price lists).
-- Runtime dependencies on later files (late bound): private.kamai_credit_decide_core (006),
-- private.kamai_issue_invoice_core (004), private.kamai_post_entry_core (005),
-- kamai_credit_exposures (006).

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function private.kamai_can(t uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select private.kamai_is_platform_admin())
      or (select private.kamai_is_server())
      or (select private.kamai_has_role(t, roles));
$$;
revoke execute on function private.kamai_can(uuid, text[]) from public, anon;
grant execute on function private.kamai_can(uuid, text[]) to authenticated, service_role;

create or replace function public.kamai_distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(least(1.0,
    power(sin((radians(lat2) - radians(lat1)) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin((radians(lon2) - radians(lon1)) / 2), 2))));
$$;
revoke execute on function public.kamai_distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.kamai_distance_m(double precision, double precision, double precision, double precision) to authenticated, service_role;

-- sales tax on a line (3rd Schedule items are taxed on retail price x qty)
create or replace function public.kamai_line_tax(p_qty bigint, p_unit_minor bigint, p_retail_minor bigint, p_rate numeric, p_third boolean)
returns bigint
language sql immutable
set search_path = ''
as $$
  select round((case when p_third and p_retail_minor is not null then p_retail_minor * p_qty else p_unit_minor * p_qty end)::numeric
               * coalesce(p_rate, 0) / 100)::bigint;
$$;
revoke execute on function public.kamai_line_tax(bigint, bigint, bigint, numeric, boolean) from public, anon;
grant execute on function public.kamai_line_tax(bigint, bigint, bigint, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_orders
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_orders (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.kamai_tenants(id) on delete cascade,
  store_id             uuid not null references public.kamai_stores(id),
  order_no             bigint not null,
  source               text not null default 'booker' check (source in ('store_pwa','whatsapp','booker','hero_app','import')),
  fulfilment_status    text not null default 'booked' check (fulfilment_status in ('booked','credit_approved','packed','dispatched','delivered','cancelled','rejected','disputed')),
  finance_status       text not null default 'unfinanced' check (finance_status in ('unfinanced','financed','paid','settled')),
  payment_mode         text not null default 'credit' check (payment_mode in ('credit','cod')),
  subtotal_minor       bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor            bigint not null default 0 check (tax_minor >= 0),
  total_minor          bigint not null default 0 check (total_minor >= 0),
  items_count          int not null default 0,
  rider_user_id        uuid,
  credit_decision_id   uuid,
  invoice_id           uuid,
  client_order_id      text,
  legacy_order_id      uuid,
  cancellation_reason  text,
  notes                text,
  credit_approved_at   timestamptz,
  packed_at            timestamptz,
  dispatched_at        timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,
  rejected_at          timestamptz,
  disputed_at          timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, order_no),
  constraint kamai_orders_cancel_reason_chk check (fulfilment_status not in ('cancelled','rejected') or cancellation_reason is not null)
);
create unique index if not exists kamai_orders_client_uidx on public.kamai_orders (tenant_id, client_order_id) where client_order_id is not null;
create index if not exists kamai_orders_store_idx on public.kamai_orders (store_id, created_at desc);
create index if not exists kamai_orders_tenant_status_idx on public.kamai_orders (tenant_id, fulfilment_status, created_at desc);
create index if not exists kamai_orders_rider_idx on public.kamai_orders (rider_user_id) where rider_user_id is not null;
create index if not exists kamai_orders_legacy_idx on public.kamai_orders (legacy_order_id) where legacy_order_id is not null;
alter table public.kamai_orders enable row level security;

create table if not exists public.kamai_order_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.kamai_tenants(id) on delete cascade,
  order_id            uuid not null references public.kamai_orders(id) on delete cascade,
  product_id          uuid not null references public.kamai_products(id),
  sku                 text not null,
  name                text not null,
  qty                 int not null check (qty > 0),
  delivered_qty       int not null default 0 check (delivered_qty >= 0 and delivered_qty <= qty),
  unit_price_minor    bigint not null check (unit_price_minor >= 0),
  tax_rate_pct        numeric(5,2) not null default 0,
  line_total_minor    bigint not null check (line_total_minor >= 0),   -- qty * unit price, excluding tax
  tax_minor           bigint not null default 0 check (tax_minor >= 0),
  retail_price_minor  bigint,
  is_third_schedule   boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (order_id, product_id)
);
create index if not exists kamai_order_items_tenant_idx on public.kamai_order_items (tenant_id);
create index if not exists kamai_order_items_product_idx on public.kamai_order_items (product_id);
alter table public.kamai_order_items enable row level security;

create table if not exists public.kamai_order_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  order_id    uuid not null references public.kamai_orders(id) on delete cascade,
  from_state  text,
  to_state    text not null,
  actor       uuid,
  reason      text,
  meta        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists kamai_order_events_order_idx on public.kamai_order_events (order_id, at);
create index if not exists kamai_order_events_tenant_idx on public.kamai_order_events (tenant_id, at desc);
alter table public.kamai_order_events enable row level security;

create table if not exists public.kamai_delivery_proofs (
  order_id               uuid primary key references public.kamai_orders(id) on delete cascade,
  tenant_id              uuid not null references public.kamai_tenants(id) on delete cascade,
  otp_hash               text,
  otp_expires_at         timestamptz,
  otp_attempts           int not null default 0,
  otp_verified_at        timestamptz,
  delivered_lat          double precision,
  delivered_lng          double precision,
  gps_accuracy_m         double precision,
  store_lat              double precision,
  store_lng              double precision,
  distance_m             double precision,
  geofence_radius_m      double precision,
  geofence_ok            boolean,
  override_reason        text,
  flagged                boolean not null default false,
  photo_url              text,
  signature_url          text,
  receiver_name          text,
  delivery_status        text check (delivery_status is null or delivery_status in ('full','partial','refused')),
  confirmed_by           uuid,
  confirmed_at           timestamptz,
  dispute_window_ends_at timestamptz,
  disputed_at            timestamptz,
  dispute_reason         text,
  resolved_at            timestamptz,
  resolution             text,
  credit_minor           bigint,
  created_at             timestamptz not null default now()
);
create index if not exists kamai_delivery_proofs_tenant_idx on public.kamai_delivery_proofs (tenant_id);
alter table public.kamai_delivery_proofs enable row level security;

-- plain OTP, visible to the store (so it can read it out / show it), written only by functions
create table if not exists public.kamai_delivery_otps (
  order_id    uuid primary key references public.kamai_orders(id) on delete cascade,
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  code        text not null check (code ~ '^[0-9]{6}$'),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists kamai_delivery_otps_tenant_idx on public.kamai_delivery_otps (tenant_id);
alter table public.kamai_delivery_otps enable row level security;

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------
drop trigger if exists kamai_orders_touch on public.kamai_orders;
create trigger kamai_orders_touch before update on public.kamai_orders for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_orders_audit on public.kamai_orders;
create trigger kamai_orders_audit after insert or update or delete on public.kamai_orders for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_order_events_append_only on public.kamai_order_events;
create trigger kamai_order_events_append_only before update or delete on public.kamai_order_events for each row execute function public.kamai_append_only();

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
drop policy if exists kamai_orders_select on public.kamai_orders;
create policy kamai_orders_select on public.kamai_orders for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and ((select private.kamai_my_role(tenant_id)) is distinct from 'rider'
                  or rider_user_id = (select auth.uid()))));

drop policy if exists kamai_order_items_select on public.kamai_order_items;
create policy kamai_order_items_select on public.kamai_order_items for select to authenticated
  using ((select private.kamai_is_platform_admin()) or order_id in (select o.id from public.kamai_orders o));

drop policy if exists kamai_order_events_select on public.kamai_order_events;
create policy kamai_order_events_select on public.kamai_order_events for select to authenticated
  using ((select private.kamai_is_platform_admin()) or order_id in (select o.id from public.kamai_orders o));

drop policy if exists kamai_delivery_proofs_select on public.kamai_delivery_proofs;
create policy kamai_delivery_proofs_select on public.kamai_delivery_proofs for select to authenticated
  using ((select private.kamai_is_platform_admin()) or order_id in (select o.id from public.kamai_orders o));

-- OTP plain code: platform admins and store-role members of the order's store only
drop policy if exists kamai_delivery_otps_select on public.kamai_delivery_otps;
create policy kamai_delivery_otps_select on public.kamai_delivery_otps for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or order_id in (select o.id from public.kamai_orders o
                         where (select private.kamai_my_role(o.tenant_id)) = 'store'));

-- ---------------------------------------------------------------------------
-- grants (writes only through SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
revoke all on public.kamai_orders from anon;
grant select on public.kamai_orders to authenticated;
grant all on public.kamai_orders to service_role;

revoke all on public.kamai_order_items from anon;
grant select on public.kamai_order_items to authenticated;
grant all on public.kamai_order_items to service_role;

revoke all on public.kamai_order_events from anon;
grant select on public.kamai_order_events to authenticated;
grant all on public.kamai_order_events to service_role;

revoke all on public.kamai_delivery_proofs from anon;
grant select on public.kamai_delivery_proofs to authenticated;
grant all on public.kamai_delivery_proofs to service_role;

revoke all on public.kamai_delivery_otps from anon;
grant select on public.kamai_delivery_otps to authenticated;
grant all on public.kamai_delivery_otps to service_role;

-- ---------------------------------------------------------------------------
-- state machine core (no auth checks; callers check)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_do_transition(p_order_id uuid, p_to text, p_reason text, p_meta jsonb, p_actor uuid)
returns public.kamai_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
  v_from text;
  v_ok boolean;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order % not found', p_order_id;
  end if;
  v_from := v_o.fulfilment_status;
  v_ok := (v_from, p_to) in (
    ('booked','credit_approved'), ('booked','rejected'), ('booked','cancelled'),
    ('credit_approved','packed'), ('credit_approved','cancelled'),
    ('packed','dispatched'), ('packed','cancelled'),
    ('dispatched','delivered'), ('dispatched','cancelled'),
    ('delivered','disputed'), ('disputed','delivered'));
  if not v_ok then
    raise exception 'kamai: illegal order transition % -> %', v_from, p_to using errcode = '22023';
  end if;
  if p_to in ('cancelled','rejected') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'kamai: a reason is required to move an order to %', p_to using errcode = '22023';
  end if;
  if p_to = 'dispatched' and v_o.rider_user_id is null then
    raise exception 'kamai: assign a rider before dispatching (RIDER_REQUIRED)' using errcode = '22023';
  end if;
  update public.kamai_orders set
    fulfilment_status  = p_to,
    credit_approved_at = case when p_to = 'credit_approved' then now() else credit_approved_at end,
    packed_at          = case when p_to = 'packed' then now() else packed_at end,
    dispatched_at      = case when p_to = 'dispatched' then now() else dispatched_at end,
    delivered_at       = case when p_to = 'delivered' and delivered_at is null then now() else delivered_at end,
    cancelled_at       = case when p_to = 'cancelled' then now() else cancelled_at end,
    rejected_at        = case when p_to = 'rejected' then now() else rejected_at end,
    disputed_at        = case when p_to = 'disputed' then now() else disputed_at end,
    cancellation_reason = case when p_to in ('cancelled','rejected') then p_reason else cancellation_reason end
  where id = p_order_id
  returning * into v_o;
  insert into public.kamai_order_events (tenant_id, order_id, from_state, to_state, actor, reason, meta)
  values (v_o.tenant_id, v_o.id, v_from, p_to, p_actor, p_reason, coalesce(p_meta, '{}'::jsonb));
  return v_o;
end;
$$;
revoke execute on function private.kamai_do_transition(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.kamai_do_transition(uuid, text, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- kamai_submit_order
-- ---------------------------------------------------------------------------
create or replace function public.kamai_submit_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := nullif(p ->> 'tenant_id', '')::uuid;
  v_store_id uuid := nullif(p ->> 'store_id', '')::uuid;
  v_cid     text := nullif(btrim(p ->> 'client_order_id'), '');
  v_mode    text := coalesce(nullif(p ->> 'payment_mode', ''), 'credit');
  v_source  text := coalesce(nullif(p ->> 'source', ''), 'booker');
  v_store   public.kamai_stores;
  v_order   public.kamai_orders;
  v_role    text;
  v_list    uuid;
  v_n       int;
  v_want    int;
  v_decision jsonb;
begin
  if v_tenant is null or v_store_id is null then
    raise exception 'kamai: tenant_id and store_id are required' using errcode = '22023';
  end if;
  if v_mode not in ('credit','cod') then
    raise exception 'kamai: payment_mode must be credit or cod' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0
     or jsonb_array_length(p -> 'items') > 200 then
    raise exception 'kamai: items must be a non-empty array (max 200)' using errcode = '22023';
  end if;

  select * into v_store from public.kamai_stores where id = v_store_id and tenant_id = v_tenant;
  if not found then
    raise exception 'kamai: store % not found in tenant', v_store_id using errcode = '22023';
  end if;

  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    v_role := (select private.kamai_my_role(v_tenant));
    if v_role is null then
      raise exception 'kamai: not a member of this tenant' using errcode = '42501';
    elsif v_role = 'store' then
      if not exists (select 1 from public.kamai_memberships m
                     where m.tenant_id = v_tenant and m.user_id = (select auth.uid())
                       and m.status = 'active' and m.store_id = v_store_id) then
        raise exception 'kamai: a store member may only order for its own store' using errcode = '42501';
      end if;
    elsif v_role not in ('booker','manager','owner') then
      raise exception 'kamai: role % may not place orders', v_role using errcode = '42501';
    end if;
  end if;

  if v_store.status <> 'active' then
    raise exception 'kamai: store is not active' using errcode = '22023';
  end if;

  -- idempotent replay
  if v_cid is not null then
    select * into v_order from public.kamai_orders where tenant_id = v_tenant and client_order_id = v_cid;
    if found then
      return jsonb_build_object(
        'order', to_jsonb(v_order),
        'decision', (select to_jsonb(d) from public.kamai_credit_decisions d where d.id = v_order.credit_decision_id),
        'replayed', true);
    end if;
  end if;

  v_list := coalesce(v_store.price_list_id,
                     (select pl.id from public.kamai_price_lists pl where pl.tenant_id = v_tenant and pl.is_default limit 1));

  insert into public.kamai_orders (tenant_id, store_id, order_no, source, payment_mode, client_order_id, notes, created_by)
  values (v_tenant, v_store_id, public.kamai_next_counter(v_tenant, 'order'), v_source, v_mode, v_cid,
          nullif(p ->> 'notes', ''), (select auth.uid()))
  returning * into v_order;

  select count(distinct (e ->> 'product_id')) into v_want from jsonb_array_elements(p -> 'items') e;

  insert into public.kamai_order_items
    (tenant_id, order_id, product_id, sku, name, qty, unit_price_minor, tax_rate_pct,
     line_total_minor, tax_minor, retail_price_minor, is_third_schedule)
  select v_tenant, v_order.id, pr.id, pr.sku, pr.name, i.qty,
         coalesce(pli.price_minor, pr.trade_price_minor), pr.tax_rate_pct,
         i.qty * coalesce(pli.price_minor, pr.trade_price_minor),
         public.kamai_line_tax(i.qty, coalesce(pli.price_minor, pr.trade_price_minor), pr.retail_price_minor, pr.tax_rate_pct, pr.is_third_schedule),
         pr.retail_price_minor, pr.is_third_schedule
  from (select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int)::int as qty
        from jsonb_array_elements(p -> 'items') e group by 1) i
  join public.kamai_products pr on pr.id = i.pid and pr.tenant_id = v_tenant and pr.active
  left join public.kamai_price_list_items pli on pli.product_id = pr.id and pli.price_list_id = v_list
  where i.qty > 0;
  get diagnostics v_n = row_count;
  if v_n <> v_want then
    raise exception 'kamai: one or more items are unknown, inactive or have qty <= 0' using errcode = '22023';
  end if;

  update public.kamai_orders o set
    subtotal_minor = t.sub, tax_minor = t.tax, total_minor = t.sub + t.tax, items_count = t.cnt
  from (select coalesce(sum(line_total_minor), 0) sub, coalesce(sum(tax_minor), 0) tax, count(*)::int cnt
        from public.kamai_order_items where order_id = v_order.id) t
  where o.id = v_order.id;

  insert into public.kamai_order_events (tenant_id, order_id, from_state, to_state, actor, reason, meta)
  values (v_tenant, v_order.id, null, 'booked', (select auth.uid()), null,
          jsonb_build_object('source', v_source, 'payment_mode', v_mode));

  v_decision := private.kamai_credit_decide_core(v_order.id);
  select * into v_order from public.kamai_orders where id = v_order.id;
  return jsonb_build_object('order', to_jsonb(v_order), 'decision', v_decision, 'replayed', false);
end;
$$;
revoke execute on function public.kamai_submit_order(jsonb) from public, anon;
grant execute on function public.kamai_submit_order(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_transition_order
-- ---------------------------------------------------------------------------
create or replace function public.kamai_transition_order(p_order_id uuid, p_to_state text, p_reason text default null, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
  v_role text;
begin
  select * into v_o from public.kamai_orders where id = p_order_id;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if p_to_state in ('delivered','disputed') then
    raise exception 'kamai: % is reachable only through kamai_confirm_delivery / kamai_dispute_delivery', p_to_state using errcode = '22023';
  end if;
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    v_role := (select private.kamai_my_role(v_o.tenant_id));
    if v_role = 'store' then
      if not (p_to_state = 'cancelled' and v_o.fulfilment_status = 'booked'
              and exists (select 1 from public.kamai_memberships m
                          where m.tenant_id = v_o.tenant_id and m.user_id = (select auth.uid())
                            and m.status = 'active' and m.store_id = v_o.store_id)) then
        raise exception 'kamai: a store may only cancel its own booked orders' using errcode = '42501';
      end if;
    elsif v_role in ('booker','manager','owner') then
      if v_o.fulfilment_status = 'booked' and p_to_state = 'credit_approved' and v_role = 'booker' then
        raise exception 'kamai: only a manager or owner may override a credit hold' using errcode = '42501';
      end if;
    else
      raise exception 'kamai: not allowed to change order state' using errcode = '42501';
    end if;
  end if;
  if v_o.fulfilment_status = 'booked' and p_to_state = 'credit_approved' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'kamai: a reason is required for a manual credit approval' using errcode = '22023';
  end if;
  return to_jsonb(private.kamai_do_transition(p_order_id, p_to_state, p_reason, coalesce(p_meta, '{}'::jsonb), (select auth.uid())));
end;
$$;
revoke execute on function public.kamai_transition_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.kamai_transition_order(uuid, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_assign_rider
-- ---------------------------------------------------------------------------
create or replace function public.kamai_assign_rider(p_order_id uuid, p_rider_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_o.tenant_id, array['owner','manager','booker'])) then
    raise exception 'kamai: not allowed to assign riders' using errcode = '42501';
  end if;
  if v_o.fulfilment_status not in ('booked','credit_approved','packed','dispatched') then
    raise exception 'kamai: cannot assign a rider to an order in state %', v_o.fulfilment_status using errcode = '22023';
  end if;
  if not (exists (select 1 from public.kamai_memberships m
                  where m.tenant_id = v_o.tenant_id and m.user_id = p_rider_user_id and m.role = 'rider' and m.status = 'active')
          or exists (select 1 from public.user_roles r where r.user_id = p_rider_user_id and r.role = 'rider')) then
    raise exception 'kamai: user is not a rider for this tenant' using errcode = '22023';
  end if;
  update public.kamai_orders set rider_user_id = p_rider_user_id where id = p_order_id returning * into v_o;
  insert into public.kamai_order_events (tenant_id, order_id, from_state, to_state, actor, reason, meta)
  values (v_o.tenant_id, v_o.id, v_o.fulfilment_status, v_o.fulfilment_status, (select auth.uid()), 'rider assigned',
          jsonb_build_object('rider_user_id', p_rider_user_id));
  return to_jsonb(v_o);
end;
$$;
revoke execute on function public.kamai_assign_rider(uuid, uuid) from public, anon;
grant execute on function public.kamai_assign_rider(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_issue_delivery_otp
-- ---------------------------------------------------------------------------
create or replace function public.kamai_issue_delivery_otp(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
  v_code text;
  v_exp timestamptz := now() + interval '24 hours';
begin
  select * into v_o from public.kamai_orders where id = p_order_id;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_can(v_o.tenant_id, array['owner','manager','booker']))
          or (v_o.rider_user_id is not null and v_o.rider_user_id = (select auth.uid()))) then
    raise exception 'kamai: not allowed to issue a delivery OTP' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'dispatched' then
    raise exception 'kamai: OTP can only be issued for a dispatched order' using errcode = '22023';
  end if;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.kamai_delivery_proofs (order_id, tenant_id, otp_hash, otp_expires_at, otp_attempts)
  values (p_order_id, v_o.tenant_id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), v_exp, 0)
  on conflict (order_id) do update
    set otp_hash = excluded.otp_hash, otp_expires_at = excluded.otp_expires_at, otp_attempts = 0;
  insert into public.kamai_delivery_otps (order_id, tenant_id, code, expires_at)
  values (p_order_id, v_o.tenant_id, v_code, v_exp)
  on conflict (order_id) do update set code = excluded.code, expires_at = excluded.expires_at, created_at = now();
  return jsonb_build_object('expires_at', v_exp);
end;
$$;
revoke execute on function public.kamai_issue_delivery_otp(uuid) from public, anon;
grant execute on function public.kamai_issue_delivery_otp(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_confirm_delivery
-- Business failures that must persist state (bad OTP, geofence) are returned as
-- {ok:false, error:...}; misuse raises.
-- ---------------------------------------------------------------------------
create or replace function public.kamai_confirm_delivery(
  p_order_id uuid,
  p_otp text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_photo_url text default null,
  p_signature_url text default null,
  p_items jsonb default null,
  p_receiver_name text default null,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o        public.kamai_orders;
  v_store    public.kamai_stores;
  v_proof    public.kamai_delivery_proofs;
  v_tenant   public.kamai_tenants;
  v_radius   double precision;
  v_dist     double precision;
  v_geo_ok   boolean;
  v_flagged  boolean := false;
  v_override text := nullif(btrim(p_override_reason), '');
  v_qty_total bigint;
  v_deliv_total bigint;
  v_status   text;
  v_hours    int;
  v_inv      uuid;
  v_exp_id   uuid;
  v_entry    uuid;
  v_terms    int;
  v_sub      bigint;
  v_tax      bigint;
  v_ordered_total bigint;
  v_today    date := (now() at time zone 'Asia/Karachi')::date;
  v_attempts int;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_can(v_o.tenant_id, array['owner','manager']))
          or (v_o.rider_user_id is not null and v_o.rider_user_id = (select auth.uid()))) then
    raise exception 'kamai: only the assigned rider or a manager may confirm delivery' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'dispatched' then
    raise exception 'kamai: order is not dispatched (state %)', v_o.fulfilment_status using errcode = '22023';
  end if;
  select * into v_store from public.kamai_stores where id = v_o.store_id;
  select * into v_tenant from public.kamai_tenants where id = v_o.tenant_id;
  select * into v_proof from public.kamai_delivery_proofs where order_id = p_order_id for update;

  -- OTP
  if p_otp is not null and btrim(p_otp) <> '' then
    if not found or v_proof.otp_hash is null then
      raise exception 'kamai: no OTP has been issued for this order' using errcode = '22023';
    end if;
    if v_proof.otp_attempts >= 5 then
      return jsonb_build_object('ok', false, 'error', 'OTP_LOCKED');
    end if;
    if v_proof.otp_expires_at < now() then
      return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED');
    end if;
    if extensions.crypt(btrim(p_otp), v_proof.otp_hash) <> v_proof.otp_hash then
      update public.kamai_delivery_proofs set otp_attempts = otp_attempts + 1 where order_id = p_order_id
      returning otp_attempts into v_attempts;
      return jsonb_build_object('ok', false, 'error', 'OTP_INVALID', 'attempts_left', greatest(0, 5 - v_attempts));
    end if;
  else
    if v_override is null then
      raise exception 'kamai: OTP required (or an override reason)' using errcode = '22023';
    end if;
    v_flagged := true;
  end if;

  -- geofence
  v_radius := coalesce(nullif(v_tenant.settings ->> 'geofence_radius_m', '')::double precision, 150);
  if p_lat is not null and p_lng is not null and v_store.latitude is not null and v_store.longitude is not null then
    v_dist := public.kamai_distance_m(p_lat, p_lng, v_store.latitude, v_store.longitude);
    v_geo_ok := v_dist <= greatest(v_radius, coalesce(p_accuracy_m, 0));
  else
    v_dist := null;
    v_geo_ok := null;
  end if;
  if v_geo_ok is distinct from true then
    if v_override is null then
      return jsonb_build_object('ok', false, 'error', 'GEOFENCE', 'distance_m', v_dist, 'radius_m', v_radius);
    end if;
    v_flagged := true;
  end if;

  -- delivered quantities (clamped)
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    update public.kamai_order_items i set delivered_qty = least(i.qty, greatest(0, x.q))
    from (select coalesce((e ->> 'item_id')::uuid,
                          (select i2.id from public.kamai_order_items i2
                           where i2.order_id = p_order_id and i2.product_id = (e ->> 'product_id')::uuid)) as iid,
                 (e ->> 'delivered_qty')::int as q
          from jsonb_array_elements(p_items) e) x
    where i.id = x.iid and i.order_id = p_order_id;
    -- items not mentioned keep delivered_qty 0 only when an explicit list was given
  else
    update public.kamai_order_items set delivered_qty = qty where order_id = p_order_id;
  end if;
  select coalesce(sum(qty), 0), coalesce(sum(delivered_qty), 0) into v_qty_total, v_deliv_total
  from public.kamai_order_items where order_id = p_order_id;
  v_status := case when v_deliv_total = 0 then 'refused' when v_deliv_total = v_qty_total then 'full' else 'partial' end;

  if v_status = 'refused' and v_override is null then
    raise exception 'kamai: a refused delivery needs a reason (p_override_reason)' using errcode = '22023';
  end if;

  v_hours := coalesce(nullif(v_tenant.settings ->> 'dispute_window_hours', '')::int, 24);
  insert into public.kamai_delivery_proofs (order_id, tenant_id) values (p_order_id, v_o.tenant_id)
  on conflict (order_id) do nothing;
  update public.kamai_delivery_proofs set
    otp_verified_at = case when not v_flagged or p_otp is not null then now() else null end,
    delivered_lat = p_lat, delivered_lng = p_lng, gps_accuracy_m = p_accuracy_m,
    store_lat = v_store.latitude, store_lng = v_store.longitude,
    distance_m = v_dist, geofence_radius_m = v_radius, geofence_ok = v_geo_ok,
    override_reason = v_override, flagged = v_flagged,
    photo_url = p_photo_url, signature_url = p_signature_url, receiver_name = nullif(btrim(p_receiver_name), ''),
    delivery_status = v_status, confirmed_by = (select auth.uid()), confirmed_at = now(),
    dispute_window_ends_at = now() + make_interval(hours => v_hours)
  where order_id = p_order_id;
  delete from public.kamai_delivery_otps where order_id = p_order_id;

  if v_status = 'refused' then
    perform private.kamai_do_transition(p_order_id, 'cancelled', 'refused at door: ' || v_override,
      jsonb_build_object('delivery_status', 'refused'), (select auth.uid()));
    return jsonb_build_object('ok', true, 'delivery_status', 'refused', 'geofence_ok', v_geo_ok, 'distance_m', v_dist);
  end if;

  -- re-price the order on delivered quantities
  v_ordered_total := v_o.total_minor;
  select coalesce(sum(delivered_qty * unit_price_minor), 0),
         coalesce(sum(public.kamai_line_tax(delivered_qty, unit_price_minor, retail_price_minor, tax_rate_pct, is_third_schedule)), 0)
    into v_sub, v_tax
  from public.kamai_order_items where order_id = p_order_id;
  update public.kamai_orders set subtotal_minor = v_sub, tax_minor = v_tax, total_minor = v_sub + v_tax where id = p_order_id;

  perform private.kamai_do_transition(p_order_id, 'delivered', null,
    jsonb_build_object('delivery_status', v_status, 'flagged', v_flagged, 'geofence_ok', v_geo_ok,
                       'distance_m', v_dist, 'ordered_total_minor', v_ordered_total, 'delivered_total_minor', v_sub + v_tax),
    (select auth.uid()));

  -- invoice
  v_inv := private.kamai_issue_invoice_core(p_order_id);

  -- credit exposure
  if v_o.payment_mode = 'credit' and (v_sub + v_tax) > 0 then
    select coalesce(nullif(v_store.payment_terms_days, 0), (select a.tenor_days from public.kamai_credit_accounts a where a.store_id = v_store.id), 0)
      into v_terms;
    insert into public.kamai_credit_exposures
      (tenant_id, store_id, order_id, invoice_id, origination_date, due_date, original_minor, outstanding_minor, status)
    values (v_o.tenant_id, v_o.store_id, p_order_id, v_inv, v_today, v_today + v_terms, v_sub + v_tax, v_sub + v_tax, 'open')
    on conflict (order_id) do nothing
    returning id into v_exp_id;
  end if;

  -- ledger: Dr 1200 receivable / Cr 4100 sales (+ Cr 2450 sales tax payable)
  if (v_sub + v_tax) > 0 then
    v_entry := private.kamai_post_entry_core(
      v_o.tenant_id, 'order:' || p_order_id || ':delivered', 'order', p_order_id::text, now(),
      'Delivery of order ' || v_o.order_no,
      jsonb_build_array(
        jsonb_build_object('account_code', '1200', 'direction', 'debit', 'amount_minor', v_sub + v_tax,
                           'party_type', 'store', 'party_id', v_o.store_id::text),
        jsonb_build_object('account_code', '4100', 'direction', 'credit', 'amount_minor', v_sub)
      ) || case when v_tax > 0 then jsonb_build_array(
        jsonb_build_object('account_code', '2450', 'direction', 'credit', 'amount_minor', v_tax)) else '[]'::jsonb end);
  end if;

  return jsonb_build_object('ok', true, 'delivery_status', v_status, 'geofence_ok', v_geo_ok, 'distance_m', v_dist,
                            'flagged', v_flagged, 'invoice_id', v_inv, 'exposure_id', v_exp_id, 'ledger_entry_id', v_entry);
end;
$$;
revoke execute on function public.kamai_confirm_delivery(uuid, text, double precision, double precision, double precision, text, text, jsonb, text, text) from public, anon;
grant execute on function public.kamai_confirm_delivery(uuid, text, double precision, double precision, double precision, text, text, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- disputes
-- ---------------------------------------------------------------------------
create or replace function public.kamai_dispute_delivery(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
  v_p public.kamai_delivery_proofs;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'kamai: a dispute reason is required' using errcode = '22023';
  end if;
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
          or exists (select 1 from public.kamai_memberships m
                     where m.tenant_id = v_o.tenant_id and m.user_id = (select auth.uid()) and m.status = 'active'
                       and m.role = 'store' and m.store_id = v_o.store_id)) then
    raise exception 'kamai: only the store may dispute its delivery' using errcode = '42501';
  end if;
  select * into v_p from public.kamai_delivery_proofs where order_id = p_order_id;
  if v_o.fulfilment_status <> 'delivered' or not found or v_p.dispute_window_ends_at is null or v_p.dispute_window_ends_at < now() then
    raise exception 'kamai: order is not in a disputable state (DISPUTE_WINDOW_CLOSED)' using errcode = '22023';
  end if;
  perform private.kamai_do_transition(p_order_id, 'disputed', p_reason, '{}'::jsonb, (select auth.uid()));
  update public.kamai_delivery_proofs set disputed_at = now(), dispute_reason = p_reason, resolved_at = null
  where order_id = p_order_id returning * into v_p;
  return to_jsonb(v_p);
end;
$$;
revoke execute on function public.kamai_dispute_delivery(uuid, text) from public, anon;
grant execute on function public.kamai_dispute_delivery(uuid, text) to authenticated, service_role;

create or replace function public.kamai_resolve_dispute(p_order_id uuid, p_resolution text, p_credit_minor bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
  v_x record;
  v_credit bigint := coalesce(p_credit_minor, 0);
  v_serial bigint;
  v_cn uuid;
  v_inv record;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_o.tenant_id, array['owner','manager'])) then
    raise exception 'kamai: only a manager or owner may resolve disputes' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'disputed' then
    raise exception 'kamai: order is not disputed' using errcode = '22023';
  end if;
  if coalesce(btrim(p_resolution), '') = '' then
    raise exception 'kamai: resolution text is required' using errcode = '22023';
  end if;
  if v_credit < 0 or v_credit > v_o.total_minor then
    raise exception 'kamai: credit must be between 0 and the order total' using errcode = '22023';
  end if;

  if v_credit > 0 then
    select * into v_x from public.kamai_credit_exposures where order_id = p_order_id for update;
    if found then
      update public.kamai_credit_exposures set
        credited_minor = credited_minor + least(v_credit, outstanding_minor),
        outstanding_minor = outstanding_minor - least(v_credit, outstanding_minor),
        status = case when outstanding_minor - least(v_credit, outstanding_minor) = 0 then 'paid' else status end,
        closed_at = case when outstanding_minor - least(v_credit, outstanding_minor) = 0 then now() else closed_at end
      where id = v_x.id;
    end if;
    perform private.kamai_post_entry_core(v_o.tenant_id, 'order:' || p_order_id || ':dispute-credit', 'dispute', p_order_id::text, now(),
      'Dispute credit for order ' || v_o.order_no,
      jsonb_build_array(
        jsonb_build_object('account_code', '4100', 'direction', 'debit', 'amount_minor', v_credit),
        jsonb_build_object('account_code', '1200', 'direction', 'credit', 'amount_minor', v_credit,
                           'party_type', 'store', 'party_id', v_o.store_id::text)));
    -- credit note
    select * into v_inv from public.kamai_invoices where id = v_o.invoice_id;
    if found then
      v_serial := public.kamai_next_counter(v_o.tenant_id, 'invoice');
      insert into public.kamai_invoices
        (tenant_id, serial_no, display_number, invoice_type, invoice_date, order_id, store_id, seller_snapshot, buyer_snapshot,
         buyer_ntn_cnic, buyer_registration_type, total_excl_st_minor, sales_tax_minor, total_incl_minor, due_date, status, ref_invoice_id)
      values (v_o.tenant_id, v_serial, split_part(v_inv.display_number, '-', 1) || '-' || lpad(v_serial::text, 6, '0'),
              'Credit Note', (now() at time zone 'Asia/Karachi')::date, null, v_o.store_id, v_inv.seller_snapshot, v_inv.buyer_snapshot,
              v_inv.buyer_ntn_cnic, v_inv.buyer_registration_type, v_credit, 0, v_credit, null, 'issued', v_inv.id)
      returning id into v_cn;
    end if;
  end if;

  perform private.kamai_do_transition(p_order_id, 'delivered', 'dispute resolved: ' || p_resolution,
    jsonb_build_object('credit_minor', v_credit, 'credit_note_id', v_cn), (select auth.uid()));
  update public.kamai_delivery_proofs set resolved_at = now(), resolution = p_resolution, credit_minor = v_credit
  where order_id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'credit_minor', v_credit, 'credit_note_id', v_cn);
end;
$$;
revoke execute on function public.kamai_resolve_dispute(uuid, text, bigint) from public, anon;
grant execute on function public.kamai_resolve_dispute(uuid, text, bigint) to authenticated, service_role;
