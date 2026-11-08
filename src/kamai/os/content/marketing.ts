import type { Intro, Tbl } from './types'

export const marketingIntro: Intro = {
  title: 'Marketing Direction',
  body: 'Two audiences, two completely different messages. Heroes: earn from what you already do. Brands: reach stores you cannot reach yourself. Keep them separate — do not mix.',
}

export const heroMessaging = {
  title: 'Hero Recruitment Messaging',
  headline: 'Core message: Market to aap pehle bhi jatay hain. Ab kamai bhi karein.',
  body: 'Target: Students, InDrive/Bykea riders, unemployed youth, part-timers. Channels: OLX, Facebook (Islamabad groups, Rawalpindi groups), Rozee.pk, WhatsApp circles, community mosques.',
  table: {
    head: ['Channel', 'Format', 'Frequency'],
    rows: [
      ['Facebook / Instagram', 'Video creative + testimonial', '3x per week'],
      ['OLX', 'Job listing with Rs 25,000/mo headline', 'Refresh weekly'],
      ['Rozee / Indeed', 'Gig work listing', 'Monthly'],
      ['WhatsApp', 'Script + forward incentive', 'Ongoing'],
    ],
  } as Tbl,
}

export const brandMessaging = {
  title: 'Brand Partner Outreach Messaging',
  headline: 'Core message: Your product is on a website. It should be on a petrol station shelf in every city.',
  body: 'Target: Importers, Shopify brand owners, small health and wellness operators. Channels: LinkedIn, direct email, Instagram DM, introductions through D.Watson and Shams relationships.',
  table: {
    head: ['Channel', 'Format', 'Frequency'],
    rows: [
      ['LinkedIn', 'Founder outreach DM', '10 DMs per week'],
      ['Email', 'Cold pitch email (short, direct)', 'Batch weekly'],
      ['Instagram', 'DM brand pages', '5 per week'],
      ['Trade shows', 'Meet importers in person', 'IFNE, PRGMEA events'],
    ],
  } as Tbl,
}

export const calendar: Tbl = {
  head: ['Week', 'Hero Content', 'Brand Content', 'Owner'],
  rows: [
    ['Week 1', 'Payout proof post + commission tier explainer', 'LinkedIn post: "why petrol shops are the most underserved channel in Pakistan"', 'Raheela / Irtaza'],
    ['Week 2', 'Hero testimonial (real or scripted if none yet)', 'Cold email batch to 20 importers', 'Irtaza / Ahsan'],
    ['Week 3', 'OLX ad refresh + WhatsApp forward campaign', 'LinkedIn: "we just added 10 new petrol stations"', 'Raheela / Irtaza'],
    ['Week 4', 'Video: how to book your first order in 60 seconds', 'Brand outreach email follow-up', 'Usman / Irtaza'],
  ],
}

export const proofPoints: Tbl = {
  head: ['Proof Point', 'Why It Matters', 'How to Get It'],
  rows: [
    ['Hero payout screenshot', 'Biggest trust builder for recruitment', 'Take screenshot when next payout is made, share with permission'],
    ['First petrol station photo', 'Shows the channel is real', 'Hero takes photo of product on petrol shop shelf'],
    ['Brand testimonial', 'Unlocks other brands', 'Ask first brand partner for a WhatsApp voice note'],
    ['Order volume milestone', 'Shows the platform works', 'Post when you hit Rs 2M / Rs 5M / Rs 10M through the app'],
  ],
}
