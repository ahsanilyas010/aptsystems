import { b, type Intro, type Tbl } from './types'

export const modelIntro: Intro = {
  title: 'Business Model',
  body: 'Kamai is the **B2B distribution rail** for imported brands and small operators who have product but no retail penetration. Primary channel: petrol station shops and highway convenience stores — high traffic, no formal induction required, proven credit payers.',
}

export interface RevenueSource {
  title: string
  headline: string
  body: string
  callout: string
  calloutSub: string
}

export const revenueSources: RevenueSource[] = [
  { title: 'Revenue Source 1: Distribution Margin', headline: 'Buy low from importers. Sell to stores at trade price.', body: 'APT sources product at importer price. Kamai sells to petrol shops and convenience stores at distributor trade price. The margin — typically 20 to 35% on imported lines — is the core revenue.', callout: 'Example: Olive oil 1L', calloutSub: 'Buy price: Rs 600 | Sell price: Rs 780 | Margin: 23%' },
  { title: 'Revenue Source 2: Brand Service Fee', headline: 'Charge brands for distribution access and data.', body: 'Brands with no field sales team pay a monthly or per-order service fee to get their product in front of petrol shop owners across Northern Pakistan. At 400+ stores, this becomes a paid listing model.', callout: 'Target: Rs 10,000 to 25,000/brand/month', calloutSub: 'Start at month 4+ when store count justifies the ask' },
  { title: 'Revenue Source 3: Store Database (Year 2+)', headline: 'The store network becomes data asset brands pay for.', body: 'Every order adds verified store data: location, owner, category, buying frequency, basket size. At 1,000+ stores this is a uniquely valuable dataset for any brand entering Northern Pakistan.', callout: 'Long-term: per-report or subscription access', calloutSub: 'Not year 1. Build the database first.' },
]

export const stakeholders: Tbl = {
  head: ['Stakeholder', 'Puts in', 'Gets out', 'Risk'],
  rows: [
    [b('Kamai Heroes'), 'Time, local store relationships, phone + bike', 'Rs 250–1,000 per approved order, no cap, paid in 10 days', 'Low — commission only on approved orders'],
    [b('Petrol / convenience stores'), 'Order commitment, payment in 15–30 days', 'Premium imported products delivered to the door, one supplier', 'Credit default — mitigated by APT collection history'],
    [b('Imported brands / Shopify operators'), 'Product at importer price, marketing support', 'General trade penetration they cannot build themselves', 'Margin transparency — need clear agreed trade price'],
    [b('APT (you)'), 'Delivery fleet, warehouse, 10-year trade relationships, ERP', 'Distribution margin on every order + store database asset', 'Execution — scaling delivery across cities'],
    [b('Ali / Abhi (pending)'), 'Credit line for sourcing and working capital', 'Interest on credit, equity in Kamai, Abhi product pilot', 'Default risk — must define in writing before credit is used'],
    [b('JDC / Bykea (pending)'), 'Hero recruitment network / last-mile delivery', 'Revenue per recruitment outcome / per delivery', 'Quality control — need SLAs'],
  ],
}

export const petrolWins: Array<{ title: string; body: string }> = [
  { title: 'No Formal Induction', body: 'A petrol shop owner will stock something if a Hero shows up, the product is right, and there is a credit period. No listing committee, no planogram, no ASM visit required. Kamai Heroes can convert a shop on the first visit.' },
  { title: 'High Traffic, Consistent Revenue', body: 'Petrol stations have daily cash flow from fuel customers. They restock weekly, not monthly. Basket size is impulse-driven: energy drinks, honey sachets, pain relief, snacks. Exactly the imported products APT carries.' },
  { title: 'No Competition', body: 'Traditional FMCG distributors do not call on petrol stations with imported or niche products. They focus on volume national brands. This channel is entirely uncontested for the product lines Kamai will carry.' },
]
