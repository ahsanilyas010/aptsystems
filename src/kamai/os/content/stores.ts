import { b, prio, type Intro, type Tbl } from './types'

export const storesIntro: Intro = {
  title: 'Target Store Database',
  body: "Primary target: petrol station shops, highway convenience stops, and roadside mini-marts. Secondary: pharmacies stocking OTC and wellness products. This week's task: map 30 petrol stations in Islamabad and Rawalpindi with owner contact.",
}

export const chains: Tbl = {
  head: ['Chain', 'Stations in ISB/Pindi', 'Shop Type', 'Best Products', 'Priority'],
  rows: [
    [b('PSO'), '~40+', 'Most have a convenience shop', 'Honey, snacks, personal care, ortho supports', prio('P1')],
    [b('Shell'), '~25', 'Select has proper grocery shelves', 'Full imported range', prio('P1')],
    [b('Total Energies'), '~20', 'Varies — some have proper shops', 'Premium imported, wellness', prio('P2')],
    [b('Attock / APL'), '~30', 'Often smaller shops', 'Snacks, confectionery', prio('P2')],
    [b('Independent stations'), '50+', 'Owner-operated, flexible', 'Anything with good margin', prio('P1')],
  ],
}

export const corridors: Tbl = {
  head: ['Corridor / Area', 'Reason', 'Estimated Stations', 'Hero to Assign'],
  rows: [
    ['GT Road, Rawalpindi to Islamabad', 'Highest traffic, truckers + commuters', '15–20', 'Assign area Hero from Pindi'],
    ['Murree Road (ISB to Murree)', 'Tourism traffic, premium spend', '10–15', 'New Hero, tourist corridor'],
    ['N-5 (ISB to Peshawar)', 'Commercial traffic, regular restock need', '10', 'Wah area Hero'],
    ['M-2 (ISB to Lahore) first 50km', 'Premium highway travellers', '8–10', 'New Hero dedicated to highway'],
    ['I-10, I-8, G-9, G-11 Islamabad', 'Urban petrol stations with high footfall', '20+', 'Existing ISB Heroes'],
    ['DHA and Bahria Rawalpindi', 'Higher income, premium product acceptance', '10+', 'Pindi Hero 2'],
  ],
}

export const criteria: Tbl = {
  head: ['Criteria', 'Why it matters'],
  rows: [
    ['Has a physical shop attached to the station (not just fuel)', 'Must have shelf space to stock products'],
    ['Owner or manager willing to take a sample order on 15-day credit', 'First order must be on credit — cash is too slow to build the network'],
    ['Minimum expected order Rs 10,000+', 'Below this, delivery cost kills the margin'],
    ['Hero has GPS-verified the location', 'Required for the app and for Bykea delivery routing'],
  ],
}
