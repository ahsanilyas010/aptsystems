import { SectionTitle } from '../../ui'
import { gapSections, gapTasks, gapsIntro } from '../content/gaps'
import { DataTable, Highlight, Panel, Stack } from '../components/content-ui'
import { TaskList } from '../components/TaskList'
import { useOsKpiView } from '../lib/kpi'
import type { Cell } from '../content/types'

export function Component() {
  const kpi = useOsKpiView()
  const fill = (c: Cell): Cell => (typeof c === 'string' ? c.split('{ar}').join(kpi.ar) : c)
  return (
    <Stack>
      <Highlight intro={gapsIntro} />
      {gapSections.map((s) => (
        <div key={s.title} className="flex flex-col gap-5">
          <SectionTitle className="mb-0">{s.title}</SectionTitle>
          <Panel>
            <DataTable head={s.table.head} rows={s.table.rows.map((r) => r.map(fill))} />
          </Panel>
        </div>
      ))}
      <SectionTitle className="mb-0">Things You Missed — Add These</SectionTitle>
      <TaskList defs={gapTasks} />
    </Stack>
  )
}
