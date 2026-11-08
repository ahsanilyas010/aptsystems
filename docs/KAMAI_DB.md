# Kamai OS database

Source of truth: `supabase/migrations/20261108120001..8_kamai_*.sql`. Types: `src/kamai/lib/db-types.ts`.
Every object is prefixed `kamai_` (RLS helpers live in schema `private`). No existing table, enum, function, trigger,
policy or bucket of the shared project is touched. Money is `bigint` minor units (paisa). Status columns are `text` + CHECK.

## Apply procedure

Do not run `supabase db push` (the live `schema_migrations` history does not match this repo). Apply the files in
order through the Supabase connector `apply_migration`, one call per file, using the file name without the timestamp
prefix as the name (`kamai_core`, `kamai_catalog_stores`, `kamai_orders_delivery`, `kamai_invoices`, `kamai_ledger`,
`kamai_credit_payments`, `kamai_financing_comms`, `kamai_os_seed_cron`). All files are idempotent, so a failed run can
be repeated. Files 003 to 006 reference each other at runtime only (plpgsql is late bound), so apply all eight before
exercising any RPC. File 008 seeds tenants `kamai` and `apt`, imports legacy stores/products into `apt`, seeds
`kamai_os_tasks` and registers the pg_cron job. Verify afterwards:
`select count(*) from kamai_tenants;` (2), `select jobname, schedule from cron.job where jobname = 'kamai-daily';`,
`select kamai_os_kpis();` (as a platform admin) and run `supabase/tests/kamai_rls_test.sql` where pgTAP exists.

Roles: platform admin = row in `kamai_platform_admins` or legacy `user_roles.role = 'admin'`.
"Server" = no end-user JWT (postgres, pg_cron, service_role). Tenant roles: owner, manager, booker, finance, viewer, rider, store.

## Tables

Tenancy: `kamai_tenants` tenants (platform, distributor, brand, lender, vertical); `kamai_memberships` user to tenant role and optional store scope;
`kamai_platform_admins` platform operators; `kamai_tenant_links` cross-tenant read grants (lender_view, brand_view, supplier);
`kamai_invites` hashed invite tokens; `kamai_counters` per-tenant gapless counters (order, invoice, store_ref).
Catalog and stores: `kamai_products` SKUs with FBR/GTIN/tax fields; `kamai_price_lists`; `kamai_price_list_items`; `kamai_stores` retail customers with credit terms and payment reference code; `kamai_store_imports` CSV import log.
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

Direct writes by `authenticated` are allowed (subject to RLS) only on: tenants (update), memberships, platform_admins, tenant_links, invites, products, price lists and items, stores, store_imports,
credit_policies, credit_accounts (update), dunning_rules, facilities (platform admin), wa_contacts, wa_templates, os_tasks. Everything else is written by SECURITY DEFINER functions.

## Views (security_invoker = true, caller RLS applies)

`kamai_ledger_balances` (balance per account), `kamai_v_lender_positions` (loan tape: one row per exposure),
`kamai_v_par` (outstanding, PAR 7/30/60/90 from the latest snapshot per tenant), `kamai_v_collections` (per tenant per day sums),
`kamai_v_store_balances` (receivable per store from the ledger).

## RPCs (public schema, SECURITY DEFINER, `search_path = ''`)

| Function | Returns | Who may call |
|---|---|---|
| `kamai_my_context()` | jsonb `{user_id, platform_admin, legacy_roles, memberships[]}` | any authenticated |
| `kamai_create_tenant(p_slug, p_name, p_type, p_settings = '{}')` | uuid | platform admin / server |
| `kamai_add_member(p_tenant, p_user, p_role, p_store_id = null)` | jsonb membership | platform admin, owner, manager (owners only by owner/admin) |
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
| `kamai_finance_order(p_order_id, p_facility_id)` | financing row | lender tenant owner/manager/finance, admin |
| `kamai_settle_financing(p_financing_id, p_amount_minor)` | financing row | lender or borrower owner/manager/finance, admin |
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
`cron.schedule` upserts by job name, so re-running migration 008 does not duplicate the job.

## Known limits

Further tax and extra tax are stored per line but not computed in v1. `otp_hash` is readable by roles that can read delivery proofs (the plain OTP is deliberately shown to the store). The store limit is
tier-driven: `kamai_evaluate_store` keeps a manually edited limit until the tier changes. `floor_tier` (set to 1 for legacy credit-terms stores) stops the engine downgrading imported stores for lack of Kamai history.
