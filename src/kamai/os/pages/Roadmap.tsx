import { roadmap, roadmapIntro } from '../content/roadmap'
import { Highlight, Panel, Stack, Timeline } from '../components/content-ui'
import { useOsKpiView } from '../lib/kpi'

export function Component() {
  const kpi = useOsKpiView()
  return (
    <Stack>
      <Highlight intro={roadmapIntro} />
      <Panel>
        <Timeline items={roadmap} replace={{ ar: kpi.ar }} />
      </Panel>
    </Stack>
  )
}
