import { SectionTitle } from '../../ui'
import { categories, marginFields, marginIntro, procurementIntro, sourcingDo, sourcingDont } from '../content/procurement'
import { Bullets, DataTable, Grid, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={procurementIntro} />
      <SectionTitle>Product Category Priority</SectionTitle>
      <Panel>
        <DataTable {...categories} />
      </Panel>
      <SectionTitle>SKU Margin Calculator — Run This First</SectionTitle>
      <Panel>
        <p className="mb-4 text-sm text-k-muted">{marginIntro}</p>
        <DataTable {...marginFields} />
      </Panel>
      <SectionTitle>Sourcing Rules</SectionTitle>
      <Grid cols={2}>
        <Panel title="Do">
          <Bullets items={sourcingDo} tone="do" />
        </Panel>
        <Panel title="Do Not" dot="red">
          <Bullets items={sourcingDont} tone="dont" />
        </Panel>
      </Grid>
    </Stack>
  )
}
