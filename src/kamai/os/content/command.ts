import { badge, type Intro, type TaskDef, type Tbl } from './types'

export const commandIntro: Intro = {
  title: 'Kamai: B2B Distribution Rail for Imported Brands',
  body: "Imported brands and small e-commerce operators have product and no distribution. Petrol shops and highway convenience stores want premium products and have no reliable supplier. Kamai connects them through a network of commission-based **Kamai Heroes**, backed by APT's 10-year delivery and collection infrastructure.",
}

export const commandTasks: TaskDef[] = [
  { id: 't1', panel: 'command', sort: 1, priority: 'P1', title: 'Run margin math on 10 APT SKUs — buy price vs petrol shop sell price', meta: 'Olive oil, Manuka honey, Caprice, Smart Flamingo, orthopedic supports + 5 more', owner: 'Ahsan / Mamoona' },
  { id: 't2', panel: 'command', sort: 2, priority: 'P1', title: 'Call Bykea B2B/Enterprise team — ask about batched multi-stop delivery rate', meta: 'Need per-drop cost for Rs 20,000+ B2B orders, not per-parcel consumer rate', owner: 'Ahsan' },
  { id: 't3', panel: 'command', sort: 3, priority: 'P1', title: 'Map 30 petrol stations and highway stops in Islamabad + Pindi with contact details', meta: 'PSO, Shell, Total, Attock, BP stations on N-5, M-2, Islamabad highway, Murree road', owner: 'Zohaib / Raheela' },
  { id: 't4', panel: 'command', sort: 4, priority: 'P1', title: 'Identify 5 Islamabad Shopify/imported brands to pitch as distribution partners', meta: 'Products already in D.Watson and Shams but not in petrol shops or general trade', owner: 'Ahsan / Raheela' },
  { id: 't5', panel: 'command', sort: 5, priority: 'P2', title: 'Send updated model summary email to Ali Raza', meta: 'Petrol shop angle, sourcing from direct importers, Bykea delivery model', owner: 'Ahsan' },
  { id: 't6', panel: 'command', sort: 6, priority: 'P2', title: 'Update Kamai Hero commission tiers to show correctly on website and app', meta: 'Current tiers: Rs 1,000 first order / Rs 500 repeat 10k+ / Rs 250 repeat below 10k', owner: 'Abdurrahman' },
  { id: 't7', panel: 'command', sort: 7, priority: 'P2', title: 'Draft one-page brand partnership pitch deck — "Sell through us"', meta: 'Target: importers and Shopify brands with no general trade distribution', owner: 'Ahsan / Barkha (design)' },
  { id: 't8', panel: 'command', sort: 8, priority: 'P1', title: 'Reduce outstanding AR — chase top 10 unpaid APT invoices', meta: 'Outstanding AR at {ar}. Collection is the working capital for Kamai JIT sourcing', owner: 'Zohaib / Mamoona' },
]

export const relationships: Tbl = {
  head: ['Person', 'Role', 'Status', 'Next Action'],
  rows: [
    ['Ali Raza', 'Abhi Bank — Credit line', badge('Warm', 'green'), 'Send model email'],
    ['Zafar Abbas', 'JDC Foundation — Hero recruitment', badge('Pending Ali intro', 'amber'), 'Wait for Ali to connect'],
    ['Bykea', 'Last-mile delivery partner', badge('To be contacted', 'amber'), 'Call B2B team this week'],
    ['Basit', 'Ex-equity interest', badge('Declined', 'dark'), 'Revisit if model solidifies'],
  ],
}

export const aliWarn = 'Do not wait on these. Build as if they are not coming. When they arrive, plug them in.'

export const aliDeliverables: Tbl = {
  head: ['Deliverable', 'What it Unlocks'],
  rows: [
    ['Credit line structure in writing', 'Sourcing scale, inventory buffer'],
    ['Bykea introduction', 'Last-mile delivery at B2B rate'],
    ['Zafar / JDC connection', 'Hero recruitment for KHI and LHR'],
  ],
}
