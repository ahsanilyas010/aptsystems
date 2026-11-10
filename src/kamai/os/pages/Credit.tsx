import { PageHeader, Badge, Stat, Table, type BadgeTone, type Column } from '../../ui'
import { PKR, fmtDate, pct } from '../../lib/format'
import type { KamaiVParRow } from '../../lib/db-types'
import { scorecard } from '../content/platform'
import { Grid, Panel, Stack } from '../components/content-ui'
import { ErrorState } from '../components/QueryState'
import { useCashVariance, useCollectedWithinTerms, useDisputeRates, useDpdDistribution, usePar } from '../lib/credit'
import { useOsKpiView } from '../lib/kpi'
import { errMsg, tenantNameMap, useAllTenants } from '../lib/tenants'

type RuleState = 'ok' | 'watch' | 'breach' | 'nodata'
const RULE_TONE: Record<RuleState, BadgeTone> = { ok: 'green', watch: 'amber', breach: 'red', nodata: 'muted' }
const RULE_TEXT: Record<RuleState, string> = { ok: 'Within limit', watch: 'Close to limit', breach: 'Breached', nodata: 'No data' }

function ruleState(value: number | null | undefined, threshold: number): RuleState {
  if (value == null || !Number.isFinite(value)) return 'nodata'
  if (value > threshold) return 'breach'
  if (value >= threshold * 0.8) return 'watch'
  return 'ok'
}

function RuleCard({ title, action, current, threshold, state, note }: { title: string; action: string; current: string; threshold: string; state: RuleState; note?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-k-border bg-k-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-[1.5px] text-k-muted">{title}</div>
        <Badge tone={RULE_TONE[state]} dot>{RULE_TEXT[state]}</Badge>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold text-k-dark">{current}</span>
        <span className="text-sm text-k-muted">vs {threshold}</span>
      </div>
      <p className="text-[13px] text-k-muted">{action}</p>
      {note ? <p className="text-xs text-k-light">{note}</p> : null}
    </div>
  )
}

export function Component() {
  const kpi = useOsKpiView()
  const tenants = useAllTenants()
  const par = usePar()
  const dpd = useDpdDistribution()
  const disputes = useDisputeRates()
  const cash = useCashVariance()
  const terms = useCollectedWithinTerms()
  const names = tenantNameMap(tenants.data)

  const par30 = par.data?.par30 ?? null
  const worst = disputes.data?.byTenant.find((t) => t.delivered + t.disputed >= 5) ?? disputes.data?.byTenant[0]
  const worstRate = worst ? worst.rate : null
  const ruleErr = disputes.error ?? cash.error
  const paused = (tenants.data ?? []).filter((t) => (t.settings as { credit_paused?: boolean } | null)?.credit_paused)

  const parCols: Column<KamaiVParRow>[] = [
    { key: 't', header: 'Tenant', render: (r) => <span className="font-semibold text-k-dark">{r.tenant_id ? names.get(r.tenant_id) ?? r.tenant_id.slice(0, 8) : '—'}</span> },
    { key: 'o', header: 'Outstanding', align: 'right', render: (r) => PKR(r.outstanding_minor) },
    { key: '7', header: 'PAR 7', align: 'right', render: (r) => pct(r.par7) },
    { key: '30', header: 'PAR 30', align: 'right', render: (r) => <span className={(r.par30 ?? 0) > 0.08 ? 'font-bold text-k-red' : ''}>{pct(r.par30)}</span> },
    { key: '60', header: 'PAR 60', align: 'right', hideOnMobile: true, render: (r) => pct(r.par60) },
    { key: '90', header: 'PAR 90', align: 'right', hideOnMobile: true, render: (r) => pct(r.par90) },
    { key: 'd', header: 'Snapshot', hideOnMobile: true, render: (r) => fmtDate(r.snapshot_date) },
  ]

  const maxOut = Math.max(1, ...(dpd.data?.buckets ?? []).map((b) => b.outstanding))
  const live: Record<string, string> = {
    cancel: kpi.cancelRate,
    collected: terms.data?.ratio != null ? pct(terms.data.ratio) : '—',
    par30: pct(par30, { fallback: '—' }),
    activation: kpi.activationRate,
  }

  return (
    <Stack>
      <PageHeader eyebrow="Kamai OS" title="Credit portfolio" description="Portfolio at risk, days-past-due distribution and the Platform Plan kill rules, across all tenants." />

      <Grid cols={4}>
        <Stat tone="dark" label="Outstanding" value={par.data ? PKR(par.data.outstanding) : '—'} sub={par.data?.snapshotDate ? `Snapshot ${fmtDate(par.data.snapshotDate)}` : 'Open credit exposures'} />
        <Stat label="PAR 7" value={pct(par.data?.par7)} sub="Obligors over 7 DPD" />
        <Stat label="PAR 30" value={pct(par30)} sub="Kill rule above 8%" deltaTone="bad" delta={par30 != null && par30 > 0.08 ? 'Breached' : undefined} />
        <Stat label="PAR 60 / 90" value={`${pct(par.data?.par60)} / ${pct(par.data?.par90)}`} sub="Balance-weighted" tone="green" />
      </Grid>

      <Panel title="Kill and pause rules">
        <Grid cols={4}>
          <RuleCard title="Pause new credit" action="Pause new credit if PAR 30 exceeds 8%." current={pct(par30)} threshold="8%" state={ruleState(par30, 0.08)} note={paused.length ? `Currently paused: ${paused.map((t) => t.name).join(', ')}` : 'No tenant is currently paused.'} />
          <RuleCard title="Pause a distributor" action="Pause a distributor if its dispute rate exceeds 10% of orders." current={pct(worstRate)} threshold="10%" state={ruleState(worstRate, 0.1)} note={worst ? `Highest: ${names.get(worst.tenant_id) ?? worst.tenant_id.slice(0, 8)} (${worst.disputed} of ${worst.delivered + worst.disputed})` : 'No delivered orders yet.'} />
          <RuleCard title="Stop Lane A" action="Stop Lane A if average float exceeds 15 days." current="—" threshold="15 days" state="nodata" note="Lane A starts at M4. Float is measured once aggregator orders exist." />
          <RuleCard title="Drop the Bykea pool plan" action="Drop the Bykea pool plan if rider cash variance exceeds 1%." current={pct(cash.data?.ratio, { digits: 2 })} threshold="1%" state={ruleState(cash.data?.ratio, 0.01)} note={cash.data ? `Last 30 days, expected ${PKR(cash.data.expected)}` : undefined} />
        </Grid>
        {ruleErr ? <p className="mt-3 text-xs text-k-muted">Some rule inputs could not be read: {errMsg(ruleErr)}</p> : null}
      </Panel>

      <Grid cols={2}>
        <Panel title="PAR by tenant">
          {par.error ? <ErrorState error={par.error} onRetry={() => void par.refetch()} /> : (
            <Table dense columns={parCols} rows={par.data?.rows ?? []} rowKey={(r, i) => (r.tenant_id ?? '') + i} loading={par.isLoading} empty={<p className="py-4 text-center text-sm text-k-muted">No credit snapshots yet. The daily job writes them at 06:30 PKT.</p>} />
          )}
        </Panel>
        <Panel title={`DPD distribution${dpd.data?.date ? ` · ${fmtDate(dpd.data.date)}` : ''}`}>
          {dpd.error ? <ErrorState error={dpd.error} onRetry={() => void dpd.refetch()} /> : dpd.isLoading ? <p className="text-sm text-k-muted">Loading…</p> : !dpd.data?.date ? (
            <p className="py-4 text-center text-sm text-k-muted">No snapshots yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {dpd.data.buckets.map((b) => (
                <div key={b.bucket} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 text-sm">
                  <span className="font-semibold text-k-dark">{b.bucket === 'current' ? 'Current' : b.bucket}</span>
                  <div className="h-3 overflow-hidden rounded-full bg-k-surface2">
                    <div className={b.bucket === 'current' || b.bucket === '1-7' ? 'h-full bg-k-green' : b.bucket === '8-14' || b.bucket === '15-30' ? 'h-full bg-k-accent' : 'h-full bg-k-red'} style={{ width: `${(b.outstanding / maxOut) * 100}%` }} />
                  </div>
                  <span className="text-right text-xs tabular-nums text-k-muted">{b.stores} stores · {PKR(b.outstanding)}</span>
                </div>
              ))}
              <div className="mt-1 border-t border-k-border pt-2 text-xs text-k-muted">{dpd.data.totalStores} stores with exposure · {PKR(dpd.data.totalOutstanding)}</div>
            </div>
          )}
        </Panel>
      </Grid>

      <Panel title="Scorecard targets (Platform Plan)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead><tr>{['Metric', 'Target', 'Current'].map((h) => <th key={h} className="border-b-2 border-k-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[1px] text-k-muted">{h}</th>)}</tr></thead>
            <tbody>
              {scorecard.map((s) => (
                <tr key={s.key}>
                  <td className="border-b border-k-border px-3 py-2.5 font-semibold text-k-dark">{s.metric}</td>
                  <td className="border-b border-k-border px-3 py-2.5 text-k-muted">{s.target}</td>
                  <td className="border-b border-k-border px-3 py-2.5 font-bold tabular-nums">{live[s.key] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Stack>
  )
}
