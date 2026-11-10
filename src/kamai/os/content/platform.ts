import { b, type Intro, type Tbl, type TimelineItem } from './types'

export const platformIntro: Intro = {
  title: 'Platform Plan: Three Lanes, One Rail',
  body: 'Kamai becomes the order, delivery and collection rail between supply (distributors, brands) and demand (stores). Abhi funds the credit gap. Bykea supplies logistics. Sequence matters: Lane B first, Lane A second, Lane C capped.',
}

export const lanes: Tbl = {
  head: ['Lane', 'How it works', 'Who funds', 'Kamai earns', 'Start'],
  rows: [
    [b('B. Distributor OS + finance'), 'Distributor enlists own stores. Uses Kamai order booking, invoicing, credit limits. Abhi pays distributor on delivery proof. Store repays Abhi on due date.', 'Abhi', 'SaaS fee, share of financing spread, collection fee', 'M1 pilot, 2 to 3 distributors'],
    [b('A. Aggregator'), 'Distributors and brands list SKUs on Kamai at an agreed trade margin. Order lands, Kamai delivers, collects, remits net of margin.', 'Float only (delivery to collection)', '6 to 10% of order value (assumption, test it)', 'M4'],
    [b('C. Own JIT (today)'), 'APT sources imported SKUs, sells to petrol shops and convenience stores via Heroes.', 'APT cash', 'Full margin, about 22%', 'Running. Cap it.'],
  ],
}

export const weakTitle = 'Where this idea is weak. Fix these before scaling.'

export const weaknesses: Array<{ title: string; text: string }> = [
  { title: 'Your base metrics are not ready for lender money.', text: '9% Hero activation, 33% cancelled orders, Rs 0.79M AR over 60 days. Gate: no Abhi drawdown until a 50-order cohort shows 90%+ collected within terms.' },
  { title: 'Default ownership decides everything.', text: 'Recommended: Abhi owns credit risk, Kamai posts a capped first-loss reserve (start at 5% of disbursed, illustrative) and earns a collection fee. If Kamai carries full default risk you behave like an unlicensed lender. Get SBP/SECP perimeter advice from a lawyer before term sheet signing.' },
  { title: 'Cash collection by riders leaks.', text: 'Move stores to Raast / wallet / QR with a reference per store. Cash is the fallback, with same-day deposit.' },
  { title: 'Distributors will not give "a good margin" for orders they already win.', text: 'Pitch incremental stores they cannot reach and credit they cannot fund. Take margin only on new stores. Charge SaaS on their existing stores.' },
  { title: 'APT is both your supplier and a competitor to Lane B distributors.', text: 'Ring-fence it. Separate books, no access to distributor store data, written neutrality clause. Otherwise no serious distributor signs.' },
  { title: 'Stickiness risk.', text: 'A distributor can learn the tool, then move stores off platform. Counter: financing sits inside Kamai, invoices live in Kamai, data terms in the agreement.' },
  { title: 'Bykea dependency.', text: 'Start as their customer. Do not build the model on their rider list until they agree in writing.' },
]

export const biggerPicture: Tbl = {
  head: ['Layer', 'Role', 'Built from'],
  rows: [
    [b('Supply'), 'Stocks vendors and stores', 'APT, importers, distributors (Lanes A, B, C)'],
    [b('Finance rail'), 'Funds distributor invoices, vendor stock and store credit', 'Abhi'],
    [b('Logistics'), 'One rider pool serves B2B drops and consumer orders. Shared density lowers cost per drop.', 'Bykea, then Kamai-managed riders'],
    [b('Demand (Neighborhood app)'), 'Consumers order Food, Pharmacy and Beauty from local vendors. Stock bought on order. Kamai keeps a margin per order. Openers and maintainers run local points.', "Today's stores become vendors. Today's Heroes become openers and maintainers."],
  ],
}

export const demandRules =
  '**Rules for the demand layer.** No consumer app build until the Phase 1 gate passes. Pilot in one sector with about 10 vendors, ordering over a WhatsApp catalog first. Use B2B payment history to pick which vendors get stock on order. Check licensing before Pharmacy (pharmacist and drug regulator rules) and Food (food authority rules). Start with the category that needs the least licensing.'
export const demandRisks =
  '**Risks.** Consumer acquisition cost. Rider cost per consumer drop. One small tech team building two products. Competing with established food and grocery delivery apps on their strongest ground. Protect focus: the rail comes first, the consumer layer rides on it.'

export const execApp: Tbl = {
  head: ['#', 'Step', 'Detail', 'Owner'],
  rows: [
    ['1', 'Multi-tenant core', 'Tenant = distributor. Catalog, price lists by store tier, stores, users per tenant. Row-level security on every table first.', 'Abdurrahman'],
    ['2', 'Distributor console', 'CSV store import plus WhatsApp invite link. Catalog and price list upload. Credit limit per store. Invoice with NTN/STRN and tax lines (check FBR requirements).', 'Abdurrahman'],
    ['3', 'Store ordering', 'WhatsApp-first in Roman Urdu, PWA second. Reorder in two taps. Stores are low-tech, so UX is the product.', 'Abdurrahman / Raheela'],
    ['4', 'Order state machine', 'Booked, credit-approved, packed, dispatched, delivered (proof: OTP + photo + GPS), financed, paid, settled. Every state timestamped. Cancellation reason mandatory.', 'Abdurrahman'],
    ['5', 'Credit engine v1', 'Rules, not ML. Limit by tier, order history, days-to-pay. Exposure caps per store, per distributor, per Hero. Decision in under 10 seconds.', 'Mamoona + Abdurrahman'],
    ['6', 'Payments and reconciliation', 'Reference or virtual account per store. Auto-match inbound payments. WhatsApp dunning on a schedule.', 'Abdurrahman'],
    ['7', 'Ledger and settlement', 'Double-entry, immutable, per tenant. Auto commission. Weekly settlement statement to each distributor.', 'Mamoona'],
    ['8', 'Abhi portal and data feed', 'Read-only dashboard: disbursed, outstanding, PAR 7/30/60, collections. Daily data export or API.', 'Abdurrahman'],
    ['9', 'Standards', 'GS1 GTIN on catalog where available. OWASP ASVS Level 1 checks. Audit log. Daily backups. ISO 27001 aligned controls later.', 'Abdurrahman'],
  ],
}

export const execDistribution: Tbl = {
  head: ['#', 'Step', 'Detail'],
  rows: [
    ['1', 'Target list', 'Tier-2 distributors and small importers in ISB/Pindi with 50 to 150 stores, weak tech, cash-starved. 10 conversations to land 3 pilots.'],
    ['2', 'Pilot offer', '60 days. 20 stores each. Software free. Financing on their stores at Abhi pricing. Kamai margin only on new stores it brings.'],
    ['3', 'Onboarding', "Import stores, set price list, assign credit tiers, train the distributor's booker in one session. Go live in 7 days."],
    ['4', 'Agreements', 'Distributor agreement: margin, territory, returns, expiry rules, payment waterfall, data rights, APT neutrality clause. Store credit terms in the order confirmation.'],
    ['5', 'Aggregator listing (Lane A)', 'Only after Lane B shows 90% on-time collection. Brands list SKUs. Kamai buys on order, never speculative stock.'],
    ['6', 'Brand fee', 'Monthly fee and data reports once store count justifies it (150+ stores).'],
  ],
}

export const execRider: Tbl = {
  head: ['#', 'Step', 'Detail'],
  rows: [
    ['1', 'Split roles', 'Heroes sell and earn commission. Delivery riders deliver and earn per drop. Do not mix them. Different incentives, different fraud risks.'],
    ['2', 'Phase 1: Bykea as customer', 'Get a per-drop B2B rate for batched multi-stop runs. Test 50 deliveries. Measure cost per drop, delay, damage, cash handling.'],
    ['3', 'Phase 2: rider pool', "With Bykea's written consent, recruit from their rider base for Kamai-managed runs. Clarify exclusivity, data sharing and rider consent first."],
    ['4', 'Rider onboarding', 'CNIC, bike registration, one guarantor, one reference, one-hour training, app with proof of delivery.'],
    ['5', 'Pay and controls', 'Per drop plus on-time and collection accuracy bonus. Weekly pay. Cash cap per rider (start Rs 50,000, illustrative). Same-day deposit. OTP at delivery.'],
    ['6', 'Upsell path', 'Top riders become Heroes in their delivery corridors. Cheapest Hero recruitment channel you have.'],
  ],
}

export const execFinance: Tbl = {
  head: ['#', 'Step', 'Detail'],
  rows: [
    ['1', 'Written term sheet', 'Facility size in tranches, pricing, tenor (15 and 30 days), eligible receivables, concentration limits, first-loss, recourse, repayment waterfall, KYC ownership, reporting. "As large as needed" is not a term.'],
    ['2', 'Structure', 'Order-linked receivables finance. Abhi pays distributor on delivery proof. Store repays Abhi. Use ICC supply chain finance standard definitions in the contract language.'],
    ['3', 'Pilot cap', 'Rs 2M, 50 stores, 15-day tenor. Tranches: Rs 2M, then 10M, then 25M. Each unlocks on collection performance.'],
    ['4', 'Collection ladder', 'Day 0 invoice. Due minus 3 reminder. Due date call. Due plus 3 call. Plus 7 Hero visit. Plus 15 supply stop. Plus 30 recovery process.'],
    ['5', 'Reporting', 'PAR 7/30/60, roll rates, vintage curves by cohort, exposure per store and distributor. Weekly to Ali (existing Monday email carries the headline numbers).'],
    ['6', 'Compliance', 'KYC/AML on distributors and larger stores, SBP rules, data sharing consent, consumer terms. Lawyer review before pilot.'],
  ],
}

export interface PhaseDef extends TimelineItem {
  key: 'p0' | 'p1' | 'p2' | 'p3'
}

export const phases: PhaseDef[] = [
  { key: 'p0', month: 'Wk 1-4', title: 'Phase 0: Fix and prove', desc: 'Cut cancellations. Auto commission. RLS on finance tables. SKU margin math. Bykea call. Abhi term sheet. Lawyer call on lending perimeter. Exit gate: cancel rate under 15%, Hero activation 25%, AR over 60 days under Rs 0.4M.' },
  { key: 'p1', month: 'M2-3', title: 'Phase 1: Lane B pilot', desc: '3 distributors, 60 stores, Rs 2M Abhi cap, Bykea Phase 1. Exit gate: 90%+ collected within terms, 50% repeat order rate, cost per drop known.' },
  { key: 'p2', month: 'M4-6', title: 'Phase 2: Aggregator and scale in twin cities', desc: '10 distributors and brands, 150 to 250 stores, Rs 10M tranche. Lane A live. Brand fee starts. Hire area manager and credit analyst.' },
  { key: 'p3', month: 'M7-12', title: 'Phase 3: KLI playbook', desc: 'Karachi via JDC and Bykea, Lahore after. Copy the Islamabad playbook. Raise next round on collected GMV and PAR data, not on registrations.' },
]

export const segments: Tbl = {
  head: ['Segment', 'Hook', 'Channel', 'Metric'],
  rows: [
    ['Distributors', 'Free software plus funded credit for your stores. Get paid on delivery.', 'Direct visits via Zohaib and Ahsan, APT network referrals, 1 case study', 'Pilots signed, stores imported'],
    ['Brands and importers', 'Reach stores you cannot reach. Weekly sell-through data.', 'LinkedIn, Instagram DM, email, Karachi trader network', 'SKUs listed, repeat orders per SKU'],
    ['Stores', 'Bigger orders on credit, one app, delivery to the door.', "Heroes, distributor's own booker, WhatsApp", 'Activation, repeat rate, GMV per store'],
    ['Heroes', 'Earn from stores you already visit.', 'OLX, Facebook, rider upsell, WhatsApp referral', 'Activation (target 60% by M3 of OS), orders per Hero'],
    ['Delivery riders', 'Steady batched runs, weekly pay.', 'Bykea pool (with consent), OLX', 'Drops per run, on-time %, cash variance'],
    ['Abhi', 'A new retail credit channel with data and collection built in.', 'Ali, weekly report', 'Disbursed, PAR30, yield'],
  ],
}

export const pricing: Tbl = {
  head: ['Party', 'Pays', 'Note'],
  rows: [
    ['Store', 'Order price plus financing fee for credit days (check against Abhi pricing and SBP rules)', 'Cash-on-delivery stays an option at a lower price'],
    ['Distributor', 'Free for 60 days, then SaaS fee or small percent of platform GMV', 'Margin share only on stores Kamai brings'],
    ['Brand', 'Trade margin on aggregator orders. Later Rs 10,000 to 25,000 per month fee (existing OS target)', 'Reports and data as part of fee'],
    ['Hero', 'Earns Rs 1,000 / 500 / 250 tiers', 'No change until unit economics are proven'],
    ['Rider', 'Earns per drop plus bonus', 'Target cost per drop under Rs 350 with batching (verify with Bykea quote)'],
  ],
}

export const unitEconomics: Tbl = {
  head: ['Line', 'Rs'],
  rows: [
    ['Order value', '20,000'],
    ['Kamai take (8%)', '1,600'],
    ['Delivery per drop', '-350'],
    ['Hero commission (repeat, 10k+)', '-500'],
    ['Collection and payment costs', '-100'],
    ['Bad debt reserve (1.5%)', '-300'],
    [b('Contribution before opex'), b('about 350 (1.75%)')],
  ],
}
export const unitEconomicsNote = 'Thin. It works only with batched delivery, repeat orders without Hero commission, and a financing spread share. Test this table before building more.'

export interface ScorecardRow {
  key: string
  metric: string
  target: string
}

export const scorecard: ScorecardRow[] = [
  { key: 'northstar', metric: 'North star: on-time collected GMV per week', target: 'Grows every week' },
  { key: 'cancel', metric: 'Cancelled orders', target: 'Under 15% (now 33%)' },
  { key: 'collected', metric: 'Collected within terms', target: '90%+' },
  { key: 'par30', metric: 'PAR 30', target: 'Under 5%' },
  { key: 'drop', metric: 'Cost per drop', target: 'Under Rs 350' },
  { key: 'repeat', metric: 'Repeat order rate per store (60 days)', target: '50%+' },
  { key: 'activation', metric: 'Hero activation', target: '25% at week 4, 60% at M3' },
]

export const killRulesText =
  '**Kill or pause rules.** Pause new credit if PAR 30 exceeds 8%. Pause a distributor if dispute rate exceeds 10% of orders. Stop Lane A if float exceeds 15 days average. Drop the Bykea pool plan if rider cash variance exceeds 1%.'
