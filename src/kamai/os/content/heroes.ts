import { b, badge, type Tbl } from './types'

export const commission: Tbl = {
  head: ['Trigger', 'Commission', 'Notes'],
  rows: [
    ['First order from a newly registered store (any value)', b('Rs 1,000'), 'Incentivises store discovery'],
    ['Repeat order from existing store, Rs 10,000+', b('Rs 500'), 'Rewards volume'],
    ['Repeat order from existing store, below Rs 10,000', b('Rs 250'), 'Still earns something'],
    ['Cancelled, fake, duplicate, or rejected order', b('Rs 0'), 'Fraud control'],
  ],
}

export const commissionNote =
  'The live database function calc_order_incentive currently pays 250/150/100 by order value, not the 1000/500/250 structure above. The OS shows orders.incentive as stored and flags the gap (see Kamai OS plan, section 7).'

export const activationPlan: Tbl = {
  head: ['Action', 'Who', 'Deadline'],
  rows: [
    ['WhatsApp all 55 registered Heroes with updated commission tiers and 30-day incentive', 'Raheela', 'This week'],
    ['Introduce a first-order bonus: Hero earns extra Rs 500 for first order in next 14 days', 'Ahsan (approve budget)', 'This week'],
    ['Share a real payout proof — screenshot of a Hero who was paid — with the group', 'Ahsan', 'This week'],
    ['Assign 10 petrol stations to existing active Heroes as priority targets', 'Zohaib / Raheela', 'Next week'],
    ['Run 1 OLX and 1 Facebook ad for new Hero recruitment targeting Rawalpindi', 'Irtaza', 'Next week'],
  ],
}

export const recruitment: Tbl = {
  head: ['City', 'Heroes Needed', 'Recruitment Channel', 'Status'],
  rows: [
    ['Islamabad', '10', 'OLX, Facebook, Rozee, word of mouth', badge('Active', 'green')],
    ['Rawalpindi', '15', 'OLX, InDrive/Bykea riders, student community', badge('Active', 'green')],
    ['Wah / Gujar Khan', '5', 'WhatsApp circles, local community', badge('Active', 'green')],
    ['Abbottabad / Haripur', '8', 'Rozee, local ads', badge('Month 3', 'amber')],
    ['Karachi', '20', 'JDC Foundation (pending Ali intro), OLX KHI', badge('Pending Ali', 'dark')],
    ['Lahore', '15', 'Rozee, InDrive riders, Facebook ads', badge('Month 4', 'dark')],
  ],
}

export const citiesLive = { count: '4', list: 'ISB, PWD, Wah, Gujar Khan' }
