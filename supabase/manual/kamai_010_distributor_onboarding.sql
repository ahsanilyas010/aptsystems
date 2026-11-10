-- Kamai OS migration 010: distributor self sign-up, product submission and admin review with a hidden platform margin.
-- Depends on 001..009. Idempotent and additive: new columns/tables/functions are kamai_ prefixed; existing objects are only
-- extended (kamai_tenants_guard, kamai_products and kamai_price_list_items policies, kamai_audit_log select policy).
--
-- Model
--   * A distributor signs up through /api/kamai-signup (service role): auth user + tenant (settings.onboarding_status
--     = 'pending_review', settings.signup = contact info) + owner membership + a kamai_admin_notifications row.
--   * The distributor uploads products (kamai_products.listing_status 'draft'), submits them (kamai_submit_products ->
--     'submitted', snapshot in `original`, one notification for the platform admin).
--   * The platform admin reviews (kamai_review_product / _bulk): may edit name/description/image/category, sets a platform
--     margin % (kamai_product_margins, admin only), and approval publishes the product to the tenant's default price list
--     at ceil(distributor_price * (1 + margin/100)). That price-list row is flagged `managed` and is invisible to every
--     tenant role except store and booker, so the distributor never sees the margin or the marked-up price.
--   * Store-facing roles (store, rider, booker) and supplier/brand readers only SELECT listing_status = 'approved' products.
--
-- "Distributor price" = kamai_products.trade_price_minor. "Description" is a new nullable column (the table had none).

-- ---------------------------------------------------------------------------
-- 1. kamai_tenants_guard: owners may not change onboarding state or the signup contact block
-- ---------------------------------------------------------------------------
create or replace function public.kamai_tenants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
begin
  if (select private.kamai_is_platform_admin()) or (select private.kamai_is_server()) then
    return new;
  end if;
  if new.status is distinct from old.status or new.type is distinct from old.type
     or new.slug is distinct from old.slug or new.created_by is distinct from old.created_by then
    raise exception 'kamai: status, type and slug are platform-controlled' using errcode = '42501';
  end if;
  foreach k in array array['credit_paused','credit_paused_by','credit_paused_at',
                           'onboarding_status','onboarding_note','onboarding_reviewed_at','signup'] loop
    if (new.settings -> k) is distinct from (old.settings -> k) then
      raise exception 'kamai: settings.% is platform-controlled', k using errcode = '42501';
    end if;
  end loop;
  if new.invoice_prefix is distinct from old.invoice_prefix and old.invoice_prefix is not null
     and to_regclass('public.kamai_invoices') is not null then
    if exists (select 1 from public.kamai_invoices i where i.tenant_id = old.id) then
      raise exception 'kamai: invoice_prefix cannot change once invoices exist' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_tenants_guard() from public, anon, authenticated;

-- every tenant that exists before this migration is already trusted (apt, kamai and anything an admin created)
update public.kamai_tenants
set settings = settings || jsonb_build_object('onboarding_status', 'approved')
where not (settings ? 'onboarding_status');

-- ---------------------------------------------------------------------------
-- 2. kamai_products: review lifecycle columns
-- ---------------------------------------------------------------------------
alter table public.kamai_products add column if not exists description text;
alter table public.kamai_products add column if not exists listing_status text not null default 'approved'
  check (listing_status in ('draft','submitted','changes_requested','approved','rejected'));
alter table public.kamai_products add column if not exists submitted_at timestamptz;
alter table public.kamai_products add column if not exists reviewed_at timestamptz;
alter table public.kamai_products add column if not exists reviewed_by uuid;
alter table public.kamai_products add column if not exists review_note text;
alter table public.kamai_products add column if not exists original jsonb;
create index if not exists kamai_products_tenant_listing_idx on public.kamai_products (tenant_id, listing_status);
create index if not exists kamai_products_submitted_idx on public.kamai_products (submitted_at) where listing_status = 'submitted';

-- ---------------------------------------------------------------------------
-- 3. kamai_price_list_items.managed: rows written by the platform review (marked-up price)
-- ---------------------------------------------------------------------------
alter table public.kamai_price_list_items add column if not exists managed boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. kamai_product_margins (platform admin only)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_product_margins (
  product_id             uuid primary key,
  tenant_id              uuid not null references public.kamai_tenants(id) on delete cascade,
  margin_pct             numeric(6,2) not null default 0 check (margin_pct between 0 and 500),
  distributor_price_minor bigint check (distributor_price_minor is null or distributor_price_minor >= 0),
  final_price_minor      bigint check (final_price_minor is null or final_price_minor >= 0),
  updated_by             uuid,
  updated_at             timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.kamai_products (tenant_id, id) on delete cascade
);
create index if not exists kamai_product_margins_tenant_idx on public.kamai_product_margins (tenant_id);
alter table public.kamai_product_margins enable row level security;

drop policy if exists kamai_product_margins_select on public.kamai_product_margins;
create policy kamai_product_margins_select on public.kamai_product_margins for select to authenticated
  using ((select private.kamai_is_platform_admin()));
drop policy if exists kamai_product_margins_insert on public.kamai_product_margins;
create policy kamai_product_margins_insert on public.kamai_product_margins for insert to authenticated
  with check ((select private.kamai_is_platform_admin()));
drop policy if exists kamai_product_margins_update on public.kamai_product_margins;
create policy kamai_product_margins_update on public.kamai_product_margins for update to authenticated
  using ((select private.kamai_is_platform_admin())) with check ((select private.kamai_is_platform_admin()));
drop policy if exists kamai_product_margins_delete on public.kamai_product_margins;
create policy kamai_product_margins_delete on public.kamai_product_margins for delete to authenticated
  using ((select private.kamai_is_platform_admin()));
revoke all on public.kamai_product_margins from anon;
grant select, insert, update, delete on public.kamai_product_margins to authenticated;
grant all on public.kamai_product_margins to service_role;

-- ---------------------------------------------------------------------------
-- 5. kamai_admin_notifications (read by platform admins, written by the server / SECURITY DEFINER code)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_admin_notifications (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('distributor_signup','products_submitted')),
  tenant_id      uuid references public.kamai_tenants(id) on delete cascade,
  payload        jsonb not null default '{}'::jsonb,
  email_status   text not null default 'pending' check (email_status in ('pending','sent','failed','skipped')),
  email_attempts int not null default 0,
  email_error    text,
  emailed_at     timestamptz,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists kamai_admin_notifications_created_idx on public.kamai_admin_notifications (created_at desc);
create index if not exists kamai_admin_notifications_tenant_idx on public.kamai_admin_notifications (tenant_id);
create index if not exists kamai_admin_notifications_retry_idx on public.kamai_admin_notifications (created_at)
  where email_status in ('pending','failed');
alter table public.kamai_admin_notifications enable row level security;

drop policy if exists kamai_admin_notifications_select on public.kamai_admin_notifications;
create policy kamai_admin_notifications_select on public.kamai_admin_notifications for select to authenticated
  using ((select private.kamai_is_platform_admin()));
revoke all on public.kamai_admin_notifications from anon, authenticated;
grant select on public.kamai_admin_notifications to authenticated;
grant all on public.kamai_admin_notifications to service_role;

-- ---------------------------------------------------------------------------
-- 6. kamai_signup_log (rate limiting; service role only, RLS on and no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_signup_log (
  id         bigint generated always as identity primary key,
  ip_hash    text,
  email_hash text,
  created_at timestamptz not null default now()
);
create index if not exists kamai_signup_log_ip_idx on public.kamai_signup_log (ip_hash, created_at desc);
create index if not exists kamai_signup_log_email_idx on public.kamai_signup_log (email_hash, created_at desc);
alter table public.kamai_signup_log enable row level security;
revoke all on public.kamai_signup_log from anon, authenticated;
grant all on public.kamai_signup_log to service_role;

-- ---------------------------------------------------------------------------
-- 7. product lifecycle guards
--    A "client" is a direct PostgREST statement (current_user authenticated/anon). SECURITY DEFINER RPCs run as their
--    owner, so they and the server pass; platform admins pass.
-- ---------------------------------------------------------------------------
create or replace function public.kamai_products_review_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated','anon') or (select private.kamai_is_platform_admin()) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- everything a distributor creates starts as a draft; review fields cannot be pre-set
    new.listing_status := 'draft';
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    new.original := null;
    return new;
  end if;
  if new.listing_status is distinct from old.listing_status or new.submitted_at is distinct from old.submitted_at
     or new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by
     or new.review_note is distinct from old.review_note or new.original is distinct from old.original then
    raise exception 'kamai: listing status and review fields are platform-controlled (use kamai_submit_products)' using errcode = '42501';
  end if;
  if old.listing_status not in ('draft','changes_requested')
     and (new.name, new.name_ur, new.description, new.category, new.image_url, new.trade_price_minor, new.retail_price_minor)
         is distinct from
         (old.name, old.name_ur, old.description, old.category, old.image_url, old.trade_price_minor, old.retail_price_minor) then
    new.listing_status := 'draft';   -- an edit pulls the product back out of review / the store catalog
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_products_review_guard() from public, anon, authenticated;
drop trigger if exists kamai_products_review_guard_ins on public.kamai_products;
create trigger kamai_products_review_guard_ins before insert on public.kamai_products
  for each row execute function public.kamai_products_review_guard();
drop trigger if exists kamai_products_review_guard_upd on public.kamai_products;
create trigger kamai_products_review_guard_upd before update on public.kamai_products
  for each row execute function public.kamai_products_review_guard();

-- when a product falls out of the published states, its price list rows go with it (runs as owner: managed rows are
-- invisible to the editing member)
create or replace function public.kamai_products_unpublish()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.kamai_price_list_items where product_id = new.id;
  return null;
end;
$$;
revoke execute on function public.kamai_products_unpublish() from public, anon, authenticated;
drop trigger if exists kamai_products_unpublish on public.kamai_products;
create trigger kamai_products_unpublish after update on public.kamai_products
  for each row when (old.listing_status = 'approved' and new.listing_status <> 'approved')
  execute function public.kamai_products_unpublish();

-- price list rows written by a tenant member: only for approved products, never for products under a platform margin
create or replace function private.kamai_product_pricing_state(p_product uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case when p.listing_status <> 'approved' then 'unapproved'
              when exists (select 1 from public.kamai_product_margins m where m.product_id = p.id) then 'margin'
              else 'ok' end
  from public.kamai_products p where p.id = p_product;
$$;
revoke execute on function private.kamai_product_pricing_state(uuid) from public, anon;
grant execute on function private.kamai_product_pricing_state(uuid) to authenticated, service_role;

create or replace function public.kamai_price_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_state text;
begin
  if current_user not in ('authenticated','anon') or (select private.kamai_is_platform_admin()) then
    return new;
  end if;
  v_state := (select private.kamai_product_pricing_state(new.product_id));
  if v_state = 'unapproved' then
    raise exception 'kamai: only approved products can be listed on a price list' using errcode = '42501';
  elsif v_state = 'margin' then
    raise exception 'kamai: the price of this product is managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_price_items_guard() from public, anon, authenticated;
drop trigger if exists kamai_price_items_guard on public.kamai_price_list_items;
create trigger kamai_price_items_guard before insert or update on public.kamai_price_list_items
  for each row execute function public.kamai_price_items_guard();

-- ---------------------------------------------------------------------------
-- 8. policies
-- ---------------------------------------------------------------------------
-- products: owner, manager, finance, viewer of the tenant see every status; store, rider, booker and the supplier / brand
-- readers see approved products only; platform admins see all.
drop policy if exists kamai_products_select on public.kamai_products;
create policy kamai_products_select on public.kamai_products for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_user_tenants())
             and (listing_status = 'approved' or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','viewer']))))
         or (listing_status = 'approved'
             and (tenant_id in (select private.kamai_linked_tenants(array['supplier']))
                  or brand_tenant_id in (select private.kamai_user_tenants()))));

-- price list items: managed (marked-up) rows are visible only to platform admins and to store / booker members
drop policy if exists kamai_price_list_items_select on public.kamai_price_list_items;
create policy kamai_price_list_items_select on public.kamai_price_list_items for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or ((select private.kamai_price_item_visible(tenant_id, price_list_id, product_id))
             and (not managed or (select private.kamai_has_role(tenant_id, array['store','booker'])))));
-- the old FOR ALL policy also granted SELECT; split it so managed rows stay hidden and immutable for tenant members
drop policy if exists kamai_price_list_items_write on public.kamai_price_list_items;
drop policy if exists kamai_price_list_items_insert on public.kamai_price_list_items;
create policy kamai_price_list_items_insert on public.kamai_price_list_items for insert to authenticated
  with check ((select private.kamai_is_platform_admin())
              or (not managed and (select private.kamai_has_role(tenant_id, array['owner','manager']))));
drop policy if exists kamai_price_list_items_update on public.kamai_price_list_items;
create policy kamai_price_list_items_update on public.kamai_price_list_items for update to authenticated
  using ((select private.kamai_is_platform_admin())
         or (not managed and (select private.kamai_has_role(tenant_id, array['owner','manager']))))
  with check ((select private.kamai_is_platform_admin())
              or (not managed and (select private.kamai_has_role(tenant_id, array['owner','manager']))));
drop policy if exists kamai_price_list_items_delete on public.kamai_price_list_items;
create policy kamai_price_list_items_delete on public.kamai_price_list_items for delete to authenticated
  using ((select private.kamai_is_platform_admin())
         or (not managed and (select private.kamai_has_role(tenant_id, array['owner','manager']))));

-- the audit log copies price list rows: hide the marked-up ones from tenant members
drop policy if exists kamai_audit_log_select on public.kamai_audit_log;
create policy kamai_audit_log_select on public.kamai_audit_log for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id is not null
             and (select private.kamai_has_role(tenant_id, array['owner','manager','finance']))
             and not (table_name = 'kamai_price_list_items'
                      and coalesce(new_row ->> 'managed', old_row ->> 'managed') = 'true')));

-- ---------------------------------------------------------------------------
-- 9. storage: public-read bucket kamai-product-images, '<tenant_id>/<file>'
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kamai-product-images', 'kamai-product-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- write access = platform admin anywhere in the bucket, or owner/manager/booker of the tenant named by the FIRST path folder
create or replace function private.kamai_prodimg_access(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_t uuid;
begin
  if (select private.kamai_is_platform_admin()) then
    return true;
  end if;
  if p_name is null or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+' then
    return false;
  end if;
  v_t := split_part(p_name, '/', 1)::uuid;
  return coalesce((select private.kamai_my_role(v_t)) in ('owner','manager','booker'), false);
end;
$$;
revoke execute on function private.kamai_prodimg_access(text) from public, anon;
grant execute on function private.kamai_prodimg_access(text) to authenticated, service_role;

drop policy if exists kamai_prodimg_select on storage.objects;
create policy kamai_prodimg_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'kamai-product-images');
drop policy if exists kamai_prodimg_insert on storage.objects;
create policy kamai_prodimg_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kamai-product-images' and (select private.kamai_prodimg_access(name)));
drop policy if exists kamai_prodimg_update on storage.objects;
create policy kamai_prodimg_update on storage.objects for update to authenticated
  using (bucket_id = 'kamai-product-images' and (select private.kamai_prodimg_access(name)))
  with check (bucket_id = 'kamai-product-images' and (select private.kamai_prodimg_access(name)));
drop policy if exists kamai_prodimg_delete on storage.objects;
create policy kamai_prodimg_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kamai-product-images' and (select private.kamai_prodimg_access(name)));

-- ---------------------------------------------------------------------------
-- 10. RPCs
-- ---------------------------------------------------------------------------
-- 10.1 distributor: submit drafts for review
create or replace function public.kamai_submit_products(p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenants uuid[];
  v_tenant uuid;
  v_admin boolean := (select private.kamai_is_platform_admin());
  v_n int;
  v_names jsonb;
  v_tname text;
  v_notif uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'kamai: sign in required' using errcode = '42501';
  end if;
  if p_product_ids is null or coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception 'kamai: p_product_ids is required' using errcode = '22023';
  end if;
  if array_length(p_product_ids, 1) > 500 then
    raise exception 'kamai: at most 500 products per submission' using errcode = '22023';
  end if;
  select array_agg(distinct p.tenant_id) into v_tenants from public.kamai_products p where p.id = any(p_product_ids);
  if v_tenants is null then
    raise exception 'kamai: not allowed to submit these products' using errcode = '42501';
  end if;
  if array_length(v_tenants, 1) > 1 then
    raise exception 'kamai: submit products of one tenant at a time' using errcode = '22023';
  end if;
  v_tenant := v_tenants[1];
  if not v_admin and not (select private.kamai_has_role(v_tenant, array['owner','manager'])) then
    raise exception 'kamai: not allowed to submit these products' using errcode = '42501';
  end if;
  if exists (select 1 from public.kamai_tenants t where t.id = v_tenant and t.settings ->> 'onboarding_status' = 'rejected') then
    raise exception 'kamai: this account was not approved' using errcode = '42501';
  end if;

  with up as (
    update public.kamai_products p set
      listing_status = 'submitted', submitted_at = now(), review_note = null,
      original = jsonb_build_object('name', p.name, 'description', p.description, 'image_url', p.image_url,
                                    'category', p.category, 'price_minor', p.trade_price_minor)
    where p.id = any(p_product_ids) and p.tenant_id = v_tenant and p.listing_status in ('draft','changes_requested')
    returning p.name
  )
  select count(*)::int, coalesce(jsonb_agg(name) filter (where rn <= 10), '[]'::jsonb)
  into v_n, v_names
  from (select name, row_number() over (order by name) rn from up) x;

  if v_n = 0 then
    return jsonb_build_object('submitted', 0, 'notification_id', null);
  end if;
  select t.name into v_tname from public.kamai_tenants t where t.id = v_tenant;
  insert into public.kamai_admin_notifications (kind, tenant_id, payload)
  values ('products_submitted', v_tenant,
          jsonb_build_object('count', v_n, 'product_names', v_names, 'tenant_name', v_tname))
  returning id into v_notif;
  return jsonb_build_object('submitted', v_n, 'notification_id', v_notif);
end;
$$;
revoke execute on function public.kamai_submit_products(uuid[]) from public, anon;
grant execute on function public.kamai_submit_products(uuid[]) to authenticated, service_role;

-- 10.2 admin: review one product
create or replace function public.kamai_review_product(p_product_id uuid, p_action text, p_margin_pct numeric default null,
                                                       p_patch jsonb default '{}'::jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.kamai_products;
  v_m numeric(6,2);
  v_dist bigint;
  v_final bigint;
  v_list uuid;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_img text;
begin
  if not (select private.kamai_is_platform_admin()) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve','request_changes','reject') then
    raise exception 'kamai: p_action must be approve, request_changes or reject' using errcode = '22023';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'kamai: p_patch must be a json object' using errcode = '22023';
  end if;
  select * into v_p from public.kamai_products where id = p_product_id for update;
  if not found then
    raise exception 'kamai: product not found' using errcode = '22023';
  end if;
  if p_action = 'request_changes' and v_note is null then
    raise exception 'kamai: a note is required when requesting changes' using errcode = '22023';
  end if;

  -- admin edits (whitelisted keys only; unknown keys are ignored)
  if v_patch ? 'image_url' then
    v_img := nullif(btrim(coalesce(v_patch ->> 'image_url', '')), '');
    if v_img is not null and v_img !~* '^https?://' then
      raise exception 'kamai: image_url must be an http(s) url' using errcode = '22023';
    end if;
  end if;
  if v_patch ? 'name' and nullif(btrim(coalesce(v_patch ->> 'name', '')), '') is null then
    raise exception 'kamai: name cannot be empty' using errcode = '22023';
  end if;
  update public.kamai_products p set
    name        = case when v_patch ? 'name' then btrim(v_patch ->> 'name') else p.name end,
    description = case when v_patch ? 'description' then nullif(btrim(coalesce(v_patch ->> 'description', '')), '') else p.description end,
    image_url   = case when v_patch ? 'image_url' then v_img else p.image_url end,
    category    = case when v_patch ? 'category' then nullif(btrim(coalesce(v_patch ->> 'category', '')), '') else p.category end
  where p.id = p_product_id;

  if p_action = 'approve' then
    v_m := coalesce(round(p_margin_pct, 2), (select m.margin_pct from public.kamai_product_margins m where m.product_id = p_product_id), 0);
    if v_m < 0 or v_m > 500 then
      raise exception 'kamai: margin must be between 0 and 500 percent' using errcode = '22023';
    end if;
    v_dist := v_p.trade_price_minor;
    v_final := ceil(v_dist::numeric * (100 + v_m) / 100)::bigint;
    insert into public.kamai_product_margins (product_id, tenant_id, margin_pct, distributor_price_minor, final_price_minor, updated_by, updated_at)
    values (p_product_id, v_p.tenant_id, v_m, v_dist, v_final, (select auth.uid()), now())
    on conflict (product_id) do update set
      margin_pct = excluded.margin_pct, distributor_price_minor = excluded.distributor_price_minor,
      final_price_minor = excluded.final_price_minor, updated_by = excluded.updated_by, updated_at = now();

    select id into v_list from public.kamai_price_lists where tenant_id = v_p.tenant_id and is_default and active
    order by created_at limit 1;
    if v_list is null then
      insert into public.kamai_price_lists (tenant_id, name, tier, is_default) values (v_p.tenant_id, 'Default', 'default', true)
      on conflict do nothing;
      select id into v_list from public.kamai_price_lists where tenant_id = v_p.tenant_id and is_default order by created_at limit 1;
    end if;
    insert into public.kamai_price_list_items (tenant_id, price_list_id, product_id, price_minor, managed)
    values (v_p.tenant_id, v_list, p_product_id, v_final, true)
    on conflict (price_list_id, product_id) do update set price_minor = excluded.price_minor, managed = true;
    v_status := 'approved';
  else
    delete from public.kamai_price_list_items where product_id = p_product_id;
    v_status := case p_action when 'reject' then 'rejected' else 'changes_requested' end;
  end if;

  update public.kamai_products set
    listing_status = v_status, reviewed_at = now(), reviewed_by = (select auth.uid()), review_note = v_note
  where id = p_product_id;

  return jsonb_build_object('product_id', p_product_id, 'listing_status', v_status,
                            'margin_pct', v_m, 'distributor_price_minor', v_dist, 'final_price_minor', v_final);
end;
$$;
revoke execute on function public.kamai_review_product(uuid, text, numeric, jsonb, text) from public, anon;
grant execute on function public.kamai_review_product(uuid, text, numeric, jsonb, text) to authenticated, service_role;

-- 10.3 admin: bulk review (each product in its own subtransaction)
create or replace function public.kamai_review_products_bulk(p_product_ids uuid[], p_action text, p_margin_pct numeric default null,
                                                             p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_done int := 0;
  v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not (select private.kamai_is_platform_admin()) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve','request_changes','reject') then
    raise exception 'kamai: p_action must be approve, request_changes or reject' using errcode = '22023';
  end if;
  if p_product_ids is null or coalesce(array_length(p_product_ids, 1), 0) = 0 or array_length(p_product_ids, 1) > 500 then
    raise exception 'kamai: p_product_ids must hold 1 to 500 ids' using errcode = '22023';
  end if;
  for v_id in select distinct x from unnest(p_product_ids) x loop
    begin
      perform public.kamai_review_product(v_id, p_action, p_margin_pct, '{}'::jsonb, p_note);
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errors) < 5 then
        v_errors := v_errors || jsonb_build_object('product_id', v_id, 'error', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_failed, 'errors', v_errors);
end;
$$;
revoke execute on function public.kamai_review_products_bulk(uuid[], text, numeric, text) from public, anon;
grant execute on function public.kamai_review_products_bulk(uuid[], text, numeric, text) to authenticated, service_role;

-- 10.4 admin: approve / reject the distributor account
create or replace function public.kamai_review_distributor(p_tenant_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select private.kamai_is_platform_admin()) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve','reject') then
    raise exception 'kamai: p_action must be approve or reject' using errcode = '22023';
  end if;
  v_status := case p_action when 'approve' then 'approved' else 'rejected' end;
  update public.kamai_tenants t set settings = t.settings || jsonb_build_object(
    'onboarding_status', v_status,
    'onboarding_reviewed_at', now(),
    'onboarding_note', nullif(btrim(coalesce(p_note, '')), ''))
  where t.id = p_tenant_id and t.type = 'distributor';
  if not found then
    raise exception 'kamai: distributor tenant not found' using errcode = '22023';
  end if;
  return jsonb_build_object('tenant_id', p_tenant_id, 'onboarding_status', v_status);
end;
$$;
revoke execute on function public.kamai_review_distributor(uuid, text, text) from public, anon;
grant execute on function public.kamai_review_distributor(uuid, text, text) to authenticated, service_role;

-- 10.5 admin: review queue (one row per distributor tenant, pending first)
create or replace function public.kamai_review_queue()
returns table (tenant_id uuid, tenant_name text, slug text, onboarding_status text, contact jsonb,
               submitted_count int, draft_count int, approved_count int, oldest_submitted_at timestamptz, created_at timestamptz)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (select private.kamai_is_platform_admin()) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  return query
  select t.id, t.name, t.slug,
         coalesce(t.settings ->> 'onboarding_status', 'approved'),
         coalesce(t.settings -> 'signup', '{}'::jsonb),
         (count(p.id) filter (where p.listing_status = 'submitted'))::int,
         (count(p.id) filter (where p.listing_status in ('draft','changes_requested')))::int,
         (count(p.id) filter (where p.listing_status = 'approved'))::int,
         min(p.submitted_at) filter (where p.listing_status = 'submitted'),
         t.created_at
  from public.kamai_tenants t
  left join public.kamai_products p on p.tenant_id = t.id
  where t.type = 'distributor'
  group by t.id
  order by (coalesce(t.settings ->> 'onboarding_status', 'approved') = 'pending_review') desc,
           (count(p.id) filter (where p.listing_status = 'submitted') > 0) desc,
           min(p.submitted_at) filter (where p.listing_status = 'submitted') asc nulls last,
           t.created_at desc;
end;
$$;
revoke execute on function public.kamai_review_queue() from public, anon;
grant execute on function public.kamai_review_queue() to authenticated, service_role;

-- 10.6 admin: mark notifications read
create or replace function public.kamai_mark_notifications_read(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not (select private.kamai_is_platform_admin()) then
    raise exception 'kamai: platform admins only' using errcode = '42501';
  end if;
  if p_ids is null then
    raise exception 'kamai: p_ids is required' using errcode = '22023';
  end if;
  update public.kamai_admin_notifications set read_at = now() where id = any(p_ids) and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.kamai_mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.kamai_mark_notifications_read(uuid[]) to authenticated, service_role;

-- 10.7 orders may only contain approved products (re-declared from 003 with one extra join condition)
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
  join public.kamai_products pr on pr.id = i.pid and pr.tenant_id = v_tenant and pr.active and pr.listing_status = 'approved'
  left join public.kamai_price_list_items pli on pli.product_id = pr.id and pli.price_list_id = v_list
  where i.qty > 0;
  get diagnostics v_n = row_count;
  if v_n <> v_want then
    raise exception 'kamai: one or more items are unknown, inactive, not approved or have qty <= 0' using errcode = '22023';
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
