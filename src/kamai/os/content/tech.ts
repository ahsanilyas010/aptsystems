import { b, badge, link, prio, type Intro, type Tbl } from './types'

export const techIntro: Intro = {
  title: 'Technology — What You Actually Have',
  body: 'You have two live GitHub repos, a provisioned Supabase instance, and a CRM running on Vercel. This is not a prototype. **It is a production system that has invoiced Rs 6.42M, now running on Supabase.**',
}

export const stack: Tbl = {
  head: ['Component', 'Tech', 'Location', 'Status', 'Limit / Next'],
  rows: [
    [b('Kamai Hero App'), 'PWA (HTML/JS)', link('apt-rider-connect', 'https://github.com/ahsanilyas010/apt-rider-connect'), badge('Live', 'green'), 'Migrate to Supabase backend from GAS'],
    [b('APT CRM + ERP'), 'Vite + React 18, Firebase Auth', link('aptsystems.vercel.app', 'https://aptsystems.vercel.app'), badge('Live', 'green'), 'Multi-city support, Supabase backend'],
    [b('Rider Delivery App'), 'PWA', 'riders2.assortedtrade.com', badge('Live', 'green'), 'Route optimisation, batched stops'],
    [b('Backend (current)'), 'Google Apps Script Web App', 'APT_GAS_API_v2.gs', badge('Retired', 'dark'), 'Replaced by Supabase. Sheets no longer updated'],
    [b('Database (live)'), 'Supabase (PostgreSQL)', 'aliegtwlfphpeyvesyvi.supabase.co', badge('Live, source of truth', 'green'), 'Enable RLS on 8 finance tables. Dedupe stores table'],
    [b('Auth'), 'Firebase Auth (Google Sign-In)', 'Allowlist-gated in APT_CRM_v3.1.jsx', badge('Live', 'green'), 'Add team members via ALLOWED_EMAILS'],
    [b('CI/CD'), 'GitHub Actions → Vercel', 'Auto-deploy on push to main', badge('Live', 'green'), '~30 seconds per deploy'],
    [b('Public Site'), 'Static', 'kamai.assorted.group', badge('Live', 'green'), 'Dynamic catalog in M2'],
  ],
}

export const sprints: Tbl = {
  head: ['Sprint', 'Task', 'Why', 'Est. Time'],
  rows: [
    [prio('P1', 'Sprint 1'), 'Add RLS policies to finance tables and dedupe stores', 'customers, invoices, payments and 5 more tables are open to the anon key; D.Watson and Shaheen branches are duplicated in stores', '2–3 days'],
    [prio('P1', 'Sprint 1'), 'Auto-commission calculator on order approval', 'Manual payout calc does not scale past 50 active Heroes', '2–3 days'],
    [prio('P1', 'Sprint 1'), 'WhatsApp confirmation message to store on order approval', 'Cuts cancellations — store knows order is coming', '1 day (WhatsApp Business API)'],
    [prio('P2', 'Sprint 2'), 'Multi-city area management', 'ISB + KHI + LHR cannot run on single-city assumption', '3–4 days'],
    [prio('P2', 'Sprint 2'), 'GPS route optimisation for delivery', 'Batch multiple store drops per run — cuts per-drop cost', '1 week (Google Maps API)'],
    [prio('P2', 'Sprint 2'), 'Product image catalog in Hero app', 'Heroes need to show store owners visuals, not a text list', '2–3 days + photography'],
    [prio('P3', 'Sprint 3'), 'Read-only brand portal', 'Show brands their SKU orders by city and store — justifies brand service fee', '1 week'],
    [prio('P3', 'Sprint 3'), 'Bykea API integration', 'Auto-create Bykea pickup request on order dispatch — remove manual step', 'Depends on Bykea B2B contract'],
    [prio('P3', 'Sprint 4'), 'Multi-tenant distributor console', 'Tenant per distributor: store import, price lists, invoices, credit limits (Platform Plan Lane B)', '2 to 3 weeks'],
    [prio('P3', 'Sprint 4'), 'Credit engine, delivery proof and Abhi feed', 'Rule-based limits, OTP + photo + GPS proof, daily data export and read-only Abhi dashboard', '2 weeks'],
    [prio('P3', 'Sprint 5'), 'Payment reconciliation and WhatsApp dunning', 'Reference per store, auto-match, reminder ladder', '1 to 2 weeks'],
  ],
}

export const infraCost = [
  { label: 'Current Monthly Cost', value: 'Rs 0', sub: 'Vercel + Supabase + Firebase all on free tiers', tone: 'light' as const },
  { label: 'At 1,000+ Heroes', value: '~5K', sub: 'PKR/month — Supabase Pro + Vercel Pro', tone: 'light' as const },
  { label: 'Tech Risk Level', value: 'Low', sub: 'Stack is standard. Migration is a sprint, not a rewrite.', tone: 'dark' as const },
]
