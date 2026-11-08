import { SectionTitle, Stat } from '../../ui'
import { infraCost, sprints, stack, techIntro } from '../content/tech'
import { DataTable, Grid, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={techIntro} />
      <SectionTitle>Live Stack</SectionTitle>
      <Panel><DataTable {...stack} /></Panel>
      <SectionTitle>Abdurrahman Sprint Priorities</SectionTitle>
      <Panel><DataTable {...sprints} /></Panel>
      <SectionTitle>Infrastructure Cost</SectionTitle>
      <Grid cols={3}>
        {infraCost.map((c) => (
          <Stat key={c.label} label={c.label} value={c.value} sub={c.sub} tone={c.tone} />
        ))}
      </Grid>
    </Stack>
  )
}
