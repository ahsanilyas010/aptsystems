# APT CRM — Vite + React

**Assorted Produce Traders — Distribution Management System**

A full-featured CRM built with Vite + React 18, backed by a Google Apps Script Web App and Firebase Authentication.

## Features

- 🔐 **Google Sign-In** via Firebase Auth (allowlist-gated)
- 📊 **Live Dashboard** — KPIs, P&L snapshot, AR alerts
- 🧾 **Invoices** — create, view, mark paid, void, generate PDF
- 👥 **Customers & Vendors** — full ledger views
- 🛒 **Purchases & Expenses** — procurement tracking
- 📦 **Inventory** — stock levels & low-stock alerts
- 📈 **P&L, AR/AP, Reports** — financial analytics

## Project Structure

```
aptsystems/
├── index.html
├── package.json
├── vite.config.js
├── .env.example        ← template for env vars
├── .gitignore
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    └── APT_CRM_v3.1.jsx   ← main CRM component
```

## Local Development

1. Clone the repo
2. Copy `.env.example` → `.env.local` and fill in your values
3. Install & run:
   ```bash
   npm install
   npm run dev
   ```

---

## Deployment (Vercel + GAS + Firebase)

### 1 — Vercel Environment Variables

In your Vercel project dashboard → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `VITE_GAS_URL` | Your GAS Web App URL (`https://script.google.com/macros/s/.../exec`) |
| `VITE_API_KEY` | Your GAS secret API key |
| `VITE_FIREBASE_API_KEY` | From Firebase project settings |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | e.g. `your-project-id` |

### 2 — Vercel Build Settings

| Setting | Value |
|---|---|
| Framework | Vite (auto-detected) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

### 3 — Firebase Authorized Domains

In [Firebase Console](https://console.firebase.google.com) → **Authentication → Settings → Authorized domains**, add:

- `your-app.vercel.app` (your Vercel deployment URL)
- Any custom domain if applicable

### 4 — Allowed Emails

The CRM restricts access to specific Google accounts. Edit `src/APT_CRM_v3.1.jsx` line ~27:

```js
const ALLOWED_EMAILS = [
  "ahsanilyas35@gmail.com",
  "tahafayyazlp@gmail.com",
  // add more team members here
];
```

### 5 — GAS Backend Updates

After any changes to `APT_GAS_API_v2.gs`:
1. Apps Script → **Deploy → Manage Deployments**
2. Edit → **New version** → Deploy
3. The Web App URL stays the same — no Vercel redeployment needed.

### 6 — Triggering a Vercel Redeploy

```bash
git add .
git commit -m "Update: description"
git push
```
Vercel auto-deploys within ~30 seconds of a push to `main`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unauthorized` error | Check `VITE_API_KEY` matches GAS script exactly |
| CORS error | Re-deploy GAS as "Anyone can access" |
| Firebase popup blocked | Allow popups in browser; check Authorized Domains |
| Data stale | Click **↻ Sync** in the CRM or wait for auto-refresh |
