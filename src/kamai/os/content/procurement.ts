import { b, badge, prio, type Intro, type Tbl } from './types'

export const procurementIntro: Intro = {
  title: 'Procurement Department',
  body: 'Source at importer price. Sell at distributor trade price. The margin lives in this gap. Stick to categories where APT already has relationships or where you can go direct to the importer.',
}

export const categories: Tbl = {
  head: ['Category', 'Current Status', 'Est. Margin', 'Source', 'Priority'],
  rows: [
    [b('Honey (Manuka, Sidr, Multifloral)'), badge('APT already carries', 'green'), '25–40%', 'Extend current supplier to adjacent lines', prio('P1')],
    [b('Olive oil (EVOO, Pomace)'), badge('APT already carries', 'green'), '20–28%', 'Spanish/Turkish private label via UAE', prio('P1')],
    [b('Orthopedic supports'), badge('Smart Flamingo in catalog', 'green'), '30–50%', 'Expand range, contact Taiwan/China direct', prio('P1')],
    [b('Imported confectionery (wafers, gummies)'), badge('Caprice in catalog', 'green'), '20–35%', 'Ulker/ETI via UAE or Karachi traders', prio('P1')],
    [b('Personal care (imported shampoo, lotion)'), badge('D.Watson relationship', 'amber'), '20–30%', 'Identify top SKUs from D.Watson, find importer', prio('P2')],
    [b('Health supplements (Omega-3, collagen)'), badge('New category', 'dark'), '25–40%', 'UAE distributors or direct from European brands', prio('P2')],
    [b('Canned specialty food (tuna, chickpeas)'), badge('New category', 'dark'), '15–25%', 'Turkish and Spanish importers in Karachi', prio('P3')],
  ],
}

export const marginIntro = 'For each SKU, calculate: (Sell Price - Buy Price - Delivery Cost - Hero Commission) / Sell Price = Net Margin. Must be above 15% to carry.'

export const marginFields: Tbl = {
  head: ['Field', 'How to get it'],
  rows: [
    ['Buy price', 'Your importer invoice or current APT purchase order'],
    ['Sell price', 'What a petrol shop currently pays from any local supplier, or what Shams/D.Watson retail minus 20%'],
    ['Delivery cost per unit', 'Total delivery cost for the run divided by units on that run'],
    ['Hero commission per unit', 'Rs 250–1,000 per order divided by units in the order'],
  ],
}

export const sourcingDo: string[] = [
  'Source from direct importers and manufacturers — best price',
  "Use APT's existing supplier relationships as the starting point",
  'Buy UAE re-exports for Turkish/European brands not directly accessible',
  'Target products with 18+ month shelf life — reduce expiry risk',
  'Source against confirmed orders wherever possible, not speculation',
]

export const sourcingDont: string[] = [
  'Do not source mainstream national brands — margins are too thin',
  'Do not buy from Metro for sub-distribution (grey area on terms)',
  'Do not carry anything with less than 15% net margin after all costs',
  'Do not add new SKUs without confirming at least 3 petrol shops will stock it',
  'Do not hold excess inventory of any new SKU for first 60 days',
]
