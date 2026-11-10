# Cowork prompt: apply migration 010 and set up Resend email

Attach the file `supabase/manual/kamai_010_distributor_onboarding.sql` (download it from GitHub, branch `claude/kamai-distributor-signup-c63gtk`, or from the repo after PR #69 is merged) to the Cowork chat, then copy everything below the line into Cowork.

---

You are helping me (Ahsan Ilyas, ahsanilyas35@gmail.com) finish the setup of a new "distributor sign-up and product review" feature for my website. I have **attached a file** called `kamai_010_distributor_onboarding.sql`. It is a database migration for my **live** Supabase project **aptcrm** (project ref `aliegtwlfphpeyvesyvi`, shown in the dashboard as "APT CRM"). The same database also runs my legacy CRM at https://aptsystems.vercel.app/, which must not be disturbed. I have approved this migration. Work carefully, in order, and stop at the first problem. If anything looks different from what I describe, **stop and ask me before changing anything**.

Hard rules: never paste, print or repeat any secret (API keys, tokens, passwords) in your replies; never change anything not listed here; never reset or delete data; never touch other Vercel environment variables, other Supabase settings, or production deployments (do not redeploy).

## Part 1: apply the migration

### Step 1.1 Pre-flight (read-only)
In the Supabase SQL editor of the aptcrm project run this and tell me the result. Expected: `new_tables = 0`, `bucket = 0`, and `kamai_tables` around 49:

```sql
select
 (select count(*) from information_schema.tables where table_schema='public' and table_name like 'kamai\_%') as kamai_tables,
 (select count(*) from information_schema.tables where table_schema='public' and table_name in ('kamai_product_margins','kamai_admin_notifications','kamai_signup_log')) as new_tables,
 (select count(*) from storage.buckets where id = 'kamai-product-images') as bucket;
```
If `new_tables` or `bucket` is not 0, stop and tell me (it may already be applied).

Then save a baseline of existing row counts and keep it for step 1.4:
```sql
select string_agg(table_name||'='||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text, ', ' order by table_name) as counts
from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'kamai\_%';
```
For reference, my last known counts (small increases from normal use are fine; any decrease is a problem): `app_settings=3, areas=7, customers=144, invoices=257, order_items=260, orders=109, payments=122 or more, products=98, profiles=56, stores=118, user_roles=57, vendors=7`.

### Step 1.2 Run the file
- Open the attached file in a text editor and **copy the whole contents** (select all). Do NOT type or paste the file name; paste the SQL text itself. The first line should begin with `-- Kamai OS migration 010`.
- In the Supabase SQL editor click **New query**, paste, and click **Run**. Run it **once, as a whole**.
- The editor may warn about "destructive" statements. That is expected: the file contains `drop policy if exists` / `drop trigger if exists` lines for objects that start with `kamai_` that it creates itself. It does not drop or change my existing tables. You may confirm.
- Expected result: "Success. No rows returned". If there is **any error, stop**: copy me the full error text (including the LINE part) and do not retry with edits. A failed run rolls back as a whole.

### Step 1.3 Verify (read-only)
```sql
select
 (select count(*) from information_schema.tables where table_schema='public' and table_name like 'kamai\_%') as kamai_tables,
 (select count(*) from pg_tables where schemaname='public' and tablename like 'kamai\_%' and not rowsecurity) as tables_without_rls,
 (select count(*) from information_schema.columns where table_name='kamai_products' and column_name in ('listing_status','submitted_at','reviewed_at','reviewed_by','review_note','original','description')) as product_cols_expected_7,
 (select id||' public='||public from storage.buckets where id='kamai-product-images') as bucket,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('kamai_submit_products','kamai_review_product','kamai_review_products_bulk','kamai_review_distributor','kamai_review_queue','kamai_mark_notifications_read')) as rpcs_expected_6,
 (select string_agg(slug||':'||coalesce(settings->>'onboarding_status','-'), ', ') from public.kamai_tenants) as tenants,
 (select count(*) from public.kamai_products where listing_status <> 'approved') as non_approved_products;
```
Expected: `kamai_tables` = 52 (three new tables), `tables_without_rls` = 0, `product_cols_expected_7` = 7, bucket = `kamai-product-images public=true`, `rpcs_expected_6` = 6, every existing tenant `approved`, `non_approved_products` = 0.

### Step 1.4 Check nothing was disturbed
Re-run the baseline row-count query from step 1.1 and compare with the first result. Report any count that went down. Also run the Supabase **Security Advisor** and tell me any new finding that mentions a `kamai_` table or function (the earlier known ones: `kamai_delivery_otp_secrets` has RLS but no policies on purpose).

## Part 2: Resend email setup (so I get an email when a distributor signs up or submits products)

### Step 2.1 Account and sender domain
1. Open https://resend.com and sign in (or create an account with ahsanilyas35@gmail.com; I will complete any email/CAPTCHA/2FA steps myself, ask me).
2. Check if a **sending domain** is already verified. If not, go to Domains, **Add Domain**, and add `assorted.group` (if I tell you to use a different domain, use that). Resend will show DNS records (SPF/DKIM TXT or MX/CNAME).
3. **Do not change my DNS yourself.** Show me the exact records (type, name, value) in a table so I can add them at my DNS provider, or tell me which DNS provider the domain uses. Then wait for me to say they're added and click Verify; report the status (Verified / Pending / Failed).
If I decide to skip the domain for now, continue with the default sender and tell me the limitation: with the default sender `onboarding@resend.dev` Resend only delivers to the email address of the Resend account owner.

### Step 2.2 API key
In Resend, go to API Keys, **Create API Key**: name `kamai-os-production`, permission **Sending access**, domain = the verified domain (or all). **Copy the key once and paste it only into Vercel in the next step**. Never show it to me in chat.

### Step 2.3 Vercel environment variables
Open Vercel, project **aptsystems**, Settings, Environment Variables. Add these for **Production and Preview** (if a variable already exists, tell me its name and leave it alone):
- `RESEND_API_KEY` = the key from step 2.2 (mark it as **Sensitive** if Vercel offers that)
- `KAMAI_ADMIN_EMAIL` = `ahsanilyas35@gmail.com`
- `KAMAI_FROM_EMAIL` = `Kamai OS <noreply@assorted.group>` (use the verified domain; if no domain is verified use `Kamai OS <onboarding@resend.dev>`)
- `KAMAI_PUBLIC_URL` = `https://aptsystems.vercel.app` (if I tell you my main address is `https://apt.assorted.group`, use that instead)

Do **not** redeploy. The values apply on the next deployment, which I will trigger by merging the pull request.

## Part 3 (optional, only if I confirm I use these custom domains): extra login redirect URLs
In Supabase, Authentication, URL Configuration, Redirect URLs: **add** (keep all existing ones, do not change the Site URL):
- `https://apt.assorted.group/auth/callback` and `https://apt.assorted.group/auth/accept`
- `https://apt.assortedtrade.com/auth/callback` and `https://apt.assortedtrade.com/auth/accept`

## Report back
A short checklist:
- Part 1: pre-flight values; run result (success or exact error); the verify query values; any row-count decrease (should be none); advisor findings that mention kamai tables.
- Part 2: domain verification status; whether the API key and the four variables were added (names only, never values); the sender limitation if the domain was skipped.
- Part 3: done / skipped.
Then stop. Do not make any other changes.
