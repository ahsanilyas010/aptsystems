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
