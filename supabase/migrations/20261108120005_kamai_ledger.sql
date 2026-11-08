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
  v_entry := case when tg_table_name = 'kamai_ledger_entries' then new.id else new.entry_id end;
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
create or replace function public.kamai_reverse_entry(p_entry_id uuid, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.kamai_ledger_entries;
  v_new uuid;
begin
  select * into v_e from public.kamai_ledger_entries where id = p_entry_id;
  if not found then
    raise exception 'kamai: entry not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_e.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to reverse ledger entries' using errcode = '42501';
  end if;
  v_new := private.kamai_post_entry_core(v_e.tenant_id, 'reverse:' || p_entry_id, 'reversal', p_entry_id::text, now(),
    coalesce(p_memo, 'Reversal of ' || coalesce(v_e.memo, p_entry_id::text)),
    (select jsonb_agg(jsonb_build_object(
        'account_code', a.code, 'direction', case when l.direction = 'debit' then 'credit' else 'debit' end,
        'amount_minor', l.amount_minor, 'party_type', l.party_type, 'party_id', l.party_id))
     from public.kamai_ledger_lines l join public.kamai_ledger_accounts a on a.id = l.account_id
     where l.entry_id = p_entry_id), p_entry_id);
  return v_new;
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
