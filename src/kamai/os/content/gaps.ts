import type { Intro, TaskDef, Tbl } from './types'

export const gapsIntro: Intro = {
  title: 'Things You Have Not Thought About Yet',
  body: 'These are real gaps that will hit you at scale. Address them early, not when they become fires.',
}

const head = ['Gap', 'Risk', 'Fix']

export const gapSections: Array<{ title: string; table: Tbl }> = [
  { title: 'Legal and Regulatory', table: { head, rows: [
    ['No formal Hero agreement', 'Hero claims employment, demands benefits', 'Draft a one-page "Kamai Hero Terms" with independent contractor clause'],
    ['No distribution agreement with brands', 'Brand pulls product mid-season, no recourse', 'Draft standard 2-page distribution agreement template'],
    ['Import compliance for new SKUs', 'Customs holds a shipment — you have stock commitment to stores', 'Always confirm clearance status before promising delivery to store'],
    ['Credit sales have no documentation', 'Store disputes the amount, you have nothing in writing', 'WhatsApp order confirmation + signed delivery receipt — minimum standard'],
  ] } },
  { title: 'Financial Controls', table: { head, rows: [
    ['{ar} AR with no structured chase process', 'Cash flow collapse — cannot fund next sourcing cycle', 'Weekly AR aging meeting — Mamoona + Ahsan'],
    ['No store credit limit per account', 'One store racks up Rs 200K in credit and disappears', 'Set maximum credit limit per store tier (Rs 25K, Rs 50K, Rs 100K)'],
    ['Hero commissions not automated', 'Disputes, payment errors, Heroes lose trust', 'Auto-calculate in CRM on order approval'],
    ['No product-level P&L tracking', 'Carrying SKUs at a loss without knowing', 'Add cost price to every SKU in CRM — generate gross margin per product'],
  ] } },
  { title: 'Operational Gaps', table: { head, rows: [
    ['No returns process', 'Store returns expired/damaged product, no SOP for what happens', 'Write a one-page returns policy — Hero handles pickup, credit note within 7 days'],
    ['No Hero performance review process', 'Inactive Heroes stay on roster, no accountability', 'Monthly Hero review — Heroes with zero orders in 30 days get outreach then offboarded'],
    ['Product photos missing from catalog', 'Store owner cannot assess the product from a text list', 'Photograph every APT SKU with a white background — add to app catalog'],
    ['No onboarding SOP for new cities', 'Karachi launch will be chaotic without a playbook', 'Document ISB/Pindi launch as a playbook — replicate for each new city'],
  ] } },
  { title: 'Platform Gaps (Lanes A and B)', table: { head, rows: [
    ['Lending perimeter unclear', 'Kamai acts as unlicensed lender', 'Abhi owns credit. Lawyer opinion before pilot'],
    ['APT conflict of interest', 'Distributors refuse to share store data', 'Ring-fence APT. Neutrality clause'],
    ['FBR sales tax invoicing', 'Invoices rejected by larger buyers', 'Check e-invoicing requirements before distributor launch'],
    ['Hero and store collusion', 'Fake orders, fake delivery proof', 'GPS, photo, OTP, exposure caps, random audits'],
    ['Founder bottleneck', 'Every deal routes through Ahsan', 'Hire distributor success manager by M3'],
    ['WhatsApp Business policy', 'Number banned for bulk messaging', 'Opt-in only, templates, keep volume gradual'],
  ] } },
]

export const gapTasks: TaskDef[] = [
  { id: 'g1', panel: 'gaps', sort: 1, priority: null, owner: null, title: 'Expiry date management — imported products have fixed shelf life', meta: 'Set a rule: no product within 6 months of expiry goes into the channel. Track batch dates in ERP.' },
  { id: 'g2', panel: 'gaps', sort: 2, priority: null, owner: null, title: 'PSQCA labelling compliance for imported goods', meta: 'Every imported product sold in Pakistan needs Urdu labelling and local importer information. Check every new SKU before it goes to stores.' },
  { id: 'g3', panel: 'gaps', sort: 3, priority: null, owner: null, title: 'Hero fraud controls beyond the current rules', meta: 'Add: max 3 new stores per Hero per day (prevents bulk fake registration), GPS radius check on store check-in, photo verification of shelf placement on first delivery.' },
  { id: 'g4', panel: 'gaps', sort: 4, priority: null, owner: null, title: 'Seasonal demand planning', meta: 'Honey, energy drinks, and personal care have seasonal peaks. Plan stock levels 60 days in advance for Ramadan, Eid, and summer.' },
  { id: 'g5', panel: 'gaps', sort: 5, priority: null, owner: null, title: 'Warehouse capacity — can APT handle 2x the current SKU volume?', meta: 'As you add new brands, storage becomes a constraint. Confirm current warehouse capacity and when you hit the ceiling.' },
  { id: 'g6', panel: 'gaps', sort: 6, priority: null, owner: null, title: 'A competitor enters the petrol shop channel', meta: 'Dawlance/SuperSave and similar players have tried retail distribution plays before. Monitor. Your defensibility is the Hero network and store relationships — not the product.' },
]
