import { useState } from 'react'
import { SectionTitle, Tabs } from '../../ui'
import { pitchScript, vendorFilters, vendorHead, vendors, vendorsIntro } from '../content/vendors'
import { DataTable, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  const [cat, setCat] = useState<string>('all')
  const rows = vendors.filter((v) => cat === 'all' || v.cat === cat).map((v) => v.row)
  return (
    <Stack>
      <Highlight intro={vendorsIntro} />
      <Tabs variant="pills" items={vendorFilters.map((f) => ({ key: f.key, label: f.label }))} value={cat} onChange={setCat} />
      <Panel>
        <DataTable head={vendorHead} rows={rows} />
      </Panel>
      <SectionTitle>Brand Partnership Pitch Script</SectionTitle>
      <Panel>
        <p className="text-sm leading-[1.8] text-k-muted">{pitchScript}</p>
      </Panel>
    </Stack>
  )
}
