import { b, badge, type Intro, type Cell } from './types'

export const vendorsIntro: Intro = {
  title: 'Vendor Pipeline',
  body: 'These are brands and importers to approach as distribution partners. They have product, no general trade reach, and will welcome a commission-based distribution arrangement for Northern Pakistan.',
}

export type VendorCat = 'confectionery' | 'health' | 'personal' | 'food'

export const vendorFilters: Array<{ key: 'all' | VendorCat; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'confectionery', label: 'Confectionery' },
  { key: 'health', label: 'Health and Wellness' },
  { key: 'personal', label: 'Personal Care' },
  { key: 'food', label: 'Specialty Food' },
]

export const vendorHead = ['Brand / Supplier', 'Category', 'Why Target Them', 'How to Approach', 'Status']

export const vendors: Array<{ cat: VendorCat; row: Cell[] }> = [
  { cat: 'confectionery', row: [b('Caprice / current supplier'), 'Confectionery', 'Already in APT catalog — expand SKU range and territory', 'Call current supplier, ask for petrol channel exclusivity in North', badge('Active', 'green')] },
  { cat: 'confectionery', row: [b('Ulker / ETI (Turkish wafers)'), 'Confectionery', 'No formal distributor in Northern Pakistan', 'Contact via Karachi Jodia Bazar traders OR UAE re-exporter', badge('To Contact', 'amber')] },
  { cat: 'confectionery', row: [b('Halley Wafers (Malaysia)'), 'Confectionery', 'Popular in petrol shops, thin distribution', 'Search Karachi wholesale for importer contact', badge('Research', 'dark')] },
  { cat: 'health', row: [b('Current Manuka honey supplier'), 'Health and Wellness', 'Already in catalog — add Sidr, multifloral, propolis', 'Call supplier and ask what adjacent lines they can supply', badge('Active', 'green')] },
  { cat: 'health', row: [b('Smart Flamingo (current supplier)'), 'Orthopedic', 'Already in catalog — expand range (knee, back, wrist, ankle)', 'Call current supplier for full product catalog', badge('Active', 'green')] },
  { cat: 'health', row: [b('Taiwan / Chinese ortho manufacturer'), 'Orthopedic', 'Private label range with 30–50% margin', 'Alibaba / Global Sources — search "knee support manufacturer"', badge('Research', 'dark')] },
  { cat: 'health', row: [b('Imported omega-3 / multivitamin brand'), 'Supplements', 'No organised general trade distribution in North', 'Look at what pharmacies stock — find the importer', badge('Research', 'dark')] },
  { cat: 'personal', row: [b('OGX / similar imported shampoo importer'), 'Personal Care', 'In premium stores but no general trade coverage', 'Ask D.Watson Ghauri who supplies them — get importer name', badge('To Contact', 'amber')] },
  { cat: 'food', row: [b('Turkish / Spanish canned food importer (Karachi)'), 'Specialty Food', 'Tuna, chickpeas, tomatoes — steady petrol shop demand', 'Jodia Bazar cold calls or LinkedIn search "canned food importer Pakistan"', badge('Research', 'dark')] },
  { cat: 'food', row: [b('Shopify olive oil brands in Pakistan'), 'Specialty Food', 'Online only, want physical retail', 'Search Facebook/Instagram ads for olive oil Pakistan — DM founders', badge('To Contact', 'amber')] },
  { cat: 'health', row: [b('Local Shopify wellness brands (honey, supplements)'), 'Health and Wellness', 'Have stock, no field sales, desperate for shelf placement', 'Instagram DM: "We distribute to petrol shops in Islamabad. Want in?"', badge('To Contact', 'amber')] },
]

export const pitchScript =
  '"We are Kamai, the distribution arm of Assorted Produce Traders, operating in Islamabad and Rawalpindi since 2016. We have a network of commission-based field partners visiting petrol stations, highway convenience stores, and general trade accounts across Northern Pakistan. We are looking to add high-quality imported products to our catalog. We handle delivery, order collection, credit management, and field visits. You supply product at your importer price. We sell at trade price and remit within [payment period]. We give you weekly sales data per store and territory. Interested in a 30-day pilot?"'
