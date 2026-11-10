import { type Intro, type Tbl } from './types'

export const financeIntro: Intro = {
  title: 'Financial Forecasting',
  body: 'Bottom-up model based on: 400 active stores at month 12, average order Rs 20,000, 1.5 reorders per month per store, gross margin 22% on imported product mix. **All figures in PKR thousands.**',
}

export const months = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12']

export interface ForecastRow {
  line: string
  values: string[]
  kind: 'plain' | 'cost' | 'gain' | 'net'
}

export const forecast: ForecastRow[] = [
  { line: 'Active Stores', kind: 'plain', values: ['60', '80', '110', '150', '190', '250', '290', '320', '350', '370', '385', '400'] },
  { line: 'Gross Revenue', kind: 'plain', values: ['1,800', '2,400', '3,300', '4,500', '5,700', '7,500', '8,700', '9,600', '10,500', '11,100', '11,550', '12,000'] },
  { line: 'COGS (78%)', kind: 'cost', values: ['1,404', '1,872', '2,574', '3,510', '4,446', '5,850', '6,786', '7,488', '8,190', '8,658', '9,009', '9,360'] },
  { line: 'Gross Profit (22%)', kind: 'gain', values: ['396', '528', '726', '990', '1,254', '1,650', '1,914', '2,112', '2,310', '2,442', '2,541', '2,640'] },
  { line: 'Hero Commissions', kind: 'cost', values: ['90', '120', '165', '225', '285', '375', '435', '480', '525', '555', '578', '600'] },
  { line: 'Delivery Cost', kind: 'cost', values: ['120', '160', '220', '300', '380', '500', '580', '640', '700', '740', '770', '800'] },
  { line: 'Opex (team etc)', kind: 'cost', values: ['250', '280', '320', '380', '420', '500', '550', '600', '650', '700', '730', '760'] },
  { line: 'Net Profit / Loss', kind: 'net', values: ['-64', '-32', '21', '85', '169', '275', '349', '392', '435', '447', '463', '480'] },
]

export interface FinanceStat {
  label: string
  value: string
  sub: string
  tone: 'light' | 'dark' | 'green'
}

export const financeStats: FinanceStat[] = [
  { label: 'Break-even Month', value: 'M3', sub: '~110 active stores', tone: 'light' },
  { label: 'Capital Required', value: '21M', sub: 'PKR — 10M working capital + 11M growth', tone: 'dark' },
  { label: 'Month 12 Net/mo', value: '480K', sub: 'PKR — scales to 1M+ with KLI', tone: 'light' },
  { label: 'Payback Period', value: '18–24', sub: 'Months on equity portion', tone: 'green' },
]

export const arAging: Tbl = {
  head: ['Age', 'Action', 'Who'],
  rows: [
    ['0–15 days', 'Friendly reminder call', 'Zohaib'],
    ['15–30 days', 'WhatsApp + call from Ahsan directly', 'Ahsan'],
    ['30–60 days', 'Stop supply until partial payment', 'Ahsan / Mamoona'],
    ['60+ days', 'Formal written notice, last warning before legal', 'Mamoona'],
  ],
}
