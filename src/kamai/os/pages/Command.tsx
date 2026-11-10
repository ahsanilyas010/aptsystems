import { RefreshCw } from 'lucide-react'
import { Button, SectionTitle, Stat } from '../../ui'
import { PKR, fmtRelative, pct } from '../../lib/format'
import { aliDeliverables, aliWarn, commandIntro, commandTasks, relationships } from '../content/command'
import { DataTable, Grid, Highlight, LiveBadge, Panel, Stack, Warn } from '../components/content-ui'
import { TaskList } from '../components/TaskList'
import { useOsKpiView } from '../lib/kpi'

export function Component() {
  const kpi = useOsKpiView()
  const k = kpi.k
  const n = (v: number) => Number(v || 0).toLocaleString('en-PK')
  return (
    <Stack>
      <Highlight intro={commandIntro} />

      <Grid cols={4}>
        <Stat tone="dark" label="Total Invoiced (APT)" value={kpi.invoiced} sub={kpi.invoicedSub} />
        <Stat label="App Orders (Kamai)" value={kpi.appOrders} sub={kpi.appOrdersSub} />
        <Stat label="Stores in Database" value={n(k.stores)} sub={`${n(k.stores_ordered)} have ordered at least once`} />
        <Stat tone="green" label="Heroes Registered" value={n(k.heroes_registered)} sub={`${n(k.heroes_active)} have booked orders · ${kpi.activationRate} activation`} />
      </Grid>

      <SectionTitle className="mb-0">
        <span className="flex items-center gap-3">
          Live from Supabase
          <LiveBadge live={kpi.live} loading={kpi.loading} label={kpi.live ? `Live ${fmtRelative(kpi.generatedAt)}` : 'Snapshot'} />
        </span>
      </SectionTitle>
      {kpi.error ? (
        <Warn>
          Live KPIs are unavailable ({kpi.error}). Showing the last dashboard snapshot. The numbers become live once the Kamai migrations are applied and you are signed in as a platform admin.
          <Button size="sm" variant="secondary" className="ml-3" icon={<RefreshCw size={12} />} onClick={kpi.refetch}>Retry</Button>
        </Warn>
      ) : null}
      <Grid cols={4}>
        <Stat label="Orders, last 7 days" value={n(k.orders_7d)} sub={`Rs ${n(k.value_7d)} live value`} />
        <Stat label="Active Heroes, 7 days" value={n(k.heroes_active_7d)} sub={`of ${n(k.heroes_registered)} registered`} />
        <Stat label="Stuck orders, 2+ days" value={n(k.stuck_orders)} sub="Pending, Approved, Packed or Dispatched" deltaTone="bad" delta={k.stuck_orders > 0 ? 'Needs action' : undefined} />
        <Stat tone="dark" label="AR over 60 days" value={kpi.ar60} sub={`${n(k.ar_60plus_count)} invoices. Collected yesterday: Rs ${n(k.collected_yesterday)}`} />
      </Grid>
      {kpi.live ? (
        <Grid cols={4}>
          <Stat label="Kamai tenants" value={n(k.kamai_tenants)} sub={`${n(k.kamai_stores)} Kamai stores`} />
          <Stat label="Kamai outstanding" value={PKR(k.kamai_outstanding_minor)} sub="Open credit exposures" />
          <Stat label="Kamai PAR 30" value={k.kamai_par30 == null ? '—' : pct(k.kamai_par30)} sub="Kill rule: pause credit above 8%" deltaTone="bad" delta={k.kamai_par30 != null && k.kamai_par30 > 0.08 ? 'Over threshold' : undefined} />
          <Stat label="WhatsApp queued" value={n(k.kamai_wa_queued)} sub={`Cancel rate ${kpi.cancelRate} · AR ${kpi.ar}`} />
        </Grid>
      ) : null}

      <SectionTitle className="mb-0">This Week — Priority Actions</SectionTitle>
      <TaskList defs={commandTasks} replace={{ ar: kpi.ar }} />

      <Grid cols={2}>
        <Panel title="Key Relationships">
          <DataTable {...relationships} />
        </Panel>
        <Panel title="Ali Deliverables (Pending)" dot="amber">
          <Warn className="mb-4">{aliWarn}</Warn>
          <DataTable {...aliDeliverables} />
        </Panel>
      </Grid>
    </Stack>
  )
}
