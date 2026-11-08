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
  created_at        timestamptz not null default now()
);
create unique index if not exists kamai_payments_extref_uidx on public.kamai_payments (tenant_id, lower(external_ref)) where external_ref is not null;
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
  select * into v_a from public.kamai_credit_accounts where store_id = v_o.store_id;

  select coalesce(sum(outstanding_minor), 0) into v_open
  from public.kamai_credit_exposures where store_id = v_o.store_id and status = 'open';
  select coalesce(sum(total_minor), 0) into v_pending
  from public.kamai_orders
  where store_id = v_o.store_id and id <> v_o.id and payment_mode = 'credit'
    and fulfilment_status in ('booked','credit_approved','packed','dispatched');
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
    v_cap := nullif(v_rules ->> 'tenant_exposure_cap_minor', '')::bigint;
    if v_cap is not null then
      select coalesce(sum(outstanding_minor), 0) into v_ten_exp from public.kamai_credit_exposures
      where tenant_id = v_o.tenant_id and status = 'open';
      v_ten_exp := v_ten_exp + coalesce((select sum(total_minor) from public.kamai_orders
        where tenant_id = v_o.tenant_id and id <> v_o.id and payment_mode = 'credit'
          and fulfilment_status in ('booked','credit_approved','packed','dispatched')), 0);
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
  v_order    public.kamai_orders;
  v_pay      public.kamai_payments;
  v_remaining bigint;
  v_alloc    bigint;
  v_x        record;
  v_allocs   jsonb := '[]'::jsonb;
  v_entry    uuid;
  v_new_out  bigint;
begin
  if v_tenant is null or v_amount is null or v_amount <= 0 then
    raise exception 'kamai: tenant_id and a positive amount_minor are required' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_tenant, array['rider','booker','finance','manager','owner'])) then
    raise exception 'kamai: not allowed to record payments' using errcode = '42501';
  end if;
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
  if nullif(p ->> 'order_id', '') is not null then
    select * into v_order from public.kamai_orders where id = (p ->> 'order_id')::uuid and tenant_id = v_tenant and store_id = v_store.id;
    if not found then
      raise exception 'kamai: order not found for this store' using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.kamai_payments
      (tenant_id, store_id, amount_minor, channel, external_ref, reference_code, collected_by, collected_at, evidence_url, notes, order_id)
    values (v_tenant, v_store.id, v_amount, v_channel, v_ext,
            coalesce(nullif(p ->> 'reference_code', ''), v_store.payment_ref_code), (select auth.uid()),
            coalesce(nullif(p ->> 'collected_at', '')::timestamptz, now()), nullif(p ->> 'evidence_url', ''), v_notes, v_order.id)
    returning * into v_pay;
  exception when unique_violation then
    raise exception 'kamai: a payment with external_ref % already exists (DUPLICATE_PAYMENT)', v_ext using errcode = '23505';
  end;

  v_remaining := v_amount;
  for v_x in
    select * from public.kamai_credit_exposures
    where store_id = v_store.id and status = 'open' and outstanding_minor > 0
    order by due_date, origination_date, created_at
    for update
  loop
    exit when v_remaining <= 0;
    v_alloc := least(v_remaining, v_x.outstanding_minor);
    v_new_out := v_x.outstanding_minor - v_alloc;
    insert into public.kamai_payment_allocations (tenant_id, payment_id, exposure_id, amount_minor)
    values (v_tenant, v_pay.id, v_x.id, v_alloc);
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

  -- COD order settled directly
  if v_order.id is not null and v_order.payment_mode = 'cod' and v_order.invoice_id is not null and v_remaining >= v_order.total_minor then
    update public.kamai_invoices set status = 'paid' where id = v_order.invoice_id and status = 'issued';
  end if;

  v_entry := private.kamai_post_entry_core(v_tenant, 'payment:' || v_pay.id, 'payment', v_pay.id::text, v_pay.collected_at,
    'Payment ' || v_channel || ' from ' || v_store.name,
    jsonb_build_array(
      jsonb_build_object('account_code', case when v_channel = 'cash' then '1110' else '1150' end, 'direction', 'debit',
                         'amount_minor', v_amount, 'party_type', 'rider', 'party_id', (select auth.uid())::text),
      jsonb_build_object('account_code', '1200', 'direction', 'credit', 'amount_minor', v_amount,
                         'party_type', 'store', 'party_id', v_store.id::text)));

  perform private.kamai_evaluate_store_core(v_store.id);
  return jsonb_build_object('payment_id', v_pay.id, 'allocated_minor', v_amount - v_remaining,
                            'unallocated_minor', v_remaining, 'allocations', v_allocs, 'ledger_entry_id', v_entry);
end;
$$;
revoke execute on function public.kamai_record_payment(jsonb) from public, anon;
grant execute on function public.kamai_record_payment(jsonb) to authenticated, service_role;

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
        and p.status = 'recorded' and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id)
      order by p.collected_at limit 1;
      if v_pid is not null then
        update public.kamai_bank_lines set match_status = 'auto', matched_payment_id = v_pid, matched_at = now(),
               meta = meta || jsonb_build_object('pass', 1) where id = v_l.id;
        update public.kamai_payments set status = 'matched' where id = v_pid;
        v_pass1 := v_pass1 + 1;
        continue;
      end if;
    end if;
    -- pass 2: external ref equals bank ref or appears in the narration
    select p.id into v_pid from public.kamai_payments p
    where p.tenant_id = v_st.tenant_id and p.external_ref is not null and length(p.external_ref) >= 6
      and p.amount_minor = v_l.amount_minor and p.status = 'recorded'
      and (lower(p.external_ref) = lower(coalesce(v_l.bank_ref, ''))
           or position(lower(p.external_ref) in lower(coalesce(v_l.narration, ''))) > 0)
      and not exists (select 1 from public.kamai_bank_lines b where b.matched_payment_id = p.id)
    order by p.collected_at limit 1;
    if v_pid is not null then
      update public.kamai_bank_lines set match_status = 'auto', matched_payment_id = v_pid, matched_at = now(),
             meta = meta || jsonb_build_object('pass', 2) where id = v_l.id;
      update public.kamai_payments set status = 'matched' where id = v_pid;
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
begin
  select * into v_l from public.kamai_bank_lines where id = p_line_id for update;
  if not found then
    raise exception 'kamai: bank line not found' using errcode = '22023';
  end if;
  if not (select private.kamai_can(v_l.tenant_id, array['owner','manager','finance'])) then
    raise exception 'kamai: not allowed to confirm bank matches' using errcode = '42501';
  end if;
  select * into v_p from public.kamai_payments where id = p_payment_id and tenant_id = v_l.tenant_id;
  if not found then
    raise exception 'kamai: payment not found' using errcode = '22023';
  end if;
  if v_l.match_status <> 'unmatched' then
    raise exception 'kamai: bank line is already %', v_l.match_status using errcode = '22023';
  end if;
  update public.kamai_bank_lines set match_status = 'manual', matched_payment_id = p_payment_id, matched_at = now(),
         matched_by = (select auth.uid()) where id = p_line_id;
  update public.kamai_payments set status = 'verified' where id = p_payment_id;
  return jsonb_build_object('line_id', p_line_id, 'payment_id', p_payment_id, 'match_status', 'manual');
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
  v_expected bigint;
  v_row public.kamai_cash_deposits;
begin
  if not ((select private.kamai_can(p_tenant, array['owner','manager','finance']))
          or (p_rider_user_id = (select auth.uid()) and (select private.kamai_has_role(p_tenant, array['rider'])))) then
    raise exception 'kamai: not allowed to close this cash day' using errcode = '42501';
  end if;
  if p_deposited_minor is null or p_deposited_minor < 0 then
    raise exception 'kamai: deposited amount must be >= 0' using errcode = '22023';
  end if;
  select coalesce(sum(amount_minor), 0) into v_expected from public.kamai_payments
  where tenant_id = p_tenant and collected_by = p_rider_user_id and channel = 'cash'
    and (collected_at at time zone 'Asia/Karachi')::date = p_business_date;
  insert into public.kamai_cash_deposits
    (tenant_id, rider_user_id, business_date, expected_minor, deposited_minor, method, deposit_ref, slip_url, variance_minor, status, notes, created_by)
  values (p_tenant, p_rider_user_id, p_business_date, v_expected, p_deposited_minor, coalesce(p_method, 'bank'), p_deposit_ref, p_slip_url,
          p_deposited_minor - v_expected, case when p_deposited_minor = v_expected then 'submitted' else 'variance' end, p_notes, (select auth.uid()))
  on conflict (tenant_id, rider_user_id, business_date) do update set
    expected_minor = excluded.expected_minor, deposited_minor = excluded.deposited_minor, method = excluded.method,
    deposit_ref = excluded.deposit_ref, slip_url = excluded.slip_url, variance_minor = excluded.variance_minor,
    status = excluded.status, notes = excluded.notes
  returning * into v_row;
  if p_deposited_minor > 0 then
    perform private.kamai_post_entry_core(p_tenant, 'cashdep:' || p_rider_user_id || ':' || p_business_date || ':' || p_deposited_minor,
      'cash_deposit', v_row.id::text, now(), 'Rider cash deposit ' || p_business_date,
      jsonb_build_array(
        jsonb_build_object('account_code', '1150', 'direction', 'debit', 'amount_minor', p_deposited_minor),
        jsonb_build_object('account_code', '1110', 'direction', 'credit', 'amount_minor', p_deposited_minor,
                           'party_type', 'rider', 'party_id', p_rider_user_id::text)));
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke execute on function public.kamai_close_cash_day(uuid, uuid, date, bigint, text, text, text, text) from public, anon;
grant execute on function public.kamai_close_cash_day(uuid, uuid, date, bigint, text, text, text, text) to authenticated, service_role;
