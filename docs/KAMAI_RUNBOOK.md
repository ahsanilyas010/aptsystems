# Kamai OS Operator Runbook

Audience: the platform operator (ahsanilyas35@gmail.com). Spec: `docs/KAMAI_OS_PLAN.md`.
Public host for everything: `https://apt.assorted.group` (Vercel Deployment Protection blocks
`aptsystems.vercel.app` and preview URLs for OAuth redirects and webhooks).

## a. Vercel environment variables

Add in Vercel, Project, Settings, Environment Variables. Set Production AND Preview unless noted.

| Variable | Scope | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | client (public) | `https://aliegtwlfphpeyvesyvi.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | client (public) | Publishable anon key. Safe to expose; RLS protects data. |
| `SUPABASE_URL` | server | Same project URL. Already used by `api/supabase.js`. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Already present. Used by `api/kamai-admin.js`, `kamai-whatsapp.js`, `kamai-cron.js`. Never `VITE_`. |
| `SUPABASE_ANON_KEY` | server (optional) | Used by `kamai-admin` to run the delivery-OTP RPC as the caller. Falls back to `VITE_SUPABASE_ANON_KEY`. |
| `CRON_SECRET` | server | Random 32+ chars. Guards `GET /api/kamai-cron`. |
| `WHATSAPP_ACCESS_TOKEN` | server, optional | System User token (never expires). |
| `WHATSAPP_PHONE_NUMBER_ID` | server, optional | From WhatsApp, API setup. |
| `WHATSAPP_WABA_ID` | server, optional | For template management. |
| `WHATSAPP_APP_SECRET` | server, optional | HMAC key for `X-Hub-Signature-256`. Without it the webhook rejects every POST with 401. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | server, optional | Random string you choose; must match the Meta webhook config. |
| `WHATSAPP_GRAPH_VERSION` | server, optional | `v25.0` (default in code). |
| `RESEND_API_KEY` | server, optional | Resend API key for admin emails (distributor sign-up, products submitted). Missing => notifications are `skipped`, never an error. |
| `KAMAI_ADMIN_EMAIL` | server, optional | Recipient of review emails. Default `ahsanilyas35@gmail.com`. |
| `KAMAI_FROM_EMAIL` | server, optional | Sender. Default `Kamai OS <onboarding@resend.dev>`. |
| `KAMAI_PUBLIC_URL` | server, optional | Base for links in emails (`/os/reviews`). Default `https://aptsystems.vercel.app`. |
| `KAMAI_HASH_SALT` | server, optional | Salt for hashed IP/email in `kamai_signup_log` (sign-up rate limit). Falls back to a value derived from the service key. |

The client does not require the two `VITE_` variables: `src/kamai/lib/supabase.ts` falls back to
the public project URL and anon key. Set them anyway so the values are explicit per environment.
Without the `WHATSAPP_*` variables Kamai still works: sends are queued in `kamai_wa_messages`
(status `queued`) and the UI offers `wa.me` links instead.

After changing env vars, redeploy (env changes apply only to new deployments).

## b. Supabase Auth dashboard (project aliegtwlfphpeyvesyvi)

Authentication, URL Configuration:
- Site URL: leave unchanged.
- Redirect URLs, add: `https://apt.assorted.group/auth/callback` and
  `https://apt.assorted.group/auth/accept`. Keep the existing `https://apt.assorted.group/apt-finance/`
  entry (and any other existing entries) so apt-finance keeps working.

Authentication, Sign In / Providers:
- Email provider enabled; minimum password length 8 (store PINs are 6 digits, so see note below).
- Email OTP expiry at most 3600 seconds.
- Phone provider is NOT required: stores log in with a synthetic email
  `store-<92xxxxxxxxxx>@kamai.assorted.group` plus a 6-digit PIN, created by `api/kamai-admin.js`.

Note: the admin API (`createUser`/`updateUserById`) sets passwords server-side, but with a minimum
length of 8 a 6-digit PIN is rejected by GoTrue. Resolve before provisioning stores by either
keeping the minimum at 6 (then document the reduced strength; note there is NO application-level
lockout today: login is a direct Supabase password grant from the browser, so only Supabase's
per-IP auth rate limits apply and distributed guessing of a 6-digit PIN against a derivable
`store-<mobile>@kamai.assorted.group` identifier is feasible; a lockout needs a Supabase auth
password-verification hook or a server-side login proxy, tracked as a follow-up) or padding the PIN client and server side (for example password = PIN + fixed
pepper). Decide this at first run; the code currently sends the raw 6-digit PIN.

## c. Applying migrations and verifying

Files live in `supabase/migrations/` and must be applied in filename order (`20261108120001_...`
first). Apply each through the Supabase connector (`apply_migration`, project
aliegtwlfphpeyvesyvi), one at a time, stopping at the first error. They are idempotent and only
create `kamai_`-prefixed objects plus the `private` schema; nothing existing is altered.

Verify after each batch:
1. `list_tables` shows the new `kamai_*` tables with RLS enabled.
2. Run the advisors (`get_advisors` security and performance) and fix any new warning on `kamai_` objects.
3. Run the RLS test (`supabase/tests/`, pgTAP) or the probe SQL referenced in `src/kamai/README.md`:
   a distributor member sees only their tenant, a store user only their store, anon sees nothing.
4. Confirm `select count(*) from kamai_platform_admins` is 1 (the seeded admin).

## d. First run

1. Open `https://apt.assorted.group/auth/login` and sign in as `ahsanilyas35@gmail.com` (platform admin seed).
2. Open `/os`. The dashboard reads live KPIs through `kamai_os_kpis`.
3. Go to `/os/tenants` and create a distributor tenant (for APT itself, use the existing slug for
   the platform tenant `kamai` only for platform-level data; create `apt` as the distributor).
4. Invite the tenant owner (provision_user with role `owner` and an email). If the invite email
   does not arrive, the response contains `action_link`; share it manually.
5. The owner signs in, imports stores (CSV) at `/distributor/stores`, and provisions store PINs
   there (role `store`, mobile required). Share each store's mobile number and PIN privately.

## e. WhatsApp onboarding (optional, do after the above works)

1. Create or verify the Meta Business Portfolio (Business Verification lifts the 250 recipients
   per 24h limit).
2. Add a dedicated +92 number that can receive an SMS/voice code and is NOT registered in the
   consumer or Business WhatsApp app.
3. Create a System User (Business Settings, System Users) with `whatsapp_business_messaging` and
   `whatsapp_business_management`, assign the WABA, generate a never-expiring token:
   `WHATSAPP_ACCESS_TOKEN`. Note `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`.
4. Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and the other variables in Vercel and redeploy FIRST: the
   webhook must answer the GET challenge before Meta will save it.
5. Webhook callback URL `https://apt.assorted.group/api/kamai-whatsapp`, verify token as above.
   Subscribe the WABA to fields `messages` and `message_template_status_update`.
6. Store the phone number id on the tenant: `update kamai_tenants set settings = settings ||
   '{"wa_phone_number_id":"<id>"}' where slug = '<tenant>'` (inbound events from a phone number id
   that no tenant carries are ignored and logged, there is no fallback tenant, so this step is required).
7. Submit these templates (language `en`, Roman Urdu text; Meta reviews content, not script):
   - `kamai_order_confirmed` UTILITY: "Salam {{1}}, aapka Kamai order {{2}} confirm ho gaya hai.
     Total: {{3}}. Delivery kal subah hogi." Footer "Kamai by Assorted Produce Traders". Buttons:
     quick reply "Dobara order", URL "Order dekhein" `https://apt.assorted.group/store/orders/{{1}}`.
   - `kamai_order_dispatched` UTILITY: "Salam {{1}}, aapka order {{2}} dispatch ho gaya hai. Rider
     {{3}} lagbhag {{4}} tak pohanchega."
   - `kamai_delivery_otp` AUTHENTICATION: COPY_CODE button, add_security_recommendation true,
     code_expiration_minutes 10 (body text is fixed by Meta; create it in WhatsApp Manager or a raw
     Graph call, the Meta MCP connector cannot create AUTHENTICATION templates).
   - `kamai_invoice_due` UTILITY: "Salam {{1}}, invoice {{2}} ki raqam {{3}} ki akhri tareekh {{4}}
     hai." URL button `https://apt.assorted.group/store/invoices/{{1}}`.
   - `kamai_payment_overdue` UTILITY: "Salam {{1}}, invoice {{2}} ki raqam {{3}} {{4}} din se baqi
     hai. Barae meherbani adaigi karein." No promotional words (offer, deal, exclusive, upgrade).
8. Send a test template to an opted-in internal number from `/os` or via `kamai-admin` `send_whatsapp`.

Rules enforced by `api/kamai-admin.js`: business-initiated templates require
`kamai_wa_contacts.opted_in_at` (else `NO_OPT_IN` with a `wa.me` fallback), except authentication
templates, which only the internal delivery-OTP path may use (the public `send_whatsapp` action
rejects them, only sends to existing `kamai_wa_contacts` of the tenant, and accepts only text/payload
template parameters); free text only inside the 24h window. A store message that is exactly
STOP/BAND/UNSUBSCRIBE sets `opted_out_at`; exactly START/RESUME clears it; any other message never
re-enables a stopped contact. Inbound retries are idempotent and the webhook answers 500 on a
persistence failure so Meta retries.

Account rules in `api/kamai-admin.js`: `provision_user` never changes the password or metadata of an
existing account (use `reset_pin`), never overwrites or re-activates an existing membership, and
refuses platform admins and users who already belong to another tenant unless the caller is a
platform admin. `reset_pin` / `disable_user` refuse platform admins, require every tenant of the
target to be managed by the caller, and require the caller's role to outrank the target's;
`reset_pin` only works on `@kamai.assorted.group` PIN logins. Re-enabling a disabled member
currently needs a platform admin (SQL). `send_delivery_otp` allows one issue per 60 s and 5 OTP
messages per order per hour. Budget roughly PKR 3-4.5 per utility/auth message and PKR 13-14 per marketing
message; confirm against Meta's official rate card.

## f. Legal and compliance gates (before enabling financed states)

- SECP perimeter opinion: Kamai as whitelisted partner platform of Abhi (Circulars 3/2023 and 12/2024).
- Data residency check for borrower data (Circular 15/2022).
- FBR digital invoicing enrolment per distributor tenant (SRO 1852(I)/2025). The schema is ready;
  no FBR API calls ship in v1.
- WhatsApp Business Account verification, and a short counsel check on B2B transactional consent
  wording (PECA 2016 / PTA rules).

## g. Security follow-ups

- `api/supabase.js`, `api/gas.js`, `api/invoice.js` are unauthenticated or shared-secret service-role
  endpoints with CORS `*`. Kamai does not use them. Lock them down (Bearer token verification as in
  `kamai-admin.js`, origin allow-list) before inviting external tenants.
- `handle_new_user` grants `rider` to every new auth user; `kamai-admin` removes it for non-rider
  personas, but self-signups through the public sign-up form still receive it. Disable public
  sign-ups in Supabase Auth if only invited users should exist.
- `products` is readable by any authenticated user including tenant users (trade prices visible).
- Add the `web-push` dependency or remove the dead push code if present.
- `auth.admin.signOut` in the installed auth-js takes a JWT, not a user id, so `disable_user`
  bans the login (`ban_duration`) but cannot revoke live sessions; existing access tokens lapse at
  JWT expiry. Lower the JWT expiry if immediate revocation matters.
- Rotate `WHATSAPP_ACCESS_TOKEN` via Business Settings if leaked; rotate `CRON_SECRET` freely.

## h. Rollback

- Disable Kamai routes: remove the SPA rewrite for Kamai paths from `vercel.json` (or revert the
  router change in `src/main.jsx`), redeploy. The legacy CRM at the root keeps working untouched.
- Disable the API: delete `api/kamai-*.js` or unset `SUPABASE_SERVICE_ROLE_KEY` for Preview only.
- Database: all `kamai_*` tables, functions and the `private` schema are isolated. To remove them,
  drop the `kamai_` objects in reverse migration order; no existing table, enum, trigger, policy or
  bucket was altered. Take a backup first (`pg_dump` of `kamai_*` tables).
- Pause pg_cron: `select cron.unschedule('<kamai job name>')`.

## Ops endpoints

- `GET /api/kamai-cron` with `Authorization: Bearer $CRON_SECRET` runs `kamai_run_daily()` on demand.
- `POST /api/kamai-admin` actions: `provision_user`, `reset_pin`, `disable_user`, `send_whatsapp`,
  `send_delivery_otp` (Bearer Supabase access token required).

## Distributor sign-up and admin email

Flow: `/auth/signup` -> `POST /api/kamai-signup` (public, honeypot field `website`, 5 sign-ups/hour per
IP hash, 3/day per email hash, via `kamai_signup_log`) creates the auth user (email pre-confirmed), a
`distributor` tenant with `settings.onboarding_status='pending_review'` and the owner membership, a
`kamai_admin_notifications` row (`distributor_signup`) and emails the admin. Submitting products
(`kamai_submit_products`) adds a `products_submitted` notification; the console then calls
`POST /api/kamai-notify` (Bearer user token) which emails every pending/failed notification of the
caller's tenants (platform admins: all). `GET /api/kamai-cron` also retries them (max 5 attempts per row).
If the email never arrives, the notification is still listed in `/os/reviews` (Notifications tab) with
its `email_status` (`sent`, `failed`, `skipped`, `pending`) and `email_error`.

Resend sender-domain step (needed to email anyone other than yourself):
1. Create a Resend account and an API key (Sending access); set `RESEND_API_KEY` in Vercel.
2. Until a domain is verified, only `onboarding@resend.dev` works and Resend delivers only to the email
   of the Resend account owner. Make that address `KAMAI_ADMIN_EMAIL` (or sign up to Resend with it).
3. Recommended: Resend, Domains, add your domain, add the DKIM/SPF (and optional DMARC) DNS records,
   wait for "Verified", then set `KAMAI_FROM_EMAIL="Kamai OS <noreply@yourdomain.com>"`.
4. Set `KAMAI_PUBLIC_URL` to the host you actually use (e.g. `https://apt.assorted.group`) and redeploy.
5. Supabase Auth: sign-ups do not use Supabase confirmation emails (the user is created pre-confirmed
   by the API), so the Site URL being localhost does not affect distributors.
