# Cowork prompt: finish Kamai OS setup (Vercel env, Supabase Auth URLs, preview check)

Copy everything below the line into Cowork. It needs a browser where I am signed in to Vercel and Supabase.

---

You are helping me (Ahsan Ilyas, ahsanilyas35@gmail.com) finish the setup of a new feature called **Kamai OS** that lives on my existing website. Be careful: the website https://aptsystems.vercel.app/ is my **live legacy CRM** and must not be disturbed. Make only the changes listed here. If anything looks different from what I describe, **stop and tell me before changing anything**. Never change production deployments, domains, other environment variables, other Supabase settings, users, or data. Never show me or paste secret keys (service role keys, tokens) in your replies.

## Facts
- Vercel project: **aptsystems** (team "ahsans-projects"). Production URL: https://aptsystems.vercel.app/
- The code is in GitHub pull request #68 on branch `claude/kamai-os-c63gtk` (repo `ahsanilyas010/aptsystems`). It is still a draft and **not merged**, so Kamai is only visible on the preview deployment of that branch, not on production.
- Preview URL of that branch: https://aptsystems-git-claude-kamai-os-c63gtk-ahsans-projects-df1a625d.vercel.app (Vercel may ask me to sign in because of deployment protection; that is normal, use my Vercel login.)
- Supabase project: **aptcrm**, project ref `aliegtwlfphpeyvesyvi`, URL https://aliegtwlfphpeyvesyvi.supabase.co
- The database migration is already done. Kamai tables exist (all start with `kamai_`).

## Task 1 (optional but preferred): Vercel environment variables
Open Vercel, project aptsystems, Settings, Environment Variables. Check whether these two exist:
- `VITE_SUPABASE_URL` = `https://aliegtwlfphpeyvesyvi.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the project's **anon / publishable** key (public by design; get it from Supabase, Project Settings, API Keys. Do NOT use the service_role key).

If they are missing, add both for **Production and Preview** environments. If they already exist, leave them alone and just tell me their names and which environments they apply to (never show the values). Note: the app has built-in defaults for both, so if you can't find the right key, skip this task and tell me; nothing breaks without it.
Do not redeploy anything yourself.

## Task 2 (required): Supabase Auth redirect URLs
Open Supabase, project aptcrm, Authentication, URL Configuration.
- Under **Redirect URLs**, **add** these two entries (keep every existing entry; do not delete or edit others):
  - `https://aptsystems.vercel.app/auth/callback`
  - `https://aptsystems.vercel.app/auth/accept`
- Do **not** change the **Site URL**.
- Save, then re-open the page and confirm both entries are listed. Tell me the full list of redirect URLs now present (URLs only).

## Task 3: check the preview (read-only; log in only as me)
1. Open the preview URL above. Sign in to Vercel if asked.
2. **Legacy CRM check at `/`:** the page should look and behave like the usual APT CRM login/dashboard. Report anything that looks broken (unstyled page, missing logo, wrong fonts, errors, blank screen). I'll tell you if it's fine to log in; for now only look at the login screen unless I say otherwise.
3. **Kamai check at `/os`:** go to `<preview URL>/os`. You should see a Kamai login page. Log in with **my email ahsanilyas35@gmail.com** and the password I give you in this chat (ask me for it; do not guess, do not reset it, do not create accounts). If I'm not available, just report what the login page looks like and stop.
4. After login, report: does the "Command" dashboard load, are the sidebar pages (Platform, Tenants, Orders, Credit, Audit, Settings) clickable, and does anything show an error such as "no access", a red banner, or an empty page? Take a screenshot of each page you visit and summarise any error text word for word.
5. Do not click any button that creates, changes, deletes or sends something (no "Create tenant", "Import legacy", "Send", "Settle", etc.). Look only.

## Report back
Give me a short checklist:
- Task 1: env vars found/added/skipped.
- Task 2: both redirect URLs present (yes/no), full URL list.
- Task 3: legacy `/` OK or issues; `/os` login OK or issues; page-by-page results with any error text.
Then stop. Do not make any other changes.
