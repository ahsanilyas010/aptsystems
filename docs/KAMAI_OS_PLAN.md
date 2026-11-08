# Kamai OS — Build Plan

Status: v1 build plan, November 2026. This document is the source of truth for the Kamai OS
and the tenant platform built inside the `aptsystems` repo and served from the same Vercel
project (apt.assorted.group, apt.assortedtrade.com, aptsystems.vercel.app).

It was written after a research pass over: the live Supabase project (`aliegtwlfphpeyvesyvi`,
"aptcrm"), the existing CRM (`src/APT_CRM_v3.1.jsx`), the Kamai Hero app repo
(`apt-rider-connect`), and external standards (Supabase multi-tenant RLS, React Router 7,
Vercel rewrites and crons, WhatsApp Cloud API, Raast/1Bill, FBR digital invoicing, SECP
digital-lending rules, ICC supply chain finance definitions, PAR/roll-rate definitions,
double-entry ledger design, GS1 GTIN, OWASP ASVS 5.0 L1).

---

## 1. What we are building

Kamai becomes one rail with three lanes, plus a demand layer later:

| Lane | Model | Funded by | Start |
|---|---|---|---|
| B. Distributor OS + finance | Distributor enlists its stores, uses Kamai ordering, invoicing, credit limits. Lender (Abhi) pays distributor on delivery proof. Store repays lender. | Abhi | Month 1 pilot |
| A. Aggregator | Distributors and brands list SKUs. Kamai delivers, collects, remits net of margin. | Float only | Month 4 |
| C. Own JIT (today) | APT sources imported SKUs and sells to petrol shops via Heroes. | APT cash | Running, capped |
| Demand (Neighborhood) | Consumers order Food, Pharmacy, Beauty from local vendors. | — | After Phase 1 gate |

Surfaces, all on the same domain under path prefixes:

| Path | Who | What |
|---|---|---|
| `/` | APT staff (Firebase allowlist) | Existing CRM, untouched except one "Open Kamai OS" link |
| `/os` | Platform admins | Kamai OS: the 14 operating-system panels (Command, AI Agents, Business Model, Platform Plan, Finance, Procurement, Vendors, Target Stores, Hero Network, Marketing, Tech, HR, Roadmap, Gaps) plus live tenants, orders pipeline, credit portfolio and audit |
| `/distributor` | Distributor owners, managers, bookers, finance | Stores, catalog and price lists, orders pipeline, credit, invoices, payments and reconciliation, ledger and settlement, team |
| `/store` | Store owners | Two-tap reorder, catalog, cart with credit check, orders with OTP and dispute, pay screen |
| `/lender` | Abhi | Read-only portfolio: disbursed, outstanding, PAR 7/30/60/90, collections, positions CSV |
| `/brand` | Brands and importers | Sell-through by SKU, store and area; product tax and GTIN data |
| `/delivery` | Delivery riders | Dispatched runs, proof of delivery (OTP + photo + GPS), cash day-close |
| `/auth` | Everyone | Login (email + password, or mobile + PIN), invite acceptance, callback, logout |

`/rider` and `/apt-finance` are already taken by static pages in `public/`, so delivery riders
use `/delivery`.

---

## 2. Constraints and decisions

1. **The shared Supabase project stays as it is.** No existing table, enum, function, policy,
   trigger or bucket is altered. Everything new is prefixed `kamai_` in `public`, with RLS
   helper functions in a non-exposed `private` schema. Kamai reads legacy data (stores,
   orders, products, customers, invoices, payments) through security-definer functions and
   views, never by loosening existing policies.
2. **Migrations are applied through the Supabase connector and committed to
   `supabase/migrations/` in this repo as the record.** The live `schema_migrations` history
   does not match either repo, and three migrations in `apt-rider-connect` were never applied,
   so `supabase db push` from either repo would conflict. Do not run it.
3. **Supabase Auth for every new surface.** The `/apt-finance` static page already uses it on
   this domain. The Kamai client uses `auth.storageKey = 'kamai-auth'` so it never shares the
   default `sb-<ref>-auth-token` session with apt-finance. Firebase stays for the legacy CRM.
4. **Invite-only onboarding, provisioned server-side.** The live trigger `handle_new_user()`
   gives every new auth user the `rider` role. We may not change it, so Kamai users are created
   by `api/kamai-admin.js` (service role) which removes the auto-granted rider role for
   non-rider personas in the same request. No public self-signup on Kamai surfaces.
5. **Stores log in with mobile + PIN.** Many stores have no email and SMS OTP to Pakistan costs
   about USD 0.47 per message. The distributor registers the owner face to face; the server
   creates the auth user with a synthetic email (`store-<digits>@kamai.assorted.group`,
   confirmed) and a 6-digit PIN as password. PIN reset is done by the distributor. WhatsApp
   OTP via the Send-SMS auth hook is a Phase 2 upgrade.
6. **Kamai is platform and seller, never lender.** The lender tenant and the debtor of record
   are explicit columns. Kamai never books finance charges to itself and never holds store
   repayments as its own float. Trade credit APT extends on its own invoices (no finance
   charge) is a separate, labelled module. Lawyer review is a gate before any financed state
   runs in production.
7. **React Router 7 (library mode), Tailwind v4 without preflight, TypeScript for new code.**
   The CRM file is lazy-loaded at `/` so Firebase never initialises on Kamai routes. Tailwind
   scans only `src/kamai/**`, and the entry CSS imports theme and utilities layers only, so the
   inline-styled CRM is untouched.
8. **Vercel:** `vercel.json` adds the SPA rewrite `/((?!api/).*)` to `/index.html` (filesystem
   wins first, so `/apt-finance`, `/rider`, `/assets`, `/api` keep working), plus security
   headers. No Vercel crons: `pg_cron` and `pg_net` are already installed and used on the
   project, so scheduled work runs in the database.
9. **Money is stored in minor units (paisa) as bigint** in Kamai tables. The CRM uses
   `numeric(12,2)`; conversion happens at the boundary.

---

## 3. Tenancy model

```
kamai_tenants            id, slug, name, type ('platform','distributor','brand','lender','vertical'),
                         status, settings jsonb, legal_name, ntn, strn, province, address,
                         invoice_prefix, bank_iban, raast_alias
kamai_memberships        tenant_id, user_id, role ('owner','manager','booker','finance','viewer',
                         'rider','store'), store_id (nullable scope for role 'store'/'rider'),
                         status ('invited','active','disabled')
kamai_platform_admins    user_id  (seeded from user_roles.admin = ahsanilyas35@gmail.com)
kamai_tenant_links       grantor_tenant_id, grantee_tenant_id, kind ('lender_view','brand_view',
                         'supplier'), scope jsonb, active
kamai_invites            token_hash, tenant_id, role, store_id, email/phone, expires_at, used_at
```

Helpers in `private` (SECURITY DEFINER, `search_path = ''`, wrapped as `(select ...)` in
policies): `kamai_is_platform_admin()`, `kamai_user_tenants()`, `kamai_is_member(t)`,
`kamai_has_role(t, roles[])`, `kamai_readable_tenants()` (own tenants plus grantor tenants via
active links), `kamai_store_scope(t)` (store ids a store-role member may see).

Policy template for every tenant table: SELECT where `tenant_id in (select
private.kamai_readable_tenants())` or platform admin; INSERT/UPDATE for owner, manager, booker,
finance as appropriate; DELETE for owner only; store-scoped tables additionally filter by
`store_id in (select private.kamai_store_scope(tenant_id))` for role `store`.

Seed tenants: `kamai` (type platform) and `apt` (type vertical, Lane C, linked to the legacy
stores/orders/products data). Distributors are created from `/os/tenants`.

---

## 4. Data model (all `kamai_` tables, public schema)

### Catalog and stores
- `kamai_products` tenant_id, sku (unique per tenant), name, name_ur, category, brand_tenant_id,
  legacy_product_id (text to products.id), gtin14 (14-digit text, check-digit CHECK), gtin_type,
  hs_code, fbr_uom, tax_rate_pct, sale_type, is_third_schedule, retail_price_minor,
  cost_price_minor, trade_price_minor, image_url, pack_size, active.
- `kamai_price_lists` tenant_id, name, tier ('A','B','C','default'). `kamai_price_list_items`
  price_list_id, product_id, price_minor.
- `kamai_stores` tenant_id, legacy_store_id (uuid to stores.id), legacy_customer_id (text to
  customers.id), name, owner_name, mobile (E.164), address, area, area_id, latitude, longitude,
  category, tier, price_list_id, payment_terms_days, credit_limit_minor, credit_status
  ('cash_only','active','paused','frozen','written_off'), payment_ref_code (unique, e.g.
  `KM-RWP12`), tax_profile jsonb (buyer_ntn_cnic, registration_type, province), wa_opt_in_at,
  wa_opt_in_source, status, created_by.
- `kamai_store_imports` for CSV imports (file hash, rows, errors).

### Orders and delivery
- `kamai_orders` tenant_id, store_id, order_no (per-tenant counter), source ('store_pwa',
  'whatsapp','booker','hero_app','import'), fulfilment_status ('booked','credit_approved',
  'packed','dispatched','delivered','cancelled','rejected','disputed'), finance_status
  ('unfinanced','financed','paid','settled'), payment_mode ('credit','cod'), subtotal_minor,
  tax_minor, total_minor, items_count, rider_user_id, credit_decision_id, invoice_id,
  client_order_id (unique, idempotent offline replay), legacy_order_id (uuid to orders.id),
  cancellation_reason (required when cancelled), notes, timestamps per state, created_by.
- `kamai_order_items` order_id, product_id, sku, name, qty, delivered_qty, unit_price_minor,
  tax_rate_pct, line_total_minor.
- `kamai_order_events` append-only: order_id, from_state, to_state, actor, reason, meta, at.
- `kamai_delivery_proofs` order_id (PK), otp_hash, otp_expires_at, otp_attempts,
  otp_verified_at, delivered_lat/lng, gps_accuracy_m, store_lat/lng snapshot, distance_m,
  geofence_radius_m, geofence_ok, override_reason, photo_url, signature_url, receiver_name,
  delivery_status ('full','partial','refused'), dispute_window_ends_at, disputed_at,
  dispute_reason, resolved_at.

State machine (enforced in `kamai_transition_order`):

```
booked -> credit_approved | rejected | cancelled
credit_approved -> packed | cancelled
packed -> dispatched | cancelled
dispatched -> delivered (via kamai_confirm_delivery only) | cancelled
delivered -> disputed ; finance_status: unfinanced -> financed -> paid -> settled
cancelled requires cancellation_reason; every transition writes kamai_order_events
```

Legacy mapping for Lane C orders from the Hero app (read-only): Pending to booked, Approved to
credit_approved, Packed, Dispatched, Delivered, Cancelled, Rejected.

### Invoices (FBR-ready, no FBR calls in v1)
- `kamai_invoices` tenant_id, serial_no (gapless per tenant), display_number, invoice_type
  ('Sale Invoice','Debit Note','Credit Note'), invoice_date, order_id, store_id,
  seller_snapshot jsonb, buyer_snapshot jsonb, buyer_ntn_cnic, buyer_registration_type, totals
  (excl ST, sales tax, further tax, extra tax, discount, incl tax) in minor units, due_date,
  status ('draft','issued','paid','void'), ref_invoice_id, fbr_* columns nullable
  (invoice_number, dated, env, status, request, response, correction_deadline_at), pdf_url.
- `kamai_invoice_items` with hs_code, uom, qty, unit price, rate, sale_type, value excl ST,
  retail price base for 3rd Schedule items, tax amounts, line total.

### Credit engine (rules, not ML)
- `kamai_credit_policies` tenant_id, name, version, effective_from, rules jsonb (tiers,
  multipliers, caps per store/distributor/hero/area, grace_days, kill triggers, provision %).
- `kamai_credit_accounts` store_id (PK), tenant_id, tier (0..3), limit_minor, tenor_days,
  status, last_reviewed_at, reason_codes.
- `kamai_credit_decisions` order_id, store_id, decision ('approved','declined','hold','cod'),
  available_minor, exposure_minor, reason_codes text[], policy_id, decided_at. Produced by
  `kamai_credit_decide(order_id)` in under one query.
- `kamai_credit_exposures` invoice-level receivable: tenant_id, store_id, order_id,
  invoice_id, origination_date, due_date, original_minor, outstanding_minor, paid_minor,
  financed_minor, lender_tenant_id, status, restructured, write_off_date.
- `kamai_payment_allocations` payment_id, exposure_id, amount_minor (FIFO oldest first).
- `kamai_credit_snapshots` (snapshot_date, store_id) outstanding, max_dpd, bucket, tier, limit,
  status, eligible, ineligibility_reason. Nightly by pg_cron; source of PAR and roll rates.
- `kamai_credit_events` append-only tier/status changes with rule id and evidence.

Definitions used everywhere: DPD = greatest(0, today − due_date); obligor DPD = max over open
exposures; buckets Current, 1-7, 8-14, 15-30, 31-60, 61-90, 90+; PAR_x = outstanding of
obligors with max DPD > x divided by total outstanding (balance-weighted). Kill rules from the
Platform Plan: pause new credit if PAR30 > 8%; pause a distributor if dispute rate > 10%; stop
Lane A if float > 15 days; drop the Bykea pool plan if rider cash variance > 1%.

### Payments and reconciliation
- `kamai_payments` tenant_id, store_id, amount_minor, channel ('cash','raast','ibft',
  'easypaisa','jazzcash','cheque','rtp'), external_ref, reference_code, collected_by,
  collected_at, status ('recorded','matched','verified','rejected'), evidence_url, notes,
  legacy_payment_id. Unique on (tenant_id, lower(external_ref)) where not null.
- `kamai_bank_statements`, `kamai_bank_lines` (narration, amount, bank_ref, extracted ref,
  match_status 'unmatched','auto','manual','ignored', matched_payment_id).
- `kamai_cash_deposits` rider day-close: rider_user_id, business_date, expected_minor,
  deposited_minor, method, deposit_ref, slip_url, variance_minor, status.
- `kamai_dunning_rules` offsets (-3, 0, +3, +7, +15, +30) with action per step;
  `kamai_dunning_events` per exposure per step; messages go to the WhatsApp outbox.

Matching passes: exact reference in narration, then exact external ref, then amount within
two business days plus payer match (proposed, needs one-click confirm). Never match on amount
alone when two open items share the amount.

### Ledger (double-entry, immutable)
- `kamai_ledger_accounts` tenant_id, code, name, type, normal_side, party_type, party_id.
- `kamai_ledger_entries` tenant_id, idempotency_key (unique per tenant), status, effective_at,
  source_type, source_id, reverses_entry_id, memo. `kamai_ledger_lines` entry_id, account_id,
  direction, amount_minor. Deferred constraint trigger enforces balance per entry; BEFORE
  UPDATE/DELETE triggers make posted rows append-only; corrections are reversing entries.
- Posting API: `kamai_post_entry(tenant, key, source_type, source_id, effective_at, lines)`.
- Chart of accounts per tenant seeded on tenant creation (1100 bank, 1110 rider float, 1150
  clearing, 1200 store receivables, 1290 allowance, 2100 supplier payables, 2200 financing
  payable, 2300 hero commissions payable, 2500 first-loss reserve, 4100 sales, 4200 platform
  fee, 4300 credit service fee, 5100 COGS, 5200 commission expense, 5300 financing cost, 5400
  credit loss, 5500 collection charges). Opening balances are posted as explicit entries so the
  CRM AR (excludes open_bal) and the OS AR (includes it) reconcile by definition.
- `kamai_ledger_balances` view; weekly settlement statement per distributor from it.

### Financing (Abhi)
- `kamai_facilities` lender_tenant_id, borrower_tenant_id, technique
  ('retailer_purchase_loan','receivables_discounting_recourse',
  'receivables_discounting_non_recourse','payables_finance','distributor_finance'), limit_minor,
  tranche_minor, tenor_days, advance_rate_pct, first_loss_pct, pricing jsonb, status,
  debtor_of_record ('store','distributor').
- `kamai_financings` facility_id, order_id, exposure_id, disbursed_minor, disbursed_at,
  due_date, repaid_minor, status, lender_ref.
- Views (security_invoker): `kamai_v_lender_positions` (loan tape fields), `kamai_v_par`,
  `kamai_v_roll_rates`, `kamai_v_collections`.

### Communications
- `kamai_wa_contacts` tenant_id, wa_id, store_id, opted_in_at, opt_in_source, opt_in_scopes,
  opted_out_at, last_inbound_at, session jsonb.
- `kamai_wa_messages` direction, wamid unique, template_name, category, payload, status,
  pricing_category, related order/invoice.
- `kamai_wa_templates` registry (name, language_code, category, status, components).
- Outbox is `kamai_wa_messages` with status 'queued'; sender is `api/kamai-whatsapp.js`
  (Meta Cloud API when `WHATSAPP_*` env vars exist; otherwise the UI offers wa.me links).

### OS and audit
- `kamai_os_tasks` id text, panel, title, meta, owner, priority, sort, done, done_at, note.
  Seeded from the artifact (t1..t8, g1..g6).
- `kamai_kpi_snapshots` snapshot_date, metrics jsonb (daily by pg_cron).
- `kamai_audit_log` generic row-version log (table, op, record_id, tenant_id, actor, changed
  keys, old/new) attached to tenancy, catalog, stores, orders, credit, payments, ledger and
  financing tables; append-only.

### Functions exposed to clients (public, SECURITY DEFINER, explicit checks)
`kamai_create_tenant`, `kamai_submit_order`, `kamai_transition_order`, `kamai_credit_decide`,
`kamai_issue_delivery_otp`, `kamai_confirm_delivery`, `kamai_record_payment`,
`kamai_match_bank_lines`, `kamai_post_entry`, `kamai_issue_invoice`, `kamai_os_kpis`
(platform admin only; reads legacy and Kamai tables), `kamai_store_outstanding`,
`kamai_run_daily` (pg_cron 01:30 UTC = 06:30 PKT: snapshots, dunning selection, kill rules,
KPI snapshot), `kamai_my_context` (memberships + platform flag for routing).

---

## 5. Application architecture (aptsystems)

```
src/main.jsx                 RouterProvider (router built once)
src/router.tsx               route tree: '/' lazy CRM, '/os', '/distributor', '/store',
                             '/lender', '/brand', '/delivery', '/auth', '*'
src/kamai/
  styles/kamai.css           Tailwind v4 theme + utilities only, @source "../"
  lib/supabase.ts            createClient(url, anon, { auth: { storageKey: 'kamai-auth' } })
  lib/auth.tsx               session, memberships, platform admin, active tenant, guards
  lib/db-types.ts            hand-written row types for kamai_* tables and RPC payloads
  lib/money.ts, format.ts, geo.ts, i18n.ts (en / ru Roman Urdu / ur), api.ts, csv.ts
  ui/                        Button, Card, Stat, Badge, Table, Input, Select, Modal, Tabs,
                             Toast, EmptyState, Spinner, PageHeader, Shell (sidebar) and
                             MobileShell (bottom nav)
  auth/routes.tsx            /auth/login, /auth/callback, /auth/accept/:token, /auth/logout
  os/routes.tsx, os/content/*.ts, os/pages/*.tsx
  distributor/routes.tsx, pages/*
  store/routes.tsx, pages/*
  lender/routes.tsx, pages/*
  brand/routes.tsx, pages/*
  delivery/routes.tsx, pages/*
api/kamai-admin.js           POST, bearer Supabase JWT verified server-side; actions:
                             provision_user, reset_pin, disable_user, send_otp,
                             send_whatsapp. Removes auto 'rider' role for non-riders.
api/kamai-whatsapp.js        GET webhook verify, POST inbound (HMAC over raw body)
vercel.json                  SPA rewrite + security headers
supabase/migrations/         kamai_* SQL, applied through the Supabase connector
supabase/tests/              pgTAP tenant isolation tests
docs/                        this plan, runbook, API notes
```

Each surface module exports `routes: RouteObject[]` and owns its folder. Shared contracts
(auth, supabase client, UI kit, db types) live in `src/kamai/lib` and `src/kamai/ui`.

Environment variables (Vercel): existing ones unchanged; new `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (public), `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
`WHATSAPP_GRAPH_VERSION` (server only, optional until WhatsApp is live). The client falls back
to the project URL and publishable key already public in `public/apt-finance/index.html`.

---

## 6. Phases and gates (from the Platform Plan)

| Phase | When | Build scope in this repo | Exit gate |
|---|---|---|---|
| 0. Fix and prove | Weeks 1-4 | Tenancy core, OS dashboard with live KPIs, APT tenant seeded, order state machine, RLS tests | Cancellations under 15%, Hero activation 25%, AR over 60 days under Rs 0.4M |
| 1. Lane B pilot | Months 2-3 | Distributor console, store PWA, credit engine v1, delivery proof, payments and reconciliation, ledger, WhatsApp utility templates | 90%+ collected within terms, 50% repeat order rate, cost per drop known |
| 2. Aggregator and scale | Months 4-6 | Brand portal listing, Lane A flows, lender portal live feed, Rs 10M tranche | 150-250 stores |
| 3. KLI | Months 7-12 | Multi-city tenants, Bykea pool, data room | Raise on collected GMV and PAR data |

Legal and compliance gates before production use of financed states: SECP perimeter opinion
(Kamai as whitelisted partner platform of Abhi under Circulars 3/2023 and 12/2024), data
residency check for borrower data (Circular 15/2022), FBR digital invoicing enrolment per
distributor tenant (SRO 1852(I)/2025 go-live dates have passed for all registered persons),
WhatsApp Business Account verification.

---

## 7. Known facts about the live system that the build respects

- Live `calc_order_incentive` pays 250/150/100 by order value, not the 1000/500/250 structure
  shown in the Hero app and the OS. The OS shows `orders.incentive` as stored and flags the gap.
- Live `submit_order` is stock-gated; Kamai store orders use `kamai_submit_order` instead.
- `invoices.status` is constrained to Unpaid, Paid, VOIDED; "Partial" is derived.
- `invoices.cust_id` is the real column; migration `20260923` in apt-rider-connect was never
  applied and its RPCs do not exist live.
- Finance tables have RLS with admin-only policies; `products` is readable by any
  authenticated user, including future tenant users (trade prices are visible).
- `api/supabase.js`, `api/gas.js` and `api/invoice.js` are unauthenticated service-role
  endpoints with CORS `*`. Kamai does not use them. Locking them down is recommended before
  external tenants are invited and is listed as follow-up work, not changed in this build.
- Vercel Deployment Protection is on for all hosts except custom domains, so
  `aptsystems.vercel.app` and preview URLs cannot be used for OAuth redirects or webhooks; use
  apt.assorted.group.

---

## 8. Out of scope for this build (tracked as follow-ups)

- FBR API calls (schema is ready; adapter is Phase 1 of the invoicing track).
- Raast request-to-pay or QR via an aggregator (reference-based reconciliation ships first).
- Consumer Neighborhood app.
- Changing `handle_new_user`, `calc_order_incentive`, or any existing policy.
- Gating the legacy `/api/*` endpoints (recommended, separate change).
