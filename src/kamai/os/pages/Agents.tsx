import { SectionTitle } from '../../ui'
import { Badge } from '../../ui'
import { activateTable, agents, agentsIntro } from '../content/agents'
import { DataTable, Grid, Highlight, Panel, Stack } from '../components/content-ui'

export function Component() {
  return (
    <Stack>
      <Highlight intro={agentsIntro} />
      <Grid cols={3}>
        {agents.map((a) => (
          <div key={a.name} className="flex flex-col gap-3 rounded-2xl border border-k-border bg-k-surface p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-k-green-light text-2xl">{a.icon}</div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-k-dark">{a.name}</div>
                <div className="text-xs text-k-muted">{a.role}</div>
              </div>
            </div>
            <div><Badge tone="green" dot>{a.status}</Badge></div>
            <ul className="flex flex-col gap-2 border-t border-k-border pt-3">
              {a.tasks.map((t) => (
                <li key={t} className="text-[13px] leading-snug text-k-muted">{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </Grid>
      <SectionTitle>How to Activate Each Agent</SectionTitle>
      <Panel>
        <DataTable {...activateTable} />
      </Panel>
    </Stack>
  )
}
