-- Kamai OS migration 002: catalog and stores
-- kamai_products, kamai_price_lists, kamai_price_list_items, kamai_stores, kamai_store_imports,
-- private.kamai_store_scope, kamai_gtin_check_digit_ok.

-- ---------------------------------------------------------------------------
-- GTIN check digit (GS1 mod-10, weights 3,1 from the right over the 13 data digits of a 14-digit GTIN)
-- ---------------------------------------------------------------------------
create or replace function public.kamai_gtin_check_digit_ok(p_gtin14 text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  i int;
  s int := 0;
  w int;
begin
  if p_gtin14 is null or p_gtin14 !~ '^[0-9]{14}$' then
    return false;
  end if;
  for i in 1..13 loop
    -- position 13 (rightmost data digit) gets weight 3, then alternating
    w := case when (13 - i) % 2 = 0 then 3 else 1 end;
    s := s + (substr(p_gtin14, i, 1))::int * w;
  end loop;
  return ((10 - (s % 10)) % 10) = (substr(p_gtin14, 14, 1))::int;
end;
$$;
revoke execute on function public.kamai_gtin_check_digit_ok(text) from public, anon;
grant execute on function public.kamai_gtin_check_digit_ok(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_price_lists (created before products so stores can reference it)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_price_lists (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  name        text not null check (length(name) between 1 and 120),
  tier        text not null default 'default' check (tier in ('A','B','C','default')),
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index if not exists kamai_price_lists_default_uidx on public.kamai_price_lists (tenant_id) where is_default;
create index if not exists kamai_price_lists_tenant_idx on public.kamai_price_lists (tenant_id);
alter table public.kamai_price_lists enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_products
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_products (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.kamai_tenants(id) on delete cascade,
  sku                text not null check (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
  name               text not null check (length(name) between 1 and 200),
  name_ur            text,
  category           text,
  brand_tenant_id    uuid references public.kamai_tenants(id) on delete set null,
  legacy_product_id  text,                       -- public.products.id (text SKU), no FK by design
  gtin14             text check (gtin14 is null or (gtin14 ~ '^[0-9]{14}$' and public.kamai_gtin_check_digit_ok(gtin14))),
  gtin_type          smallint check (gtin_type is null or gtin_type in (8,12,13,14)),
  hs_code            text check (hs_code is null or hs_code ~ '^[0-9]{4}\.[0-9]{2,4}$'),
  fbr_uom            text,
  tax_rate_pct       numeric(5,2) not null default 0 check (tax_rate_pct >= 0 and tax_rate_pct <= 100),
  sale_type          text not null default 'Goods at standard rate (default)',
  is_third_schedule  boolean not null default false,
  retail_price_minor bigint check (retail_price_minor is null or retail_price_minor >= 0),
  cost_price_minor   bigint check (cost_price_minor is null or cost_price_minor >= 0),
  trade_price_minor  bigint not null default 0 check (trade_price_minor >= 0),
  image_url          text,
  pack_size          text,
  active             boolean not null default true,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, sku)
);
create unique index if not exists kamai_products_tenant_gtin_uidx on public.kamai_products (tenant_id, gtin14) where gtin14 is not null;
create index if not exists kamai_products_tenant_active_idx on public.kamai_products (tenant_id) where active;
create index if not exists kamai_products_brand_idx on public.kamai_products (brand_tenant_id) where brand_tenant_id is not null;
create index if not exists kamai_products_legacy_idx on public.kamai_products (legacy_product_id) where legacy_product_id is not null;
alter table public.kamai_products enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_price_list_items (tenant_id denormalised for cheap RLS)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_price_list_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.kamai_tenants(id) on delete cascade,
  price_list_id  uuid not null references public.kamai_price_lists(id) on delete cascade,
  product_id     uuid not null references public.kamai_products(id) on delete cascade,
  price_minor    bigint not null check (price_minor >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (price_list_id, product_id)
);
create index if not exists kamai_price_list_items_tenant_idx on public.kamai_price_list_items (tenant_id);
create index if not exists kamai_price_list_items_product_idx on public.kamai_price_list_items (product_id);
alter table public.kamai_price_list_items enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_stores
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_stores (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.kamai_tenants(id) on delete cascade,
  legacy_store_id     uuid,                      -- public.stores.id, no FK by design
  legacy_customer_id  text,                      -- public.customers.id (via stores.gas_customer_id)
  name                text not null check (length(name) between 1 and 200),
  owner_name          text,
  mobile              text check (mobile is null or mobile ~ '^\+[1-9][0-9]{7,14}$'),
  address             text,
  area                text,
  area_id             uuid,                      -- public.areas.id, no FK by design
  latitude            double precision check (latitude is null or (latitude between -90 and 90)),
  longitude           double precision check (longitude is null or (longitude between -180 and 180)),
  category            text,
  tier                text check (tier is null or tier in ('A','B','C','default')),
  price_list_id       uuid references public.kamai_price_lists(id) on delete set null,
  payment_terms_days  smallint not null default 0 check (payment_terms_days between 0 and 90),
  credit_limit_minor  bigint not null default 0 check (credit_limit_minor >= 0),
  credit_status       text not null default 'cash_only' check (credit_status in ('cash_only','active','paused','frozen','written_off')),
  payment_ref_code    text not null unique check (payment_ref_code ~ '^[A-Z0-9-]{4,24}$'),
  tax_profile         jsonb not null default '{}'::jsonb,
  wa_opt_in_at        timestamptz,
  wa_opt_in_source    text,
  status              text not null default 'active' check (status in ('active','inactive','blocked')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists kamai_stores_tenant_legacy_uidx on public.kamai_stores (tenant_id, legacy_store_id) where legacy_store_id is not null;
create index if not exists kamai_stores_tenant_idx on public.kamai_stores (tenant_id, status);
create index if not exists kamai_stores_price_list_idx on public.kamai_stores (price_list_id) where price_list_id is not null;
create index if not exists kamai_stores_area_idx on public.kamai_stores (tenant_id, area_id);
create index if not exists kamai_stores_mobile_idx on public.kamai_stores (mobile) where mobile is not null;
alter table public.kamai_stores enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_store_imports
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_store_imports (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.kamai_tenants(id) on delete cascade,
  file_name     text,
  file_hash     text not null,
  rows_total    int not null default 0,
  rows_created  int not null default 0,
  rows_updated  int not null default 0,
  rows_failed   int not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  status        text not null default 'pending' check (status in ('pending','done','failed')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, file_hash)
);
create index if not exists kamai_store_imports_tenant_idx on public.kamai_store_imports (tenant_id, created_at desc);
alter table public.kamai_store_imports enable row level security;

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------
drop trigger if exists kamai_price_lists_touch on public.kamai_price_lists;
create trigger kamai_price_lists_touch before update on public.kamai_price_lists for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_products_touch on public.kamai_products;
create trigger kamai_products_touch before update on public.kamai_products for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_price_list_items_touch on public.kamai_price_list_items;
create trigger kamai_price_list_items_touch before update on public.kamai_price_list_items for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_stores_touch on public.kamai_stores;
create trigger kamai_stores_touch before update on public.kamai_stores for each row execute function public.kamai_touch_updated_at();

drop trigger if exists kamai_products_audit on public.kamai_products;
create trigger kamai_products_audit after insert or update or delete on public.kamai_products for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_price_list_items_audit on public.kamai_price_list_items;
create trigger kamai_price_list_items_audit after insert or update or delete on public.kamai_price_list_items for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_stores_audit on public.kamai_stores;
create trigger kamai_stores_audit after insert or update or delete on public.kamai_stores for each row execute function public.kamai_audit_trigger();

-- ---------------------------------------------------------------------------
-- private.kamai_store_scope(t): store ids a user may see inside tenant t.
-- Store-role members see only their own store; every other reader (other roles,
-- linked tenants, platform admins) sees all stores of t.
-- ---------------------------------------------------------------------------
create or replace function private.kamai_store_scope(t uuid)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  with me as (
    select m.role, m.store_id from public.kamai_memberships m
    where m.tenant_id = t and m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select s.id from public.kamai_stores s
  where s.tenant_id = t
    and ((select me.role from me) is distinct from 'store' or s.id = (select me.store_id from me));
$$;
revoke execute on function private.kamai_store_scope(uuid) from public, anon;
grant execute on function private.kamai_store_scope(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists kamai_price_lists_select on public.kamai_price_lists;
create policy kamai_price_lists_select on public.kamai_price_lists for select to authenticated
  using ((select private.kamai_is_platform_admin()) or tenant_id in (select private.kamai_readable_tenants()));
drop policy if exists kamai_price_lists_write on public.kamai_price_lists;
create policy kamai_price_lists_write on public.kamai_price_lists for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_products_select on public.kamai_products;
create policy kamai_products_select on public.kamai_products for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or tenant_id in (select private.kamai_readable_tenants())
         or brand_tenant_id in (select private.kamai_user_tenants()));
drop policy if exists kamai_products_insert on public.kamai_products;
create policy kamai_products_insert on public.kamai_products for insert to authenticated
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));
drop policy if exists kamai_products_update on public.kamai_products;
create policy kamai_products_update on public.kamai_products for update to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));
drop policy if exists kamai_products_delete on public.kamai_products;
create policy kamai_products_delete on public.kamai_products for delete to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])));

drop policy if exists kamai_price_list_items_select on public.kamai_price_list_items;
create policy kamai_price_list_items_select on public.kamai_price_list_items for select to authenticated
  using ((select private.kamai_is_platform_admin()) or tenant_id in (select private.kamai_readable_tenants()));
drop policy if exists kamai_price_list_items_write on public.kamai_price_list_items;
create policy kamai_price_list_items_write on public.kamai_price_list_items for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_stores_select on public.kamai_stores;
create policy kamai_stores_select on public.kamai_stores for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and id in (select private.kamai_store_scope(tenant_id))));
drop policy if exists kamai_stores_insert on public.kamai_stores;
create policy kamai_stores_insert on public.kamai_stores for insert to authenticated
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','booker'])));
drop policy if exists kamai_stores_update on public.kamai_stores;
create policy kamai_stores_update on public.kamai_stores for update to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','booker'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','booker'])));
drop policy if exists kamai_stores_delete on public.kamai_stores;
create policy kamai_stores_delete on public.kamai_stores for delete to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])));

drop policy if exists kamai_store_imports_all on public.kamai_store_imports;
create policy kamai_store_imports_all on public.kamai_store_imports for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.kamai_price_lists from anon;
grant select, insert, update, delete on public.kamai_price_lists to authenticated;
grant all on public.kamai_price_lists to service_role;

revoke all on public.kamai_products from anon;
grant select, insert, update, delete on public.kamai_products to authenticated;
grant all on public.kamai_products to service_role;

revoke all on public.kamai_price_list_items from anon;
grant select, insert, update, delete on public.kamai_price_list_items to authenticated;
grant all on public.kamai_price_list_items to service_role;

revoke all on public.kamai_stores from anon;
grant select, insert, update, delete on public.kamai_stores to authenticated;
grant all on public.kamai_stores to service_role;

revoke all on public.kamai_store_imports from anon;
grant select, insert, update, delete on public.kamai_store_imports to authenticated;
grant all on public.kamai_store_imports to service_role;
