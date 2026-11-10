# Cowork prompt: apply the Kamai OS migrations (copy everything below the line)

---

You are helping me (Ahsan Ilyas) apply 9 additive SQL migrations to my **live** Supabase project **aptcrm** (project ref `aliegtwlfphpeyvesyvi`). The legacy CRM at https://aptsystems.vercel.app/ runs on this same database and must not be disturbed. I have approved this migration. Work carefully, one file at a time, and stop at the first problem.

## Where the SQL is
GitHub repo `ahsanilyas010/aptsystems`, branch `claude/kamai-os-c63gtk` (pull request #68), folder `supabase/migrations/`. Apply these files **in this exact order**, copying each file's contents **verbatim** (do not edit, trim, reformat or "fix" anything):

1. `20261108120001_kamai_core.sql`
2. `20261108120002_kamai_catalog_stores.sql`
3. `20261108120003_kamai_orders_delivery.sql`
4. `20261108120004_kamai_invoices.sql`
5. `20261108120005_kamai_ledger.sql`
6. `20261108120006_kamai_credit_payments.sql`
7. `20261108120007_kamai_financing_comms.sql`
8. `20261108120008_kamai_os_seed_cron.sql`
9. `20261108120009_kamai_storage_wa.sql`

If you cannot read the files from GitHub, tell me and I will paste them. Do not write the SQL yourself.

## What these files do (so you know what is expected)
They are **additive only**: new tables, functions and policies all prefixed `kamai_`, a new schema named `private`, one new private storage bucket `kamai-pod` with policies named `kamai_pod_*`, and one new pg_cron job `kamai-daily` (06:30 PKT). They do not drop, truncate, delete or alter any existing table, row, policy, auth setting or configuration. If you see a statement that does, **stop and tell me before running it**.

## Step 0: pre-flight (read-only, before any change)
Run this in the Supabase SQL editor and report the result. It should show 0 / 0 / no `kamai-pod` / no `kamai-daily`:

```sql
select
 (select count(*) from information_schema.tables where table_name like 'kamai\_%') as kamai_tables,
 (select count(*) from pg_namespace where nspname = 'private') as private_schema,
 (select count(*) from storage.buckets where id = 'kamai-pod') as kamai_bucket,
 (select count(*) from cron.job where jobname = 'kamai-daily') as kamai_cron,
 (select max(version) from supabase_migrations.schema_migrations) as latest_migration;
```

If anything already exists, stop and report. Then save a **baseline** of existing row counts:

```sql
select string_agg(table_name || '=' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text,
  ', ' order by table_name) as counts
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';
```

My baseline from before the migration was (43 tables): `app_settings=3, areas=7, customers=144, cw_counters=2, cw_expenses=0, cw_invoices=13, cw_members=19, cw_message_log=30, cw_onboarding_submissions=5, cw_payments=7, cw_tenant_users=2, cw_tenants=1, email_send_log=0, email_send_state=1, email_unsubscribe_tokens=0, expenses=34, gas_sync_log=0, invoice_items=669, invoices=257, order_items=260, order_payment_collections=1, orders=109, payments=119, products=98, profiles=56, purchase_items=0, push_subscriptions=31, return_items=0, returns=0, rider_areas=3, rider_locations=27, rider_payment_permissions=2, stockroute_leads=1, store_assignments=71, store_products=0, store_visits=144, stores=118, suppressed_emails=0, user_roles=57, vendor_pipeline=472, vendors=7, vendors_purchases=17, whatsapp_log=0`. (Small differences in live tables such as `rider_locations`, `push_subscriptions`, `whatsapp_log` or `store_visits` are normal if people used the app meanwhile; any drop in a count is not.)

## Step 1: apply the files, one at a time
- Run each file **completely** (the whole file as one run) in the SQL editor, in order, or with the Supabase `apply_migration` tool if you have it (name it like `kamai_core`, `kamai_catalog_stores`, and so on). If a confirmation prompt appears, I will approve it.
- After each file succeeds, say so in one line before moving to the next.
- **If any file errors: STOP.** Do not retry with changes, do not skip ahead, do not run any repair SQL. Paste me the exact error text and which files succeeded. (Each file runs as one transaction, so a failed file leaves nothing half-applied.)
- Never run DROP, DELETE, TRUNCATE or UPDATE on existing objects. Never reset the database or change auth settings.

## Step 2: verify (read-only)
1. Re-run the baseline row-count query and compare it to my baseline above. Report any difference.
2. Run:
```sql
select
 (select count(*) from information_schema.tables where table_name like 'kamai\_%') as kamai_tables,
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'kamai\_%') as kamai_functions,
 (select count(*) from pg_tables where tablename like 'kamai\_%' and not rowsecurity) as kamai_tables_without_rls,
 (select id || ' public=' || public from storage.buckets where id = 'kamai-pod') as pod_bucket,
 (select jobname || ' ' || schedule from cron.job where jobname = 'kamai-daily') as cron_job,
 (select count(*) from public.kamai_tenants) as tenants,
 (select count(*) from public.kamai_platform_admins) as platform_admins;
```
Expected: `kamai_tables_without_rls = 0`, bucket `kamai-pod public=false`, cron `kamai-daily 30 1 * * *`, at least 1 platform admin, and a few seeded tenants (Assorted, APT and others).
3. Run the Supabase **security advisor** and report any finding that mentions a `kamai_` table or function.
4. Confirm the legacy CRM still works: open https://aptsystems.vercel.app/ and check that it loads and I can still log in.

## Step 3: report back
Give me a short report: each file applied or failed, the row-count comparison, the verify results, and the advisor findings. Do **not** make any other changes. If anything looks wrong, stop and ask me.

After this, I will open https://aptsystems.vercel.app/os as ahsanilyas35@gmail.com to check the Kamai OS dashboard.
