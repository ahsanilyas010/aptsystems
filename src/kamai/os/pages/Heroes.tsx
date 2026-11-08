import { SectionTitle, Stat } from '../../ui'
import { activationPlan, citiesLive, commission, commissionNote, recruitment } from '../content/heroes'
import { DataTable, Grid, Highlight, LiveBadge, Panel, Stack, Warn } from '../components/content-ui'
import { useOsKpiView } from '../lib/kpi'

export function Component() {
  const kpi = useOsKpiView()
  const k = kpi.k
  return (
    <Stack>
      <Highlight title="Hero Network Management">
        <p className="max-w-4xl text-sm leading-relaxed text-[#cfdad3]">
          {k.heroes_registered} registered. {k.heroes_active} have ever booked a live order, {k.heroes_active_7d} in the last 7 days. {kpi.cancelRate} of app orders were cancelled.
          The gap is trust, first-order incentive, and order follow-through. Heroes need to see a payout before they commit to regular visits. Fix that this week.
        </p>
        <div className="mt-3"><LiveBadge live={kpi.live} loading={kpi.loading} /></div>
      </Highlight>
      <Grid cols={4}>
        <Stat label="Registered" value={k.heroes_registered} />
        <Stat label="Active (ordered)" value={k.heroes_active} tone="dark" />
        <Stat label="Activation Rate" value={kpi.activationRate} sub="Target: 60% by M3" />
        <Stat label="Cities Live" value={citiesLive.count} sub={citiesLive.list} tone="green" />
      </Grid>
      <SectionTitle>Commission Structure</SectionTitle>
      <Panel><DataTable {...commission} /></Panel>
      <Warn>{commissionNote}</Warn>
      <SectionTitle>Activation Plan (Next 30 Days)</SectionTitle>
      <Panel><DataTable {...activationPlan} /></Panel>
      <SectionTitle>Hero Recruitment Pipeline (Next 90 Days)</SectionTitle>
      <Panel><DataTable {...recruitment} /></Panel>
    </Stack>
  )
}
