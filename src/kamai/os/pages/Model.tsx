import { SectionTitle } from '../../ui'
import { petrolWins, modelIntro, revenueSources, stakeholders } from '../content/model'
import { DataTable, Grid, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={modelIntro} />
      <SectionTitle>How Money Flows</SectionTitle>
      <Grid cols={3}>
        {revenueSources.map((r) => (
          <Panel key={r.title} title={r.title}>
            <h3 className="mb-2 text-[15px] font-bold text-k-dark">{r.headline}</h3>
            <p className="text-sm leading-relaxed text-k-muted">{r.body}</p>
            <div className="mt-4 rounded-lg bg-k-green-light p-3">
              <div className="text-[13px] font-bold text-k-green">{r.callout}</div>
              <div className="mt-1 text-[13px] text-k-muted">{r.calloutSub}</div>
            </div>
          </Panel>
        ))}
      </Grid>
      <SectionTitle>Stakeholder Map</SectionTitle>
      <Panel>
        <DataTable {...stakeholders} />
      </Panel>
      <SectionTitle>Why Petrol Shops Win</SectionTitle>
      <Grid cols={3}>
        {petrolWins.map((w) => (
          <Panel key={w.title}>
            <h3 className="mb-2 text-[15px] font-bold text-k-dark">{w.title}</h3>
            <p className="text-sm leading-relaxed text-k-muted">{w.body}</p>
          </Panel>
        ))}
      </Grid>
    </Stack>
  )
}
