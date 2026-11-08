-- Transactional dry-run probe (happy path + RLS). Run as: begin; <all 8 migration files>; <this file>; rollback;
-- Verified on a local PostgreSQL 16 clone of the shared schema (stubbed auth/legacy tables).
-- ===== KAMAI PROBE (runs inside begin ... rollback) =====
do $probe$
declare
  u_dist uuid := '00000000-0000-4000-8000-000000000001';
  u_rider uuid := '00000000-0000-4000-8000-000000000002';
  u_store uuid := '00000000-0000-4000-8000-000000000003';
  u_fake uuid := '00000000-0000-4000-8000-000000000004';
  u_lender uuid := '00000000-0000-4000-8000-000000000005';
  v_apt uuid; v_t2 uuid; v_lend uuid;
  v_total_store uuid; v_cash_store uuid; v_t2_store uuid;
  v_prod uuid; v_prod2 uuid;
  r jsonb; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid;
  d jsonb; code text; n int; b bigint; x record;
  v_fac uuid; v_fin jsonb; v_stmt jsonb; v_pay jsonb;
  v_ref text; v_code text;
begin
  insert into auth.users (id, email) values
    (u_dist, 'dist@test.local'), (u_rider, 'rider@test.local'), (u_store, 'store@test.local'),
    (u_fake, 'fake@test.local'), (u_lender, 'lender@test.local');

  select id into v_apt from public.kamai_tenants where slug = 'apt';
  if v_apt is null then raise exception 'FAIL seed: apt tenant missing'; end if;
  select count(*) into n from public.kamai_tenants where slug in ('kamai','apt');
  if n <> 2 then raise exception 'FAIL seed: expected 2 seeded tenants, got %', n; end if;
  select count(*) into n from public.kamai_stores where tenant_id = v_apt;
  if n < 1 then raise exception 'FAIL import: no stores imported'; end if;
  select count(*) into n from public.kamai_credit_accounts where tenant_id = v_apt;
  if n <> (select count(*) from public.kamai_stores where tenant_id = v_apt) then raise exception 'FAIL import: credit accounts missing'; end if;
  -- idempotent re-import
  r := public.kamai_import_legacy(v_apt);
  if (r->>'stores_created')::int <> 0 or (r->>'products_created')::int <> 0 then raise exception 'FAIL import not idempotent: %', r; end if;

  -- create tenant + members
  v_t2 := public.kamai_create_tenant('dist-test', 'Dist Test', 'distributor', '{}'::jsonb);
  select count(*) into n from public.kamai_ledger_accounts where tenant_id = v_t2;
  if n < 15 then raise exception 'FAIL chart not seeded (%)', n; end if;
  if not exists (select 1 from public.kamai_credit_policies where tenant_id = v_t2) then raise exception 'FAIL policy not seeded'; end if;
  if not exists (select 1 from public.kamai_price_lists where tenant_id = v_t2 and is_default) then raise exception 'FAIL price list not seeded'; end if;
  perform public.kamai_add_member(v_t2, u_fake, 'owner');
  perform public.kamai_add_member(v_t2, u_dist, 'manager');
  insert into public.kamai_stores (tenant_id, name, payment_ref_code) values (v_t2, 'T2 Store', 'KM-DT-0001') returning id into v_t2_store;

  select id into v_total_store from public.kamai_stores where tenant_id = v_apt and name = 'Total';
  select id into v_cash_store from public.kamai_stores where tenant_id = v_apt and name = 'Shell Pump';
  select id into v_prod from public.kamai_products where tenant_id = v_apt and legacy_product_id = 'ADT-001';
  select id into v_prod2 from public.kamai_products where tenant_id = v_apt and legacy_product_id = 'MNK-004';
  update public.kamai_products set tax_rate_pct = 18 where id = v_prod;
  perform public.kamai_add_member(v_apt, u_rider, 'rider');
  perform public.kamai_add_member(v_apt, u_store, 'store', v_total_store);
  perform public.kamai_add_member(v_apt, u_dist, 'booker');

  -- order 1: credit store, approved by policy
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'source', 'booker',
        'payment_mode', 'credit', 'client_order_id', 'c-1', 'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 3))));
  o1 := (r->'order'->>'id')::uuid;
  if r->'order'->>'fulfilment_status' <> 'credit_approved' then raise exception 'FAIL order1 not approved: %', r; end if;
  if (r->'order'->>'tax_minor')::bigint <> round(150050*3*0.18) then raise exception 'FAIL tax math: %', r->'order'; end if;
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'client_order_id', 'c-1',
        'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 3))));
  if (r->>'replayed')::boolean is not true or (r->'order'->>'id')::uuid <> o1 then raise exception 'FAIL idempotent replay: %', r; end if;

  -- order 2: over the limit -> hold, then COD conversion
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'source', 'booker',
        'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 40))));
  o2 := (r->'order'->>'id')::uuid;
  if r->'order'->>'fulfilment_status' <> 'booked' or r->'decision'->>'decision' <> 'hold' or not (r->'decision'->'reason_codes') ? 'LIMIT_EXCEEDED'
    then raise exception 'FAIL order2 should be on hold: %', r; end if;
  d := public.kamai_convert_order_to_cod(o2);
  if d->>'decision' <> 'cod' then raise exception 'FAIL cod conversion %', d; end if;
  if (select fulfilment_status from public.kamai_orders where id = o2) <> 'credit_approved' then raise exception 'FAIL cod order not approved'; end if;
  perform public.kamai_transition_order(o2, 'cancelled', 'test cancel');
  begin
    perform public.kamai_transition_order(o2, 'packed');
    raise exception 'FAIL illegal transition accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.kamai_transition_order(o1, 'delivered');
    raise exception 'FAIL direct delivered accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.kamai_transition_order(o1, 'cancelled', null);
    raise exception 'FAIL cancel without reason accepted';
  exception when sqlstate '22023' then null; end;

  -- cash-only store hold
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_cash_store, 'items', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'qty', 1))));
  if r->'decision'->>'decision' <> 'hold' or not (r->'decision'->'reason_codes') ? 'CASH_ONLY' then raise exception 'FAIL cash-only store should hold: %', r; end if;

  -- fulfilment of order 1
  perform public.kamai_transition_order(o1, 'packed');
  begin
    perform public.kamai_transition_order(o1, 'dispatched');
    raise exception 'FAIL dispatched without rider accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.kamai_assign_rider(o1, u_fake);
    raise exception 'FAIL assigned non-rider';
  exception when sqlstate '22023' then null; end;
  perform public.kamai_assign_rider(o1, u_rider);
  perform public.kamai_transition_order(o1, 'dispatched');
  d := public.kamai_issue_delivery_otp(o1);
  select o.code into v_code from public.kamai_delivery_otps o where o.order_id = o1;
  if v_code !~ '^[0-9]{6}$' then raise exception 'FAIL otp code %', v_code; end if;
  r := public.kamai_confirm_delivery(o1, case when v_code = '000000' then '111111' else '000000' end, 33.7, 73.1, 10, 'p.jpg', 's.png', null, 'Ali', null);
  if (r->>'ok')::boolean is not false or r->>'error' <> 'OTP_INVALID' then raise exception 'FAIL wrong otp: %', r; end if;
  r := public.kamai_confirm_delivery(o1, v_code, 33.70005, 73.10005, 10, 'p.jpg', 's.png', null, 'Ali', null);
  if (r->>'ok')::boolean is not true or (r->>'geofence_ok')::boolean is not true then raise exception 'FAIL confirm: %', r; end if;
  if r->>'invoice_id' is null or r->>'exposure_id' is null or r->>'ledger_entry_id' is null then raise exception 'FAIL confirm outputs: %', r; end if;
  if (select fulfilment_status from public.kamai_orders where id = o1) <> 'delivered' then raise exception 'FAIL not delivered'; end if;
  if exists (select 1 from public.kamai_delivery_otps where order_id = o1) then raise exception 'FAIL otp row kept'; end if;
  select * into x from public.kamai_invoices where order_id = o1;
  if x.display_number <> 'APT-000001' or x.status <> 'issued' or x.total_incl_minor <> (select total_minor from public.kamai_orders where id = o1) then raise exception 'FAIL invoice %', x; end if;
  select count(*) into n from public.kamai_invoice_items where invoice_id = x.id;
  if n <> 1 then raise exception 'FAIL invoice items'; end if;
  select * into x from public.kamai_credit_exposures where order_id = o1;
  if x.status <> 'open' or x.due_date <> (now() at time zone 'Asia/Karachi')::date + 25 or x.outstanding_minor <> (select total_minor from public.kamai_orders where id = o1)
    then raise exception 'FAIL exposure %', x; end if;
  -- ledger balanced and store balance
  select coalesce(sum(case when direction='debit' then amount_minor else -amount_minor end),0) into b from public.kamai_ledger_lines where tenant_id = v_apt;
  if b <> 0 then raise exception 'FAIL ledger unbalanced %', b; end if;
  select balance_minor into b from public.kamai_v_store_balances where store_id = v_total_store;
  if b <> (select total_minor from public.kamai_orders where id = o1) then raise exception 'FAIL store balance %', b; end if;
  -- confirm again must fail
  begin
    perform public.kamai_confirm_delivery(o1, v_code, 33.7, 73.1, 10, 'p', 's', null, 'x', null);
    raise exception 'FAIL double confirm accepted';
  exception when sqlstate '22023' then null; end;

  -- order 3: partial delivery with override (no OTP, no coords)
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store,
        'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 4))));
  o3 := (r->'order'->>'id')::uuid;
  if r->'order'->>'fulfilment_status' <> 'credit_approved' then raise exception 'FAIL order3: %', r; end if;
  perform public.kamai_transition_order(o3, 'packed');
  perform public.kamai_assign_rider(o3, u_rider);
  perform public.kamai_transition_order(o3, 'dispatched');
  r := public.kamai_confirm_delivery(o3, null, null, null, null, null, null,
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'delivered_qty', 2)), 'Ali', 'store shutter jammed, photo to follow');
  if (r->>'ok')::boolean is not true or r->>'delivery_status' <> 'partial' or (r->>'flagged')::boolean is not true then raise exception 'FAIL partial: %', r; end if;
  if (select total_minor from public.kamai_orders where id = o3) <> 150050*2 + round(150050*2*0.18) then raise exception 'FAIL partial repricing'; end if;

  -- payments: full amount of order 1 -> exposure paid, invoice paid
  select total_minor into b from public.kamai_orders where id = o1;
  v_pay := public.kamai_record_payment(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'amount_minor', b, 'channel', 'cash'));
  if (v_pay->>'unallocated_minor')::bigint <> 0 then raise exception 'FAIL payment alloc %', v_pay; end if;
  if (select status from public.kamai_credit_exposures where order_id = o1) <> 'paid' then raise exception 'FAIL exposure not paid'; end if;
  if (select status from public.kamai_invoices where order_id = o1) <> 'paid' then raise exception 'FAIL invoice not paid'; end if;
  if (select status from public.kamai_credit_exposures where order_id = o3) <> 'open' then raise exception 'FAIL exposure3 should be open'; end if;
  begin
    perform public.kamai_record_payment(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'amount_minor', 1000, 'channel', 'raast'));
    raise exception 'FAIL non-cash without ref accepted';
  exception when sqlstate '22023' then null; end;
  -- raast payment then bank statement matching
  select payment_ref_code into v_ref from public.kamai_stores where id = v_total_store;
  v_pay := public.kamai_record_payment(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'amount_minor', 5000, 'channel', 'raast', 'external_ref', 'RAAST-123456'));
  begin
    perform public.kamai_record_payment(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'amount_minor', 5000, 'channel', 'raast', 'external_ref', 'raast-123456'));
    raise exception 'FAIL duplicate external ref accepted';
  exception when sqlstate '23505' then null; end;
  v_stmt := public.kamai_import_bank_lines(jsonb_build_object('tenant_id', v_apt, 'bank_name', 'HBL', 'file_hash', 'h1'),
        jsonb_build_array(jsonb_build_object('line_date', current_date, 'narration', 'RAAST FROM ALI ' || v_ref || ' THANKS', 'amount_minor', 5000, 'bank_ref', 'X1')));
  r := public.kamai_match_bank_lines((v_stmt->>'statement_id')::uuid);
  if (r->>'matched_by_reference')::int <> 1 then raise exception 'FAIL bank match: %', r; end if;
  if (public.kamai_import_bank_lines(jsonb_build_object('tenant_id', v_apt, 'file_hash', 'h1'), '[]'::jsonb)->>'duplicate')::boolean is not true then raise exception 'FAIL statement dedupe'; end if;
  -- cash day close
  d := public.kamai_close_cash_day(v_apt, u_rider, (now() at time zone 'Asia/Karachi')::date, 0, 'bank', null, null, 'test');
  if d->>'status' not in ('submitted','variance') then raise exception 'FAIL cash close %', d; end if;

  -- unbalanced ledger entry rejected
  begin
    perform public.kamai_post_entry(v_apt, 'bad-1', 'test', '1', now(), 'bad',
      jsonb_build_array(jsonb_build_object('account_code', '1100', 'direction', 'debit', 'amount_minor', 100),
                        jsonb_build_object('account_code', '4100', 'direction', 'credit', 'amount_minor', 99)));
    raise exception 'FAIL unbalanced entry accepted';
  exception when sqlstate '23514' then null; end;
  -- idempotent posting and immutability
  b := 0;
  perform public.kamai_post_entry(v_apt, 'ok-1', 'test', '1', now(), 'ok',
      jsonb_build_array(jsonb_build_object('account_code', '1100', 'direction', 'debit', 'amount_minor', 100),
                        jsonb_build_object('account_code', '4100', 'direction', 'credit', 'amount_minor', 100)));
  perform public.kamai_post_entry(v_apt, 'ok-1', 'test', '1', now(), 'ok',
      jsonb_build_array(jsonb_build_object('account_code', '1100', 'direction', 'debit', 'amount_minor', 100),
                        jsonb_build_object('account_code', '4100', 'direction', 'credit', 'amount_minor', 100)));
  select count(*) into n from public.kamai_ledger_entries where tenant_id = v_apt and idempotency_key = 'ok-1';
  if n <> 1 then raise exception 'FAIL idempotent post'; end if;
  begin
    update public.kamai_ledger_lines set amount_minor = 1 where tenant_id = v_apt;
    raise exception 'FAIL ledger update accepted';
  exception when sqlstate '42501' then null; end;
  perform public.kamai_reverse_entry((select id from public.kamai_ledger_entries where tenant_id = v_apt and idempotency_key = 'ok-1'));

  -- dispute flow on order 1
  perform public.kamai_dispute_delivery(o1, 'wrong goods');
  if (select fulfilment_status from public.kamai_orders where id = o1) <> 'disputed' then raise exception 'FAIL dispute'; end if;
  d := public.kamai_resolve_dispute(o1, 'partial credit agreed', 1000);
  if (select fulfilment_status from public.kamai_orders where id = o1) <> 'delivered' then raise exception 'FAIL resolve'; end if;
  if not exists (select 1 from public.kamai_invoices where invoice_type = 'Credit Note' and order_id is null and tenant_id = v_apt) then raise exception 'FAIL credit note'; end if;

  -- financing: lender finances order 3
  v_lend := public.kamai_create_tenant('lend-test', 'Lender Test', 'lender', '{}'::jsonb);
  perform public.kamai_add_member(v_lend, u_lender, 'owner');
  insert into public.kamai_tenant_links (grantor_tenant_id, grantee_tenant_id, kind) values (v_apt, v_lend, 'lender_view');
  insert into public.kamai_facilities (lender_tenant_id, borrower_tenant_id, technique, limit_minor, advance_rate_pct, status)
    values (v_lend, v_apt, 'retailer_purchase_loan', 100000000, 80, 'active') returning id into v_fac;
  v_fin := public.kamai_finance_order(o3, v_fac);
  if (select finance_status from public.kamai_orders where id = o3) <> 'financed' then raise exception 'FAIL financed'; end if;
  v_fin := public.kamai_settle_financing((v_fin->>'id')::uuid, (v_fin->>'disbursed_minor')::bigint);
  if v_fin->>'status' <> 'settled' then raise exception 'FAIL settle %', v_fin; end if;

  -- order 4 dispatched with OTP pending (for RLS probe)
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_total_store, 'items', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'qty', 1))));
  o4 := (r->'order'->>'id')::uuid;
  perform public.kamai_transition_order(o4, 'packed');
  perform public.kamai_assign_rider(o4, u_rider);
  perform public.kamai_transition_order(o4, 'dispatched');
  perform public.kamai_issue_delivery_otp(o4);

  -- daily job, KPIs, views
  d := public.kamai_run_daily();
  if (d->>'snapshots')::int < 1 then raise exception 'FAIL run_daily %', d; end if;
  d := public.kamai_os_kpis();
  if d->'invoices' is null or d->'kamai_tenants' is null or d->'kamai_orders_by_state' is null then raise exception 'FAIL kpis %', d; end if;
  perform 1 from public.kamai_v_par; perform 1 from public.kamai_v_lender_positions; perform 1 from public.kamai_v_collections;
end
$probe$;

-- ===== RLS probe =====
do $rls$
declare
  u_dist uuid := '00000000-0000-4000-8000-000000000001';
  u_rider uuid := '00000000-0000-4000-8000-000000000002';
  u_store uuid := '00000000-0000-4000-8000-000000000003';
  u_fake uuid := '00000000-0000-4000-8000-000000000004';
  u_lender uuid := '00000000-0000-4000-8000-000000000005';
  v_apt uuid; v_t2 uuid; n int; r jsonb; o4 uuid; ok boolean; v_c text; v_store uuid; v_prod2 uuid;
begin
  select id into v_apt from public.kamai_tenants where slug = 'apt';
  select id into v_t2 from public.kamai_tenants where slug = 'dist-test';
  select id into o4 from public.kamai_orders where tenant_id = v_apt and fulfilment_status = 'dispatched';

  -- fake user: owner of dist-test only
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fake, 'role', 'authenticated')::text, true);
  select count(*) into n from public.kamai_tenants;
  if n <> 1 then raise exception 'RLS FAIL fake sees % tenants', n; end if;
  select count(*) into n from public.kamai_stores;
  if n <> 1 then raise exception 'RLS FAIL fake sees % stores', n; end if;
  update public.kamai_tenants set name = 'hacked' where slug = 'apt';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS FAIL fake updated apt'; end if;
  select count(*) into n from public.kamai_delivery_otps;
  if n <> 0 then raise exception 'RLS FAIL fake sees otps'; end if;
  select count(*) into n from public.kamai_orders; if n <> 0 then raise exception 'RLS FAIL orders %', n; end if;
  select count(*) into n from public.kamai_ledger_lines; if n <> 0 then raise exception 'RLS FAIL ledger %', n; end if;
  r := public.kamai_my_context();
  if jsonb_array_length(r->'memberships') <> 1 or (r->>'platform_admin')::boolean then raise exception 'RLS FAIL context %', r; end if;
  begin perform public.kamai_create_tenant('evil','Evil','distributor'); raise exception 'RLS FAIL create_tenant allowed';
  exception when sqlstate '42501' then null; end;
  begin perform public.kamai_os_kpis(); raise exception 'RLS FAIL kpis allowed';
  exception when sqlstate '42501' then null; end;
  begin perform public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', (select id from public.kamai_stores limit 1), 'items', '[{"product_id":"00000000-0000-4000-8000-0000000000ff","qty":1}]'::jsonb)); raise exception 'RLS FAIL foreign order';
  exception when sqlstate '42501' or sqlstate '22023' then null; end;
  begin perform public.kamai_run_daily(); raise exception 'RLS FAIL run_daily allowed';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- store user: sees own store only, and its OTP
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_store, 'role', 'authenticated')::text, true);
  select count(*) into n from public.kamai_stores where tenant_id = v_apt;
  if n <> 1 then raise exception 'RLS FAIL store user sees % stores', n; end if;
  select count(*) into n from public.kamai_delivery_otps;
  if n <> 1 then raise exception 'RLS FAIL store user otps %', n; end if;
  select count(*) into n from public.kamai_orders where store_id <> (select store_id from public.kamai_memberships where user_id = u_store);
  if n <> 0 then raise exception 'RLS FAIL store sees other store orders'; end if;
  select count(*) into n from public.kamai_ledger_lines; if n <> 0 then raise exception 'RLS FAIL store ledger'; end if;
  select code into v_c from public.kamai_delivery_otps where order_id = o4;
  select store_id into v_store from public.kamai_memberships where user_id = u_store;
  select id into v_prod2 from public.kamai_products where tenant_id = v_apt and legacy_product_id = 'MNK-004';
  r := public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', v_store, 'source', 'store_pwa', 'client_order_id', 'pwa-1',
        'items', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'qty', 1))));
  if r->'order'->>'fulfilment_status' <> 'credit_approved' then raise exception 'RLS FAIL store own order %', r; end if;
  begin perform public.kamai_transition_order((r->'order'->>'id')::uuid, 'cancelled', 'changed my mind'); raise exception 'RLS FAIL store cancelled approved order';
  exception when sqlstate '42501' then null; end;
  begin perform public.kamai_submit_order(jsonb_build_object('tenant_id', v_apt, 'store_id', (select id from public.kamai_stores where name = 'Shell Pump'), 'items', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'qty', 1))));
    raise exception 'RLS FAIL store ordered for other store';
  exception when sqlstate '42501' or sqlstate '22023' then null; end;
  begin perform public.kamai_transition_order(o4, 'packed'); raise exception 'RLS FAIL store transition';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- rider: only assigned orders, no otps, no credit data
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rider, 'role', 'authenticated')::text, true);
  select count(*) into n from public.kamai_delivery_otps; if n <> 0 then raise exception 'RLS FAIL rider otps %', n; end if;
  select count(*) into n from public.kamai_orders where rider_user_id is distinct from u_rider; if n <> 0 then raise exception 'RLS FAIL rider sees others orders'; end if;
  select count(*) into n from public.kamai_credit_exposures; if n <> 0 then raise exception 'RLS FAIL rider exposures'; end if;
  r := public.kamai_confirm_delivery(o4, v_c, 33.7, 73.1, 5, 'p.jpg', 's.png', null, 'Ali', null);
  if (r->>'ok')::boolean is not true then raise exception 'RLS FAIL rider confirm %', r; end if;
  r := public.kamai_record_payment(jsonb_build_object('tenant_id', v_apt, 'store_id', v_store, 'amount_minor', 100, 'channel', 'cash'));
  if (r->>'payment_id') is null then raise exception 'RLS FAIL rider payment'; end if;
  begin perform public.kamai_post_entry(v_apt, 'x', 'x', 'x', now(), 'x', '[]'::jsonb); raise exception 'RLS FAIL rider post_entry';
  exception when sqlstate '42501' then null; end;
  reset role;

  -- lender via tenant link: sees apt exposures, financings, not ledger
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_lender, 'role', 'authenticated')::text, true);
  select count(*) into n from public.kamai_v_lender_positions where distributor_tenant_id = v_apt; if n < 1 then raise exception 'RLS FAIL lender positions %', n; end if;
  select count(*) into n from public.kamai_financings; if n <> 1 then raise exception 'RLS FAIL lender financings %', n; end if;
  select count(*) into n from public.kamai_ledger_lines where tenant_id = v_apt; if n <> 0 then raise exception 'RLS FAIL lender ledger'; end if;
  select count(*) into n from public.kamai_wa_messages; if n <> 0 then raise exception 'RLS FAIL lender wa'; end if;
  reset role;

  -- anon cannot touch kamai tables
  set local role anon;
  begin perform 1 from public.kamai_tenants; raise exception 'RLS FAIL anon select';
  exception when insufficient_privilege then null; end;
  reset role;

  -- platform admin sees everything
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', 'ae9b1695-6121-4005-a2a1-08b5db4f8570', 'role', 'authenticated')::text, true);
  select count(*) into n from public.kamai_tenants; if n < 4 then raise exception 'RLS FAIL admin tenants %', n; end if;
  r := public.kamai_os_kpis(); if r->'stores' is null then raise exception 'RLS FAIL admin kpis'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'KAMAI PROBE PASSED';
end
$rls$;
do $p2$
declare v_apt uuid; r jsonb; n int; st text; sid uuid; xid uuid;
begin
  select id into v_apt from public.kamai_tenants where slug='apt';
  update public.kamai_stores set wa_opt_in_at = now(), mobile = '+923001234567' where name = 'Total' and tenant_id = v_apt;
  select store_id, id into sid, xid from public.kamai_credit_exposures where status='open' and tenant_id=v_apt limit 1;
  update public.kamai_credit_exposures set due_date = (now() at time zone 'Asia/Karachi')::date - 3, origination_date = current_date - 28 where id = xid;
  r := public.kamai_run_daily();
  select count(*) into n from public.kamai_dunning_events where exposure_id = xid and offset_days = 3;
  if n <> 1 or (r->>'wa_queued')::int < 1 then raise exception 'P2 FAIL dunning %', r; end if;
  update public.kamai_credit_exposures set due_date = (now() at time zone 'Asia/Karachi')::date - 40 where id = xid;
  r := public.kamai_run_daily();
  select status into st from public.kamai_credit_accounts where store_id = sid;
  if st <> 'frozen' then raise exception 'P2 FAIL expected frozen, got %', st; end if;
  if (select settings->>'credit_paused' from public.kamai_tenants where id = v_apt) <> 'true' then raise exception 'P2 FAIL tenant not paused %', r; end if;
  if not exists (select 1 from public.kamai_credit_events where store_id = sid and to_status='frozen') then raise exception 'P2 FAIL event'; end if;
  if (select par30 from public.kamai_v_par where tenant_id = v_apt) < 0.99 then raise exception 'P2 FAIL par'; end if;
  r := public.kamai_run_daily();
  raise notice 'P2 PASSED %', r;
end $p2$;
