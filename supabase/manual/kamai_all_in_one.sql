-- Kamai OS: all 9 migrations in order (001..009), concatenated verbatim from supabase/migrations/.
-- Additive only. Run once, in the Supabase SQL editor of the aptcrm project. If it errors, nothing is half-applied only if the editor runs it as one transaction; otherwise stop and report the error.

-- ===================== 20261108120001_kamai_core.sql =====================
-- Kamai OS migration 001: tenancy core
-- Scope: private schema + RLS helpers, kamai_tenants, kamai_memberships, kamai_platform_admins,
-- kamai_tenant_links, kamai_invites, kamai_counters, kamai_audit_log, kamai_my_context,
-- kamai_create_tenant, kamai_add_member, kamai_next_counter.
-- Rules: idempotent; never touches existing public objects; every new object is kamai_ prefixed
-- (helpers live in schema private). Money is bigint minor units (paisa). Enums are text + CHECK.

-- ---------------------------------------------------------------------------
-- private schema (not exposed by PostgREST)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_tenants
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name            text not null check (length(name) between 1 and 200),
  type            text not null check (type in ('platform','distributor','brand','lender','vertical')),
  status          text not null default 'active' check (status in ('active','suspended','archived')),
  settings        jsonb not null default '{}'::jsonb,
  legal_name      text,
  ntn             text check (ntn is null or ntn ~ '^[0-9]{7,13}$'),
  strn            text,
  province        text,
  address         text,
  invoice_prefix  text check (invoice_prefix is null or invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  bank_iban       text,
  raast_alias     text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists kamai_tenants_type_idx on public.kamai_tenants (type) where status = 'active';
alter table public.kamai_tenants enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_memberships (NO force RLS: helpers rely on owner bypass)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_memberships (
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','manager','booker','finance','viewer','rider','store')),
  store_id    uuid,
  status      text not null default 'active' check (status in ('invited','active','disabled')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint kamai_memberships_store_scope_chk check (role <> 'store' or store_id is not null)
);
create index if not exists kamai_memberships_user_tenant_idx on public.kamai_memberships (user_id, tenant_id) where status = 'active';
create index if not exists kamai_memberships_store_idx on public.kamai_memberships (store_id) where store_id is not null;
alter table public.kamai_memberships enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_platform_admins
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.kamai_platform_admins enable row level security;
insert into public.kamai_platform_admins (user_id, note)
values ('ae9b1695-6121-4005-a2a1-08b5db4f8570', 'seed: live user_roles admin')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- kamai_tenant_links (cross-tenant read grants)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_tenant_links (
  grantor_tenant_id uuid not null references public.kamai_tenants(id) on delete cascade,
  grantee_tenant_id uuid not null references public.kamai_tenants(id) on delete cascade,
  kind              text not null check (kind in ('lender_view','brand_view','supplier')),
  scope             jsonb not null default '{}'::jsonb,
  active            boolean not null default true,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  primary key (grantor_tenant_id, grantee_tenant_id, kind),
  check (grantor_tenant_id <> grantee_tenant_id)
);
create index if not exists kamai_tenant_links_grantee_idx on public.kamai_tenant_links (grantee_tenant_id) where active;
alter table public.kamai_tenant_links enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_invites
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  token_hash  text not null unique,
  role        text not null check (role in ('owner','manager','booker','finance','viewer','rider','store')),
  store_id    uuid,
  email       text,
  phone       text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create index if not exists kamai_invites_tenant_idx on public.kamai_invites (tenant_id, created_at desc);
create index if not exists kamai_invites_store_idx on public.kamai_invites (store_id) where store_id is not null;
alter table public.kamai_invites enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_counters (per-tenant gapless counters)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_counters (
  tenant_id  uuid not null references public.kamai_tenants(id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z_]{1,40}$'),
  value      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, kind)
);
alter table public.kamai_counters enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_audit_log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_audit_log (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  op           text not null check (op in ('INSERT','UPDATE','DELETE')),
  record_id    text,
  tenant_id    uuid,
  actor        uuid,
  changed_keys text[],
  old_row      jsonb,
  new_row      jsonb,
  at           timestamptz not null default now()
);
create index if not exists kamai_audit_log_tenant_at_idx on public.kamai_audit_log (tenant_id, at desc);
create index if not exists kamai_audit_log_table_record_idx on public.kamai_audit_log (table_name, record_id);
alter table public.kamai_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------
create or replace function public.kamai_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.kamai_touch_updated_at() from public, anon, authenticated;

create or replace function public.kamai_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'kamai: % is append-only (% not allowed)', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;
revoke execute on function public.kamai_append_only() from public, anon, authenticated;

create or replace function public.kamai_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
  v_tenant uuid;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select array_agg(k order by k) into v_keys
    from (
      select key as k from jsonb_each(v_new) n
      where n.value is distinct from (v_old -> n.key)
    ) d;
    if v_keys is null then
      return null; -- nothing changed
    end if;
  else
    v_old := to_jsonb(old);
  end if;
  v_tenant := coalesce((coalesce(v_new, v_old) ->> 'tenant_id')::uuid, null);
  if tg_table_name = 'kamai_tenants' then
    v_tenant := (coalesce(v_new, v_old) ->> 'id')::uuid;
  end if;
  v_id := coalesce(coalesce(v_new, v_old) ->> 'id',
                   coalesce(v_new, v_old) ->> 'store_id',
                   (coalesce(v_new, v_old) ->> 'tenant_id') || ':' || (coalesce(v_new, v_old) ->> 'user_id'));
  insert into public.kamai_audit_log (table_name, op, record_id, tenant_id, actor, changed_keys, old_row, new_row)
  values (tg_table_name, tg_op, v_id, v_tenant, auth.uid(), v_keys, v_old, v_new);
  return null;
end;
$$;
revoke execute on function public.kamai_audit_trigger() from public, anon, authenticated;

drop trigger if exists kamai_audit_log_append_only on public.kamai_audit_log;
create trigger kamai_audit_log_append_only
  before update or delete on public.kamai_audit_log
  for each row execute function public.kamai_append_only();

drop trigger if exists kamai_tenants_touch on public.kamai_tenants;
create trigger kamai_tenants_touch before update on public.kamai_tenants
  for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_memberships_touch on public.kamai_memberships;
create trigger kamai_memberships_touch before update on public.kamai_memberships
  for each row execute function public.kamai_touch_updated_at();

drop trigger if exists kamai_tenants_audit on public.kamai_tenants;
create trigger kamai_tenants_audit after insert or update or delete on public.kamai_tenants
  for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_memberships_audit on public.kamai_memberships;
create trigger kamai_memberships_audit after insert or update or delete on public.kamai_memberships
  for each row execute function public.kamai_audit_trigger();

-- Owners may edit display/legal/operational fields of their tenant, never the platform-controlled ones:
-- status, type, slug and the credit pause switches (settings.credit_paused*). invoice_prefix is frozen once invoices exist.
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
  foreach k in array array['credit_paused','credit_paused_by','credit_paused_at'] loop
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
drop trigger if exists kamai_tenants_guard on public.kamai_tenants;
create trigger kamai_tenants_guard before update on public.kamai_tenants
  for each row execute function public.kamai_tenants_guard();

-- ---------------------------------------------------------------------------
-- private helpers (SECURITY DEFINER, STABLE, search_path '', owned by postgres)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.kamai_platform_admins a where a.user_id = (select auth.uid()))
      or exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin');
$$;

create or replace function private.kamai_is_server()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- true when there is no end-user JWT (postgres, pg_cron, service_role from the server)
  select (select auth.uid()) is null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') not in ('authenticated','anon');
$$;

-- All membership helpers ignore memberships of tenants that are not 'active' (suspended/archived tenants lose access;
-- platform admins and the server are unaffected).
create or replace function private.kamai_user_tenants()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id from public.kamai_memberships m
  join public.kamai_tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create or replace function private.kamai_is_member(t uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.kamai_memberships m
                 join public.kamai_tenants tt on tt.id = m.tenant_id and tt.status = 'active'
                 where m.tenant_id = t and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function private.kamai_has_role(t uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.kamai_memberships m
                 join public.kamai_tenants tt on tt.id = m.tenant_id and tt.status = 'active'
                 where m.tenant_id = t and m.user_id = (select auth.uid())
                   and m.status = 'active' and m.role = any(roles));
$$;

-- Tenants reachable through an active cross-tenant link of one of the given kinds. Only privileged roles of the
-- GRANTEE tenant (owner, manager, finance, viewer) benefit: store, rider and booker members of the grantee never read
-- the grantor's data. link.scope is reserved and not enforced in v1.
create or replace function private.kamai_linked_tenants(p_kinds text[])
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select l.grantor_tenant_id from public.kamai_tenant_links l
  join public.kamai_tenants g on g.id = l.grantor_tenant_id and g.status = 'active'
  where l.active and l.kind = any(p_kinds)
    and l.grantee_tenant_id in (select m.tenant_id from public.kamai_memberships m
                                join public.kamai_tenants gt on gt.id = m.tenant_id and gt.status = 'active'
                                where m.user_id = (select auth.uid()) and m.status = 'active'
                                  and m.role in ('owner','manager','finance','viewer'));
$$;

-- Generic read set used by the tenant-scoped select policies: own tenants plus grantors of a LENDER link
-- (lender_view = loan-book data: stores, orders, invoices, credit, payments). brand_view and supplier links are NOT in this
-- set: a brand reads only its own products (brand_tenant_id) and sell-through through kamai_brand_sellthrough() (009);
-- a supplier reads catalog and prices through kamai_linked_tenants(array['supplier']) in the catalog policies (002).
create or replace function private.kamai_readable_tenants()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select private.kamai_user_tenants()
  union
  select private.kamai_linked_tenants(array['lender_view']);
$$;

-- private.kamai_store_scope(uuid) is defined in 002 (needs kamai_stores).

create or replace function private.kamai_my_role(t uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.kamai_memberships m
  join public.kamai_tenants tt on tt.id = m.tenant_id and tt.status = 'active'
  where m.tenant_id = t and m.user_id = (select auth.uid()) and m.status = 'active';
$$;

revoke execute on function
  private.kamai_is_platform_admin(), private.kamai_is_server(), private.kamai_user_tenants(),
  private.kamai_is_member(uuid), private.kamai_has_role(uuid, text[]), private.kamai_readable_tenants(),
  private.kamai_my_role(uuid), private.kamai_linked_tenants(text[])
from public, anon;
grant execute on function
  private.kamai_is_platform_admin(), private.kamai_is_server(), private.kamai_user_tenants(),
  private.kamai_is_member(uuid), private.kamai_has_role(uuid, text[]), private.kamai_readable_tenants(),
  private.kamai_my_role(uuid), private.kamai_linked_tenants(text[])
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists kamai_tenants_select on public.kamai_tenants;
create policy kamai_tenants_select on public.kamai_tenants for select to authenticated
  using ((select private.kamai_is_platform_admin()) or id in (select private.kamai_readable_tenants())
         or id in (select private.kamai_linked_tenants(array['brand_view','supplier'])));
drop policy if exists kamai_tenants_insert on public.kamai_tenants;
create policy kamai_tenants_insert on public.kamai_tenants for insert to authenticated
  with check ((select private.kamai_is_platform_admin()));
drop policy if exists kamai_tenants_update on public.kamai_tenants;
create policy kamai_tenants_update on public.kamai_tenants for update to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(id, array['owner'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(id, array['owner'])));
drop policy if exists kamai_tenants_delete on public.kamai_tenants;
create policy kamai_tenants_delete on public.kamai_tenants for delete to authenticated
  using ((select private.kamai_is_platform_admin()));

drop policy if exists kamai_memberships_select on public.kamai_memberships;
create policy kamai_memberships_select on public.kamai_memberships for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.kamai_is_platform_admin())
         or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));
drop policy if exists kamai_memberships_write on public.kamai_memberships;
create policy kamai_memberships_write on public.kamai_memberships for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])));
-- managers add/change members only through kamai_add_member() (which blocks owner grants)

drop policy if exists kamai_platform_admins_select on public.kamai_platform_admins;
create policy kamai_platform_admins_select on public.kamai_platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select private.kamai_is_platform_admin()));
drop policy if exists kamai_platform_admins_write on public.kamai_platform_admins;
create policy kamai_platform_admins_write on public.kamai_platform_admins for all to authenticated
  using ((select private.kamai_is_platform_admin()))
  with check ((select private.kamai_is_platform_admin()));

drop policy if exists kamai_tenant_links_select on public.kamai_tenant_links;
create policy kamai_tenant_links_select on public.kamai_tenant_links for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or grantor_tenant_id in (select private.kamai_user_tenants())
         or grantee_tenant_id in (select private.kamai_user_tenants()));
drop policy if exists kamai_tenant_links_write on public.kamai_tenant_links;
create policy kamai_tenant_links_write on public.kamai_tenant_links for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(grantor_tenant_id, array['owner'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(grantor_tenant_id, array['owner'])));

drop policy if exists kamai_invites_all on public.kamai_invites;
create policy kamai_invites_all on public.kamai_invites for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_counters_select on public.kamai_counters;
create policy kamai_counters_select on public.kamai_counters for select to authenticated
  using ((select private.kamai_is_platform_admin()) or tenant_id in (select private.kamai_user_tenants()));

drop policy if exists kamai_audit_log_select on public.kamai_audit_log;
create policy kamai_audit_log_select on public.kamai_audit_log for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id is not null and (select private.kamai_has_role(tenant_id, array['owner','manager','finance']))));

-- ---------------------------------------------------------------------------
-- Grants (default ACL would have granted ALL to anon; tighten explicitly)
-- ---------------------------------------------------------------------------
revoke all on public.kamai_tenants from anon;
grant select, insert, update, delete on public.kamai_tenants to authenticated;
grant all on public.kamai_tenants to service_role;

revoke all on public.kamai_memberships from anon;
grant select, insert, update, delete on public.kamai_memberships to authenticated;
grant all on public.kamai_memberships to service_role;

revoke all on public.kamai_platform_admins from anon;
grant select, insert, update, delete on public.kamai_platform_admins to authenticated;
grant all on public.kamai_platform_admins to service_role;

revoke all on public.kamai_tenant_links from anon;
grant select, insert, update, delete on public.kamai_tenant_links to authenticated;
grant all on public.kamai_tenant_links to service_role;

revoke all on public.kamai_invites from anon;
grant select, insert, update, delete on public.kamai_invites to authenticated;
grant all on public.kamai_invites to service_role;

revoke all on public.kamai_counters from anon;
grant select on public.kamai_counters to authenticated;          -- written by functions only
grant all on public.kamai_counters to service_role;

revoke all on public.kamai_audit_log from anon;
grant select on public.kamai_audit_log to authenticated;         -- append-only, written by trigger
grant all on public.kamai_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- kamai_next_counter
-- ---------------------------------------------------------------------------
create or replace function public.kamai_next_counter(p_tenant uuid, p_kind text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.kamai_counters as c (tenant_id, kind, value)
  values (p_tenant, p_kind, 1)
  on conflict (tenant_id, kind) do update
    set value = c.value + 1, updated_at = now()
  returning c.value;
$$;
-- internal: not callable by end users directly
revoke execute on function public.kamai_next_counter(uuid, text) from public, anon, authenticated;
grant execute on function public.kamai_next_counter(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- kamai_my_context()
-- ---------------------------------------------------------------------------
create or replace function public.kamai_my_context()
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'platform_admin', (select private.kamai_is_platform_admin()),
    'legacy_roles', coalesce((select array_agg(r.role::text order by r.role) from public.user_roles r
                               where r.user_id = (select auth.uid())), array[]::text[]),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tenant_id', m.tenant_id,
               'role', m.role,
               'store_id', m.store_id,
               'status', m.status,
               'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'type', t.type, 'status', t.status)
             ) order by t.name)
      from public.kamai_memberships m
      join public.kamai_tenants t on t.id = m.tenant_id
      where m.user_id = (select auth.uid()) and m.status <> 'disabled'
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.kamai_my_context() from public, anon;
grant execute on function public.kamai_my_context() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_add_member
-- ---------------------------------------------------------------------------
create or replace function public.kamai_add_member(p_tenant uuid, p_user uuid, p_role text, p_store_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.kamai_memberships;
  v_old public.kamai_memberships;
  v_priv boolean;
begin
  v_priv := (select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
            or (select private.kamai_has_role(p_tenant, array['owner']));
  if not (v_priv or (select private.kamai_has_role(p_tenant, array['manager']))) then
    raise exception 'kamai: not allowed to manage members of this tenant' using errcode = '42501';
  end if;
  if p_role = 'owner' and not v_priv then
    raise exception 'kamai: only owners or platform admins may add owners' using errcode = '42501';
  end if;
  if p_role = 'store' and p_store_id is null then
    raise exception 'kamai: store role requires p_store_id';
  end if;
  if p_store_id is not null and not exists (select 1 from public.kamai_stores s where s.id = p_store_id and s.tenant_id = p_tenant) then
    raise exception 'kamai: store % does not belong to tenant %', p_store_id, p_tenant;
  end if;
  -- existing membership: managers may never modify an owner (demote, re-scope or re-enable); owners cannot remove the last owner
  select * into v_old from public.kamai_memberships where tenant_id = p_tenant and user_id = p_user for update;
  if found and v_old.role = 'owner' then
    if not v_priv then
      raise exception 'kamai: only owners or platform admins may modify an owner' using errcode = '42501';
    end if;
    if p_role <> 'owner' and v_old.status = 'active'
       and not exists (select 1 from public.kamai_memberships o
                       where o.tenant_id = p_tenant and o.role = 'owner' and o.status = 'active' and o.user_id <> p_user) then
      raise exception 'kamai: cannot demote the last owner' using errcode = '22023';
    end if;
  end if;
  insert into public.kamai_memberships as m (tenant_id, user_id, role, store_id, status, created_by)
  values (p_tenant, p_user, p_role, p_store_id, 'active', auth.uid())
  on conflict (tenant_id, user_id) do update
    set role = excluded.role, store_id = excluded.store_id, status = 'active', updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke execute on function public.kamai_add_member(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.kamai_add_member(uuid, uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kamai_create_tenant (platform admin only). Depends at runtime on
-- kamai_seed_ledger_accounts (005), kamai_seed_credit_policy and kamai_seed_dunning_rules (006).
-- ---------------------------------------------------------------------------
create or replace function public.kamai_create_tenant(p_slug text, p_name text, p_type text, p_settings jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    raise exception 'kamai: only platform admins may create tenants' using errcode = '42501';
  end if;
  insert into public.kamai_tenants (slug, name, type, settings, created_by)
  values (p_slug, p_name, p_type, coalesce(p_settings, '{}'::jsonb), auth.uid())
  returning id into v_id;
  perform public.kamai_seed_ledger_accounts(v_id);
  perform public.kamai_seed_credit_policy(v_id);
  perform public.kamai_seed_dunning_rules(v_id);
  insert into public.kamai_price_lists (tenant_id, name, tier, is_default)
  values (v_id, 'Default', 'default', true)
  on conflict do nothing;
  return v_id;
end;
$$;
revoke execute on function public.kamai_create_tenant(text, text, text, jsonb) from public, anon;
grant execute on function public.kamai_create_tenant(text, text, text, jsonb) to authenticated, service_role;

-- ===================== 20261108120002_kamai_catalog_stores.sql =====================
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
  unique (tenant_id, name),
  unique (tenant_id, id)            -- target of tenant-consistent composite FKs
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
  trade_price_minor  bigint not null default 0 check (trade_price_minor >= 0),
  image_url          text,
  pack_size          text,
  active             boolean not null default true,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, id)            -- target of tenant-consistent composite FKs
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
  price_list_id  uuid not null,
  product_id     uuid not null,
  price_minor    bigint not null check (price_minor >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (price_list_id, product_id),
  -- the list and the product must belong to the SAME tenant as the item (no cross-tenant price poisoning)
  foreign key (tenant_id, price_list_id) references public.kamai_price_lists (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.kamai_products (tenant_id, id) on delete cascade
);
create index if not exists kamai_price_list_items_tenant_idx on public.kamai_price_list_items (tenant_id);
create index if not exists kamai_price_list_items_product_idx on public.kamai_price_list_items (product_id);
alter table public.kamai_price_list_items enable row level security;

-- ---------------------------------------------------------------------------
-- kamai_product_costs: distributor cost price, split out of kamai_products so that store, rider, brand and
-- linked readers of the catalog can never read it (readable by owner, manager, finance only).
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_product_costs (
  product_id       uuid primary key,
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,
  cost_price_minor bigint not null check (cost_price_minor >= 0),
  updated_at       timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.kamai_products (tenant_id, id) on delete cascade
);
create index if not exists kamai_product_costs_tenant_idx on public.kamai_product_costs (tenant_id);
alter table public.kamai_product_costs enable row level security;

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
  price_list_id       uuid,
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
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, price_list_id) references public.kamai_price_lists (tenant_id, id) on delete set null (price_list_id)
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
drop trigger if exists kamai_product_costs_touch on public.kamai_product_costs;
create trigger kamai_product_costs_touch before update on public.kamai_product_costs for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_product_costs_audit on public.kamai_product_costs;
create trigger kamai_product_costs_audit after insert or update or delete on public.kamai_product_costs for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_stores_touch on public.kamai_stores;
create trigger kamai_stores_touch before update on public.kamai_stores for each row execute function public.kamai_touch_updated_at();

drop trigger if exists kamai_products_audit on public.kamai_products;
create trigger kamai_products_audit after insert or update or delete on public.kamai_products for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_price_list_items_audit on public.kamai_price_list_items;
create trigger kamai_price_list_items_audit after insert or update or delete on public.kamai_price_list_items for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_stores_audit on public.kamai_stores;
create trigger kamai_stores_audit after insert or update or delete on public.kamai_stores for each row execute function public.kamai_audit_trigger();

-- ---------------------------------------------------------------------------
-- Reference validation triggers: store_id on memberships/invites must be a store of the same tenant;
-- products.brand_tenant_id must be a tenant of type 'brand'.
-- ---------------------------------------------------------------------------
create or replace function public.kamai_check_store_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_id is not null and not exists (select 1 from public.kamai_stores s where s.id = new.store_id and s.tenant_id = new.tenant_id) then
    raise exception 'kamai: store % does not belong to tenant %', new.store_id, new.tenant_id using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_check_store_tenant() from public, anon, authenticated;
drop trigger if exists kamai_memberships_store_chk on public.kamai_memberships;
create trigger kamai_memberships_store_chk before insert or update of store_id, tenant_id on public.kamai_memberships
  for each row execute function public.kamai_check_store_tenant();
drop trigger if exists kamai_invites_store_chk on public.kamai_invites;
create trigger kamai_invites_store_chk before insert or update of store_id, tenant_id on public.kamai_invites
  for each row execute function public.kamai_check_store_tenant();

create or replace function public.kamai_check_product_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_tenant_id is not null and not exists (select 1 from public.kamai_tenants t where t.id = new.brand_tenant_id and t.type = 'brand') then
    raise exception 'kamai: brand_tenant_id must be a tenant of type brand' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_check_product_brand() from public, anon, authenticated;
drop trigger if exists kamai_products_brand_chk on public.kamai_products;
create trigger kamai_products_brand_chk before insert or update of brand_tenant_id on public.kamai_products
  for each row execute function public.kamai_check_product_brand();

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
-- Price visibility (finding: store and rider members must not read every tier / other stores' lists):
--   owner, manager, booker, finance, viewer of the tenant: everything; supplier-linked tenants: everything;
--   store members: the default list plus the list assigned to their own store; brand tenants: items of their own products;
--   riders and every other reader: nothing.
create or replace function private.kamai_my_store_price_list(t uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select s.price_list_id from public.kamai_memberships m
  join public.kamai_stores s on s.id = m.store_id and s.tenant_id = m.tenant_id
  where m.tenant_id = t and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'store';
$$;

create or replace function private.kamai_price_list_visible(t uuid, pl uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select private.kamai_has_role(t, array['owner','manager','booker','finance','viewer']))
      or t in (select private.kamai_linked_tenants(array['supplier']))
      or ((select private.kamai_has_role(t, array['store']))
          and exists (select 1 from public.kamai_price_lists l
                      where l.id = pl and l.tenant_id = t and (l.is_default or l.id = (select private.kamai_my_store_price_list(t)))))
      or exists (select 1 from public.kamai_price_list_items i join public.kamai_products p on p.id = i.product_id
                 where i.price_list_id = pl and i.tenant_id = t and p.brand_tenant_id in (select private.kamai_user_tenants()));
$$;

create or replace function private.kamai_price_item_visible(t uuid, pl uuid, pr uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select private.kamai_has_role(t, array['owner','manager','booker','finance','viewer']))
      or t in (select private.kamai_linked_tenants(array['supplier']))
      or ((select private.kamai_has_role(t, array['store']))
          and exists (select 1 from public.kamai_price_lists l
                      where l.id = pl and l.tenant_id = t and (l.is_default or l.id = (select private.kamai_my_store_price_list(t)))))
      or exists (select 1 from public.kamai_products p where p.id = pr and p.tenant_id = t
                 and p.brand_tenant_id in (select private.kamai_user_tenants()));
$$;
revoke execute on function private.kamai_my_store_price_list(uuid), private.kamai_price_list_visible(uuid, uuid),
  private.kamai_price_item_visible(uuid, uuid, uuid) from public, anon;
grant execute on function private.kamai_my_store_price_list(uuid), private.kamai_price_list_visible(uuid, uuid),
  private.kamai_price_item_visible(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists kamai_price_lists_select on public.kamai_price_lists;
create policy kamai_price_lists_select on public.kamai_price_lists for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_price_list_visible(tenant_id, id)));
drop policy if exists kamai_price_lists_write on public.kamai_price_lists;
create policy kamai_price_lists_write on public.kamai_price_lists for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_products_select on public.kamai_products;
create policy kamai_products_select on public.kamai_products for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or tenant_id in (select private.kamai_user_tenants())
         or tenant_id in (select private.kamai_linked_tenants(array['supplier']))
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
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_price_item_visible(tenant_id, price_list_id, product_id)));
drop policy if exists kamai_price_list_items_write on public.kamai_price_list_items;
create policy kamai_price_list_items_write on public.kamai_price_list_items for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_product_costs_select on public.kamai_product_costs;
create policy kamai_product_costs_select on public.kamai_product_costs for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));
drop policy if exists kamai_product_costs_write on public.kamai_product_costs;
create policy kamai_product_costs_write on public.kamai_product_costs for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));

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

revoke all on public.kamai_product_costs from anon;
grant select, insert, update, delete on public.kamai_product_costs to authenticated;
grant all on public.kamai_product_costs to service_role;

revoke all on public.kamai_stores from anon;
grant select, insert, update, delete on public.kamai_stores to authenticated;
grant all on public.kamai_stores to service_role;

revoke all on public.kamai_store_imports from anon;
grant select, insert, update, delete on public.kamai_store_imports to authenticated;
grant all on public.kamai_store_imports to service_role;

-- ===================== 20261108120003_kamai_orders_delivery.sql =====================
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

-- OTP hash, expiry and attempt counter live here, NOT on kamai_delivery_proofs (which the rider can read):
-- RLS is enabled with no policy and no grant to anon/authenticated, so only SECURITY DEFINER functions touch it.
create table if not exists public.kamai_delivery_otp_secrets (
  order_id       uuid primary key references public.kamai_orders(id) on delete cascade,
  tenant_id      uuid not null references public.kamai_tenants(id) on delete cascade,
  otp_hash       text not null,
  expires_at     timestamptz not null,
  attempts       int not null default 0,
  issue_count    int not null default 1,
  last_issued_at timestamptz not null default now()
);
create index if not exists kamai_delivery_otp_secrets_tenant_idx on public.kamai_delivery_otp_secrets (tenant_id);
alter table public.kamai_delivery_otp_secrets enable row level security;

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

revoke all on public.kamai_delivery_otp_secrets from anon, authenticated;
grant all on public.kamai_delivery_otp_secrets to service_role;

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
  -- tenant-scoped: the rider must hold an active 'rider' membership in THIS tenant (no global user_roles fallback)
  if not exists (select 1 from public.kamai_memberships m
                 where m.tenant_id = v_o.tenant_id and m.user_id = p_rider_user_id and m.role = 'rider' and m.status = 'active') then
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
  v_o    public.kamai_orders;
  v_s    public.kamai_delivery_otp_secrets;
  v_priv boolean;
  v_n    bigint;
  v_code text;
  v_exp  timestamptz := now() + interval '24 hours';
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  v_priv := (select private.kamai_can(v_o.tenant_id, array['owner','manager']));
  -- the assigned rider must still be an active rider member of the order's tenant
  if not (v_priv
          or (select private.kamai_can(v_o.tenant_id, array['booker']))
          or (v_o.rider_user_id is not null and v_o.rider_user_id = (select auth.uid())
              and (select private.kamai_has_role(v_o.tenant_id, array['rider'])))) then
    raise exception 'kamai: not allowed to issue a delivery OTP' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'dispatched' then
    raise exception 'kamai: OTP can only be issued for a dispatched order' using errcode = '22023';
  end if;
  select * into v_s from public.kamai_delivery_otp_secrets where order_id = p_order_id for update;
  if found and not v_priv then
    -- reissue resets the attempt counter, so it is throttled: 60 s apart, 3 issues per order for non-managers
    if v_s.last_issued_at > now() - interval '60 seconds' then
      raise exception 'kamai: OTP was issued moments ago (OTP_RATE_LIMITED)' using errcode = '22023';
    end if;
    if v_s.issue_count >= 3 then
      raise exception 'kamai: OTP reissue limit reached, ask a manager (OTP_REISSUE_LIMIT)' using errcode = '22023';
    end if;
  end if;
  -- CSPRNG; 32 random bits mod 10^6 (bias < 0.03%)
  v_n := (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32))::bigint;
  v_code := lpad((v_n % 1000000)::text, 6, '0');
  insert into public.kamai_delivery_otp_secrets as s (order_id, tenant_id, otp_hash, expires_at, attempts, issue_count, last_issued_at)
  values (p_order_id, v_o.tenant_id, extensions.crypt(p_order_id::text || ':' || v_code, extensions.gen_salt('bf', 8)), v_exp, 0, 1, now())
  on conflict (order_id) do update
    set otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0,
        issue_count = s.issue_count + 1, last_issued_at = now();
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
  v_sec      public.kamai_delivery_otp_secrets;
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
  v_acc      double precision;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  -- the assigned rider must still be an active rider member of the order's tenant
  if not ((select private.kamai_can(v_o.tenant_id, array['owner','manager']))
          or (v_o.rider_user_id is not null and v_o.rider_user_id = (select auth.uid())
              and (select private.kamai_has_role(v_o.tenant_id, array['rider'])))) then
    raise exception 'kamai: only the assigned rider or a manager may confirm delivery' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'dispatched' then
    raise exception 'kamai: order is not dispatched (state %)', v_o.fulfilment_status using errcode = '22023';
  end if;
  select * into v_store from public.kamai_stores where id = v_o.store_id;
  select * into v_tenant from public.kamai_tenants where id = v_o.tenant_id;
  select * into v_proof from public.kamai_delivery_proofs where order_id = p_order_id for update;

  -- take the store's credit-account lock before any exposure is created, so credit decisions
  -- (which hold the same lock) never see a half-moved pending/open balance
  if v_o.payment_mode = 'credit' then
    perform 1 from public.kamai_credit_accounts where store_id = v_o.store_id for update;
  end if;

  -- OTP
  if p_otp is not null and btrim(p_otp) <> '' then
    select * into v_sec from public.kamai_delivery_otp_secrets where order_id = p_order_id for update;
    if not found then
      raise exception 'kamai: no OTP has been issued for this order' using errcode = '22023';
    end if;
    if v_sec.attempts >= 5 then
      return jsonb_build_object('ok', false, 'error', 'OTP_LOCKED');
    end if;
    if v_sec.expires_at < now() then
      return jsonb_build_object('ok', false, 'error', 'OTP_EXPIRED');
    end if;
    if extensions.crypt(p_order_id::text || ':' || btrim(p_otp), v_sec.otp_hash) <> v_sec.otp_hash then
      update public.kamai_delivery_otp_secrets set attempts = attempts + 1 where order_id = p_order_id
      returning attempts into v_attempts;
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
    -- device-reported accuracy may widen the fence, but never by more than 100 m (a spoofed 1e6 would void the check)
    v_acc := least(greatest(coalesce(p_accuracy_m, 0), 0), 100);
    v_geo_ok := v_dist <= greatest(v_radius, v_acc);
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
  delete from public.kamai_delivery_otp_secrets where order_id = p_order_id;

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
  if found and v_p.resolution is not null then
    raise exception 'kamai: this delivery dispute was already resolved (DISPUTE_ALREADY_RESOLVED)' using errcode = '22023';
  end if;
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
  v_p public.kamai_delivery_proofs;
  v_x record;
  v_credit bigint := coalesce(p_credit_minor, 0);
  v_prior bigint;
  v_apply bigint := 0;
  v_unapplied bigint := 0;
  v_net bigint;
  v_tax bigint;
  v_serial bigint;
  v_cn uuid;
  v_inv record;
  v_lines jsonb;
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
  select * into v_p from public.kamai_delivery_proofs where order_id = p_order_id for update;
  v_prior := coalesce(v_p.credit_minor, 0);
  -- a dispute is resolved once (kamai_dispute_delivery refuses a second one); cap on what is not yet credited
  if v_credit < 0 or v_credit > v_o.total_minor - v_prior then
    raise exception 'kamai: credit must be between 0 and the order total not yet credited (%)', v_o.total_minor - v_prior using errcode = '22023';
  end if;

  if v_credit > 0 then
    -- split the credit into net and tax in the order's own ratio
    v_net := case when v_o.total_minor > 0 then round(v_credit::numeric * v_o.subtotal_minor / v_o.total_minor)::bigint else v_credit end;
    v_tax := v_credit - v_net;

    select * into v_x from public.kamai_credit_exposures where order_id = p_order_id for update;
    if found and v_x.status = 'open' then
      v_apply := least(v_credit, v_x.outstanding_minor);
      update public.kamai_credit_exposures set
        credited_minor = credited_minor + v_apply,
        outstanding_minor = outstanding_minor - v_apply,
        status = case when outstanding_minor - v_apply = 0 then 'paid' else status end,
        closed_at = case when outstanding_minor - v_apply = 0 then now() else closed_at end
      where id = v_x.id;
      -- anything beyond what is still owed (already paid) stays on the store's 1200 sub-ledger as an unapplied credit
      v_unapplied := v_credit - v_apply;
    elsif found then
      v_unapplied := v_credit;
    else
      v_apply := v_credit;   -- COD order: no exposure row, the credit simply reduces the receivable
    end if;

    v_lines := case when v_net > 0 then jsonb_build_array(
      jsonb_build_object('account_code', '4100', 'direction', 'debit', 'amount_minor', v_net)) else '[]'::jsonb end
      || case when v_tax > 0 then jsonb_build_array(
           jsonb_build_object('account_code', '2450', 'direction', 'debit', 'amount_minor', v_tax)) else '[]'::jsonb end
      || case when v_apply > 0 then jsonb_build_array(
           jsonb_build_object('account_code', '1200', 'direction', 'credit', 'amount_minor', v_apply,
                              'party_type', 'store', 'party_id', v_o.store_id::text)) else '[]'::jsonb end
      || case when v_unapplied > 0 then jsonb_build_array(
           jsonb_build_object('account_code', '1200', 'direction', 'credit', 'amount_minor', v_unapplied,
                              'party_type', 'store', 'party_id', v_o.store_id::text, 'memo', 'unapplied credit (refund due)')) else '[]'::jsonb end;
    perform private.kamai_post_entry_core(v_o.tenant_id, 'order:' || p_order_id || ':dispute-credit:' || v_prior, 'dispute', p_order_id::text, now(),
      'Dispute credit for order ' || v_o.order_no, v_lines);
    -- credit note
    select * into v_inv from public.kamai_invoices where id = v_o.invoice_id;
    if found then
      v_serial := public.kamai_next_counter(v_o.tenant_id, 'invoice');
      insert into public.kamai_invoices
        (tenant_id, serial_no, display_number, invoice_type, invoice_date, order_id, store_id, seller_snapshot, buyer_snapshot,
         buyer_ntn_cnic, buyer_registration_type, total_excl_st_minor, sales_tax_minor, total_incl_minor, due_date, status, ref_invoice_id)
      values (v_o.tenant_id, v_serial, split_part(v_inv.display_number, '-', 1) || '-' || lpad(v_serial::text, 6, '0'),
              'Credit Note', (now() at time zone 'Asia/Karachi')::date, null, v_o.store_id, v_inv.seller_snapshot, v_inv.buyer_snapshot,
              v_inv.buyer_ntn_cnic, v_inv.buyer_registration_type, v_net, v_tax, v_credit, null, 'issued', v_inv.id)
      returning id into v_cn;
    end if;
  end if;

  perform private.kamai_do_transition(p_order_id, 'delivered', 'dispute resolved: ' || p_resolution,
    jsonb_build_object('credit_minor', v_credit, 'credit_note_id', v_cn), (select auth.uid()));
  update public.kamai_delivery_proofs set resolved_at = now(), resolution = p_resolution, credit_minor = v_prior + v_credit
  where order_id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'credit_minor', v_credit, 'credit_note_id', v_cn,
                            'unapplied_minor', v_unapplied);
end;
$$;
revoke execute on function public.kamai_resolve_dispute(uuid, text, bigint) from public, anon;
grant execute on function public.kamai_resolve_dispute(uuid, text, bigint) to authenticated, service_role;

-- ===================== 20261108120004_kamai_invoices.sql =====================
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
  -- invoices are issued on delivered goods only: never for booked/cancelled/rejected orders, whose
  -- quantities and prices can still change (the delivery re-price would otherwise leave a stale invoice)
  if v_o.fulfilment_status not in ('delivered','disputed') then
    raise exception 'kamai: an invoice can only be issued for a delivered order (state %)', v_o.fulfilment_status using errcode = '22023';
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

-- ===================== 20261108120005_kamai_ledger.sql =====================
-- Kamai OS migration 005: immutable double-entry ledger (bigint minor units).

create table if not exists public.kamai_ledger_accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  code        text not null check (code ~ '^[0-9]{4}$'),
  name        text not null,
  type        text not null check (type in ('asset','liability','equity','revenue','expense','contra')),
  normal_side text not null check (normal_side in ('debit','credit')),
  currency    char(3) not null default 'PKR',
  party_type  text,
  party_id    text,
  is_control  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
alter table public.kamai_ledger_accounts enable row level security;

create table if not exists public.kamai_ledger_entries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.kamai_tenants(id) on delete cascade,
  idempotency_key    text not null,
  status             text not null default 'posted' check (status in ('pending','posted')),
  effective_at       timestamptz not null default now(),
  source_type        text not null,
  source_id          text not null,
  reverses_entry_id  uuid references public.kamai_ledger_entries(id),
  memo               text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists kamai_ledger_entries_tenant_eff_idx on public.kamai_ledger_entries (tenant_id, effective_at);
create index if not exists kamai_ledger_entries_source_idx on public.kamai_ledger_entries (tenant_id, source_type, source_id);
create index if not exists kamai_ledger_entries_reverses_idx on public.kamai_ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
alter table public.kamai_ledger_entries enable row level security;

create table if not exists public.kamai_ledger_lines (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.kamai_tenants(id) on delete cascade,
  entry_id     uuid not null references public.kamai_ledger_entries(id),
  account_id   uuid not null references public.kamai_ledger_accounts(id),
  direction    text not null check (direction in ('debit','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency     char(3) not null default 'PKR',
  party_type   text,
  party_id     text,
  memo         text
);
create index if not exists kamai_ledger_lines_account_idx on public.kamai_ledger_lines (account_id, entry_id);
create index if not exists kamai_ledger_lines_entry_idx on public.kamai_ledger_lines (entry_id);
create index if not exists kamai_ledger_lines_tenant_party_idx on public.kamai_ledger_lines (tenant_id, party_type, party_id);
alter table public.kamai_ledger_lines enable row level security;

-- ---------------------------------------------------------------------------
-- balance + immutability triggers
-- ---------------------------------------------------------------------------
create or replace function public.kamai_ledger_check_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_diff bigint;
  v_n int;
begin
  -- (separate branches: plpgsql resolves new.<field> per statement, and each table's row type lacks the other's column)
  if tg_table_name = 'kamai_ledger_entries' then
    v_entry := new.id;
  else
    v_entry := new.entry_id;
  end if;
  select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0), count(*)
    into v_diff, v_n
  from public.kamai_ledger_lines where entry_id = v_entry;
  if v_n < 2 or v_diff <> 0 then
    raise exception 'kamai ledger: entry % is unbalanced (diff %, lines %)', v_entry, v_diff, v_n using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke execute on function public.kamai_ledger_check_balanced() from public, anon, authenticated;

drop trigger if exists kamai_ledger_lines_balanced on public.kamai_ledger_lines;
create constraint trigger kamai_ledger_lines_balanced
  after insert on public.kamai_ledger_lines
  deferrable initially deferred
  for each row execute function public.kamai_ledger_check_balanced();
drop trigger if exists kamai_ledger_entries_balanced on public.kamai_ledger_entries;
create constraint trigger kamai_ledger_entries_balanced
  after insert on public.kamai_ledger_entries
  deferrable initially deferred
  for each row execute function public.kamai_ledger_check_balanced();

create or replace function public.kamai_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'kamai ledger: % is append-only; post a reversing entry instead', tg_table_name using errcode = '42501';
end;
$$;
revoke execute on function public.kamai_ledger_immutable() from public, anon, authenticated;

drop trigger if exists kamai_ledger_lines_no_change on public.kamai_ledger_lines;
create trigger kamai_ledger_lines_no_change before update or delete on public.kamai_ledger_lines
  for each row execute function public.kamai_ledger_immutable();
drop trigger if exists kamai_ledger_entries_no_change on public.kamai_ledger_entries;
create trigger kamai_ledger_entries_no_change before update or delete on public.kamai_ledger_entries
  for each row execute function public.kamai_ledger_immutable();
drop trigger if exists kamai_ledger_accounts_audit on public.kamai_ledger_accounts;
create trigger kamai_ledger_accounts_audit after insert or update or delete on public.kamai_ledger_accounts
  for each row execute function public.kamai_audit_trigger();

-- ---------------------------------------------------------------------------
-- policies: owner / manager / finance / platform admin read; no direct writes
-- ---------------------------------------------------------------------------
drop policy if exists kamai_ledger_accounts_select on public.kamai_ledger_accounts;
create policy kamai_ledger_accounts_select on public.kamai_ledger_accounts for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));
drop policy if exists kamai_ledger_entries_select on public.kamai_ledger_entries;
create policy kamai_ledger_entries_select on public.kamai_ledger_entries for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));
drop policy if exists kamai_ledger_lines_select on public.kamai_ledger_lines;
create policy kamai_ledger_lines_select on public.kamai_ledger_lines for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));

revoke all on public.kamai_ledger_accounts from anon;
grant select on public.kamai_ledger_accounts to authenticated;
grant all on public.kamai_ledger_accounts to service_role;
revoke all on public.kamai_ledger_entries from anon;
grant select on public.kamai_ledger_entries to authenticated;
grant all on public.kamai_ledger_entries to service_role;
revoke all on public.kamai_ledger_lines from anon;
grant select on public.kamai_ledger_lines to authenticated;
grant all on public.kamai_ledger_lines to service_role;

-- ---------------------------------------------------------------------------
-- chart of accounts
-- ---------------------------------------------------------------------------
create or replace function public.kamai_seed_ledger_accounts(p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.kamai_ledger_accounts (tenant_id, code, name, type, normal_side, is_control)
  select p_tenant, v.code, v.name, v.type, v.side, v.ctl
  from (values
    ('1100','Cash - bank','asset','debit',false),
    ('1110','Cash - rider float','asset','debit',false),
    ('1150','Cash clearing / in transit','asset','debit',false),
    ('1200','Trade receivables - stores','asset','debit',true),
    ('1290','Allowance for credit losses','contra','credit',false),
    ('2100','Payables - suppliers','liability','credit',false),
    ('2200','Financing payable - lender','liability','credit',false),
    ('2300','Hero commissions payable','liability','credit',false),
    ('2450','Sales tax payable','liability','credit',false),
    ('2500','First-loss reserve','liability','credit',false),
    ('3000','Opening balance equity','equity','credit',false),
    ('4100','Sales','revenue','credit',false),
    ('4200','Platform fee','revenue','credit',false),
    ('4300','Credit service fee','revenue','credit',false),
    ('5100','Cost of goods sold','expense','debit',false),
    ('5200','Commission expense','expense','debit',false),
    ('5300','Financing cost','expense','debit',false),
    ('5400','Credit loss','expense','debit',false),
    ('5500','Collection charges','expense','debit',false),
    ('5600','Cash shortage / overage','expense','debit',false)
  ) as v(code, name, type, side, ctl)
  on conflict (tenant_id, code) do nothing;
$$;
revoke execute on function public.kamai_seed_ledger_accounts(uuid) from public, anon, authenticated;
grant execute on function public.kamai_seed_ledger_accounts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- posting core + public API
-- lines: [{account_code, direction, amount_minor, party_type?, party_id?, memo?}]
-- ---------------------------------------------------------------------------
create or replace function private.kamai_post_entry_core(
  p_tenant uuid, p_key text, p_source_type text, p_source_id text,
  p_effective_at timestamptz, p_memo text, p_lines jsonb, p_reverses uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_debit bigint;
  v_credit bigint;
  v_n int;
  v_missing text;
begin
  if p_key is null or btrim(p_key) = '' then
    raise exception 'kamai ledger: idempotency key required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'kamai ledger: lines must be a json array' using errcode = '22023';
  end if;
  select id into v_id from public.kamai_ledger_entries where tenant_id = p_tenant and idempotency_key = p_key;
  if found then
    return v_id;
  end if;
  select coalesce(sum((l ->> 'amount_minor')::bigint) filter (where l ->> 'direction' = 'debit'), 0),
         coalesce(sum((l ->> 'amount_minor')::bigint) filter (where l ->> 'direction' = 'credit'), 0),
         count(*)
    into v_debit, v_credit, v_n
  from jsonb_array_elements(p_lines) l;
  if v_n < 2 or v_debit <> v_credit or v_debit <= 0 then
    raise exception 'kamai ledger: unbalanced entry (debit %, credit %, lines %)', v_debit, v_credit, v_n using errcode = '23514';
  end if;
  select string_agg(distinct l ->> 'account_code', ',') into v_missing
  from jsonb_array_elements(p_lines) l
  where not exists (select 1 from public.kamai_ledger_accounts a where a.tenant_id = p_tenant and a.code = l ->> 'account_code');
  if v_missing is not null then
    raise exception 'kamai ledger: unknown account code(s) %', v_missing using errcode = '22023';
  end if;
  insert into public.kamai_ledger_entries (tenant_id, idempotency_key, effective_at, source_type, source_id, memo, created_by, reverses_entry_id)
  values (p_tenant, p_key, coalesce(p_effective_at, now()), p_source_type, p_source_id, p_memo, (select auth.uid()), p_reverses)
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.kamai_ledger_entries where tenant_id = p_tenant and idempotency_key = p_key;
    return v_id;
  end if;
  insert into public.kamai_ledger_lines (tenant_id, entry_id, account_id, direction, amount_minor, party_type, party_id, memo)
  select p_tenant, v_id, a.id, l ->> 'direction', (l ->> 'amount_minor')::bigint, l ->> 'party_type', l ->> 'party_id', l ->> 'memo'
  from jsonb_array_elements(p_lines) l
  join public.kamai_ledger_accounts a on a.tenant_id = p_tenant and a.code = l ->> 'account_code';
  return v_id;
end;
$$;
revoke execute on function private.kamai_post_entry_core(uuid, text, text, text, timestamptz, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.kamai_post_entry_core(uuid, text, text, text, timestamptz, text, jsonb, uuid) to service_role;

create or replace function public.kamai_post_entry(
  p_tenant uuid, p_key text, p_source_type text, p_source_id text,
  p_effective_at timestamptz, p_memo text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.kamai_can(p_tenant, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to post ledger entries' using errcode = '42501';
  end if;
  return private.kamai_post_entry_core(p_tenant, p_key, p_source_type, p_source_id, p_effective_at, p_memo, p_lines);
end;
$$;
revoke execute on function public.kamai_post_entry(uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.kamai_post_entry(uuid, text, text, text, timestamptz, text, jsonb) to authenticated, service_role;

-- reversing entry (corrections never edit history)
create or replace function private.kamai_reverse_entry_core(p_entry_id uuid, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.kamai_ledger_entries;
begin
  select * into v_e from public.kamai_ledger_entries where id = p_entry_id;
  if not found then
    raise exception 'kamai: entry not found' using errcode = '22023';
  end if;
  return private.kamai_post_entry_core(v_e.tenant_id, 'reverse:' || p_entry_id, 'reversal', p_entry_id::text, now(),
    coalesce(p_memo, 'Reversal of ' || coalesce(v_e.memo, p_entry_id::text)),
    (select jsonb_agg(jsonb_build_object(
        'account_code', a.code, 'direction', case when l.direction = 'debit' then 'credit' else 'debit' end,
        'amount_minor', l.amount_minor, 'party_type', l.party_type, 'party_id', l.party_id))
     from public.kamai_ledger_lines l join public.kamai_ledger_accounts a on a.id = l.account_id
     where l.entry_id = p_entry_id), p_entry_id);
end;
$$;
revoke execute on function private.kamai_reverse_entry_core(uuid, text) from public, anon, authenticated;
grant execute on function private.kamai_reverse_entry_core(uuid, text) to service_role;

create or replace function public.kamai_reverse_entry(p_entry_id uuid, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.kamai_ledger_entries;
begin
  select * into v_e from public.kamai_ledger_entries where id = p_entry_id;
  if not found then
    raise exception 'kamai: entry not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_e.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to reverse ledger entries' using errcode = '42501';
  end if;
  return private.kamai_reverse_entry_core(p_entry_id, p_memo);
end;
$$;
revoke execute on function public.kamai_reverse_entry(uuid, text) from public, anon;
grant execute on function public.kamai_reverse_entry(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- balances view (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------------
create or replace view public.kamai_ledger_balances with (security_invoker = true) as
select a.id as account_id, a.tenant_id, a.code, a.name, a.type, a.normal_side,
       coalesce(sum(case when l.direction = a.normal_side then l.amount_minor else -l.amount_minor end), 0)::bigint as balance_minor
from public.kamai_ledger_accounts a
left join (select ll.account_id, ll.direction, ll.amount_minor
           from public.kamai_ledger_lines ll
           join public.kamai_ledger_entries e on e.id = ll.entry_id and e.status = 'posted') l on l.account_id = a.id
group by a.id, a.tenant_id, a.code, a.name, a.type, a.normal_side;
revoke all on public.kamai_ledger_balances from anon;
grant select on public.kamai_ledger_balances to authenticated;
grant all on public.kamai_ledger_balances to service_role;

-- ===================== 20261108120006_kamai_credit_payments.sql =====================
-- Kamai OS migration 006: credit engine (rules, not ML), exposures, payments, reconciliation, dunning.

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_credit_policies (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.kamai_tenants(id) on delete cascade,
  name           text not null,
  version        int not null default 1,
  effective_from date not null default current_date,
  rules          jsonb not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (tenant_id, version)
);
create index if not exists kamai_credit_policies_tenant_idx on public.kamai_credit_policies (tenant_id, effective_from desc);
alter table public.kamai_credit_policies enable row level security;

create table if not exists public.kamai_credit_accounts (
  store_id         uuid primary key references public.kamai_stores(id) on delete cascade,
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,
  tier             smallint not null default 0 check (tier between 0 and 3),
  floor_tier       smallint not null default 0 check (floor_tier between 0 and 3),
  limit_minor      bigint not null default 0 check (limit_minor >= 0),
  tenor_days       smallint not null default 0 check (tenor_days between 0 and 90),
  status           text not null default 'cash_only' check (status in ('cash_only','active','paused','frozen','written_off')),
  policy_id        uuid references public.kamai_credit_policies(id) on delete set null,
  reason_codes     text[] not null default '{}',
  last_reviewed_at timestamptz,
  tier_changed_at  timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists kamai_credit_accounts_tenant_idx on public.kamai_credit_accounts (tenant_id, status);
create index if not exists kamai_credit_accounts_policy_idx on public.kamai_credit_accounts (policy_id) where policy_id is not null;
alter table public.kamai_credit_accounts enable row level security;

create table if not exists public.kamai_credit_decisions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,
  order_id         uuid not null references public.kamai_orders(id) on delete cascade,
  store_id         uuid not null references public.kamai_stores(id),
  decision         text not null check (decision in ('approved','declined','hold','cod')),
  available_minor  bigint not null default 0,
  exposure_minor   bigint not null default 0,
  order_total_minor bigint not null default 0,
  reason_codes     text[] not null default '{}',
  policy_id        uuid references public.kamai_credit_policies(id) on delete set null,
  decided_by       uuid,
  decided_at       timestamptz not null default now()
);
create index if not exists kamai_credit_decisions_order_idx on public.kamai_credit_decisions (order_id, decided_at desc);
create index if not exists kamai_credit_decisions_store_idx on public.kamai_credit_decisions (store_id);
create index if not exists kamai_credit_decisions_tenant_idx on public.kamai_credit_decisions (tenant_id, decided_at desc);
create index if not exists kamai_credit_decisions_policy_idx on public.kamai_credit_decisions (policy_id) where policy_id is not null;
alter table public.kamai_credit_decisions enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kamai_orders_credit_decision_fk') then
    alter table public.kamai_orders add constraint kamai_orders_credit_decision_fk
      foreign key (credit_decision_id) references public.kamai_credit_decisions(id) on delete set null;
  end if;
end $$;
create index if not exists kamai_orders_decision_idx on public.kamai_orders (credit_decision_id) where credit_decision_id is not null;

create table if not exists public.kamai_credit_exposures (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.kamai_tenants(id) on delete cascade,
  store_id          uuid not null references public.kamai_stores(id),
  order_id          uuid not null unique references public.kamai_orders(id),
  invoice_id        uuid references public.kamai_invoices(id),
  origination_date  date not null,
  due_date          date not null,
  original_minor    bigint not null check (original_minor > 0),
  outstanding_minor bigint not null check (outstanding_minor >= 0),
  paid_minor        bigint not null default 0 check (paid_minor >= 0),
  credited_minor    bigint not null default 0 check (credited_minor >= 0),
  financed_minor    bigint not null default 0 check (financed_minor >= 0),
  lender_tenant_id  uuid references public.kamai_tenants(id),
  status            text not null default 'open' check (status in ('open','paid','restructured','written_off')),
  restructured      boolean not null default false,
  write_off_date    date,
  last_payment_at   timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists kamai_credit_exposures_store_open_idx on public.kamai_credit_exposures (store_id, due_date) where status = 'open';
create index if not exists kamai_credit_exposures_tenant_idx on public.kamai_credit_exposures (tenant_id, status);
create index if not exists kamai_credit_exposures_invoice_idx on public.kamai_credit_exposures (invoice_id) where invoice_id is not null;
create index if not exists kamai_credit_exposures_lender_idx on public.kamai_credit_exposures (lender_tenant_id) where lender_tenant_id is not null;
alter table public.kamai_credit_exposures enable row level security;

create table if not exists public.kamai_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.kamai_tenants(id) on delete cascade,
  store_id          uuid not null references public.kamai_stores(id),
  amount_minor      bigint not null check (amount_minor > 0),
  channel           text not null check (channel in ('cash','raast','ibft','easypaisa','jazzcash','cheque','rtp')),
  external_ref      text,
  reference_code    text,
  collected_by      uuid,
  collected_at      timestamptz not null default now(),
  status            text not null default 'recorded' check (status in ('recorded','matched','verified','rejected')),
  evidence_url      text,
  notes             text,
  order_id          uuid references public.kamai_orders(id),
  legacy_payment_id text,
  client_key        text check (client_key is null or length(client_key) between 1 and 128),  -- client idempotency key
  reported_by       uuid,                -- set when a store member reported (claimed) the payment; never allocated until verified
  settled_at        timestamptz,         -- allocation + ledger posting done (cash on record, non-cash once verified)
  order_applied_minor bigint not null default 0 check (order_applied_minor >= 0),  -- part applied straight to a COD order
  verified_by       uuid,
  verified_at       timestamptz,
  reversed_at       timestamptz,
  reversal_reason   text,
  created_at        timestamptz not null default now()
);
-- a rejected / reversed payment frees its external reference
create unique index if not exists kamai_payments_extref_uidx on public.kamai_payments (tenant_id, lower(external_ref)) where external_ref is not null and status <> 'rejected';
create unique index if not exists kamai_payments_client_key_uidx on public.kamai_payments (tenant_id, client_key) where client_key is not null;
create index if not exists kamai_payments_store_idx on public.kamai_payments (store_id, collected_at desc);
create index if not exists kamai_payments_tenant_idx on public.kamai_payments (tenant_id, collected_at desc);
create index if not exists kamai_payments_collector_idx on public.kamai_payments (collected_by, collected_at) where collected_by is not null;
create index if not exists kamai_payments_refcode_idx on public.kamai_payments (tenant_id, reference_code) where reference_code is not null;
create index if not exists kamai_payments_order_idx on public.kamai_payments (order_id) where order_id is not null;
alter table public.kamai_payments enable row level security;

create table if not exists public.kamai_payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.kamai_tenants(id) on delete cascade,
  payment_id    uuid not null references public.kamai_payments(id) on delete cascade,
  exposure_id   uuid not null references public.kamai_credit_exposures(id),
  amount_minor  bigint not null check (amount_minor > 0),
  reversed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists kamai_payment_allocations_payment_idx on public.kamai_payment_allocations (payment_id);
create index if not exists kamai_payment_allocations_exposure_idx on public.kamai_payment_allocations (exposure_id);
create index if not exists kamai_payment_allocations_tenant_idx on public.kamai_payment_allocations (tenant_id);
alter table public.kamai_payment_allocations enable row level security;

create table if not exists public.kamai_credit_snapshots (
  snapshot_date       date not null,
  store_id            uuid not null references public.kamai_stores(id) on delete cascade,
  tenant_id           uuid not null references public.kamai_tenants(id) on delete cascade,
  outstanding_minor   bigint not null default 0,
  max_dpd             int not null default 0,
  bucket              text not null,
  tier                smallint,
  limit_minor         bigint,
  status              text,
  eligible            boolean not null default true,
  ineligibility_reason text,
  primary key (snapshot_date, store_id)
);
create index if not exists kamai_credit_snapshots_tenant_idx on public.kamai_credit_snapshots (tenant_id, snapshot_date desc);
create index if not exists kamai_credit_snapshots_store_idx on public.kamai_credit_snapshots (store_id);
alter table public.kamai_credit_snapshots enable row level security;

create table if not exists public.kamai_credit_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.kamai_tenants(id) on delete cascade,
  store_id    uuid not null references public.kamai_stores(id) on delete cascade,
  event_type  text not null,
  from_status text,
  to_status   text,
  from_tier   smallint,
  to_tier     smallint,
  rule_id     text,
  evidence    jsonb not null default '{}'::jsonb,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists kamai_credit_events_store_idx on public.kamai_credit_events (store_id, created_at desc);
create index if not exists kamai_credit_events_tenant_idx on public.kamai_credit_events (tenant_id, created_at desc);
alter table public.kamai_credit_events enable row level security;

create table if not exists public.kamai_bank_statements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.kamai_tenants(id) on delete cascade,
  bank_name    text,
  account_ref  text,
  period_start date,
  period_end   date,
  file_name    text,
  file_hash    text not null,
  rows_total   int not null default 0,
  imported_by  uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, file_hash)
);
alter table public.kamai_bank_statements enable row level security;

create table if not exists public.kamai_bank_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.kamai_tenants(id) on delete cascade,
  statement_id        uuid not null references public.kamai_bank_statements(id) on delete cascade,
  line_no             int not null,
  line_date           date not null,
  narration           text,
  amount_minor        bigint not null,
  direction           text not null default 'credit' check (direction in ('credit','debit')),
  bank_ref            text,
  extracted_ref       text,
  match_status        text not null default 'unmatched' check (match_status in ('unmatched','auto','manual','ignored')),
  matched_payment_id  uuid references public.kamai_payments(id),
  matched_at          timestamptz,
  matched_by          uuid,
  meta                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (statement_id, line_no)
);
create index if not exists kamai_bank_lines_tenant_idx on public.kamai_bank_lines (tenant_id, line_date desc);
create index if not exists kamai_bank_lines_payment_idx on public.kamai_bank_lines (matched_payment_id) where matched_payment_id is not null;
create index if not exists kamai_bank_lines_open_idx on public.kamai_bank_lines (statement_id) where match_status = 'unmatched';
-- one bank line per payment
create unique index if not exists kamai_bank_lines_payment_uidx on public.kamai_bank_lines (matched_payment_id) where matched_payment_id is not null;
alter table public.kamai_bank_lines enable row level security;

create table if not exists public.kamai_cash_deposits (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,
  rider_user_id    uuid not null,
  business_date    date not null,
  expected_minor   bigint not null default 0,
  deposited_minor  bigint not null default 0,
  method           text not null default 'bank' check (method in ('bank','office','raast','other')),
  deposit_ref      text,
  slip_url         text,
  variance_minor   bigint not null default 0,
  status           text not null default 'submitted' check (status in ('open','submitted','reconciled','variance')),
  notes            text,
  ledger_entry_id  uuid,                 -- current ledger entry (posted only by finance confirmation)
  post_version     int not null default 0,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, rider_user_id, business_date)
);
create index if not exists kamai_cash_deposits_rider_idx on public.kamai_cash_deposits (rider_user_id, business_date desc);
alter table public.kamai_cash_deposits enable row level security;

create table if not exists public.kamai_dunning_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.kamai_tenants(id) on delete cascade,
  offset_days   int not null check (offset_days between -30 and 120),
  action        text not null,
  template_name text,
  active        boolean not null default true,
  unique (tenant_id, offset_days)
);
alter table public.kamai_dunning_rules enable row level security;

create table if not exists public.kamai_dunning_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.kamai_tenants(id) on delete cascade,
  exposure_id   uuid not null references public.kamai_credit_exposures(id) on delete cascade,
  store_id      uuid not null references public.kamai_stores(id) on delete cascade,
  rule_id       uuid references public.kamai_dunning_rules(id) on delete set null,
  offset_days   int not null,
  action        text not null,
  status        text not null default 'queued' check (status in ('queued','skipped')),
  wa_message_id uuid,
  created_at    timestamptz not null default now(),
  unique (exposure_id, offset_days)
);
create index if not exists kamai_dunning_events_tenant_idx on public.kamai_dunning_events (tenant_id, created_at desc);
create index if not exists kamai_dunning_events_store_idx on public.kamai_dunning_events (store_id);
create index if not exists kamai_dunning_events_rule_idx on public.kamai_dunning_events (rule_id) where rule_id is not null;
alter table public.kamai_dunning_events enable row level security;

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------
drop trigger if exists kamai_credit_events_append_only on public.kamai_credit_events;
create trigger kamai_credit_events_append_only before update or delete on public.kamai_credit_events
  for each row execute function public.kamai_append_only();
drop trigger if exists kamai_credit_accounts_touch on public.kamai_credit_accounts;
create trigger kamai_credit_accounts_touch before update on public.kamai_credit_accounts for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_credit_exposures_touch on public.kamai_credit_exposures;
create trigger kamai_credit_exposures_touch before update on public.kamai_credit_exposures for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_cash_deposits_touch on public.kamai_cash_deposits;
create trigger kamai_cash_deposits_touch before update on public.kamai_cash_deposits for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_credit_accounts_audit on public.kamai_credit_accounts;
create trigger kamai_credit_accounts_audit after insert or update or delete on public.kamai_credit_accounts for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_payments_audit on public.kamai_payments;
create trigger kamai_payments_audit after insert or update or delete on public.kamai_payments for each row execute function public.kamai_audit_trigger();

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
drop policy if exists kamai_credit_policies_select on public.kamai_credit_policies;
create policy kamai_credit_policies_select on public.kamai_credit_policies for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));
drop policy if exists kamai_credit_policies_write on public.kamai_credit_policies;
create policy kamai_credit_policies_write on public.kamai_credit_policies for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner'])));

drop policy if exists kamai_credit_accounts_select on public.kamai_credit_accounts;
create policy kamai_credit_accounts_select on public.kamai_credit_accounts for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and (select private.kamai_my_role(tenant_id)) is distinct from 'rider'));
drop policy if exists kamai_credit_accounts_update on public.kamai_credit_accounts;
create policy kamai_credit_accounts_update on public.kamai_credit_accounts for update to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_credit_decisions_select on public.kamai_credit_decisions;
create policy kamai_credit_decisions_select on public.kamai_credit_decisions for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and (select private.kamai_my_role(tenant_id)) is distinct from 'rider'));

drop policy if exists kamai_credit_exposures_select on public.kamai_credit_exposures;
create policy kamai_credit_exposures_select on public.kamai_credit_exposures for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and (select private.kamai_my_role(tenant_id)) is distinct from 'rider'));

drop policy if exists kamai_credit_snapshots_select on public.kamai_credit_snapshots;
create policy kamai_credit_snapshots_select on public.kamai_credit_snapshots for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and (select private.kamai_my_role(tenant_id)) is distinct from 'rider'));

drop policy if exists kamai_credit_events_select on public.kamai_credit_events;
create policy kamai_credit_events_select on public.kamai_credit_events for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));

drop policy if exists kamai_payments_select on public.kamai_payments;
create policy kamai_payments_select on public.kamai_payments for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or (tenant_id in (select private.kamai_readable_tenants())
             and store_id in (select private.kamai_store_scope(tenant_id))
             and ((select private.kamai_my_role(tenant_id)) is distinct from 'rider'
                  or collected_by = (select auth.uid()))));

drop policy if exists kamai_payment_allocations_select on public.kamai_payment_allocations;
create policy kamai_payment_allocations_select on public.kamai_payment_allocations for select to authenticated
  using ((select private.kamai_is_platform_admin()) or payment_id in (select p.id from public.kamai_payments p));

drop policy if exists kamai_bank_statements_select on public.kamai_bank_statements;
create policy kamai_bank_statements_select on public.kamai_bank_statements for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));
drop policy if exists kamai_bank_lines_select on public.kamai_bank_lines;
create policy kamai_bank_lines_select on public.kamai_bank_lines for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));

drop policy if exists kamai_cash_deposits_select on public.kamai_cash_deposits;
create policy kamai_cash_deposits_select on public.kamai_cash_deposits for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or rider_user_id = (select auth.uid())
         or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));

drop policy if exists kamai_dunning_rules_select on public.kamai_dunning_rules;
create policy kamai_dunning_rules_select on public.kamai_dunning_rules for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));
drop policy if exists kamai_dunning_rules_write on public.kamai_dunning_rules;
create policy kamai_dunning_rules_write on public.kamai_dunning_rules for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));
drop policy if exists kamai_dunning_events_select on public.kamai_dunning_events;
create policy kamai_dunning_events_select on public.kamai_dunning_events for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on public.kamai_credit_policies from anon;
grant select, insert, update, delete on public.kamai_credit_policies to authenticated;
grant all on public.kamai_credit_policies to service_role;

revoke all on public.kamai_credit_accounts from anon;
grant select, update on public.kamai_credit_accounts to authenticated;
grant all on public.kamai_credit_accounts to service_role;

revoke all on public.kamai_credit_decisions from anon;
grant select on public.kamai_credit_decisions to authenticated;
grant all on public.kamai_credit_decisions to service_role;

revoke all on public.kamai_credit_exposures from anon;
grant select on public.kamai_credit_exposures to authenticated;
grant all on public.kamai_credit_exposures to service_role;

revoke all on public.kamai_payments from anon;
grant select on public.kamai_payments to authenticated;
grant all on public.kamai_payments to service_role;

revoke all on public.kamai_payment_allocations from anon;
grant select on public.kamai_payment_allocations to authenticated;
grant all on public.kamai_payment_allocations to service_role;

revoke all on public.kamai_credit_snapshots from anon;
grant select on public.kamai_credit_snapshots to authenticated;
grant all on public.kamai_credit_snapshots to service_role;

revoke all on public.kamai_credit_events from anon;
grant select on public.kamai_credit_events to authenticated;
grant all on public.kamai_credit_events to service_role;

revoke all on public.kamai_bank_statements from anon;
grant select on public.kamai_bank_statements to authenticated;
grant all on public.kamai_bank_statements to service_role;

revoke all on public.kamai_bank_lines from anon;
grant select on public.kamai_bank_lines to authenticated;
grant all on public.kamai_bank_lines to service_role;

revoke all on public.kamai_cash_deposits from anon;
grant select on public.kamai_cash_deposits to authenticated;
grant all on public.kamai_cash_deposits to service_role;

revoke all on public.kamai_dunning_rules from anon;
grant select, insert, update, delete on public.kamai_dunning_rules to authenticated;
grant all on public.kamai_dunning_rules to service_role;

revoke all on public.kamai_dunning_events from anon;
grant select on public.kamai_dunning_events to authenticated;
grant all on public.kamai_dunning_events to service_role;

-- ---------------------------------------------------------------------------
-- helpers: bucket, default rules, seeds
-- ---------------------------------------------------------------------------
create or replace function public.kamai_dpd_bucket(p_dpd int)
returns text
language sql immutable
set search_path = ''
as $$
  select case when p_dpd is null or p_dpd <= 0 then 'current'
              when p_dpd <= 7 then '1-7' when p_dpd <= 14 then '8-14' when p_dpd <= 30 then '15-30'
              when p_dpd <= 60 then '31-60' when p_dpd <= 90 then '61-90' else '90+' end;
$$;
revoke execute on function public.kamai_dpd_bucket(int) from public, anon;
grant execute on function public.kamai_dpd_bucket(int) to authenticated, service_role;

create or replace function private.kamai_default_credit_rules()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select '{
    "tiers": {
      "0": {"limit_minor": 0, "tenor_days": 0},
      "1": {"limit_minor": 2500000, "tenor_days": 7},
      "2": {"limit_minor": 7500000, "tenor_days": 14},
      "3": {"limit_minor": 15000000, "tenor_days": 25}
    },
    "tier_requirements": {
      "1": {"orders": 4, "days": 30},
      "2": {"orders": 12, "days": 90, "on_time": 0.90, "max_dpd_180": 7, "closed": 2},
      "3": {"orders": 26, "days": 180, "on_time": 0.95, "max_dpd_180": 3, "closed": 2}
    },
    "grace_days": 2,
    "pause_dpd": 7,
    "freeze_dpd": 30,
    "writeoff_dpd": 90,
    "max_store_exposure_pct_of_tenant": 25,
    "tenant_exposure_cap_minor": null,
    "par30_pause_pct": 8
  }'::jsonb;
$$;
revoke execute on function private.kamai_default_credit_rules() from public, anon;
grant execute on function private.kamai_default_credit_rules() to authenticated, service_role;

create or replace function private.kamai_rules(p_tenant uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select private.kamai_default_credit_rules() || coalesce(
    (select p.rules from public.kamai_credit_policies p
     where p.tenant_id = p_tenant and p.effective_from <= current_date
     order by p.effective_from desc, p.version desc limit 1), '{}'::jsonb);
$$;
revoke execute on function private.kamai_rules(uuid) from public, anon, authenticated;
grant execute on function private.kamai_rules(uuid) to service_role;

create or replace function public.kamai_seed_credit_policy(p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.kamai_credit_policies (tenant_id, name, version, rules)
  values (p_tenant, 'Default v1', 1, private.kamai_default_credit_rules())
  on conflict (tenant_id, version) do nothing;
$$;
revoke execute on function public.kamai_seed_credit_policy(uuid) from public, anon, authenticated;
grant execute on function public.kamai_seed_credit_policy(uuid) to service_role;

create or replace function public.kamai_seed_dunning_rules(p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.kamai_dunning_rules (tenant_id, offset_days, action, template_name)
  select p_tenant, v.off, v.act, v.tpl
  from (values
    (-3, 'pre_due_reminder', 'kamai_payment_due_soon'),
    (0,  'due_today',        'kamai_payment_due_today'),
    (3,  'overdue_notice',   'kamai_payment_overdue'),
    (7,  'overdue_pause',    'kamai_payment_overdue'),
    (15, 'escalate_manager', 'kamai_payment_overdue_final'),
    (30, 'freeze_notice',    'kamai_payment_overdue_final')
  ) as v(off, act, tpl)
  on conflict (tenant_id, offset_days) do nothing;
$$;
revoke execute on function public.kamai_seed_dunning_rules(uuid) from public, anon, authenticated;
grant execute on function public.kamai_seed_dunning_rules(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- credit decision
-- ---------------------------------------------------------------------------
create or replace function private.kamai_credit_decide_core(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o        public.kamai_orders;
  v_t        public.kamai_tenants;
  v_a        public.kamai_credit_accounts;
  v_rules    jsonb;
  v_policy   uuid;
  v_open     bigint;
  v_pending  bigint;
  v_exposure bigint;
  v_limit    bigint := 0;
  v_reasons  text[] := '{}';
  v_decision text;
  v_id       uuid;
  v_ten_exp  bigint;
  v_cap      bigint;
  v_pct      numeric;
  v_pause    int;
  v_row      public.kamai_credit_decisions;
begin
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if v_o.fulfilment_status <> 'booked' then
    return (select to_jsonb(d) from public.kamai_credit_decisions d where d.id = v_o.credit_decision_id);
  end if;
  select * into v_t from public.kamai_tenants where id = v_o.tenant_id;
  select p.id into v_policy from public.kamai_credit_policies p
   where p.tenant_id = v_o.tenant_id and p.effective_from <= current_date order by p.effective_from desc, p.version desc limit 1;
  v_rules := private.kamai_rules(v_o.tenant_id);

  insert into public.kamai_credit_accounts (store_id, tenant_id, policy_id)
  values (v_o.store_id, v_o.tenant_id, v_policy)
  on conflict (store_id) do nothing;
  -- serialise concurrent decisions / deliveries / payments for this store: the limit check below reads
  -- exposure that those paths change
  select * into v_a from public.kamai_credit_accounts where store_id = v_o.store_id for update;
  v_cap := nullif(v_rules ->> 'tenant_exposure_cap_minor', '')::bigint;
  if v_cap is not null then
    -- tenant-wide cap: one decision at a time per tenant
    perform pg_advisory_xact_lock(hashtextextended('kamai_credit:' || v_o.tenant_id::text, 0));
  end if;

  select coalesce(sum(outstanding_minor), 0) into v_open
  from public.kamai_credit_exposures where store_id = v_o.store_id and status = 'open';
  select coalesce(sum(total_minor), 0) into v_pending
  from public.kamai_orders
  where store_id = v_o.store_id and id <> v_o.id and payment_mode = 'credit'
    and fulfilment_status in ('credit_approved','packed','dispatched');   -- held / unapproved booked orders do not count
  v_exposure := v_open + v_pending;
  v_limit := v_a.limit_minor;

  if v_o.payment_mode = 'cod' then
    v_decision := 'cod';
    v_reasons := array['COD'];
  else
    if v_a.status = 'cash_only' then v_reasons := array_append(v_reasons, 'CASH_ONLY'::text); end if;
    if v_a.status = 'paused' then v_reasons := array_append(v_reasons, 'STORE_PAUSED'::text); end if;
    if v_a.status in ('frozen','written_off') then v_reasons := array_append(v_reasons, 'STORE_FROZEN'::text); end if;
    if coalesce(v_t.settings ->> 'credit_paused', 'false') = 'true' then v_reasons := array_append(v_reasons, 'TENANT_PAUSED'::text); end if;
    v_pause := coalesce((v_rules ->> 'pause_dpd')::int, 7);
    if exists (select 1 from public.kamai_credit_exposures x
               where x.store_id = v_o.store_id and x.status = 'open' and x.outstanding_minor > 0
                 and (now() at time zone 'Asia/Karachi')::date - x.due_date > v_pause) then
      v_reasons := array_append(v_reasons, 'DPD_OVER_LIMIT'::text);
    end if;
    if v_a.status = 'active' and v_exposure + v_o.total_minor > v_limit then
      v_reasons := array_append(v_reasons, 'LIMIT_EXCEEDED'::text);
    end if;
    if v_cap is not null then
      select coalesce(sum(outstanding_minor), 0) into v_ten_exp from public.kamai_credit_exposures
      where tenant_id = v_o.tenant_id and status = 'open';
      v_ten_exp := v_ten_exp + coalesce((select sum(total_minor) from public.kamai_orders
        where tenant_id = v_o.tenant_id and id <> v_o.id and payment_mode = 'credit'
          and fulfilment_status in ('credit_approved','packed','dispatched')), 0);
      if v_ten_exp + v_o.total_minor > v_cap then v_reasons := array_append(v_reasons, 'TENANT_CAP'::text); end if;
      v_pct := coalesce((v_rules ->> 'max_store_exposure_pct_of_tenant')::numeric, 100);
      if v_exposure + v_o.total_minor > (v_cap * v_pct / 100) then v_reasons := array_append(v_reasons, 'STORE_CAP'::text); end if;
    end if;
    v_decision := case when cardinality(v_reasons) = 0 then 'approved' else 'hold' end;
  end if;

  insert into public.kamai_credit_decisions
    (tenant_id, order_id, store_id, decision, available_minor, exposure_minor, order_total_minor, reason_codes, policy_id, decided_by)
  values (v_o.tenant_id, v_o.id, v_o.store_id, v_decision, greatest(0, v_limit - v_exposure), v_exposure, v_o.total_minor,
          v_reasons, v_policy, (select auth.uid()))
  returning * into v_row;
  update public.kamai_orders set credit_decision_id = v_row.id where id = v_o.id;

  if v_decision in ('approved','cod') then
    perform private.kamai_do_transition(v_o.id, 'credit_approved',
      case when v_decision = 'cod' then 'cash on delivery' else 'credit approved by policy' end,
      jsonb_build_object('decision_id', v_row.id, 'decision', v_decision), (select auth.uid()));
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke execute on function private.kamai_credit_decide_core(uuid) from public, anon, authenticated;
grant execute on function private.kamai_credit_decide_core(uuid) to service_role;

create or replace function public.kamai_credit_decide(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.kamai_orders;
begin
  select * into v_o from public.kamai_orders where id = p_order_id;
  if not found then
    raise exception 'kamai: order not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_o.tenant_id, array['owner','manager','booker','finance'])) then
    raise exception 'kamai: not allowed to run credit decisions' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'booked' then
    raise exception 'kamai: only booked orders can be re-decided' using errcode = '22023';
  end if;
  return private.kamai_credit_decide_core(p_order_id);
end;
$$;
revoke execute on function public.kamai_credit_decide(uuid) from public, anon;
grant execute on function public.kamai_credit_decide(uuid) to authenticated, service_role;

create or replace function public.kamai_convert_order_to_cod(p_order_id uuid)
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
    raise exception 'kamai: not allowed to convert orders to COD' using errcode = '42501';
  end if;
  if v_o.fulfilment_status <> 'booked' then
    raise exception 'kamai: only booked orders can be converted to COD' using errcode = '22023';
  end if;
  update public.kamai_orders set payment_mode = 'cod' where id = p_order_id;
  return private.kamai_credit_decide_core(p_order_id);
end;
$$;
revoke execute on function public.kamai_convert_order_to_cod(uuid) from public, anon;
grant execute on function public.kamai_convert_order_to_cod(uuid) to authenticated, service_role;

create or replace function public.kamai_store_outstanding(p_store_id uuid)
returns bigint
language sql stable
set search_path = ''
as $$
  select coalesce(sum(outstanding_minor), 0)::bigint from public.kamai_credit_exposures
  where store_id = p_store_id and status = 'open';
$$;
revoke execute on function public.kamai_store_outstanding(uuid) from public, anon;
grant execute on function public.kamai_store_outstanding(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- store evaluation (tier / status from behaviour)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_evaluate_store_core(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.kamai_stores;
  v_a public.kamai_credit_accounts;
  v_rules jsonb;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_grace int;
  v_delivered int;
  v_first timestamptz;
  v_days int;
  v_closed int;
  v_ontime int;
  v_ratio numeric;
  v_dpd_open int;
  v_dpd_180 int;
  v_target int := 0;
  v_new_tier int;
  v_status text;
  v_limit bigint;
  v_tenor int;
  v_req jsonb;
  v_changed boolean := false;
  k int;
begin
  select * into v_s from public.kamai_stores where id = p_store_id;
  if not found then
    raise exception 'kamai: store not found' using errcode = '22023';
  end if;
  v_rules := private.kamai_rules(v_s.tenant_id);
  v_grace := coalesce((v_rules ->> 'grace_days')::int, 2);
  insert into public.kamai_credit_accounts (store_id, tenant_id) values (v_s.id, v_s.tenant_id) on conflict (store_id) do nothing;
  select * into v_a from public.kamai_credit_accounts where store_id = p_store_id for update;

  select count(*), min(delivered_at) into v_delivered, v_first
  from public.kamai_orders where store_id = p_store_id and fulfilment_status in ('delivered','disputed');
  v_days := case when v_first is null then 0 else (v_today - (v_first at time zone 'Asia/Karachi')::date) end;
  select count(*), count(*) filter (where closed_at is not null and (closed_at at time zone 'Asia/Karachi')::date <= due_date + v_grace)
    into v_closed, v_ontime
  from public.kamai_credit_exposures
  where store_id = p_store_id and status = 'paid' and closed_at >= now() - interval '180 days';
  v_ratio := case when v_closed = 0 then 1 else v_ontime::numeric / v_closed end;
  select coalesce(max(greatest(0, v_today - due_date)), 0) into v_dpd_open
  from public.kamai_credit_exposures where store_id = p_store_id and status = 'open' and outstanding_minor > 0;
  select greatest(v_dpd_open, coalesce(max(greatest(0, (closed_at at time zone 'Asia/Karachi')::date - due_date)), 0)) into v_dpd_180
  from public.kamai_credit_exposures where store_id = p_store_id and status = 'paid' and closed_at >= now() - interval '180 days';

  for k in 1..3 loop
    v_req := v_rules -> 'tier_requirements' -> k::text;
    exit when v_req is null;
    if v_delivered >= coalesce((v_req ->> 'orders')::int, 0)
       and v_days >= coalesce((v_req ->> 'days')::int, 0)
       and v_closed >= coalesce((v_req ->> 'closed')::int, 0)
       and v_ratio >= coalesce((v_req ->> 'on_time')::numeric, 0)
       and v_dpd_180 <= coalesce((v_req ->> 'max_dpd_180')::int, 100000) then
      v_target := k;
    else
      exit;
    end if;
  end loop;

  if v_target > v_a.tier then
    v_new_tier := case when v_a.tier_changed_at is null or v_a.tier_changed_at < now() - interval '30 days' then v_a.tier + 1 else v_a.tier end;
  else
    v_new_tier := v_target;
  end if;
  v_new_tier := greatest(v_new_tier, v_a.floor_tier);

  v_status := case
    when v_dpd_open > coalesce((v_rules ->> 'writeoff_dpd')::int, 90) then 'written_off'
    when v_dpd_open > coalesce((v_rules ->> 'freeze_dpd')::int, 30) then 'frozen'
    when v_dpd_open > coalesce((v_rules ->> 'pause_dpd')::int, 7) then 'paused'
    when v_new_tier = 0 then 'cash_only'
    else 'active' end;

  if v_new_tier <> v_a.tier then
    v_limit := coalesce((v_rules -> 'tiers' -> v_new_tier::text ->> 'limit_minor')::bigint, v_a.limit_minor);
    v_tenor := coalesce((v_rules -> 'tiers' -> v_new_tier::text ->> 'tenor_days')::int, v_a.tenor_days);
  else
    v_limit := v_a.limit_minor;
    v_tenor := v_a.tenor_days;
  end if;

  if v_new_tier <> v_a.tier or v_status <> v_a.status then
    v_changed := true;
    insert into public.kamai_credit_events (tenant_id, store_id, event_type, from_status, to_status, from_tier, to_tier, rule_id, evidence)
    values (v_s.tenant_id, v_s.id,
            case when v_new_tier > v_a.tier then 'tier_up' when v_new_tier < v_a.tier then 'tier_down' else 'status_change' end,
            v_a.status, v_status, v_a.tier, v_new_tier, 'evaluate_store',
            jsonb_build_object('delivered_orders', v_delivered, 'days_on_rail', v_days, 'closed_180', v_closed,
                               'on_time_ratio', v_ratio, 'max_dpd_open', v_dpd_open, 'max_dpd_180', v_dpd_180, 'target_tier', v_target));
  end if;
  update public.kamai_credit_accounts set
    tier = v_new_tier, limit_minor = v_limit, tenor_days = v_tenor, status = v_status,
    last_reviewed_at = now(),
    tier_changed_at = case when v_new_tier <> v_a.tier then now() else tier_changed_at end,
    reason_codes = case when v_status = 'active' then '{}'::text[]
                        when v_status = 'cash_only' then array['CASH_ONLY']
                        when v_status = 'paused' then array['DPD_OVER_PAUSE']
                        when v_status = 'frozen' then array['DPD_OVER_FREEZE'] else array['DPD_OVER_WRITEOFF'] end
  where store_id = p_store_id;
  update public.kamai_stores set credit_status = v_status, credit_limit_minor = v_limit
  where id = p_store_id and (credit_status is distinct from v_status or credit_limit_minor is distinct from v_limit);
  return jsonb_build_object('store_id', p_store_id, 'tier', v_new_tier, 'status', v_status, 'limit_minor', v_limit,
                            'changed', v_changed, 'target_tier', v_target, 'max_dpd_open', v_dpd_open);
end;
$$;
revoke execute on function private.kamai_evaluate_store_core(uuid) from public, anon, authenticated;
grant execute on function private.kamai_evaluate_store_core(uuid) to service_role;

create or replace function public.kamai_evaluate_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.kamai_stores where id = p_store_id;
  if not found then
    raise exception 'kamai: store not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_tenant, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to evaluate credit' using errcode = '42501';
  end if;
  return private.kamai_evaluate_store_core(p_store_id);
end;
$$;
revoke execute on function public.kamai_evaluate_store(uuid) from public, anon;
grant execute on function public.kamai_evaluate_store(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
-- Settlement core: allocate a payment to receivables and post it to the ledger. Called exactly once per
-- payment (settled_at guards it): immediately for cash, and for non-cash only after verification
-- (bank match / manual bank confirmation). A COD order named by the payment is settled first; only the
-- remainder goes FIFO against the store's older credit exposures.
create or replace function private.kamai_settle_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay      public.kamai_payments;
  v_store    public.kamai_stores;
  v_order    public.kamai_orders;
  v_remaining bigint;
  v_alloc    bigint;
  v_x        record;
  v_allocs   jsonb := '[]'::jsonb;
  v_entry    uuid;
  v_new_out  bigint;
  v_cod_prior bigint;
  v_cod_apply bigint := 0;
  v_cash     boolean;
begin
  select * into v_pay from public.kamai_payments where id = p_payment_id for update;
  if not found then
    raise exception 'kamai: payment not found' using errcode = '22023';
  end if;
  if v_pay.settled_at is not null or v_pay.status = 'rejected' then
    return jsonb_build_object('payment_id', v_pay.id, 'settled', false);
  end if;
  v_cash := v_pay.channel = 'cash';
  select * into v_store from public.kamai_stores where id = v_pay.store_id;
  -- same lock order as credit decisions and delivery: credit account first, then exposures
  perform 1 from public.kamai_credit_accounts where store_id = v_pay.store_id for update;
  v_remaining := v_pay.amount_minor;

  if v_pay.order_id is not null then
    select * into v_order from public.kamai_orders where id = v_pay.order_id;
    if found and v_order.payment_mode = 'cod' then
      select coalesce(sum(order_applied_minor), 0) into v_cod_prior from public.kamai_payments
      where order_id = v_order.id and id <> v_pay.id and settled_at is not null and status <> 'rejected';
      v_cod_apply := least(v_remaining, greatest(0, v_order.total_minor - v_cod_prior));
      v_remaining := v_remaining - v_cod_apply;
      if v_cod_apply > 0 and v_order.invoice_id is not null and v_cod_prior + v_cod_apply >= v_order.total_minor then
        update public.kamai_invoices set status = 'paid' where id = v_order.invoice_id and status = 'issued';
      end if;
    end if;
  end if;

  for v_x in
    select * from public.kamai_credit_exposures
    where store_id = v_pay.store_id and status = 'open' and outstanding_minor > 0
    order by (order_id is not distinct from v_pay.order_id) desc, due_date, origination_date, created_at
    for update
  loop
    exit when v_remaining <= 0;
    v_alloc := least(v_remaining, v_x.outstanding_minor);
    v_new_out := v_x.outstanding_minor - v_alloc;
    insert into public.kamai_payment_allocations (tenant_id, payment_id, exposure_id, amount_minor)
    values (v_pay.tenant_id, v_pay.id, v_x.id, v_alloc);
    update public.kamai_credit_exposures set
      outstanding_minor = v_new_out, paid_minor = paid_minor + v_alloc, last_payment_at = now(),
      status = case when v_new_out = 0 then 'paid' else status end,
      closed_at = case when v_new_out = 0 then now() else closed_at end
    where id = v_x.id;
    if v_new_out = 0 then
      update public.kamai_invoices set status = 'paid' where id = v_x.invoice_id and status = 'issued';
      update public.kamai_orders set finance_status = 'paid' where id = v_x.order_id and finance_status = 'financed';
    end if;
    v_allocs := v_allocs || jsonb_build_object('exposure_id', v_x.id, 'amount_minor', v_alloc, 'closed', v_new_out = 0);
    v_remaining := v_remaining - v_alloc;
  end loop;

  -- cash lands in the rider float; a verified digital payment lands in the bank account
  v_entry := private.kamai_post_entry_core(v_pay.tenant_id, 'payment:' || v_pay.id, 'payment', v_pay.id::text, v_pay.collected_at,
    'Payment ' || v_pay.channel || ' from ' || v_store.name,
    jsonb_build_array(
      jsonb_build_object('account_code', case when v_cash then '1110' else '1100' end, 'direction', 'debit',
                         'amount_minor', v_pay.amount_minor,
                         'party_type', case when v_cash and v_pay.collected_by is not null then 'rider' end,
                         'party_id', case when v_cash then v_pay.collected_by::text end),
      jsonb_build_object('account_code', '1200', 'direction', 'credit', 'amount_minor', v_pay.amount_minor,
                         'party_type', 'store', 'party_id', v_store.id::text)));

  update public.kamai_payments set settled_at = now(), order_applied_minor = v_cod_apply where id = v_pay.id;
  perform private.kamai_evaluate_store_core(v_pay.store_id);
  return jsonb_build_object('payment_id', v_pay.id, 'settled', true, 'allocated_minor', v_pay.amount_minor - v_remaining,
                            'unallocated_minor', v_remaining, 'order_applied_minor', v_cod_apply,
                            'allocations', v_allocs, 'ledger_entry_id', v_entry);
end;
$$;
revoke execute on function private.kamai_settle_payment(uuid) from public, anon, authenticated;
grant execute on function private.kamai_settle_payment(uuid) to service_role;

-- record a payment collected by staff. Cash is trusted on record (the rider's cash day close reconciles it);
-- every non-cash payment is only an unverified claim until a bank line is matched / confirmed.
create or replace function public.kamai_record_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := nullif(p ->> 'tenant_id', '')::uuid;
  v_store    public.kamai_stores;
  v_amount   bigint := nullif(p ->> 'amount_minor', '')::bigint;
  v_channel  text := coalesce(nullif(p ->> 'channel', ''), 'cash');
  v_ext      text := nullif(btrim(p ->> 'external_ref'), '');
  v_notes    text := nullif(btrim(p ->> 'notes'), '');
  v_key      text := nullif(btrim(p ->> 'client_key'), '');
  v_at       timestamptz := coalesce(nullif(p ->> 'collected_at', '')::timestamptz, now());
  v_floor    timestamptz;
  v_role     text;
  v_order    public.kamai_orders;
  v_pay      public.kamai_payments;
  v_res      jsonb;
begin
  if v_tenant is null or v_amount is null or v_amount <= 0 then
    raise exception 'kamai: tenant_id and a positive amount_minor are required' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_tenant, array['rider','booker','finance','manager','owner'])) then
    raise exception 'kamai: not allowed to record payments' using errcode = '42501';
  end if;
  v_role := (select private.kamai_my_role(v_tenant));
  select * into v_store from public.kamai_stores where id = nullif(p ->> 'store_id', '')::uuid and tenant_id = v_tenant;
  if not found then
    raise exception 'kamai: store not found in tenant' using errcode = '22023';
  end if;
  if v_channel not in ('cash','raast','ibft','easypaisa','jazzcash','cheque','rtp') then
    raise exception 'kamai: unknown channel %', v_channel using errcode = '22023';
  end if;
  if v_channel <> 'cash' and not (coalesce(length(v_ext), 0) >= 6 or v_notes is not null) then
    raise exception 'kamai: non-cash payments need an external reference (6+ chars) or an override note' using errcode = '22023';
  end if;
  if v_key is not null and length(v_key) > 128 then
    raise exception 'kamai: client_key is too long' using errcode = '22023';
  end if;
  -- collected_at may not be in the future and may not reach far back (riders: 2 days)
  v_floor := now() - (case when v_role = 'rider' then interval '2 days' else interval '35 days' end);
  if v_at > now() + interval '5 minutes' or v_at < v_floor then
    raise exception 'kamai: collected_at is outside the allowed window' using errcode = '22023';
  end if;
  if v_role = 'rider' then
    -- riders collect cash only, and only from stores on their own run
    if v_channel <> 'cash' then
      raise exception 'kamai: riders may only record cash payments' using errcode = '42501';
    end if;
    if not exists (select 1 from public.kamai_orders o
                   where o.tenant_id = v_tenant and o.store_id = v_store.id and o.rider_user_id = (select auth.uid())
                     and o.fulfilment_status in ('dispatched','delivered','disputed')) then
      raise exception 'kamai: this store is not on your run' using errcode = '42501';
    end if;
  end if;
  if nullif(p ->> 'order_id', '') is not null then
    select * into v_order from public.kamai_orders where id = (p ->> 'order_id')::uuid and tenant_id = v_tenant and store_id = v_store.id;
    if not found then
      raise exception 'kamai: order not found for this store' using errcode = '22023';
    end if;
  end if;

  -- client idempotency: a retried request returns the original payment
  if v_key is not null then
    select * into v_pay from public.kamai_payments where tenant_id = v_tenant and client_key = v_key;
    if found then
      return jsonb_build_object('payment_id', v_pay.id, 'status', v_pay.status, 'replayed', true,
        'allocated_minor', coalesce((select sum(a.amount_minor) from public.kamai_payment_allocations a where a.payment_id = v_pay.id and a.reversed_at is null), 0) + v_pay.order_applied_minor,
        'unallocated_minor', 0, 'allocations', '[]'::jsonb, 'ledger_entry_id', null);
    end if;
  end if;

  begin
    insert into public.kamai_payments
      (tenant_id, store_id, amount_minor, channel, external_ref, reference_code, collected_by, collected_at, evidence_url, notes, order_id, client_key)
    values (v_tenant, v_store.id, v_amount, v_channel, v_ext,
            coalesce(nullif(p ->> 'reference_code', ''), v_store.payment_ref_code), (select auth.uid()),
            v_at, nullif(p ->> 'evidence_url', ''), v_notes, v_order.id, v_key)
    returning * into v_pay;
  exception when unique_violation then
    if v_key is not null and exists (select 1 from public.kamai_payments where tenant_id = v_tenant and client_key = v_key) then
      select * into v_pay from public.kamai_payments where tenant_id = v_tenant and client_key = v_key;
      return jsonb_build_object('payment_id', v_pay.id, 'status', v_pay.status, 'replayed', true);
    end if;
    raise exception 'kamai: a payment with external_ref % already exists (DUPLICATE_PAYMENT)', v_ext using errcode = '23505';
  end;

  if v_channel <> 'cash' then
    -- unverified: no allocation, no ledger posting until a bank line confirms it
    return jsonb_build_object('payment_id', v_pay.id, 'status', v_pay.status, 'verified', false, 'allocated_minor', 0,
                              'unallocated_minor', v_amount, 'allocations', '[]'::jsonb, 'ledger_entry_id', null);
  end if;
  v_res := private.kamai_settle_payment(v_pay.id);
  return (v_res - 'settled') || jsonb_build_object('status', v_pay.status, 'verified', false);
end;
$$;
revoke execute on function public.kamai_record_payment(jsonb) from public, anon;
grant execute on function public.kamai_record_payment(jsonb) to authenticated, service_role;

-- a store member reports (claims) that it paid. Creates an UNVERIFIED claim only: no allocation and no
-- ledger posting; finance confirms it later by matching/confirming a bank line (kamai_confirm_bank_match)
-- or rejects it (kamai_reverse_payment).
create or replace function public.kamai_report_payment(
  p_store_id uuid, p_amount_minor bigint, p_method text, p_reference text, p_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store  public.kamai_stores;
  v_ref    text := nullif(btrim(p_reference), '');
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), ''));
  v_order  public.kamai_orders;
  v_pay    public.kamai_payments;
begin
  if (select auth.uid()) is null then
    raise exception 'kamai: sign in to report a payment' using errcode = '42501';
  end if;
  select * into v_store from public.kamai_stores where id = p_store_id;
  if not found then
    raise exception 'kamai: store not found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.kamai_memberships m
                 where m.tenant_id = v_store.tenant_id and m.user_id = (select auth.uid()) and m.status = 'active'
                   and m.role = 'store' and m.store_id = p_store_id) then
    raise exception 'kamai: a store member may only report payments for its own store' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'kamai: a positive amount is required' using errcode = '22023';
  end if;
  if v_method not in ('raast','ibft','easypaisa','jazzcash','cheque','rtp') then
    raise exception 'kamai: method must be a digital channel (raast, ibft, easypaisa, jazzcash, cheque, rtp); hand cash to your rider' using errcode = '22023';
  end if;
  if coalesce(length(v_ref), 0) < 6 then
    raise exception 'kamai: a payment reference of 6+ characters is required' using errcode = '22023';
  end if;
  if p_order_id is not null then
    select * into v_order from public.kamai_orders where id = p_order_id and tenant_id = v_store.tenant_id and store_id = p_store_id;
    if not found then
      raise exception 'kamai: order not found for this store' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from public.kamai_payments x
      where x.store_id = p_store_id and x.reported_by is not null and x.settled_at is null and x.status = 'recorded') >= 20 then
    raise exception 'kamai: too many unverified payment reports are waiting for finance' using errcode = '22023';
  end if;
  begin
    insert into public.kamai_payments
      (tenant_id, store_id, amount_minor, channel, external_ref, reference_code, collected_by, collected_at, notes, order_id, reported_by)
    values (v_store.tenant_id, p_store_id, p_amount_minor, v_method, v_ref, v_store.payment_ref_code, null, now(),
            'reported by store, unverified', v_order.id, (select auth.uid()))
    returning * into v_pay;
  exception when unique_violation then
    raise exception 'kamai: a payment with this reference already exists (DUPLICATE_PAYMENT)' using errcode = '23505';
  end;
  return jsonb_build_object('payment_id', v_pay.id, 'status', v_pay.status, 'verified', false);
end;
$$;
revoke execute on function public.kamai_report_payment(uuid, bigint, text, text, uuid) from public, anon;
grant execute on function public.kamai_report_payment(uuid, bigint, text, text, uuid) to authenticated, service_role;

-- reject an unverified payment, or reverse a settled one: allocations are undone (exposures, invoices and
-- finance status reopened), the ledger entry is reversed, and a matched bank line is released.
create or replace function public.kamai_reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay   public.kamai_payments;
  v_a     record;
  v_x     public.kamai_credit_exposures;
  v_entry uuid;
  v_rev   uuid;
  v_order public.kamai_orders;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'kamai: a reason is required' using errcode = '22023';
  end if;
  select * into v_pay from public.kamai_payments where id = p_payment_id for update;
  if not found then
    raise exception 'kamai: payment not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_pay.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to reverse payments' using errcode = '42501';
  end if;
  if v_pay.status = 'rejected' then
    raise exception 'kamai: payment is already rejected or reversed' using errcode = '22023';
  end if;
  perform 1 from public.kamai_credit_accounts where store_id = v_pay.store_id for update;

  if v_pay.settled_at is not null then
    for v_a in select * from public.kamai_payment_allocations where payment_id = p_payment_id and reversed_at is null for update loop
      select * into v_x from public.kamai_credit_exposures where id = v_a.exposure_id for update;
      update public.kamai_credit_exposures set
        outstanding_minor = outstanding_minor + v_a.amount_minor,
        paid_minor = greatest(0, paid_minor - v_a.amount_minor),
        status = case when status = 'paid' then 'open' else status end,
        closed_at = case when status = 'paid' then null else closed_at end
      where id = v_x.id;
      if v_x.status = 'paid' then
        update public.kamai_invoices set status = 'issued' where id = v_x.invoice_id and status = 'paid';
        update public.kamai_orders set finance_status = 'financed' where id = v_x.order_id and finance_status = 'paid' and v_x.financed_minor > 0;
      end if;
      update public.kamai_payment_allocations set reversed_at = now() where id = v_a.id;
    end loop;
    if v_pay.order_applied_minor > 0 and v_pay.order_id is not null then
      select * into v_order from public.kamai_orders where id = v_pay.order_id;
      if found and v_order.invoice_id is not null then
        update public.kamai_invoices set status = 'issued' where id = v_order.invoice_id and status = 'paid';
      end if;
    end if;
    select id into v_entry from public.kamai_ledger_entries where tenant_id = v_pay.tenant_id and idempotency_key = 'payment:' || p_payment_id;
    if v_entry is not null then
      v_rev := private.kamai_reverse_entry_core(v_entry, 'Reversal of payment ' || p_payment_id || ': ' || btrim(p_reason));
    end if;
  end if;

  update public.kamai_bank_lines set match_status = 'unmatched', matched_payment_id = null, matched_at = null, matched_by = null,
         meta = meta || jsonb_build_object('released_from_payment', p_payment_id)
   where matched_payment_id = p_payment_id;
  update public.kamai_payments set status = 'rejected', reversed_at = now(), reversal_reason = btrim(p_reason)
   where id = p_payment_id returning * into v_pay;
  if v_pay.settled_at is not null then
    perform private.kamai_evaluate_store_core(v_pay.store_id);
  end if;
  return jsonb_build_object('payment_id', p_payment_id, 'status', 'rejected', 'reversal_entry_id', v_rev);
end;
$$;
revoke execute on function public.kamai_reverse_payment(uuid, text) from public, anon;
grant execute on function public.kamai_reverse_payment(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bank statement import and matching
-- ---------------------------------------------------------------------------
create or replace function public.kamai_import_bank_lines(p_statement jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := nullif(p_statement ->> 'tenant_id', '')::uuid;
  v_hash text := nullif(p_statement ->> 'file_hash', '');
  v_id uuid;
  v_n int;
begin
  if v_tenant is null or v_hash is null then
    raise exception 'kamai: tenant_id and file_hash are required' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_tenant, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to import bank statements' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'kamai: lines must be an array' using errcode = '22023';
  end if;
  select id into v_id from public.kamai_bank_statements where tenant_id = v_tenant and file_hash = v_hash;
  if found then
    return jsonb_build_object('statement_id', v_id, 'inserted', 0, 'duplicate', true);
  end if;
  insert into public.kamai_bank_statements (tenant_id, bank_name, account_ref, period_start, period_end, file_name, file_hash, rows_total, imported_by)
  values (v_tenant, p_statement ->> 'bank_name', p_statement ->> 'account_ref',
          nullif(p_statement ->> 'period_start', '')::date, nullif(p_statement ->> 'period_end', '')::date,
          p_statement ->> 'file_name', v_hash, jsonb_array_length(p_lines), (select auth.uid()))
  returning id into v_id;
  insert into public.kamai_bank_lines (tenant_id, statement_id, line_no, line_date, narration, amount_minor, direction, bank_ref, extracted_ref)
  select v_tenant, v_id, t.ord::int, (t.l ->> 'line_date')::date, t.l ->> 'narration', abs((t.l ->> 'amount_minor')::bigint),
         coalesce(nullif(t.l ->> 'direction', ''), case when (t.l ->> 'amount_minor')::bigint < 0 then 'debit' else 'credit' end),
         nullif(t.l ->> 'bank_ref', ''),
         (regexp_match(upper(coalesce(t.l ->> 'narration', '')), 'KM-[A-Z0-9]+(?:-[A-Z0-9]+)*'))[1]
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  get diagnostics v_n = row_count;
  return jsonb_build_object('statement_id', v_id, 'inserted', v_n, 'duplicate', false);
end;
$$;
revoke execute on function public.kamai_import_bank_lines(jsonb, jsonb) from public, anon;
grant execute on function public.kamai_import_bank_lines(jsonb, jsonb) to authenticated, service_role;

create or replace function public.kamai_match_bank_lines(p_statement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st public.kamai_bank_statements;
  v_l record;
  v_pid uuid;
  v_cnt int;
  v_pass1 int := 0;
  v_pass2 int := 0;
  v_proposed int := 0;
  v_ambiguous int := 0;
begin
  select * into v_st from public.kamai_bank_statements where id = p_statement_id;
  if not found then
    raise exception 'kamai: statement not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_st.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to match bank lines' using errcode = '42501';
  end if;
  for v_l in select * from public.kamai_bank_lines
             where statement_id = p_statement_id and match_status = 'unmatched' and direction = 'credit' order by line_no loop
    v_pid := null;
    -- pass 1: reference code in narration
    if v_l.extracted_ref is not null then
      select p.id into v_pid from public.kamai_payments p
      where p.tenant_id = v_st.tenant_id and upper(p.reference_code) = v_l.extracted_ref and p.amount_minor = v_l.amount_minor
        and p.status = 'recorded' and p.channel <> 'cash'
        and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id)
      order by p.collected_at limit 1
      for update of p;
      if v_pid is not null then
        update public.kamai_bank_lines set match_status = 'auto', matched_payment_id = v_pid, matched_at = now(),
               meta = meta || jsonb_build_object('pass', 1) where id = v_l.id;
        update public.kamai_payments set status = 'matched', verified_at = now(), verified_by = (select auth.uid()) where id = v_pid;
        perform private.kamai_settle_payment(v_pid);   -- the bank line proves the money arrived
        v_pass1 := v_pass1 + 1;
        continue;
      end if;
    end if;
    -- pass 2: external ref equals bank ref or appears in the narration
    select p.id into v_pid from public.kamai_payments p
    where p.tenant_id = v_st.tenant_id and p.external_ref is not null and length(p.external_ref) >= 6
      and p.amount_minor = v_l.amount_minor and p.status = 'recorded' and p.channel <> 'cash'
      and (lower(p.external_ref) = lower(coalesce(v_l.bank_ref, ''))
           or position(lower(p.external_ref) in lower(coalesce(v_l.narration, ''))) > 0)
      and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id)
    order by p.collected_at limit 1
    for update of p;
    if v_pid is not null then
      update public.kamai_bank_lines set match_status = 'auto', matched_payment_id = v_pid, matched_at = now(),
             meta = meta || jsonb_build_object('pass', 2) where id = v_l.id;
      update public.kamai_payments set status = 'matched', verified_at = now(), verified_by = (select auth.uid()) where id = v_pid;
      perform private.kamai_settle_payment(v_pid);
      v_pass2 := v_pass2 + 1;
      continue;
    end if;
    -- pass 3: propose by amount within 2 days (never auto-match on amount alone)
    select count(*) into v_cnt from public.kamai_payments p
    where p.tenant_id = v_st.tenant_id and p.amount_minor = v_l.amount_minor and p.status = 'recorded' and p.channel <> 'cash'
      and abs((p.collected_at at time zone 'Asia/Karachi')::date - v_l.line_date) <= 2
      and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id);
    if v_cnt = 1 then
      select p.id into v_pid from public.kamai_payments p
      where p.tenant_id = v_st.tenant_id and p.amount_minor = v_l.amount_minor and p.status = 'recorded' and p.channel <> 'cash'
        and abs((p.collected_at at time zone 'Asia/Karachi')::date - v_l.line_date) <= 2
        and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id);
      update public.kamai_bank_lines set meta = meta || jsonb_build_object('pass', 3, 'status', 'proposed', 'suggested_payment_id', v_pid)
      where id = v_l.id;
      v_proposed := v_proposed + 1;
    elsif v_cnt > 1 then
      update public.kamai_bank_lines set meta = meta || jsonb_build_object('pass', 3, 'status', 'ambiguous', 'candidates', v_cnt)
      where id = v_l.id;
      v_ambiguous := v_ambiguous + 1;
    end if;
  end loop;
  return jsonb_build_object('statement_id', p_statement_id, 'matched_by_reference', v_pass1, 'matched_by_external_ref', v_pass2,
                            'proposed', v_proposed, 'ambiguous', v_ambiguous);
end;
$$;
revoke execute on function public.kamai_match_bank_lines(uuid) from public, anon;
grant execute on function public.kamai_match_bank_lines(uuid) to authenticated, service_role;

create or replace function public.kamai_confirm_bank_match(p_line_id uuid, p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.kamai_bank_lines;
  v_p public.kamai_payments;
  v_s jsonb;
begin
  select * into v_l from public.kamai_bank_lines where id = p_line_id for update;
  if not found then
    raise exception 'kamai: bank line not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_l.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to confirm bank matches' using errcode = '42501';
  end if;
  select * into v_p from public.kamai_payments where id = p_payment_id and tenant_id = v_l.tenant_id for update;
  if not found then
    raise exception 'kamai: payment not found' using errcode = '22023';
  end if;
  if v_l.match_status <> 'unmatched' then
    raise exception 'kamai: bank line is already %', v_l.match_status using errcode = '22023';
  end if;
  if v_l.direction <> 'credit' then
    raise exception 'kamai: only a bank credit can confirm a payment' using errcode = '22023';
  end if;
  if v_p.status <> 'recorded' then
    raise exception 'kamai: payment is already %', v_p.status using errcode = '22023';
  end if;
  if v_p.channel = 'cash' then
    raise exception 'kamai: cash payments are reconciled through the rider cash day, not bank lines' using errcode = '22023';
  end if;
  if v_p.amount_minor <> v_l.amount_minor then
    raise exception 'kamai: payment amount % does not equal the bank line amount %', v_p.amount_minor, v_l.amount_minor using errcode = '22023';
  end if;
  update public.kamai_bank_lines set match_status = 'manual', matched_payment_id = p_payment_id, matched_at = now(),
         matched_by = (select auth.uid()) where id = p_line_id;
  update public.kamai_payments set status = 'verified', verified_at = now(), verified_by = (select auth.uid()) where id = p_payment_id;
  -- verification is what allocates the payment to receivables and posts Dr 1100 bank / Cr 1200
  v_s := private.kamai_settle_payment(p_payment_id);
  return jsonb_build_object('line_id', p_line_id, 'payment_id', p_payment_id, 'match_status', 'manual',
                            'allocated_minor', v_s -> 'allocated_minor', 'ledger_entry_id', v_s -> 'ledger_entry_id');
end;
$$;
revoke execute on function public.kamai_confirm_bank_match(uuid, uuid) from public, anon;
grant execute on function public.kamai_confirm_bank_match(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rider cash day close
-- ---------------------------------------------------------------------------
create or replace function public.kamai_close_cash_day(
  p_tenant uuid, p_rider_user_id uuid, p_business_date date, p_deposited_minor bigint,
  p_method text default 'bank', p_deposit_ref text default null, p_slip_url text default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_priv     boolean;
  v_today    date := (now() at time zone 'Asia/Karachi')::date;
  v_expected bigint;
  v_row      public.kamai_cash_deposits;
  v_status   text;
  v_lines    jsonb;
  v_entry    uuid;
  v_short    bigint;
begin
  v_priv := (select private.kamai_can(p_tenant, array['owner','manager','finance']));
  if not (v_priv or (p_rider_user_id = (select auth.uid()) and (select private.kamai_has_role(p_tenant, array['rider'])))) then
    raise exception 'kamai: not allowed to close this cash day' using errcode = '42501';
  end if;
  if p_deposited_minor is null or p_deposited_minor < 0 then
    raise exception 'kamai: deposited amount must be >= 0' using errcode = '22023';
  end if;
  if p_business_date is null or p_business_date > v_today or (not v_priv and p_business_date < v_today - 7) then
    raise exception 'kamai: business date is outside the allowed window' using errcode = '22023';
  end if;
  if not exists (select 1 from public.kamai_memberships m where m.tenant_id = p_tenant and m.user_id = p_rider_user_id and m.role = 'rider') then
    raise exception 'kamai: user is not a rider of this tenant' using errcode = '22023';
  end if;

  select * into v_row from public.kamai_cash_deposits
   where tenant_id = p_tenant and rider_user_id = p_rider_user_id and business_date = p_business_date for update;
  if found and v_row.status = 'reconciled' then
    raise exception 'kamai: this cash day is already reconciled' using errcode = '22023';
  end if;
  if found and not v_priv then
    -- a rider may submit once; only finance can change the amount. Same amount = idempotent (slip/ref/notes may be added).
    if v_row.deposited_minor <> p_deposited_minor then
      raise exception 'kamai: this cash day was already submitted with a different amount, ask finance to correct it' using errcode = '22023';
    end if;
    update public.kamai_cash_deposits set deposit_ref = coalesce(p_deposit_ref, deposit_ref),
           slip_url = coalesce(p_slip_url, slip_url), notes = coalesce(p_notes, notes)
     where id = v_row.id returning * into v_row;
    return to_jsonb(v_row);
  end if;

  select coalesce(sum(amount_minor), 0) into v_expected from public.kamai_payments
  where tenant_id = p_tenant and collected_by = p_rider_user_id and channel = 'cash' and status <> 'rejected'
    and (collected_at at time zone 'Asia/Karachi')::date = p_business_date;
  v_status := case when p_deposited_minor <> v_expected then 'variance' else 'submitted' end;

  insert into public.kamai_cash_deposits
    (tenant_id, rider_user_id, business_date, expected_minor, deposited_minor, method, deposit_ref, slip_url, variance_minor, status, notes, created_by)
  values (p_tenant, p_rider_user_id, p_business_date, v_expected, p_deposited_minor, coalesce(p_method, 'bank'), p_deposit_ref, p_slip_url,
          p_deposited_minor - v_expected, v_status, p_notes, (select auth.uid()))
  on conflict (tenant_id, rider_user_id, business_date) do update set
    expected_minor = excluded.expected_minor, deposited_minor = excluded.deposited_minor, method = excluded.method,
    deposit_ref = excluded.deposit_ref, slip_url = excluded.slip_url, variance_minor = excluded.variance_minor,
    status = excluded.status, notes = excluded.notes
  returning * into v_row;

  -- the ledger moves only on finance confirmation (a rider's own submission never posts)
  if v_priv and (v_expected > 0 or p_deposited_minor > 0) then
    -- unchanged amounts on an already-posted day: nothing to do
    if v_row.ledger_entry_id is null or v_row.post_version = 0
       or (select coalesce(sum(l.amount_minor), 0) from public.kamai_ledger_lines l join public.kamai_ledger_accounts a on a.id = l.account_id
           where l.entry_id = v_row.ledger_entry_id and a.code = '1150') <> p_deposited_minor
       or (select coalesce(sum(l.amount_minor), 0) from public.kamai_ledger_lines l join public.kamai_ledger_accounts a on a.id = l.account_id
           where l.entry_id = v_row.ledger_entry_id and a.code = '1110' and l.direction = 'credit') <> v_expected then
      if v_row.ledger_entry_id is not null then
        perform private.kamai_reverse_entry_core(v_row.ledger_entry_id, 'Correction of rider cash deposit ' || p_business_date);
      end if;
      v_short := v_expected - p_deposited_minor;     -- > 0 shortage, < 0 overage
      v_lines := '[]'::jsonb;
      if p_deposited_minor > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1150', 'direction', 'debit', 'amount_minor', p_deposited_minor));
      end if;
      if v_short > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '5600', 'direction', 'debit', 'amount_minor', v_short,
                                                                   'memo', 'cash shortage'));
      end if;
      if v_expected > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1110', 'direction', 'credit', 'amount_minor', v_expected,
                                                                   'party_type', 'rider', 'party_id', p_rider_user_id::text));
      end if;
      if v_short < 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '5600', 'direction', 'credit', 'amount_minor', -v_short,
                                                                   'memo', 'cash overage'));
      end if;
      v_entry := private.kamai_post_entry_core(p_tenant, 'cashdep:' || v_row.id || ':v' || (v_row.post_version + 1), 'cash_deposit',
        v_row.id::text, now(), 'Rider cash deposit ' || p_business_date, v_lines);
      update public.kamai_cash_deposits set ledger_entry_id = v_entry, post_version = post_version + 1
       where id = v_row.id returning * into v_row;
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke execute on function public.kamai_close_cash_day(uuid, uuid, date, bigint, text, text, text, text) from public, anon;
grant execute on function public.kamai_close_cash_day(uuid, uuid, date, bigint, text, text, text, text) to authenticated, service_role;

-- ===================== 20261108120007_kamai_financing_comms.sql =====================
-- Kamai OS migration 007: financing (lender facilities), communications (WhatsApp outbox), reporting views.

-- ---------------------------------------------------------------------------
-- financing
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_facilities (
  id                 uuid primary key default gen_random_uuid(),
  lender_tenant_id   uuid not null references public.kamai_tenants(id),
  borrower_tenant_id uuid not null references public.kamai_tenants(id),
  technique          text not null check (technique in ('retailer_purchase_loan','receivables_discounting_recourse','receivables_discounting_non_recourse','payables_finance','distributor_finance')),
  limit_minor        bigint not null check (limit_minor >= 0),
  tranche_minor      bigint check (tranche_minor is null or tranche_minor >= 0),
  tenor_days         int not null default 25 check (tenor_days between 1 and 365),
  advance_rate_pct   numeric(5,2) not null default 80 check (advance_rate_pct > 0 and advance_rate_pct <= 100),
  first_loss_pct     numeric(5,2) not null default 0 check (first_loss_pct >= 0 and first_loss_pct <= 100),
  pricing            jsonb not null default '{}'::jsonb,
  status             text not null default 'draft' check (status in ('draft','active','suspended','closed')),
  debtor_of_record   text not null default 'store' check (debtor_of_record in ('store','distributor')),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (lender_tenant_id <> borrower_tenant_id)
);
create index if not exists kamai_facilities_lender_idx on public.kamai_facilities (lender_tenant_id);
create index if not exists kamai_facilities_borrower_idx on public.kamai_facilities (borrower_tenant_id);
alter table public.kamai_facilities enable row level security;

create table if not exists public.kamai_financings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,   -- borrower / distributor tenant
  lender_tenant_id uuid not null references public.kamai_tenants(id),
  facility_id      uuid not null references public.kamai_facilities(id),
  order_id         uuid not null unique references public.kamai_orders(id),
  exposure_id      uuid not null references public.kamai_credit_exposures(id),
  disbursed_minor  bigint not null check (disbursed_minor > 0),
  disbursed_at     timestamptz not null default now(),
  due_date         date not null,
  repaid_minor     bigint not null default 0 check (repaid_minor >= 0),
  status           text not null default 'disbursed' check (status in ('disbursed','partially_repaid','settled','defaulted')),
  lender_ref       text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists kamai_financings_tenant_idx on public.kamai_financings (tenant_id, disbursed_at desc);
create index if not exists kamai_financings_lender_idx on public.kamai_financings (lender_tenant_id, status);
create index if not exists kamai_financings_facility_idx on public.kamai_financings (facility_id);
create index if not exists kamai_financings_exposure_idx on public.kamai_financings (exposure_id);
alter table public.kamai_financings enable row level security;

drop trigger if exists kamai_facilities_touch on public.kamai_facilities;
create trigger kamai_facilities_touch before update on public.kamai_facilities for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_financings_touch on public.kamai_financings;
create trigger kamai_financings_touch before update on public.kamai_financings for each row execute function public.kamai_touch_updated_at();
drop trigger if exists kamai_facilities_audit on public.kamai_facilities;
create trigger kamai_facilities_audit after insert or update or delete on public.kamai_facilities for each row execute function public.kamai_audit_trigger();
drop trigger if exists kamai_financings_audit on public.kamai_financings;
create trigger kamai_financings_audit after insert or update or delete on public.kamai_financings for each row execute function public.kamai_audit_trigger();

-- ---------------------------------------------------------------------------
-- communications
-- ---------------------------------------------------------------------------
create table if not exists public.kamai_wa_contacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.kamai_tenants(id) on delete cascade,
  wa_id           text not null check (wa_id ~ '^[0-9]{8,15}$'),
  store_id        uuid references public.kamai_stores(id) on delete set null,
  opted_in_at     timestamptz,
  opt_in_source   text,
  opt_in_scopes   text[] not null default '{}',
  opted_out_at    timestamptz,
  last_inbound_at timestamptz,
  session         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (tenant_id, wa_id)
);
create index if not exists kamai_wa_contacts_store_idx on public.kamai_wa_contacts (store_id) where store_id is not null;
alter table public.kamai_wa_contacts enable row level security;

create table if not exists public.kamai_wa_messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.kamai_tenants(id) on delete cascade,
  contact_id       uuid references public.kamai_wa_contacts(id) on delete set null,
  store_id         uuid references public.kamai_stores(id) on delete set null,
  to_wa_id         text,
  direction        text not null default 'out' check (direction in ('in','out')),
  wamid            text unique,
  template_name    text,
  category         text check (category is null or category in ('utility','marketing','authentication','service')),
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','received')),
  pricing_category text,
  order_id         uuid references public.kamai_orders(id) on delete set null,
  invoice_id       uuid references public.kamai_invoices(id) on delete set null,
  error            text,
  queued_at        timestamptz not null default now(),
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists kamai_wa_messages_queue_idx on public.kamai_wa_messages (tenant_id, queued_at) where status = 'queued';
create index if not exists kamai_wa_messages_contact_idx on public.kamai_wa_messages (contact_id) where contact_id is not null;
create index if not exists kamai_wa_messages_store_idx on public.kamai_wa_messages (store_id) where store_id is not null;
create index if not exists kamai_wa_messages_order_idx on public.kamai_wa_messages (order_id) where order_id is not null;
create index if not exists kamai_wa_messages_invoice_idx on public.kamai_wa_messages (invoice_id) where invoice_id is not null;
alter table public.kamai_wa_messages enable row level security;

create table if not exists public.kamai_wa_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.kamai_tenants(id) on delete cascade,
  name          text not null,
  language_code text not null default 'en',
  category      text not null default 'utility' check (category in ('utility','marketing','authentication')),
  status        text not null default 'draft' check (status in ('draft','pending','approved','rejected','paused')),
  components    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name, language_code)
);
alter table public.kamai_wa_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kamai_dunning_events_wa_fk') then
    alter table public.kamai_dunning_events add constraint kamai_dunning_events_wa_fk
      foreign key (wa_message_id) references public.kamai_wa_messages(id) on delete set null;
  end if;
end $$;
create index if not exists kamai_dunning_events_wa_idx on public.kamai_dunning_events (wa_message_id) where wa_message_id is not null;

drop trigger if exists kamai_wa_templates_touch on public.kamai_wa_templates;
create trigger kamai_wa_templates_touch before update on public.kamai_wa_templates for each row execute function public.kamai_touch_updated_at();

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------
drop policy if exists kamai_facilities_select on public.kamai_facilities;
create policy kamai_facilities_select on public.kamai_facilities for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or lender_tenant_id in (select private.kamai_user_tenants())
         or (select private.kamai_has_role(borrower_tenant_id, array['owner','manager','finance'])));
drop policy if exists kamai_facilities_write on public.kamai_facilities;
create policy kamai_facilities_write on public.kamai_facilities for all to authenticated
  using ((select private.kamai_is_platform_admin()))
  with check ((select private.kamai_is_platform_admin()));

drop policy if exists kamai_financings_select on public.kamai_financings;
create policy kamai_financings_select on public.kamai_financings for select to authenticated
  using ((select private.kamai_is_platform_admin())
         or lender_tenant_id in (select private.kamai_user_tenants())
         or (select private.kamai_has_role(tenant_id, array['owner','manager','finance'])));

drop policy if exists kamai_wa_contacts_select on public.kamai_wa_contacts;
create policy kamai_wa_contacts_select on public.kamai_wa_contacts for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));
drop policy if exists kamai_wa_contacts_write on public.kamai_wa_contacts;
create policy kamai_wa_contacts_write on public.kamai_wa_contacts for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

drop policy if exists kamai_wa_messages_select on public.kamai_wa_messages;
create policy kamai_wa_messages_select on public.kamai_wa_messages for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));

drop policy if exists kamai_wa_templates_select on public.kamai_wa_templates;
create policy kamai_wa_templates_select on public.kamai_wa_templates for select to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager','finance','booker'])));
drop policy if exists kamai_wa_templates_write on public.kamai_wa_templates;
create policy kamai_wa_templates_write on public.kamai_wa_templates for all to authenticated
  using ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])))
  with check ((select private.kamai_is_platform_admin()) or (select private.kamai_has_role(tenant_id, array['owner','manager'])));

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
revoke all on public.kamai_facilities from anon;
grant select, insert, update, delete on public.kamai_facilities to authenticated;
grant all on public.kamai_facilities to service_role;
revoke all on public.kamai_financings from anon;
grant select on public.kamai_financings to authenticated;
grant all on public.kamai_financings to service_role;
revoke all on public.kamai_wa_contacts from anon;
grant select, insert, update, delete on public.kamai_wa_contacts to authenticated;
grant all on public.kamai_wa_contacts to service_role;
revoke all on public.kamai_wa_messages from anon;
grant select on public.kamai_wa_messages to authenticated;
grant all on public.kamai_wa_messages to service_role;
revoke all on public.kamai_wa_templates from anon;
grant select, insert, update, delete on public.kamai_wa_templates to authenticated;
grant all on public.kamai_wa_templates to service_role;

-- ---------------------------------------------------------------------------
-- kamai_finance_order / kamai_settle_financing
-- ---------------------------------------------------------------------------
create or replace function public.kamai_finance_order(p_order_id uuid, p_facility_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.kamai_facilities;
  v_o public.kamai_orders;
  v_x public.kamai_credit_exposures;
  v_amt bigint;
  v_used bigint;
  v_fin public.kamai_financings;
begin
  -- lock the facility row: serialises concurrent advances so the limit check below cannot race
  select * into v_f from public.kamai_facilities where id = p_facility_id for update;
  if not found then
    raise exception 'kamai: facility not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
          or (select private.kamai_has_role(v_f.lender_tenant_id, array['owner','manager','finance']))) then
    raise exception 'kamai: only the lender or a platform admin may finance orders' using errcode = '42501';
  end if;
  if v_f.status <> 'active' then
    raise exception 'kamai: facility is not active' using errcode = '22023';
  end if;
  select * into v_o from public.kamai_orders where id = p_order_id for update;
  if not found or v_o.tenant_id <> v_f.borrower_tenant_id then
    raise exception 'kamai: order does not belong to the facility borrower' using errcode = '22023';
  end if;
  if v_o.fulfilment_status <> 'delivered' or v_o.finance_status <> 'unfinanced' then
    raise exception 'kamai: order must be delivered and unfinanced' using errcode = '22023';
  end if;
  select * into v_x from public.kamai_credit_exposures where order_id = p_order_id and status = 'open' for update;
  if not found then
    raise exception 'kamai: no open credit exposure for this order' using errcode = '22023';
  end if;
  v_amt := round(v_x.outstanding_minor * v_f.advance_rate_pct / 100)::bigint;
  select coalesce(sum(disbursed_minor - repaid_minor), 0) into v_used from public.kamai_financings
  where facility_id = p_facility_id and status in ('disbursed','partially_repaid');
  if v_used + v_amt > v_f.limit_minor then
    raise exception 'kamai: facility limit exceeded (FACILITY_LIMIT)' using errcode = '22023';
  end if;
  insert into public.kamai_financings (tenant_id, lender_tenant_id, facility_id, order_id, exposure_id, disbursed_minor, due_date, created_by)
  values (v_o.tenant_id, v_f.lender_tenant_id, v_f.id, v_o.id, v_x.id, v_amt, v_x.due_date, (select auth.uid()))
  returning * into v_fin;
  update public.kamai_credit_exposures set financed_minor = v_amt, lender_tenant_id = v_f.lender_tenant_id where id = v_x.id;
  update public.kamai_orders set finance_status = 'financed' where id = v_o.id;
  perform private.kamai_post_entry_core(v_o.tenant_id, 'financing:' || v_fin.id || ':disburse', 'financing', v_fin.id::text, now(),
    'Financing advance for order ' || v_o.order_no,
    jsonb_build_array(
      jsonb_build_object('account_code', '1100', 'direction', 'debit', 'amount_minor', v_amt),
      jsonb_build_object('account_code', '2200', 'direction', 'credit', 'amount_minor', v_amt,
                         'party_type', 'lender', 'party_id', v_f.lender_tenant_id::text)));
  return to_jsonb(v_fin);
end;
$$;
revoke execute on function public.kamai_finance_order(uuid, uuid) from public, anon;
grant execute on function public.kamai_finance_order(uuid, uuid) to authenticated, service_role;

create or replace function public.kamai_settle_financing(p_financing_id uuid, p_amount_minor bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fin public.kamai_financings;
  v_new bigint;
  v_cover bigint;
begin
  select * into v_fin from public.kamai_financings where id = p_financing_id for update;
  if not found then
    raise exception 'kamai: financing not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
          or (select private.kamai_has_role(v_fin.lender_tenant_id, array['owner','manager','finance']))) then
    -- the borrower (distributor) can never mark its own financing as repaid
    raise exception 'kamai: only the lender or a platform admin may settle this financing' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > v_fin.disbursed_minor - v_fin.repaid_minor then
    raise exception 'kamai: amount must be between 1 and the outstanding financing' using errcode = '22023';
  end if;
  v_new := v_fin.repaid_minor + p_amount_minor;
  -- Repayment must be backed by ledger-verified money: the store payments allocated to the financed exposure that are
  -- bank-matched or verified (kamai_payments.status matched|verified). Platform admins and the server may override.
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    select coalesce(sum(a.amount_minor), 0) into v_cover
    from public.kamai_payment_allocations a
    join public.kamai_payments p on p.id = a.payment_id and p.status in ('matched','verified')
    where a.exposure_id = v_fin.exposure_id;
    if v_new > v_cover then
      raise exception 'kamai: repayment not covered by verified payments (REPAYMENT_NOT_VERIFIED): verified % < repaid after this call %', v_cover, v_new
        using errcode = '22023';
    end if;
  end if;
  update public.kamai_financings set repaid_minor = v_new,
         status = case when v_new >= disbursed_minor then 'settled' else 'partially_repaid' end
  where id = p_financing_id returning * into v_fin;
  if v_fin.status = 'settled' then
    update public.kamai_orders set finance_status = 'settled' where id = v_fin.order_id;
  end if;
  perform private.kamai_post_entry_core(v_fin.tenant_id, 'financing:' || v_fin.id || ':repay:' || v_new, 'financing', v_fin.id::text, now(),
    'Financing repayment',
    jsonb_build_array(
      jsonb_build_object('account_code', '2200', 'direction', 'debit', 'amount_minor', p_amount_minor,
                         'party_type', 'lender', 'party_id', v_fin.lender_tenant_id::text),
      jsonb_build_object('account_code', '1100', 'direction', 'credit', 'amount_minor', p_amount_minor)));
  return to_jsonb(v_fin);
end;
$$;
revoke execute on function public.kamai_settle_financing(uuid, bigint) from public, anon;
grant execute on function public.kamai_settle_financing(uuid, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.kamai_v_lender_positions with (security_invoker = true) as
select x.tenant_id as distributor_tenant_id,
       x.id as exposure_id,
       x.order_id,
       x.invoice_id,
       i.display_number as invoice_number,
       x.store_id,
       s.name as store_name,
       s.area,
       a.tier as credit_tier,
       a.limit_minor as credit_limit_minor,
       x.origination_date,
       x.due_date,
       (x.due_date - x.origination_date) as tenor_days,
       x.original_minor,
       x.financed_minor,
       x.outstanding_minor,
       x.paid_minor,
       x.credited_minor,
       x.last_payment_at,
       greatest(0, (now() at time zone 'Asia/Karachi')::date - x.due_date) as dpd,
       public.kamai_dpd_bucket(greatest(0, (now() at time zone 'Asia/Karachi')::date - x.due_date)) as dpd_bucket,
       x.status,
       x.restructured,
       x.write_off_date,
       x.lender_tenant_id,
       (dp.photo_url is not null) as delivery_proof_flag,
       (x.status = 'open' and (now() at time zone 'Asia/Karachi')::date - x.due_date <= 90 and not x.restructured) as eligible_flag,
       case when x.status <> 'open' then 'NOT_OPEN'
            when x.restructured then 'RESTRUCTURED'
            when (now() at time zone 'Asia/Karachi')::date - x.due_date > 90 then 'DPD_OVER_90' end as ineligibility_reason,
       x.created_at
from public.kamai_credit_exposures x
join public.kamai_stores s on s.id = x.store_id
left join public.kamai_invoices i on i.id = x.invoice_id
left join public.kamai_credit_accounts a on a.store_id = x.store_id
left join public.kamai_delivery_proofs dp on dp.order_id = x.order_id;

create or replace view public.kamai_v_par with (security_invoker = true) as
with latest as (
  select tenant_id, max(snapshot_date) as snapshot_date from public.kamai_credit_snapshots group by tenant_id
)
select s.tenant_id, l.snapshot_date,
       coalesce(sum(s.outstanding_minor), 0)::bigint as outstanding_minor,
       coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 7), 0)::bigint as par7_minor,
       coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 30), 0)::bigint as par30_minor,
       coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 60), 0)::bigint as par60_minor,
       coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 90), 0)::bigint as par90_minor,
       round(coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 7), 0)::numeric / nullif(sum(s.outstanding_minor), 0), 4) as par7,
       round(coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 30), 0)::numeric / nullif(sum(s.outstanding_minor), 0), 4) as par30,
       round(coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 60), 0)::numeric / nullif(sum(s.outstanding_minor), 0), 4) as par60,
       round(coalesce(sum(s.outstanding_minor) filter (where s.max_dpd > 90), 0)::numeric / nullif(sum(s.outstanding_minor), 0), 4) as par90
from public.kamai_credit_snapshots s
join latest l on l.tenant_id = s.tenant_id and l.snapshot_date = s.snapshot_date
group by s.tenant_id, l.snapshot_date;

create or replace view public.kamai_v_collections with (security_invoker = true) as
select p.tenant_id,
       (p.collected_at at time zone 'Asia/Karachi')::date as collected_on,
       count(*)::int as payments,
       sum(p.amount_minor)::bigint as collected_minor,
       coalesce(sum(p.amount_minor) filter (where p.channel = 'cash'), 0)::bigint as cash_minor,
       coalesce(sum(p.amount_minor) filter (where p.channel <> 'cash'), 0)::bigint as digital_minor
from public.kamai_payments p
where p.status <> 'rejected'
group by p.tenant_id, (p.collected_at at time zone 'Asia/Karachi')::date;

create or replace view public.kamai_v_store_balances with (security_invoker = true) as
select l.tenant_id, l.party_id::uuid as store_id,
       sum(case when l.direction = 'debit' then l.amount_minor else -l.amount_minor end)::bigint as balance_minor
from public.kamai_ledger_lines l
join public.kamai_ledger_accounts a on a.id = l.account_id and a.code = '1200'
where l.party_type = 'store'
group by l.tenant_id, l.party_id;

revoke all on public.kamai_v_lender_positions, public.kamai_v_par, public.kamai_v_collections, public.kamai_v_store_balances from anon;
grant select on public.kamai_v_lender_positions, public.kamai_v_par, public.kamai_v_collections, public.kamai_v_store_balances to authenticated;
grant all on public.kamai_v_lender_positions, public.kamai_v_par, public.kamai_v_collections, public.kamai_v_store_balances to service_role;

-- ===================== 20261108120008_kamai_os_seed_cron.sql =====================
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
  v_errors jsonb := '[]'::jsonb;
  v_n_err int := 0;
begin
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())) then
    raise exception 'kamai: platform admins or the scheduler only' using errcode = '42501';
  end if;

  -- 1. re-evaluate stores with activity
  for v_s in select st.id from public.kamai_stores st
             where exists (select 1 from public.kamai_credit_exposures x where x.store_id = st.id and x.status = 'open')
                or exists (select 1 from public.kamai_orders o where o.store_id = st.id and o.created_at >= now() - interval '90 days')
                or exists (select 1 from public.kamai_credit_exposures x where x.store_id = st.id and x.closed_at >= now() - interval '180 days') loop
    -- one bad store/policy must never abort the job for everyone else
    begin
      perform private.kamai_evaluate_store_core(v_s.id);
      v_n_eval := v_n_eval + 1;
    exception when others then
      v_n_err := v_n_err + 1;
      if jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || jsonb_build_object('step', 'evaluate', 'store_id', v_s.id, 'error', sqlerrm);
      end if;
      raise warning 'kamai_run_daily: evaluate store % failed: %', v_s.id, sqlerrm;
    end;
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
   begin
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
   exception when others then
    v_n_err := v_n_err + 1;
    if jsonb_array_length(v_errors) < 20 then
      v_errors := v_errors || jsonb_build_object('step', 'par30', 'tenant_id', v_t.id, 'error', sqlerrm);
    end if;
    raise warning 'kamai_run_daily: PAR30 rule for tenant % failed: %', v_t.id, sqlerrm;
   end;
  end loop;

  -- 4. dunning: per exposure the latest active rule whose offset has been reached (offset_days <= days overdue), once per
  -- exposure and step. A missed run therefore fires the step the next day instead of skipping it, without back-filling
  -- every earlier step.
  for v_x in
    select x.id as exposure_id, x.tenant_id, x.store_id, x.outstanding_minor, x.due_date, r.id as rule_id, r.offset_days, r.action,
           r.template_name, s.name as store_name, s.mobile, s.wa_opt_in_at, i.display_number
    from public.kamai_credit_exposures x
    join lateral (select dr.* from public.kamai_dunning_rules dr
                  where dr.tenant_id = x.tenant_id and dr.active and dr.offset_days <= (v_today - x.due_date)
                  order by dr.offset_days desc limit 1) r on true
    join public.kamai_stores s on s.id = x.store_id
    left join public.kamai_invoices i on i.id = x.invoice_id
    where x.status = 'open' and x.outstanding_minor > 0
      and not exists (select 1 from public.kamai_dunning_events e where e.exposure_id = x.id and e.offset_days = r.offset_days)
  loop
   begin
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
            case when v_msg is null then 'skipped' else 'queued' end, v_msg)
    on conflict do nothing;
    v_n_dun := v_n_dun + 1;
   exception when others then
    v_n_err := v_n_err + 1;
    if jsonb_array_length(v_errors) < 20 then
      v_errors := v_errors || jsonb_build_object('step', 'dunning', 'exposure_id', v_x.exposure_id, 'error', sqlerrm);
    end if;
    raise warning 'kamai_run_daily: dunning for exposure % failed: %', v_x.exposure_id, sqlerrm;
   end;
  end loop;

  -- 5. KPI snapshot
  insert into public.kamai_kpi_snapshots (snapshot_date, metrics)
  values (v_today, private.kamai_os_kpis_core())
  on conflict (snapshot_date) do update set metrics = excluded.metrics;

  return jsonb_build_object('date', v_today, 'stores_evaluated', v_n_eval, 'snapshots', v_n_snap, 'dunning_events', v_n_dun,
                            'wa_queued', v_n_msg, 'tenants_paused', v_paused, 'tenants_unpaused', v_unpaused,
                            'errors', v_n_err, 'error_samples', v_errors);
end;
$$;
revoke execute on function public.kamai_run_daily() from public, anon;
grant execute on function public.kamai_run_daily() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- credit policy validation: reject malformed rules at write time (the engine casts these keys with ::int / ::numeric)
-- ---------------------------------------------------------------------------
create or replace function private.kamai_rules_error(r jsonb)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  t text;
  v jsonb;
  e record;
  sub text;
begin
  if r is null or jsonb_typeof(r) <> 'object' then return 'rules must be a json object'; end if;
  foreach k in array array['grace_days','pause_dpd','freeze_dpd','writeoff_dpd'] loop
    if r ? k then
      v := r -> k;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric not between 0 and 3650 then return k || ' must be an integer between 0 and 3650'; end if;
    end if;
  end loop;
  foreach k in array array['max_store_exposure_pct_of_tenant','par30_pause_pct'] loop
    if r ? k then
      v := r -> k;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 100 then return k || ' must be a number between 0 and 100'; end if;
    end if;
  end loop;
  if r ? 'tenant_exposure_cap_minor' then
    v := r -> 'tenant_exposure_cap_minor';
    if jsonb_typeof(v) not in ('number','null') then return 'tenant_exposure_cap_minor must be a number or null'; end if;
    if jsonb_typeof(v) = 'number' and ((v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 0 and 9000000000000000)
      then return 'tenant_exposure_cap_minor must be a non-negative integer'; end if;
  end if;
  if r ? 'tiers' then
    if jsonb_typeof(r -> 'tiers') <> 'object' then return 'tiers must be an object'; end if;
    for e in select key, value from jsonb_each(r -> 'tiers') loop
      if e.key !~ '^[0-3]$' or jsonb_typeof(e.value) <> 'object' then return 'tiers keys must be 0..3 with object values'; end if;
      foreach k in array array['limit_minor','tenor_days'] loop
        if e.value ? k then
          v := e.value -> k;
          if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
             or (v #>> '{}')::numeric not between 0 and 9000000000000000 then return 'tiers.' || e.key || '.' || k || ' must be a non-negative integer'; end if;
        end if;
      end loop;
    end loop;
  end if;
  if r ? 'tier_requirements' then
    if jsonb_typeof(r -> 'tier_requirements') <> 'object' then return 'tier_requirements must be an object'; end if;
    for e in select key, value from jsonb_each(r -> 'tier_requirements') loop
      if e.key !~ '^[0-3]$' or jsonb_typeof(e.value) <> 'object' then return 'tier_requirements keys must be 0..3 with object values'; end if;
      foreach k in array array['orders','days','closed','max_dpd_180','on_time'] loop
        if e.value ? k then
          v := e.value -> k;
          if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 100000
             or (k <> 'on_time' and (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)) then
            return 'tier_requirements.' || e.key || '.' || k || ' must be a number in range (integer except on_time)';
          end if;
        end if;
      end loop;
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function private.kamai_rules_error(jsonb) from public, anon;
grant execute on function private.kamai_rules_error(jsonb) to authenticated, service_role;

create or replace function public.kamai_credit_policies_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_err text;
begin
  v_err := private.kamai_rules_error(new.rules);
  if v_err is not null then
    raise exception 'kamai: invalid credit policy: %', v_err using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.kamai_credit_policies_validate() from public, anon, authenticated;
drop trigger if exists kamai_credit_policies_validate on public.kamai_credit_policies;
create trigger kamai_credit_policies_validate before insert or update of rules on public.kamai_credit_policies
  for each row execute function public.kamai_credit_policies_validate();

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

-- ===================== 20261108120009_kamai_storage_wa.sql =====================
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
  if v_role is null then
    -- a lender with an active lender_view link reads proof of delivery for the loan book it finances
    return p_mode = 'read' and exists (select 1 from private.kamai_linked_tenants(array['lender_view']) lt(id) where lt.id = v_t);
  end if;
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
    -- same error as "not allowed": do not reveal whether a store id exists
    raise exception 'kamai: not allowed to change WhatsApp consent of this store' using errcode = '42501';
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

