# APT CRM — Complete Deployment Guide
## Vercel + Google Apps Script + Firebase Auth

---

## OVERVIEW

```
Browser (Vercel)
    ↓ Google Sign-In (Firebase Auth)
    ↓ fetch() with API key
Google Apps Script Web App
    ↓ reads / writes
Google Sheet (APT_ERP)
```

---

## STEP 1 — Add the GAS API to your Apps Script

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. You'll see your existing script file (APT_RiderApp or similar)
4. Click the **+** button next to "Files" → Add a new script file
5. Name it `API`
6. Paste the entire contents of `APT_GAS_API.gs` into it
7. **Change the API key on line 7:**
   ```javascript
   var API_KEY = "APT_SECRET_2025";  // ← Change this to something secret
   ```
   Write it down — you'll need it in Step 4.
8. Click **Save** (Ctrl+S)

---

## STEP 2 — Deploy GAS as Web App

1. In Apps Script, click **Deploy → New Deployment**
2. Click the gear icon → select **Web App**
3. Set:
   - **Description:** APT CRM API v1
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
4. Click **Deploy**
5. **Copy the Web App URL** — looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
   Save this. You need it in Step 4.

> ⚠️ Every time you edit the GAS script, you must click
> **Deploy → Manage Deployments → Edit → New Version → Deploy**
> to publish changes.

---

## STEP 3 — Set up Firebase for Google Login

1. Go to **https://console.firebase.google.com**
2. Click **Add Project** → name it `apt-crm` → Continue
3. Disable Google Analytics (not needed) → Create Project
4. In the left sidebar: **Authentication → Get Started**
5. Click **Google** provider → Enable → Save
6. In left sidebar: **Project Settings** (gear icon)
7. Scroll down to **Your apps** → click `</>` (Web)
8. Register app name: `apt-crm-web` → Register
9. Copy the **firebaseConfig object** — looks like:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "apt-crm.firebaseapp.com",
     projectId: "apt-crm",
     ...
   };
   ```

10. Go to **Authentication → Settings → Authorized domains**
11. Add your Vercel domain: `your-app.vercel.app`

---

## STEP 4 — Set up the GitHub Repository

1. Go to **https://github.com/new**
2. Repository name: `apt-crm`
3. Private → Create repository

4. On your computer, create a new folder `apt-crm`
5. Inside it, create this file structure:
   ```
   apt-crm/
   ├── index.html
   ├── package.json
   ├── vite.config.js
   ├── .env.local          ← NOT committed to git
   ├── .gitignore
   └── src/
       ├── main.jsx
       ├── App.jsx
       └── APT_CRM_v3.jsx
   ```

6. Create `.gitignore`:
   ```
   node_modules/
   dist/
   .env.local
   .env
   ```

7. Create `.env.local` (this stays on your computer only):
   ```
   VITE_GAS_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   VITE_API_KEY=APT_SECRET_2025
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=apt-crm.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=apt-crm
   ```

8. Create `package.json`:
   ```json
   {
     "name": "apt-crm",
     "version": "1.0.0",
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview"
     },
     "dependencies": {
       "react": "^18.2.0",
       "react-dom": "^18.2.0",
       "firebase": "^10.7.0"
     },
     "devDependencies": {
       "@vitejs/plugin-react": "^4.2.0",
       "vite": "^5.0.0"
     }
   }
   ```

9. Create `vite.config.js`:
   ```javascript
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   export default defineConfig({ plugins: [react()] })
   ```

10. Create `index.html`:
    ```html
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>APT CRM</title>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.jsx"></script>
      </body>
    </html>
    ```

11. Create `src/main.jsx`:
    ```jsx
    import React from 'react'
    import ReactDOM from 'react-dom/client'
    import App from './App.jsx'
    ReactDOM.createRoot(document.getElementById('root')).render(<App />)
    ```

12. Copy `APT_CRM_v3.jsx` into `src/`

13. Push to GitHub:
    ```bash
    git init
    git add .
    git commit -m "Initial APT CRM"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/apt-crm.git
    git push -u origin main
    ```

---

## STEP 5 — Deploy to Vercel

1. Go to **https://vercel.com** → Log in with GitHub
2. Click **Add New Project**
3. Import your `apt-crm` repository
4. Framework: **Vite** (auto-detected)
5. Before clicking Deploy, click **Environment Variables**
6. Add each of these:

   | Name | Value |
   |------|-------|
   | `VITE_GAS_URL` | Your GAS Web App URL |
   | `VITE_API_KEY` | APT_SECRET_2025 (your secret) |
   | `VITE_FIREBASE_API_KEY` | From Firebase config |
   | `VITE_FIREBASE_AUTH_DOMAIN` | apt-crm.firebaseapp.com |
   | `VITE_FIREBASE_PROJECT_ID` | apt-crm |

7. Click **Deploy**
8. Vercel gives you a URL like `apt-crm.vercel.app`
9. Add this URL to Firebase Authorized Domains (Step 3, point 11)

---

## STEP 6 — Restrict who can log in

In `src/App.jsx`, the allowed emails list controls who can access:

```javascript
const ALLOWED_EMAILS = [
  "ahsanilyas35@gmail.com",
  "tahafayyazlp@gmail.com",
  // Add more team members here
];
```

Anyone who tries to log in with a Google account NOT in this list 
will be shown an "Access Denied" screen and signed out immediately.

---

## UPDATING THE APP

After making code changes:
```bash
git add .
git commit -m "Update: description of change"
git push
```
Vercel auto-deploys within 30 seconds. No manual steps needed.

After making GAS script changes:
1. Apps Script → Deploy → Manage Deployments
2. Edit → New version → Deploy

---

## TESTING THE API

You can test your GAS API directly in your browser:
```
YOUR_GAS_URL?action=customers&key=APT_SECRET_2025
YOUR_GAS_URL?action=invoices&key=APT_SECRET_2025
YOUR_GAS_URL?action=dashboard&key=APT_SECRET_2025
YOUR_GAS_URL?action=all&key=APT_SECRET_2025
```

Should return JSON with your real sheet data.

---

## TROUBLESHOOTING

**"Unauthorized" error:**
- Check API_KEY matches exactly in GAS and Vercel env vars

**CORS error:**
- Make sure GAS is deployed as "Anyone can access"
- Re-deploy GAS after any changes

**Firebase login not working:**
- Check your Vercel domain is in Firebase Authorized Domains
- Make sure Google provider is enabled in Firebase Auth

**Data not updating:**
- GAS changes need a new deployment version to take effect
- CRM has a Sync button — click it to force refresh

---

## SUMMARY CHECKLIST

- [ ] GAS API script added and saved
- [ ] GAS deployed as Web App, URL copied
- [ ] Firebase project created, Google Auth enabled
- [ ] Firebase config values copied
- [ ] GitHub repo created and code pushed
- [ ] Vercel project created with env vars set
- [ ] Vercel URL added to Firebase authorized domains
- [ ] Tested login with ahsanilyas35@gmail.com
- [ ] Tested data loads from real sheet
