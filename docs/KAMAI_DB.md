# Kamai OS database

Source of truth: `supabase/migrations/20261108120001..9_kamai_*.sql` (+ 010 below). Types: `src/kamai/lib/db-types.ts`.
Every object is prefixed `kamai_` (RLS helpers live in schema `private`). No existing table, enum, function, trigger,
policy or bucket of the shared project is touched (the only new bucket is `kamai-pod`). Money is `bigint` minor units (paisa). Status columns are `text` + CHECK.

## Apply procedure

Do not run `supabase db push` (the live `schema_migrations` history does not match this repo). Apply the files in
order through the Supabase connector `apply_migration`, one call per file, using the file name without the timestamp
prefix as the name (`kamai_core`, `kamai_catalog_stores`, `kamai_orders_delivery`, `kamai_invoices`, `kamai_ledger`,
`kamai_credit_payments`, `kamai_financing_comms`, `kamai_os_seed_cron`, `kamai_storage_wa`). All files are idempotent, so a failed run can
be repeated. Files 003 to 006 reference each other at runtime only (plpgsql is late bound), so apply files 001 to 008 before
exercising any RPC. File 008 seeds tenants `kamai` and `apt`, imports legacy stores/products into `apt`, seeds
`kamai_os_tasks` and registers the pg_cron job. Verify afterwards:
`select count(*) from kamai_tenants;` (2), `select jobname, schedule from cron.job where jobname = 'kamai-daily';`,
`select kamai_os_kpis();` (as a platform admin) and run `supabase/tests/kamai_rls_test.sql` where pgTAP exists.

Roles: platform admin = row in `kamai_platform_admins` or legacy `user_roles.role = 'admin'`.
"Server" = no end-user JWT (postgres, pg_cron, service_role). Tenant roles: owner, manager, booker, finance, viewer, rider, store.

## Tables

Tenancy: `kamai_tenants` tenants (platform, distributor, brand, lender, vertical); `kamai_memberships` user to tenant role and optional store scope;
`kamai_platform_admins` platform operators; `kamai_tenant_links` cross-tenant read grants (lender_view, brand_view, supplier; see Link semantics);
`kamai_invites` hashed invite tokens; `kamai_counters` per-tenant gapless counters (order, invoice, store_ref).
Catalog and stores: `kamai_products` SKUs with FBR/GTIN/tax fields; `kamai_price_lists`; `kamai_price_list_items`; `kamai_product_costs` distributor cost price (owner, manager, finance only; split out of `kamai_products`, which has no `cost_price_minor` column); `kamai_stores` retail customers with credit terms and payment reference code; `kamai_store_imports` CSV import log.
Orders and delivery: `kamai_orders` order header and state; `kamai_order_items` lines (delivered_qty, tax per line); `kamai_order_events` append-only state log;
`kamai_delivery_proofs` OTP hash, GPS/geofence, photo, signature, dispute window; `kamai_delivery_otps` plain OTP readable by the store and platform admins only.
Invoices: `kamai_invoices` gapless FBR-ready invoices, debit and credit notes; `kamai_invoice_items` invoice lines.
Ledger: `kamai_ledger_accounts` chart of accounts per tenant; `kamai_ledger_entries` immutable journal headers (idempotency key); `kamai_ledger_lines` immutable debit/credit lines with party sub-ledger (deferred balance trigger).
Credit: `kamai_credit_policies` versioned rules jsonb; `kamai_credit_accounts` per-store tier/limit/status; `kamai_credit_decisions` per-order decisions with reason codes;
`kamai_credit_exposures` invoice-level receivables (FIFO allocation target); `kamai_credit_snapshots` nightly per-store DPD/outstanding (source of PAR); `kamai_credit_events` append-only tier/status changes.
Payments: `kamai_payments` recorded collections; `kamai_payment_allocations` FIFO allocation to exposures; `kamai_bank_statements` and `kamai_bank_lines` imported bank lines and match state;
`kamai_cash_deposits` rider day close; `kamai_dunning_rules` offsets (-3, 0, 3, 7, 15, 30); `kamai_dunning_events` one per exposure per step.
Financing: `kamai_facilities` lender facilities; `kamai_financings` per-order advances and repayments.
Comms: `kamai_wa_contacts` opt-in registry; `kamai_wa_messages` WhatsApp outbox/inbox (status `queued` is the outbox); `kamai_wa_templates` template registry.
OS and audit: `kamai_os_tasks` Kamai OS task list (t1..t8 command, g1..g6 gaps); `kamai_kpi_snapshots` daily metrics jsonb; `kamai_audit_log` append-only row-version log
(triggers on tenants, memberships, products, price_list_items, stores, orders, credit_accounts, payments, facilities, financings, ledger_accounts).

Cross-tenant references are enforced by the schema: `kamai_price_list_items` and `kamai_stores.price_list_id` use composite FKs `(tenant_id, id)` so a list or product of another tenant cannot be referenced, and triggers check that `store_id` on memberships/invites belongs to the tenant and that `products.brand_tenant_id` is a `brand` tenant.

Direct writes by `authenticated` are allowed (subject to RLS) only on: tenants (update), memberships, platform_admins, tenant_links, invites, products, price lists and items, stores, store_imports,
credit_policies (rules validated by trigger), credit_accounts (update), dunning_rules, facilities (platform admin), wa_contacts, wa_templates, os_tasks, product_costs. Owners may update their tenant row but a trigger blocks `status`, `type`, `slug`, `settings.credit_paused*` (platform admin only) and `invoice_prefix` once invoices exist. Suspended or archived tenants lose all membership based access (platform admins and the server are unaffected). Everything else is written by SECURITY DEFINER functions.

## Link semantics (kamai_tenant_links)

`private.kamai_readable_tenants()` = the caller's own active tenants plus grantors of an active **lender_view** link, and only when the caller holds
owner, manager, finance or viewer in the grantee tenant (store, rider and booker members of a grantee never read the grantor). The `scope` column is reserved and
not enforced in v1. Kinds:

- `lender_view`: the loan-book tables that use the generic read set (stores, orders, invoices, credit accounts/exposures/decisions/snapshots, payments, cash deposits). No catalog prices.
- `brand_view`: no direct table access. The brand reads its own SKUs (`products.brand_tenant_id`, plus the price list items of those products) and delivered sell-through only through `kamai_brand_sellthrough(p_days)`, which returns delivered lines of its SKUs with an opaque store id and area, and only for distributors that granted the link.
- `supplier`: catalog and price lists of the grantor (products, price lists, price list items), nothing else.

Price visibility: owner, manager, booker, finance, viewer of the tenant see all price lists; a `store` member sees the default list and the list assigned to its own store; riders see no price lists. Cost prices live in `kamai_product_costs`.

## Views (security_invoker = true, caller RLS applies)

`kamai_ledger_balances` (balance per account), `kamai_v_lender_positions` (loan tape: one row per exposure),
`kamai_v_par` (outstanding, PAR 7/30/60/90 from the latest snapshot per tenant), `kamai_v_collections` (per tenant per day sums),
`kamai_v_store_balances` (receivable per store from the ledger).

## RPCs (public schema, SECURITY DEFINER, `search_path = ''`)

| Function | Returns | Who may call |
|---|---|---|
| `kamai_my_context()` | jsonb `{user_id, platform_admin, legacy_roles, memberships[]}` | any authenticated |
| `kamai_create_tenant(p_slug, p_name, p_type, p_settings = '{}')` | uuid | platform admin / server |
| `kamai_add_member(p_tenant, p_user, p_role, p_store_id = null)` | jsonb membership | platform admin, owner, manager. Only owners/admin/server may grant owner or modify an existing owner; the last active owner cannot be demoted |
| `kamai_submit_order(p jsonb)` | `{order, decision, replayed}` | store (own store), booker, manager, owner, platform admin |
| `kamai_transition_order(p_order_id, p_to_state, p_reason = null, p_meta = '{}')` | order | booker, manager, owner, admin; store may cancel own booked orders; manual credit override manager/owner |
| `kamai_assign_rider(p_order_id, p_rider_user_id)` | order | owner, manager, booker, admin |
| `kamai_convert_order_to_cod(p_order_id)` | decision | owner, manager, booker, admin |
| `kamai_credit_decide(p_order_id)` | decision | owner, manager, booker, finance, admin |
| `kamai_issue_delivery_otp(p_order_id)` | `{expires_at}` | assigned rider, owner, manager, booker, admin |
| `kamai_confirm_delivery(p_order_id, p_otp, p_lat, p_lng, p_accuracy_m, p_photo_url, p_signature_url, p_items, p_receiver_name, p_override_reason)` | `{ok, ...}` | assigned rider, owner, manager, admin |
| `kamai_dispute_delivery(p_order_id, p_reason)` | proof | the store member, inside the dispute window |
| `kamai_resolve_dispute(p_order_id, p_resolution, p_credit_minor = 0)` | `{order_id, credit_minor, credit_note_id}` | owner, manager, admin |
| `kamai_issue_invoice(p_order_id)` | uuid | owner, manager, booker, finance, admin |
| `kamai_evaluate_store(p_store_id)` | jsonb | owner, manager, finance, admin |
| `kamai_store_outstanding(p_store_id)` | bigint | any (RLS scoped) |
| `kamai_record_payment(p jsonb)` | `{payment_id, allocated_minor, unallocated_minor, allocations, ledger_entry_id}` | rider, booker, finance, manager, owner, admin |
| `kamai_import_bank_lines(p_statement, p_lines)` | `{statement_id, inserted, duplicate}` | owner, manager, finance, admin |
| `kamai_match_bank_lines(p_statement_id)` | counts jsonb | owner, manager, finance, admin |
| `kamai_confirm_bank_match(p_line_id, p_payment_id)` | jsonb | owner, manager, finance, admin |
| `kamai_close_cash_day(p_tenant, p_rider_user_id, p_business_date, p_deposited_minor, p_method, p_deposit_ref, p_slip_url, p_notes)` | cash deposit row | the rider for own day; owner, manager, finance, admin |
| `kamai_post_entry(p_tenant, p_key, p_source_type, p_source_id, p_effective_at, p_memo, p_lines)` | uuid entry | owner, manager, finance, admin |
| `kamai_reverse_entry(p_entry_id, p_memo = null)` | uuid | owner, manager, finance, admin |
| `kamai_finance_order(p_order_id, p_facility_id)` | financing row | lender tenant owner/manager/finance, admin (locks the facility row, so concurrent advances cannot exceed the limit) |
| `kamai_settle_financing(p_financing_id, p_amount_minor)` | financing row | lender owner/manager/finance, admin. The borrower can never settle. Lender calls must be covered by `matched`/`verified` payments allocated to the financed exposure (`REPAYMENT_NOT_VERIFIED` otherwise); platform admin/server may override |
| `kamai_set_wa_opt_in(p_store_id, p_opt_in, p_source = 'store_app')` | `{store_id, opt_in, wa_opt_in_at, wa_opt_in_source}` | the store member linked to that store, owner/manager of the tenant, admin. Updates `kamai_stores`, `kamai_wa_contacts` and writes an audit row (`kamai_wa_opt_in`) |
| `kamai_brand_sellthrough(p_days = 90)` | setof delivered lines | brand tenant owner/manager/finance/viewer with a brand_view link from the distributor |
| `kamai_os_kpis()` | jsonb | platform admin / server |
| `kamai_run_daily()` | jsonb | platform admin / server (pg_cron) |
| `kamai_import_legacy(p_tenant_id)` | jsonb counts | platform admin / server |
| `kamai_distance_m`, `kamai_line_tax`, `kamai_dpd_bucket`, `kamai_gtin_check_digit_ok` | pure helpers | any authenticated |

`kamai_confirm_delivery` returns `{ok:false, error:'OTP_INVALID'|'OTP_EXPIRED'|'OTP_LOCKED'|'GEOFENCE'}` (not an exception) when state must persist (OTP attempt counter) or the rider can retry with an override reason.
Internal (not granted to clients): `kamai_next_counter`, `kamai_seed_*`, `kamai_touch_updated_at`, `kamai_append_only`, `kamai_audit_trigger`, and the `private.*` helpers/cores.

Order state machine: booked -> credit_approved | rejected | cancelled; credit_approved -> packed | cancelled; packed -> dispatched | cancelled;
dispatched -> delivered (only via `kamai_confirm_delivery`) | cancelled; delivered <-> disputed (via dispute/resolve). `cancelled` and `rejected` require a reason.
Credit decision: approved when the account is `active`, exposure + order total fits the tier limit, no open exposure is past `pause_dpd` and the tenant is not paused;
otherwise `hold` with reason codes (CASH_ONLY, STORE_PAUSED, STORE_FROZEN, TENANT_PAUSED, DPD_OVER_LIMIT, LIMIT_EXCEEDED, TENANT_CAP, STORE_CAP); COD orders get decision `cod`.
Delivery posts: invoice (gapless per tenant, `<prefix>-000001`), credit exposure (credit orders), ledger Dr 1200 / Cr 4100 (+ Cr 2450 sales tax) with key `order:<id>:delivered`.
`line_total_minor` on order items is excluding tax; `tax_minor` is per line; order totals are re-priced on delivered quantities at delivery.

## Scheduled job

`kamai-daily` at `30 1 * * *` UTC (06:30 PKT): `select public.kamai_run_daily()`. It re-evaluates stores with activity, writes `kamai_credit_snapshots` for every store with an open exposure,
applies the PAR30 kill rule (sets `kamai_tenants.settings.credit_paused`, removed automatically when PAR30 recovers), queues dunning events and `kamai_wa_messages` (status `queued`) and writes `kamai_kpi_snapshots`.
Each store, tenant and dunning row runs in its own exception block: a failure is logged as a warning and returned in `errors` / `error_samples`, the rest of the job completes. Credit policy `rules` are validated on write (numeric ranges, integer days). Dunning fires, per exposure, the latest active rule whose `offset_days` has been reached and has not fired yet, so a missed run delays a step instead of skipping it.
`cron.schedule` upserts by job name, so re-running migration 008 does not duplicate the job.

## Known limits

Further tax and extra tax are stored per line but not computed in v1. The OTP hash, expiry and attempts live in `kamai_delivery_otp_secrets` (no access for anon or authenticated; only SECURITY DEFINER functions); the plain OTP is deliberately shown to the store through `kamai_delivery_otps`. The store limit is
tier-driven: `kamai_evaluate_store` keeps a manually edited limit until the tier changes. `floor_tier` (set to 1 for legacy credit-terms stores) stops the engine downgrading imported stores for lack of Kamai history.

## Proof-of-delivery storage (kamai-pod)

Private bucket `kamai-pod` (5 MB, jpeg/png/webp). Object names are `<tenant_id>/<order_id>/photo.jpg`, `<tenant_id>/<order_id>/signature.png`, `<tenant_id>/cash/<date>/slip.jpg`.
`storage.objects` policies call `private.kamai_pod_access(name, mode)`: owner/manager/booker read and write their tenant folder; finance/viewer read; a rider reads and writes `cash/` and the folders of
orders assigned to them; a store member the folders of its own store's orders; delete is owner/manager. Because the bucket is private, clients must use `createSignedUrl`, not `getPublicUrl`
(the URLs saved in `kamai_delivery_proofs` should be stored as object paths).

## Client impact of the hardening

`kamai_products.cost_price_minor` moved to `kamai_product_costs(product_id, tenant_id, cost_price_minor)`; the store app should read prices from `kamai_price_list_items` (default list or its own list);
the store app should call `kamai_set_wa_opt_in` instead of updating `kamai_stores`; the brand app should use `kamai_brand_sellthrough` for sell-through instead of reading orders and stores.

## 010 distributor onboarding (`20261110100001_kamai_distributor_onboarding.sql`)

Manual copy for the Supabase SQL editor: `supabase/manual/kamai_010_distributor_onboarding.sql` (byte-identical). Idempotent (verified by applying it twice on top of 001..009), additive. Apply after 009.

Flow: a distributor signs up through `/api/kamai-signup` (service role): tenant `type='distributor'`, `settings.onboarding_status='pending_review'`, `settings.signup={contact_name,mobile,city,email,source}`, owner membership, a `distributor_signup` notification. The distributor uploads products (always `draft`), submits them (`kamai_submit_products`), the platform admin reviews them (`kamai_review_product`, margin hidden from the distributor) and approval publishes the product to the default price list. Tenants that existed before 010 (apt, kamai, anything admin-made) are set to `onboarding_status='approved'`.

Schema changes
- `kamai_products` + `description`, `listing_status` (`draft|submitted|changes_requested|approved|rejected`, default `approved` so existing rows stay live), `submitted_at`, `reviewed_at`, `reviewed_by`, `review_note`, `original` (jsonb snapshot `{name, description, image_url, category, price_minor}` taken at submission). Column mapping: price = `trade_price_minor` (the distributor's own price), image = `image_url`.
- `kamai_price_list_items` + `managed boolean` (true = written by a platform review, i.e. the marked-up price).
- `kamai_product_margins(product_id pk, tenant_id, margin_pct 0..500, distributor_price_minor, final_price_minor, updated_by, updated_at)`: platform admins only (select/insert/update/delete); everybody else reads 0 rows.
- `kamai_admin_notifications` (`distributor_signup | products_submitted`, `email_status pending|sent|failed|skipped`, attempts, error, `read_at`): select for platform admins only; writes by the server or SECURITY DEFINER RPCs only.
- `kamai_signup_log(ip_hash, email_hash, created_at)`: RLS on, no policies, service role only.
- Bucket `kamai-product-images` (public read, 2 MB, jpeg/png/webp). Object name `<tenant_id>/<file>`. `storage.objects` policies `kamai_prodimg_select|insert|update|delete`: anyone reads; write = owner/manager/booker of the tenant in the FIRST path folder (`private.kamai_prodimg_access`), platform admins anywhere in the bucket.

Rules enforced in the database
- `kamai_tenants_guard` additionally blocks non-admin changes of `settings.onboarding_status`, `onboarding_note`, `onboarding_reviewed_at` and `signup`.
- Trigger `kamai_products_review_guard`: rows inserted by a client (not platform admin, not a SECURITY DEFINER function/server) are forced to `draft` with empty review fields; a client cannot change `listing_status`, `submitted_at`, `reviewed_*`, `review_note`, `original`; a client edit of name, name_ur, description, category, image_url, trade/retail price on a product that is not `draft`/`changes_requested` sets it back to `draft`, and trigger `kamai_products_unpublish` deletes its price list rows.
- Product SELECT: platform admin all; owner, manager, finance, viewer of the tenant all statuses; store, rider, booker and supplier/brand readers only `approved`.
- Price list items: tenant members cannot read `managed` rows unless they are `store` or `booker` members (so the distributor never sees the final price); the old FOR ALL write policy was split into insert/update/delete and excludes managed rows; trigger `kamai_price_items_guard` stops a client from pricing an unapproved product or a product that has a margin row. `kamai_audit_log` select hides audit copies of managed price rows from tenant members.

RPCs (SECURITY DEFINER, `search_path = ''`, denial = errcode 42501, bad input = 22023)

| Function | Returns | Who |
|---|---|---|
| `kamai_submit_products(p_product_ids uuid[])` | `{submitted, notification_id}` | owner/manager of the (single) tenant of the products, platform admin. Only `draft`/`changes_requested` move to `submitted`; stores `original`, sets `submitted_at`, clears `review_note`; inserts ONE `products_submitted` notification `{count, product_names (10), tenant_name}`. Rejected accounts get 42501 |
| `kamai_review_product(p_product_id, p_action, p_margin_pct = null, p_patch = '{}', p_note = null)` | `{product_id, listing_status, margin_pct, distributor_price_minor, final_price_minor}` | platform admin. `approve`/`request_changes`/`reject`; patch keys `name, description, image_url, category` (others ignored); `request_changes` needs a note. Approve: `final = ceil(distributor_price * (1 + margin/100))`, upserts the margin row and the default price list item (`managed = true`); margin defaults to the stored one, else 0. Other actions delete the product's price list rows |
| `kamai_review_products_bulk(p_product_ids, p_action, p_margin_pct = null, p_note = null)` | `{done, failed, errors[]}` | platform admin; each product in its own subtransaction; max 500 |
| `kamai_review_distributor(p_tenant_id, p_action, p_note = null)` | `{tenant_id, onboarding_status}` | platform admin; `approve`/`reject` sets `settings.onboarding_status` (+ `onboarding_reviewed_at`, `onboarding_note`) |
| `kamai_review_queue()` | one row per distributor tenant: `tenant_id, tenant_name, slug, onboarding_status, contact, submitted_count, draft_count (draft + changes_requested), approved_count, oldest_submitted_at, created_at` | platform admin; pending accounts first, then tenants with submitted products |
| `kamai_mark_notifications_read(p_ids uuid[])` | int | platform admin |

Tests: `supabase/tests/kamai_rls_test.sql` (now 106 assertions; the 010 block covers margin/notification isolation, forced drafts, onboarding guard, review RPC denial, ceil pricing, publish, snapshot + single notification, store/booker visibility, managed price hiding, unpublish on edit, storage isolation). Without pgTAP use `supabase/tests/pgtap_shim.sql` (+ `local_stub.sql` for the auth/storage/legacy tables of a plain Postgres); a ~20 line shim defining `plan/is/ok/lives_ok/throws_ok/finish` over a results table is enough.

Known limits
- Raw prices: `kamai_products.trade_price_minor` is the distributor's price and is still selectable by store/booker members for approved products (column level hiding is impossible with RLS). A store comparing it with the price list could infer the margin. The store app must read prices only from `kamai_price_list_items`; move the column behind a view if stores get direct PostgREST access they should not have.
- Orders, order items and invoices of a distributor tenant carry the marked-up unit price (`unit_price_minor`), readable by that tenant's owner/manager/finance. Hiding it needs a product model decision (who invoices whom) and is not done in 010.
- `kamai_submit_order` is unchanged: it only requires the product to be `active`, not `approved`; protection relies on stores never seeing non-approved product ids.
- Description and image edits by a distributor on an approved product also reset it to `draft` (by design, all content edits re-enter review).
