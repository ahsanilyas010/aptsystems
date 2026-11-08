import type { Intro, TimelineItem } from './types'

export const roadmapIntro: Intro = {
  title: '12-Month Roadmap',
  body: "Month 3 is break-even. Month 6 is the milestone that triggers Ali's second tranche. Month 12 is the proof of concept for KLI expansion. Execute sequentially — do not jump ahead.",
}

/** {ar} is replaced with the live AR figure. */
export const roadmap: TimelineItem[] = [
  { month: 'Now', title: 'Foundation — Clean up and confirm', desc: 'Chase {ar} outstanding AR. Run margin math on top 10 SKUs. Map 30 petrol stations in ISB/Pindi. Fix Hero commission tiers on app and site. Send Ali model summary email.' },
  { month: 'M1–2', title: 'First brand partnerships + petrol channel launch', desc: 'Sign 3 brand distribution agreements. Convert first 10 petrol stations. Hire Area Manager ISB/Pindi. Upgrade backend to Supabase. Call Bykea B2B team and agree delivery rate.' },
  { month: 'M3', title: 'Break-even — 110 stores active', desc: 'Net margin turns positive at ~110 active stores. Activate Hero first-order bonus programme. Begin Abbottabad and Haripur coverage from ISB team.' },
  { month: 'M4–5', title: 'Brand fee model launch', desc: 'At 150+ stores, approach 3 brands for a monthly distribution fee (Rs 10–25K/mo). Introduce brand dashboard showing their orders by store. Hire Brand Partnerships Executive.' },
  { month: 'M6', title: '250 stores — Ali milestone trigger', desc: '250 active stores in twin cities triggers second tranche if Ali is on board. If not, growth is self-funded from margin. Begin Karachi scoping via JDC (if connected by now).' },
  { month: 'M7–10', state: 'pending', title: '400 stores twin cities + Karachi launch', desc: '400 active stores in ISB/Pindi. Launch Karachi with JDC-recruited Heroes and Bykea delivery. Open Lahore coverage. Hire city managers. Begin media coverage of Kamai story.' },
  { month: 'M12', state: 'future', title: 'KLI — Proof of pan-Pakistan model', desc: 'Active in Islamabad, Rawalpindi, Karachi and Lahore. Rs 12M monthly revenue run rate. 500+ Heroes. 30+ brand partners. Raise next round with this as the proof case.' },
]
