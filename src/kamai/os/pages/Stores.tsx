import { SectionTitle } from '../../ui'
import { chains, corridors, criteria, storesIntro } from '../content/stores'
import { DataTable, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={storesIntro} />
      <SectionTitle>Priority Petrol Chains to Target</SectionTitle>
      <Panel><DataTable {...chains} /></Panel>
      <SectionTitle>Key Corridors to Cover First</SectionTitle>
      <Panel><DataTable {...corridors} /></Panel>
      <SectionTitle>Store Criteria (Minimum to Add)</SectionTitle>
      <Panel><DataTable {...criteria} /></Panel>
    </Stack>
  )
}
