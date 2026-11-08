import { SectionTitle } from '../../ui'
import { classification, classificationIntro, hiring, hrIntro, team } from '../content/hr'
import { DataTable, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={hrIntro} />
      <SectionTitle>Current Team</SectionTitle>
      <Panel><DataTable {...team} /></Panel>
      <SectionTitle>Hiring Plan</SectionTitle>
      <Panel><DataTable {...hiring} /></Panel>
      <SectionTitle>Hero vs Employee — Classification Rules</SectionTitle>
      <Panel>
        <p className="mb-3 text-sm text-k-muted">{classificationIntro}</p>
        <DataTable {...classification} />
      </Panel>
    </Stack>
  )
}
