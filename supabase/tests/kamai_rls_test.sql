-- pgTAP tests for Kamai tenant isolation (not run in CI yet). Run in a database where the kamai migrations are applied:
--   begin; create extension if not exists pgtap with schema extensions; \i supabase/tests/kamai_rls_test.sql
-- Everything runs inside a transaction and is rolled back.
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'pgtap-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'pgtap-other@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'pgtap-store@test.local');

select lives_ok($$select public.kamai_create_tenant('pgtap-a', 'PgTap A', 'distributor')$$, 'platform context can create tenant A');
select lives_ok($$select public.kamai_create_tenant('pgtap-b', 'PgTap B', 'distributor')$$, 'platform context can create tenant B');

insert into public.kamai_stores (tenant_id, name, payment_ref_code)
select id, 'Store A1', 'KM-PGA-0001' from public.kamai_tenants where slug = 'pgtap-a';
insert into public.kamai_stores (tenant_id, name, payment_ref_code)
select id, 'Store A2', 'KM-PGA-0002' from public.kamai_tenants where slug = 'pgtap-a';
insert into public.kamai_stores (tenant_id, name, payment_ref_code)
select id, 'Store B1', 'KM-PGB-0001' from public.kamai_tenants where slug = 'pgtap-b';

select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a1', 'owner');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-b'), '00000000-0000-4000-8000-0000000000a2', 'owner');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a3', 'store',
  (select id from public.kamai_stores where name = 'Store A1'));

-- owner of A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_tenants), 1, 'owner A sees only tenant A');
select is((select count(*)::int from public.kamai_stores), 2, 'owner A sees both A stores, none of B');
select is((select count(*)::int from public.kamai_audit_log where tenant_id <> (select id from public.kamai_tenants where slug = 'pgtap-a')), 0, 'owner A sees no other tenant audit rows');
select throws_ok($$select public.kamai_create_tenant('pgtap-evil', 'Evil', 'distributor')$$, '42501', null, 'non platform admin cannot create tenants');
select throws_ok($$select public.kamai_os_kpis()$$, '42501', null, 'non platform admin cannot read OS KPIs');
select is((select (public.kamai_my_context() ->> 'platform_admin')::boolean), false, 'context says not platform admin');
select is((select jsonb_array_length(public.kamai_my_context() -> 'memberships')), 1, 'context lists exactly one membership');
reset role;

-- owner of B cannot touch A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores), 1, 'owner B sees only B stores');
with u as (update public.kamai_tenants set name = 'hacked' where slug = 'pgtap-a' returning 1) select is((select count(*)::int from u), 0, 'owner B cannot update tenant A');
select is((select count(*)::int from public.kamai_ledger_accounts), 19, 'owner B sees only its own chart of accounts');
reset role;

-- store member of A1
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores), 1, 'store member sees only its own store');
select is((select count(*)::int from public.kamai_ledger_lines), 0, 'store member cannot read ledger lines');
select is((select count(*)::int from public.kamai_delivery_otps), 0, 'no OTP rows visible without an issued OTP');
reset role;

-- anon has no table access
set local role anon;
select throws_ok($$select 1 from public.kamai_tenants$$, '42501', null, 'anon cannot select kamai_tenants');
reset role;

select * from finish();
rollback;
