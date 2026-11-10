-- pgTAP tests for Kamai tenant isolation (not run in CI yet). Run in a database where the kamai migrations are applied:
--   begin; create extension if not exists pgtap with schema extensions; \i supabase/tests/kamai_rls_test.sql
-- Everything runs inside a transaction and is rolled back.
begin;
select plan(106);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'pgtap-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'pgtap-other@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'pgtap-store@test.local'),
  ('00000000-0000-4000-8000-0000000000a4', 'pgtap-manager@test.local'),
  ('00000000-0000-4000-8000-0000000000a5', 'pgtap-bstore@test.local'),
  ('00000000-0000-4000-8000-0000000000a6', 'pgtap-brand@test.local'),
  ('00000000-0000-4000-8000-0000000000a7', 'pgtap-rider@test.local'),
  ('00000000-0000-4000-8000-0000000000a8', 'pgtap-lender@test.local');

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
select is((select count(*)::int from public.kamai_ledger_accounts where tenant_id = (select id from public.kamai_tenants where slug = 'pgtap-a')), 0, 'owner B sees none of tenant A chart of accounts');
reset role;

-- store member of A1
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores), 1, 'store member sees only its own store');
select is((select count(*)::int from public.kamai_ledger_lines), 0, 'store member cannot read ledger lines');
select is((select count(*)::int from public.kamai_delivery_otps), 0, 'no OTP rows visible without an issued OTP');
reset role;

-- ===========================================================================
-- Hardening checks (links, price visibility, owner guards, financing, consent, storage)
-- ===========================================================================
select set_config('request.jwt.claims', '', true);   -- back to a server context after the role switches above
select public.kamai_create_tenant('pgtap-brand', 'PgTap Brand', 'brand');
select public.kamai_create_tenant('pgtap-lender', 'PgTap Lender', 'lender');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a4', 'manager');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a7', 'rider');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-b'), '00000000-0000-4000-8000-0000000000a5', 'store',
  (select id from public.kamai_stores where name = 'Store B1'));
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-brand'), '00000000-0000-4000-8000-0000000000a6', 'owner');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-lender'), '00000000-0000-4000-8000-0000000000a8', 'owner');
-- B holds a lender_view link on A; the brand holds a brand_view link on A
insert into public.kamai_tenant_links (grantor_tenant_id, grantee_tenant_id, kind)
select a.id, b.id, 'lender_view' from public.kamai_tenants a, public.kamai_tenants b where a.slug = 'pgtap-a' and b.slug = 'pgtap-b';
insert into public.kamai_tenant_links (grantor_tenant_id, grantee_tenant_id, kind)
select a.id, b.id, 'brand_view' from public.kamai_tenants a, public.kamai_tenants b where a.slug = 'pgtap-a' and b.slug = 'pgtap-brand';

-- catalog of A: default list, tier-A list assigned to Store A2, one product with a cost price
insert into public.kamai_price_lists (tenant_id, name, tier, is_default)
select id, 'Tier A', 'A', false from public.kamai_tenants where slug = 'pgtap-a';
update public.kamai_stores set price_list_id = (select id from public.kamai_price_lists where name = 'Tier A' and tenant_id = kamai_stores.tenant_id)
where name = 'Store A2';
insert into public.kamai_products (tenant_id, sku, name, trade_price_minor)
select id, 'PGT-1', 'PgTap product', 1000 from public.kamai_tenants where slug = 'pgtap-a';
insert into public.kamai_product_costs (tenant_id, product_id, cost_price_minor)
select tenant_id, id, 700 from public.kamai_products where sku = 'PGT-1';
insert into public.kamai_price_list_items (tenant_id, price_list_id, product_id, price_minor)
select p.tenant_id, l.id, p.id, case when l.is_default then 1000 else 900 end
from public.kamai_products p join public.kamai_price_lists l on l.tenant_id = p.tenant_id where p.sku = 'PGT-1';

insert into public.kamai_price_lists (id, tenant_id, name, tier) select '00000000-0000-4000-8000-0000000000f6', id, 'B list', 'B' from public.kamai_tenants where slug = 'pgtap-b';
select set_config('pgtap.store_a2', (select id::text from public.kamai_stores where name = 'Store A2'), true);

-- financing fixture: A borrows from the lender, 100000 exposure, 50000 of it paid and bank-matched
insert into public.kamai_orders (id, tenant_id, store_id, order_no, fulfilment_status, finance_status, total_minor)
select '00000000-0000-4000-8000-0000000000f1', t.id, s.id, 1, 'delivered', 'financed', 100000
from public.kamai_tenants t join public.kamai_stores s on s.tenant_id = t.id where t.slug = 'pgtap-a' and s.name = 'Store A1';
insert into public.kamai_credit_exposures (id, tenant_id, store_id, order_id, origination_date, due_date, original_minor, outstanding_minor)
select '00000000-0000-4000-8000-0000000000f2', tenant_id, store_id, id, current_date, current_date + 7, 100000, 50000
from public.kamai_orders where id = '00000000-0000-4000-8000-0000000000f1';
insert into public.kamai_facilities (id, lender_tenant_id, borrower_tenant_id, technique, limit_minor, status)
select '00000000-0000-4000-8000-0000000000f3', l.id, a.id, 'retailer_purchase_loan', 1000000, 'active'
from public.kamai_tenants l, public.kamai_tenants a where l.slug = 'pgtap-lender' and a.slug = 'pgtap-a';
insert into public.kamai_financings (id, tenant_id, lender_tenant_id, facility_id, order_id, exposure_id, disbursed_minor, due_date)
select '00000000-0000-4000-8000-0000000000f4', a.id, l.id, '00000000-0000-4000-8000-0000000000f3',
       '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', 80000, current_date + 7
from public.kamai_tenants l, public.kamai_tenants a where l.slug = 'pgtap-lender' and a.slug = 'pgtap-a';
insert into public.kamai_payments (id, tenant_id, store_id, amount_minor, channel, status)
select '00000000-0000-4000-8000-0000000000f5', tenant_id, store_id, 50000, 'raast', 'matched'
from public.kamai_orders where id = '00000000-0000-4000-8000-0000000000f1';
insert into public.kamai_payment_allocations (tenant_id, payment_id, exposure_id, amount_minor)
select tenant_id, '00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f2', 50000
from public.kamai_orders where id = '00000000-0000-4000-8000-0000000000f1';

-- manager of A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select throws_ok($$select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a1', 'viewer')$$,
  '42501', null, 'manager cannot demote an owner via kamai_add_member');
select throws_ok($$select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-a'), '00000000-0000-4000-8000-0000000000a5', 'owner')$$,
  '42501', null, 'manager cannot grant owner');
reset role;

-- owner of A: platform-controlled fields, poisoning, policy validation
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$update public.kamai_tenants set status = 'suspended' where slug = 'pgtap-a'$$, '42501', null, 'owner cannot change tenant status');
select throws_ok($$update public.kamai_tenants set settings = settings || '{"credit_paused":"false"}' where slug = 'pgtap-a'$$, '42501', null, 'owner cannot touch credit_paused');
select lives_ok($$update public.kamai_tenants set settings = settings || '{"geofence_radius_m":200}' where slug = 'pgtap-a'$$, 'owner can edit operational settings');
select throws_ok($$insert into public.kamai_price_list_items (tenant_id, price_list_id, product_id, price_minor)
  select p.tenant_id, '00000000-0000-4000-8000-0000000000f6', p.id, 0 from public.kamai_products p where p.sku = 'PGT-1'$$, '23503', null,
  'price list item cannot reference another tenant price list');
select throws_ok($$insert into public.kamai_credit_policies (tenant_id, name, version, rules)
  values ((select id from public.kamai_tenants where slug = 'pgtap-a'), 'bad', 99, '{"pause_dpd":"abc"}')$$, '22023', null, 'malformed credit policy is rejected');
select is((select count(*)::int from public.kamai_product_costs), 1, 'owner reads product costs');
select throws_ok($$select public.kamai_settle_financing('00000000-0000-4000-8000-0000000000f4', 10000)$$, '42501', null, 'borrower cannot settle its own financing');
reset role;

-- store member of A1: prices, costs, consent
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_product_costs), 0, 'store member cannot read cost prices');
select is((select count(*)::int from public.kamai_price_list_items), 1, 'store member reads only the default list (own store has no tier list)');
select is((select count(*)::int from public.kamai_price_lists), 1, 'store member sees only the default price list');
select lives_ok($$select public.kamai_set_wa_opt_in((select id from public.kamai_stores where name = 'Store A1'), true, 'store_app')$$, 'store member opts in own store');
select is((select (wa_opt_in_at is not null) from public.kamai_stores where name = 'Store A1'), true, 'opt-in timestamp stored');
select throws_ok($$select public.kamai_set_wa_opt_in(current_setting('pgtap.store_a2')::uuid, true)$$, '42501', null, 'store member cannot change another store consent');
reset role;

-- store member of B, owner of B (lender_view grantee) and brand owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores where name like 'Store A%'), 0, 'store member of a grantee tenant cannot read grantor stores');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores where name like 'Store A%'), 2, 'owner of a lender_view grantee reads grantor stores');
select is((select count(*)::int from public.kamai_price_list_items), 0, 'lender_view link does not expose price lists');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores where name like 'Store A%'), 0, 'brand_view link does not expose stores');
select is((select count(*)::int from public.kamai_payments), 0, 'brand_view link does not expose payments');
select lives_ok($$select * from public.kamai_brand_sellthrough(30)$$, 'brand can call the sell-through RPC');
reset role;

-- lender: repayment must be covered by verified payments
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
select throws_ok($$select public.kamai_settle_financing('00000000-0000-4000-8000-0000000000f4', 60000)$$, '22023', null, 'repayment above verified payments is rejected');
select lives_ok($$select public.kamai_settle_financing('00000000-0000-4000-8000-0000000000f4', 50000)$$, 'repayment covered by a matched payment is accepted');
reset role;

-- rider: proof storage is limited to the own tenant folder
insert into storage.buckets (id, name, public) values ('kamai-pod', 'kamai-pod', false) on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('kamai-pod', '%s/cash/2026-01-01/slip.jpg', auth.uid())$$,
  (select id from public.kamai_tenants where slug = 'pgtap-a')), 'rider uploads a cash slip in the own tenant folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('kamai-pod', '%s/cash/2026-01-01/slip.jpg', auth.uid())$$,
  (select id from public.kamai_tenants where slug = 'pgtap-b')), '42501', null, 'rider cannot upload into another tenant folder');
reset role;

-- suspended tenants lose access
select set_config('request.jwt.claims', '', true);
update public.kamai_tenants set status = 'suspended' where slug = 'pgtap-b';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_stores), 0, 'owner of a suspended tenant reads nothing');
reset role;

-- anon has no table access
set local role anon;
select throws_ok($$select 1 from public.kamai_tenants$$, '42501', null, 'anon cannot select kamai_tenants');
reset role;

-- ===========================================================================
-- Migration 010: distributor onboarding, product review, hidden platform margin
-- ===========================================================================
select set_config('request.jwt.claims', '', true);   -- server context
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'pgtap-dist@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'pgtap-admin@test.local'),
  ('00000000-0000-4000-8000-0000000000b3', 'pgtap-dstore@test.local'),
  ('00000000-0000-4000-8000-0000000000b4', 'pgtap-dbooker@test.local');
insert into public.kamai_platform_admins (user_id, note) values ('00000000-0000-4000-8000-0000000000b2', 'pgtap admin');
select is((select count(*)::int from public.kamai_tenants where slug in ('apt','kamai') and settings ->> 'onboarding_status' = 'approved'), 2,
  'seeded tenants apt and kamai are approved by the migration');
select is((select count(*)::int from public.kamai_products where tenant_id = (select id from public.kamai_tenants where slug = 'apt') and listing_status <> 'approved'), 0,
  'existing products stay approved');

-- what the signup API does (service role): tenant with pending_review + owner membership + notification
select public.kamai_create_tenant('pgtap-d', 'PgTap Dist', 'distributor',
  '{"onboarding_status":"pending_review","signup":{"contact_name":"Dee","mobile":"+923001234567","city":"Lahore","email":"d@x.pk","source":"self_signup"}}');
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-d'), '00000000-0000-4000-8000-0000000000b1', 'owner');
insert into public.kamai_stores (tenant_id, name, payment_ref_code)
select id, 'Store D1', 'KM-PGD-0001' from public.kamai_tenants where slug = 'pgtap-d';
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-d'), '00000000-0000-4000-8000-0000000000b3', 'store',
  (select id from public.kamai_stores where name = 'Store D1'));
select public.kamai_add_member((select id from public.kamai_tenants where slug = 'pgtap-d'), '00000000-0000-4000-8000-0000000000b4', 'booker');
insert into public.kamai_admin_notifications (kind, tenant_id, payload)
select 'distributor_signup', id, '{"company":"PgTap Dist"}' from public.kamai_tenants where slug = 'pgtap-d';

-- distributor owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select lives_ok($$insert into public.kamai_products (tenant_id, sku, name, trade_price_minor, listing_status, review_note, reviewed_at)
  select id, s.sku, s.nm, s.pr, 'approved', 'fake note', now() from public.kamai_tenants,
    (values ('D-1', 'Soap', 10001), ('D-2', 'Shampoo', 5000), ('D-3', 'Cream', 700)) s(sku, nm, pr) where slug = 'pgtap-d'$$,
  'distributor owner inserts products');
select is((select count(*)::int from public.kamai_products where sku like 'D-%' and listing_status = 'draft' and review_note is null and reviewed_at is null), 3,
  'client inserts are forced to draft and cannot pre-set review fields');
select is((select count(*)::int from public.kamai_product_margins), 0, 'distributor reads no margins');
select throws_ok($$insert into public.kamai_product_margins (product_id, tenant_id, margin_pct)
  select id, tenant_id, 10 from public.kamai_products where sku = 'D-1'$$, '42501', null, 'distributor cannot write margins');
select is((select count(*)::int from public.kamai_admin_notifications), 0, 'distributor reads no admin notifications');
select throws_ok($$insert into public.kamai_admin_notifications (kind, payload) values ('distributor_signup', '{}')$$, '42501', null,
  'clients cannot insert notifications');
select throws_ok($$select 1 from public.kamai_signup_log$$, '42501', null, 'clients cannot read the signup log');
select throws_ok($$update public.kamai_tenants set settings = settings || '{"onboarding_status":"approved"}' where slug = 'pgtap-d'$$, '42501', null,
  'owner cannot change onboarding_status');
select throws_ok($$update public.kamai_tenants set settings = jsonb_set(settings, '{signup,city}', '"X"') where slug = 'pgtap-d'$$, '42501', null,
  'owner cannot edit settings.signup');
select lives_ok($$update public.kamai_tenants set name = 'PgTap Dist Ltd' where slug = 'pgtap-d'$$, 'owner can still rename the tenant');
select throws_ok($$update public.kamai_products set listing_status = 'approved' where sku = 'D-1'$$, '42501', null,
  'owner cannot approve a product directly');
select throws_ok($$select public.kamai_review_product((select id from public.kamai_products where sku = 'D-1'), 'approve', 10)$$, '42501', null,
  'non admin cannot call kamai_review_product');
select throws_ok($$select public.kamai_review_products_bulk(array[(select id from public.kamai_products where sku = 'D-1')], 'approve', 10)$$, '42501', null,
  'non admin cannot call kamai_review_products_bulk');
select throws_ok($$select public.kamai_review_distributor((select id from public.kamai_tenants where slug = 'pgtap-d'), 'approve')$$, '42501', null,
  'non admin cannot call kamai_review_distributor');
select throws_ok($$select * from public.kamai_review_queue()$$, '42501', null, 'non admin cannot call kamai_review_queue');
select throws_ok($$select public.kamai_mark_notifications_read(array[gen_random_uuid()])$$, '42501', null, 'non admin cannot mark notifications read');
select is((public.kamai_submit_products(array[(select id from public.kamai_products where sku = 'D-1'), (select id from public.kamai_products where sku = 'D-2')]) ->> 'submitted')::int, 2,
  'owner submits two drafts');
select is((select original ->> 'name' || ':' || (original ->> 'price_minor') from public.kamai_products where sku = 'D-1'), 'Soap:10001', 'submit snapshots the original');
select is((public.kamai_submit_products(array[(select id from public.kamai_products where sku = 'D-1')]) ->> 'submitted')::int, 0,
  'an already submitted product is not submitted twice');
update public.kamai_products set name = 'Shampoo 2' where sku = 'D-2';
select is((select listing_status from public.kamai_products where sku = 'D-2'), 'draft', 'editing a submitted product sends it back to draft');
select is((public.kamai_submit_products(array[(select id from public.kamai_products where sku = 'D-2')]) ->> 'submitted')::int, 1, 'owner resubmits the edited product');
reset role;

select is((select count(*)::int from public.kamai_admin_notifications where kind = 'products_submitted'
           and tenant_id = (select id from public.kamai_tenants where slug = 'pgtap-d')), 2, 'one notification per submission call');
select is((select payload ->> 'count' || ':' || (payload ->> 'tenant_name') || ':' || jsonb_array_length(payload -> 'product_names') from public.kamai_admin_notifications
           where kind = 'products_submitted' order by (payload ->> 'count')::int desc limit 1), '2:PgTap Dist Ltd:2', 'notification payload carries count, tenant name and product names');

-- another tenant's owner cannot submit them
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.kamai_submit_products(array[(select id from public.kamai_products where sku = 'D-3')])$$, '42501', null,
  'owner of another tenant cannot submit these products');
reset role;

-- store and booker of the distributor see nothing yet
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_products where sku like 'D-%'), 0, 'store member sees no unapproved product');
reset role;

-- platform admin: review
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select is((select onboarding_status || ':' || submitted_count from public.kamai_review_queue() where slug = 'pgtap-d'), 'pending_review:2', 'queue lists the pending distributor');
select is((select (public.kamai_review_product((select id from public.kamai_products where sku = 'D-1'), 'approve', 12.5,
  '{"name":"Soap Deluxe","bogus":"x"}', 'ok') ->> 'final_price_minor')::bigint), 11252::bigint, 'approve computes ceil(price*(1+margin/100))');
select is((select name from public.kamai_products where sku = 'D-1'), 'Soap Deluxe', 'admin patch edits the product');
select is((select margin_pct::text from public.kamai_product_margins where product_id = (select id from public.kamai_products where sku = 'D-1')), '12.50', 'margin is stored');
select is((select price_minor from public.kamai_price_list_items i join public.kamai_price_lists l on l.id = i.price_list_id and l.is_default
           where i.product_id = (select id from public.kamai_products where sku = 'D-1') and i.managed), 11252::bigint,
  'approval publishes to the default price list at the final price');
select throws_ok($$select public.kamai_review_product((select id from public.kamai_products where sku = 'D-1'), 'approve', 900)$$, '22023', null, 'margin above 500 is rejected');
select throws_ok($$select public.kamai_review_product((select id from public.kamai_products where sku = 'D-2'), 'request_changes')$$, '22023', null, 'request_changes needs a note');
select is((public.kamai_review_products_bulk(array[(select id from public.kamai_products where sku = 'D-2'), gen_random_uuid()], 'request_changes', null, 'add a photo') ->> 'done')::int
          * 10 + (public.kamai_review_products_bulk(array[gen_random_uuid()], 'reject', null, 'x') ->> 'failed')::int, 11, 'bulk review counts done and failed');
select is((select listing_status from public.kamai_products where sku = 'D-2'), 'changes_requested', 'bulk request_changes applied');
select is((select count(*)::int from public.kamai_product_margins), 1, 'admin reads margins');
select is((select count(*)::int from public.kamai_admin_notifications), 3, 'admin reads notifications');
select is(public.kamai_mark_notifications_read(array(select id from public.kamai_admin_notifications)), 3, 'admin marks notifications read');
select is((select onboarding_status from public.kamai_review_queue() where slug = 'pgtap-d') || ':' ||
          (select approved_count from public.kamai_review_queue() where slug = 'pgtap-d'), 'pending_review:1', 'queue counts approved products');
select is(public.kamai_review_distributor((select id from public.kamai_tenants where slug = 'pgtap-d'), 'approve') ->> 'onboarding_status', 'approved', 'admin approves the account');
reset role;

-- store and booker now see exactly the approved product, and the final price only
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_products where sku like 'D-%'), 1, 'store member sees only the approved product');
select is((select price_minor from public.kamai_price_list_items), 11252::bigint, 'store member reads the default list price');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_products where sku like 'D-%'), 1, 'booker sees only the approved product');
reset role;

-- distributor owner again: status and note visible, margin and final price not
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_products where sku like 'D-%'), 3, 'owner sees every status of its own products');
select is((select review_note from public.kamai_products where sku = 'D-2'), 'add a photo', 'owner sees the review note');
select is((select count(*)::int from public.kamai_price_list_items), 0, 'owner cannot read the marked-up price list rows');
select is((select count(*)::int from public.kamai_audit_log where table_name = 'kamai_price_list_items'), 0, 'audit log hides marked-up price rows');
select is((select count(*)::int from public.kamai_product_margins), 0, 'owner still reads no margins');
select throws_ok($$insert into public.kamai_price_list_items (tenant_id, price_list_id, product_id, price_minor)
  select i.tenant_id, i.price_list_id, i.product_id, 1 from public.kamai_products p, lateral (select tenant_id, (select id from public.kamai_price_lists where tenant_id = p.tenant_id and is_default) price_list_id, p.id product_id) i
  where p.sku = 'D-1'$$, '42501', null, 'owner cannot price a margin-managed product');
select throws_ok($$insert into public.kamai_price_list_items (tenant_id, price_list_id, product_id, price_minor)
  select p.tenant_id, (select id from public.kamai_price_lists where tenant_id = p.tenant_id and is_default), p.id, 1 from public.kamai_products p where p.sku = 'D-3'$$,
  '42501', null, 'owner cannot price an unapproved product');
update public.kamai_products set trade_price_minor = 1 where sku = 'D-2';
select is((select listing_status from public.kamai_products where sku = 'D-2'), 'changes_requested', 'editing a changes_requested product keeps its status');
update public.kamai_products set trade_price_minor = 20000 where sku = 'D-1';
select is((select listing_status from public.kamai_products where sku = 'D-1'), 'draft', 'editing an approved product pulls it out of the catalog');
reset role;
select is((select count(*)::int from public.kamai_price_list_items where product_id = (select id from public.kamai_products where sku = 'D-1')), 0, 'unpublished product leaves the price list');
select is((select count(*)::int from public.kamai_product_margins where product_id = (select id from public.kamai_products where sku = 'D-1')), 1, 'margin survives an unpublish');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select is((select count(*)::int from public.kamai_products where sku like 'D-%'), 0, 'store member no longer sees the edited product');
reset role;

-- rejected accounts cannot submit
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select is(public.kamai_review_distributor((select id from public.kamai_tenants where slug = 'pgtap-d'), 'reject', 'no') ->> 'onboarding_status', 'rejected', 'admin rejects the account');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select public.kamai_submit_products(array[(select id from public.kamai_products where sku = 'D-3')])$$, '42501', null, 'rejected account cannot submit');
reset role;

-- storage: public read, tenant-prefix isolation, admin anywhere
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('kamai-product-images', '%s/a.jpg', auth.uid())$$,
  (select id from public.kamai_tenants where slug = 'pgtap-d')), 'owner uploads into the own tenant folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('kamai-product-images', '%s/a.jpg', auth.uid())$$,
  (select id from public.kamai_tenants where slug = 'pgtap-a')), '42501', null, 'owner cannot upload into another tenant folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('kamai-product-images', 'loose.jpg', auth.uid())$$, '42501', null, 'owner cannot upload outside a tenant folder');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('kamai-product-images', '%s/b.jpg', auth.uid())$$,
  (select id from public.kamai_tenants where slug = 'pgtap-d')), '42501', null, 'store member cannot upload product images');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('kamai-product-images', 'misc/x.png', auth.uid())$$, 'platform admin uploads anywhere in the bucket');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'kamai-product-images'), 2, 'product images are publicly readable');
reset role;

select * from finish();
rollback;
