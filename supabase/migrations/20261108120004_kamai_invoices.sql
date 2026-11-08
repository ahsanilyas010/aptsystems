-- Kamai OS migration 004: FBR-ready invoices (no FBR calls in v1).

create table if not exists public.kamai_invoices (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.kamai_tenants(id) on delete cascade,
  serial_no               bigint not null,
  display_number          text not null,
  invoice_type            text not null default 'Sale Invoice' check (invoice_type in ('Sale Invoice','Debit Note','Credit Note')),
  invoice_date            date not null,
  order_id                uuid references public.kamai_orders(id),
  store_id                uuid not null references public.kamai_stores(id),
  seller_snapshot         jsonb not null default '{}'::jsonb,
  buyer_snapshot          jsonb not null default '{}'::jsonb,
  buyer_ntn_cnic          text,
  buyer_registration_type text not null default 'Unregistered' check (buyer_registration_type in ('Registered','Unregistered')),
  total_excl_st_minor     bigint not null default 0 check (total_excl_st_minor >= 0),
  sales_tax_minor         bigint not null default 0 check (sales_tax_minor >= 0),
  further_tax_minor       bigint not null default 0 check (further_tax_minor >= 0),
  extra_tax_minor         bigint not null default 0 check (extra_tax_minor >= 0),
  discount_minor          bigint not null default 0 check (discount_minor >= 0),
  total_incl_minor        bigint not null default 0 check (total_incl_minor >= 0),
  due_date                date,
  status                  text not null default 'issued' check (status in ('draft','issued','paid','void')),
  ref_invoice_id          uuid references public.kamai_invoices(id),
  fbr_invoice_number      text,
  fbr_dated               timestamptz,
  fbr_env                 text check (fbr_env is null or fbr_env in ('sandbox','production')),
  fbr_status              text,
  fbr_request             jsonb,
  fbr_response            jsonb,
  fbr_correction_deadline_at timestamptz,
  pdf_url                 text,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, serial_no),
  unique (tenant_id, display_number)
);
create unique index if not exists kamai_invoices_order_sale_uidx on public.kamai_invoices (order_id) where order_id is not null and invoice_type = 'Sale Invoice';
create index if not exists kamai_invoices_store_idx on public.kamai_invoices (store_id, invoice_date desc);
create index if not exists kamai_invoices_tenant_date_idx on public.kamai_invoices (tenant_id, invoice_date desc);
create index if not exists kamai_invoices_ref_idx on public.kamai_invoices (ref_invoice_id) where ref_invoice_id is not null;
alter table public.kamai_invoices enable row level security;

create table if not exists public.kamai_invoice_items (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.kamai_tenants(id) on delete cascade,
  invoice_id            uuid not null references public.kamai_invoices(id) on delete cascade,
  product_id            uuid references public.kamai_products(id),
  line_no               int not null,
  description           text not null,
  hs_code               text,
  uom                   text,
  qty                   int not null check (qty > 0),
  unit_price_minor      bigint not null check (unit_price_minor >= 0),
  tax_rate_pct          numeric(5,2) not null default 0,
  sale_type             text not null default 'Goods at standard rate (default)',
  value_excl_st_minor   bigint not null check (value_excl_st_minor >= 0),
  retail_price_base_minor bigint,                 -- 3rd Schedule: retail price x qty
  sales_tax_minor       bigint not null default 0,
  further_tax_minor     bigint not null default 0,
  extra_tax_minor       bigint not null default 0,
  line_total_minor      bigint not null check (line_total_minor >= 0),
  unique (invoice_id, line_no)
);
create index if not exists kamai_invoice_items_tenant_idx on public.kamai_invoice_items (tenant_id);
create index if not exists kamai_invoice_items_product_idx on public.kamai_invoice_items (product_id) where product_id is not null;
alter table public.kamai_invoice_items enable row level security;

drop trigger if exists kamai_invoices_touch on public.kamai_invoices;
create trigger kamai_invoices_touch before update on public.kamai_invoices for each row execute function public.kamai_touch_updated_at();

-- FKs from orders (declared in 003) to invoices
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kamai_orders_invoice_fk') then
    alter table public.kamai_orders add constraint kamai_orders_invoice_fk foreign key (invoice_id) references public.kamai_invoices(id);
  end if;
end $$;
create index if not exists kamai_orders_invoice_idx on public.kamai_orders (invoice_id) where invoice_id is not null;

-- policies: readable like orders (store scope); no direct writes
drop policy if exists kamai_invoices_select on public.kamai_invoices;
create policy kamai_invoices_select on public.kamai_invoices for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and (select private.kamai_my_role(tenant_id)) is distinct from 'rider'));
drop policy if exists kamai_invoice_items_select on public.kamai_invoice_items;
create policy kamai_invoice_items_select on public.kamai_invoice_items for select to authenticated
  using ((select private.kamai_is_platform_admin()) or invoice_id in (select i.id from public.kamai_invoices i));

revoke all on public.kamai_invoices from anon;
grant select on public.kamai_invoices to authenticated;
grant all on public.kamai_invoices to service_role;
revoke all on public.kamai_invoice_items from anon;
grant select on public.kamai_invoice_items to authenticated;
grant all on public.kamai_invoice_items to service_role;

-- ---------------------------------------------------------------------------
-- invoice issue (core, idempotent per order)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_issue_invoice_core(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      public.kamai_orders;
  v_t      public.kamai_tenants;
  v_s      public.kamai_stores;
  v_id     uuid;
  v_serial bigint;
  v_delivered boolean;
  v_date   date := (now() at time zone 'Asia/Karachi')::date;
  v_terms  int;
  v_excl   bigint;
  v_tax    bigint;
  v_reg    text;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  select id into v_id from public.kamai_invoices where order_id = p_order_id and invoice_type = 'Sale Invoice';
  if found then
    return v_id;
  end if;
  select * into v_t from public.kamai_tenants where id = v_o.tenant_id;
  select * into v_s from public.kamai_stores where id = v_o.store_id;
  v_delivered := v_o.delivered_at is not null;
  v_terms := case when v_o.payment_mode = 'credit'
                  then coalesce(nullif(v_s.payment_terms_days, 0), (select a.tenor_days from public.kamai_credit_accounts a where a.store_id = v_s.id), 0)
                  else 0 end;
  v_serial := public.kamai_next_counter(v_o.tenant_id, 'invoice');
  v_reg := case when coalesce(v_s.tax_profile ->> 'registration_type', '') = 'Registered' then 'Registered' else 'Unregistered' end;

  insert into public.kamai_invoices
    (tenant_id, serial_no, display_number, invoice_type, invoice_date, order_id, store_id, seller_snapshot, buyer_snapshot,
     buyer_ntn_cnic, buyer_registration_type, due_date, status, created_by)
  values (v_o.tenant_id, v_serial, coalesce(v_t.invoice_prefix, 'KM') || '-' || lpad(v_serial::text, 6, '0'), 'Sale Invoice',
          v_date, p_order_id, v_o.store_id,
          jsonb_build_object('name', coalesce(v_t.legal_name, v_t.name), 'ntn', v_t.ntn, 'strn', v_t.strn,
                             'province', v_t.province, 'address', v_t.address, 'bank_iban', v_t.bank_iban, 'raast_alias', v_t.raast_alias),
          jsonb_build_object('name', v_s.name, 'owner_name', v_s.owner_name, 'mobile', v_s.mobile, 'address', v_s.address,
                             'area', v_s.area, 'tax_profile', v_s.tax_profile),
          nullif(v_s.tax_profile ->> 'buyer_ntn_cnic', ''), v_reg, v_date + v_terms, 'issued', (select auth.uid()))
  returning id into v_id;

  insert into public.kamai_invoice_items
    (tenant_id, invoice_id, product_id, line_no, description, hs_code, uom, qty, unit_price_minor, tax_rate_pct, sale_type,
     value_excl_st_minor, retail_price_base_minor, sales_tax_minor, line_total_minor)
  select v_o.tenant_id, v_id, i.product_id, (row_number() over (order by i.created_at, i.id))::int, i.name,
         p.hs_code, p.fbr_uom,
         case when v_delivered then i.delivered_qty else i.qty end,
         i.unit_price_minor, i.tax_rate_pct,
         case when i.is_third_schedule then '3rd Schedule Goods' else p.sale_type end,
         (case when v_delivered then i.delivered_qty else i.qty end) * i.unit_price_minor,
         case when i.is_third_schedule and i.retail_price_minor is not null
              then i.retail_price_minor * (case when v_delivered then i.delivered_qty else i.qty end) end,
         public.kamai_line_tax((case when v_delivered then i.delivered_qty else i.qty end)::bigint, i.unit_price_minor,
                               i.retail_price_minor, i.tax_rate_pct, i.is_third_schedule),
         (case when v_delivered then i.delivered_qty else i.qty end) * i.unit_price_minor
           + public.kamai_line_tax((case when v_delivered then i.delivered_qty else i.qty end)::bigint, i.unit_price_minor,
                                   i.retail_price_minor, i.tax_rate_pct, i.is_third_schedule)
  from public.kamai_order_items i
  join public.kamai_products p on p.id = i.product_id
  where i.order_id = p_order_id and (case when v_delivered then i.delivered_qty else i.qty end) > 0;

  select coalesce(sum(value_excl_st_minor), 0), coalesce(sum(sales_tax_minor), 0) into v_excl, v_tax
  from public.kamai_invoice_items where invoice_id = v_id;
  update public.kamai_invoices set total_excl_st_minor = v_excl, sales_tax_minor = v_tax, total_incl_minor = v_excl + v_tax
  where id = v_id;
  update public.kamai_orders set invoice_id = v_id where id = p_order_id;
  return v_id;
end;
$$;
revoke execute on function private.kamai_issue_invoice_core(uuid) from public, anon, authenticated;
grant execute on function private.kamai_issue_invoice_core(uuid) to service_role;

create or replace function public.kamai_issue_invoice(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.kamai_orders where id = p_order_id;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_tenant, array['owner','manager','booker','finance'])) then
    raise exception 'kamai: not allowed to issue invoices' using errcode = '42501';
  end if;
  return private.kamai_issue_invoice_core(p_order_id);
end;
$$;
revoke execute on function public.kamai_issue_invoice(uuid) from public, anon;
grant execute on function public.kamai_issue_invoice(uuid) to authenticated, service_role;
