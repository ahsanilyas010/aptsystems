import { prio, type Intro, type Tbl } from './types'

export const hrIntro: Intro = {
  title: 'HR and Team Structure',
  body: 'Current team is running lean. Two roles are critical to add in month 1–2 before you can scale. Everything else waits until the store count justifies it.',
}

export const team: Tbl = {
  head: ['Name', 'Role', 'Kamai Responsibility'],
  rows: [
    ['Ahsan Ilyas', 'Founder', 'Strategy, investor relations, brand partnerships, decisions'],
    ['Zohaib', 'Order booker / collections', 'Order management, delivery coordination, store collections'],
    ['Raheela', 'Sales + Kamai content', 'Hero recruitment support, Facebook page, outreach'],
    ['Mamoona', 'Finance and accounts', 'AR management, invoice tracking, commission payouts'],
    ['Abdurrahman', 'Developer', 'App maintenance, tech upgrades'],
    ['Irtaza', 'Media buying', 'Meta ads for Hero recruitment'],
    ['Usman', 'Video editing', 'Hero recruitment video content'],
  ],
}

export const hiring: Tbl = {
  head: ['Role', 'When to Hire', 'Salary Est.', 'What They Do', 'Priority'],
  rows: [
    ['Area Manager — Islamabad/Pindi', 'Month 1', 'Rs 50,000–65,000', 'Manages 20+ Heroes, visits problem stores, onboards new petrol shops', prio('P1')],
    ['Delivery Coordinator', 'Month 1–2', 'Rs 35,000–45,000', 'Schedules daily delivery runs, coordinates with Bykea, tracks order status', prio('P1')],
    ['Area Manager — KHI (via JDC)', 'Month 4', 'Rs 45,000–55,000', 'Same as ISB/Pindi role but for Karachi launch', prio('P2')],
    ['Area Manager — LHR', 'Month 5', 'Rs 45,000–55,000', 'Lahore city Hero management and store expansion', prio('P2')],
    ['Brand Partnerships Executive', 'Month 3', 'Rs 45,000–60,000', 'Full-time on signing new brand distribution agreements', prio('P2')],
  ],
}

export const classificationIntro =
  'Kamai Heroes are NOT employees. They are commission-only independent agents. This is important for labour law, tax, and financial exposure. Document this clearly.'

export const classification: Tbl = {
  head: ['Heroes', 'Employees'],
  rows: [
    ['Commission only, no fixed salary', 'Fixed monthly salary'],
    ['Work their own hours, own areas', 'Fixed hours, assigned location'],
    ['Use own phone and transport', 'Company provides tools'],
    ['No EOBI/SESSI requirement', 'EOBI registration required'],
    ['Agreement: Kamai Hero Terms and Conditions', 'Formal employment contract'],
  ],
}
