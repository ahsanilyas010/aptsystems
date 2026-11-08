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
  select * into v_f from public.kamai_facilities where id = p_facility_id;
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
begin
  select * into v_fin from public.kamai_financings where id = p_financing_id for update;
  if not found then
    raise exception 'kamai: financing not found' using errcode = '22023';
  end if;
  if not ((select private.kamai_is_platform_admin()) or (select private.kamai_is_server())
          or (select private.kamai_has_role(v_fin.lender_tenant_id, array['owner','manager','finance']))
          or (select private.kamai_has_role(v_fin.tenant_id, array['owner','manager','finance']))) then
    raise exception 'kamai: not allowed to settle this financing' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > v_fin.disbursed_minor - v_fin.repaid_minor then
    raise exception 'kamai: amount must be between 1 and the outstanding financing' using errcode = '22023';
  end if;
  v_new := v_fin.repaid_minor + p_amount_minor;
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
