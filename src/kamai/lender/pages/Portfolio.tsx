import { useMemo } from 'react'
import { Card, CardTitle, EmptyState, PageHeader, Stat, Table, Spinner, type Column } from '../../ui'
import { PKR, PKRCompact, fmtInt, pct, fmtDate } from '../../lib/format'
import { ComplianceBanner } from '../parts/ComplianceBanner'
import { DayBars, HBars, type BarDatum } from '../parts/Bars'
import { BUCKETS, errMsg, nameOf, sum, useCollections, useFacilities, useFinancings, usePar, usePositions, useTenantNames } from '../lib/data'

interface DistRow {
  id: string
  outstanding: number
  financed: number
  open: number
  ineligible: number
  par30: number | null
}

export function Component() {
  const pos = usePositions()
  const par = usePar()
  const col = useCollections(30)
  const fac = useFacilities()
  const fin = useFinancings()

  const positions = pos.data ?? []
  const open = positions.filter((r) => r.status === 'open')
  const names = useTenantNames(positions.map((r) => r.distributor_tenant_id ?? ''))

  const kpi = useMemo(() => {
    const f = fin.data ?? []
    const parRows = par.data ?? []
    const out = sum(parRows.map((r) => r.outstanding_minor))
    const w = (k: 'par7_minor' | 'par30_minor' | 'par60_minor' | 'par90_minor') => (out > 0 ? sum(parRows.map((r) => r[k])) / out : null)
    const reserve = (fac.data ?? []).reduce((a, x) => {
      const used = sum(f.filter((y) => y.facility_id === x.id).map((y) => y.disbursed_minor - y.repaid_minor))
      return a + (used * x.first_loss_pct) / 100
    }, 0)
    return {
      disbursed: sum(f.map((x) => x.disbursed_minor)),
      outstanding: sum(f.map((x) => x.disbursed_minor - x.repaid_minor)),
      collected: sum(f.map((x) => x.repaid_minor)),
      par7: w('par7_minor'),
      par30: w('par30_minor'),
      par60: w('par60_minor'),
      par90: w('par90_minor'),
      eligible: open.filter((r) => r.eligible_flag),
      ineligible: open.filter((r) => !r.eligible_flag),
      reserve,
    }
  }, [fin.data, par.data, fac.data, open])

  const buckets: BarDatum[] = BUCKETS.map((b, i) => ({
    label: b,
    value: sum(open.filter((r) => r.dpd_bucket === b).map((r) => r.outstanding_minor)),
    tone: i === 0 ? 'green' : i < 3 ? 'amber' : i < 5 ? 'blue' : 'red',
  }))

  const days = useMemo(() => {
    const m = new Map<string, number>()
    for (let i = 29; i >= 0; i--) m.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0)
    for (const r of col.data ?? []) if (r.collected_on && m.has(r.collected_on)) m.set(r.collected_on, (m.get(r.collected_on) ?? 0) + (r.collected_minor ?? 0))
    return [...m].map(([day, value]) => ({ day, value }))
  }, [col.data])

  const dist: DistRow[] = useMemo(() => {
    const ids = [...new Set(positions.map((r) => r.distributor_tenant_id).filter((x): x is string => !!x))]
    return ids.map((id) => {
      const rows = open.filter((r) => r.distributor_tenant_id === id)
      const p = (par.data ?? []).find((x) => x.tenant_id === id)
      return {
        id,
        outstanding: sum(rows.map((r) => r.outstanding_minor)),
        financed: sum(rows.map((r) => r.financed_minor)),
        open: rows.length,
        ineligible: rows.filter((r) => !r.eligible_flag).length,
        par30: p?.par30 ?? null,
      }
    })
  }, [positions, open, par.data])

  const cols: Column<DistRow>[] = [
    { key: 'name', header: 'Distributor', render: (r) => <span className="font-semibold text-k-dark">{nameOf(names.data, r.id)}</span> },
    { key: 'open', header: 'Open', align: 'right', render: (r) => fmtInt(r.open) },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => PKR(r.outstanding) },
    { key: 'financed', header: 'Financed', align: 'right', hideOnMobile: true, render: (r) => PKR(r.financed) },
    { key: 'inel', header: 'Ineligible', align: 'right', hideOnMobile: true, render: (r) => fmtInt(r.ineligible) },
    { key: 'par30', header: 'PAR30', align: 'right', render: (r) => pct(r.par30) },
  ]

  const failed = [pos, par, col, fac, fin].find((q) => q.error)
  const loading = pos.isLoading || fin.isLoading || par.isLoading
  const noData = !loading && !failed && positions.length === 0 && (fin.data ?? []).length === 0 && (fac.data ?? []).length === 0
  const lastSnap = (par.data ?? []).map((r) => r.snapshot_date).filter(Boolean).sort().pop()

  return (
    <>
      <PageHeader title="Portfolio" eyebrow="Lender" description={lastSnap ? `PAR snapshot of ${fmtDate(lastSnap)}. Read-only view of linked distributors.` : 'Read-only view of linked distributors.'} />
      <ComplianceBanner />
      {failed ? (
        <Card>
          <EmptyState title="Could not load portfolio data" description={errMsg(failed.error)} />
        </Card>
      ) : loading ? (
        <Spinner label="Loading portfolio…" />
      ) : noData ? (
        <Card>
          <EmptyState
            title="No portfolio data yet"
            description="Positions appear once a distributor linked to your tenant delivers credit orders, and disbursements appear after you finance an order. Ask Kamai to link your tenant to a distributor."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat tone="dark" label="Disbursed" value={PKRCompact(kpi.disbursed)} sub={`${fmtInt((fin.data ?? []).length)} advances`} />
            <Stat label="Outstanding" value={PKRCompact(kpi.outstanding)} sub="advances net of repayments" />
            <Stat label="Collected" value={PKRCompact(kpi.collected)} sub="repaid to date" />
            <Stat label="First-loss reserve" value={PKRCompact(kpi.reserve)} sub="cover on outstanding advances" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="PAR 7" value={pct(kpi.par7)} />
            <Stat label="PAR 30" value={pct(kpi.par30)} delta={kpi.par30 !== null && kpi.par30 > 0.08 ? 'Above 8% pause rule' : undefined} deltaTone="bad" />
            <Stat label="PAR 60" value={pct(kpi.par60)} />
            <Stat label="PAR 90" value={pct(kpi.par90)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat tone="green" label="Eligible positions" value={fmtInt(kpi.eligible.length)} sub={PKR(sum(kpi.eligible.map((r) => r.outstanding_minor)))} />
            <Stat label="Ineligible positions" value={fmtInt(kpi.ineligible.length)} sub={PKR(sum(kpi.ineligible.map((r) => r.outstanding_minor)))} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle>Outstanding by DPD bucket</CardTitle>
              <HBars data={buckets} />
            </Card>
            <Card>
              <CardTitle>Collections, last 30 days</CardTitle>
              {sum(days.map((d) => d.value)) === 0 ? <EmptyState compact title="No collections in the last 30 days" /> : <DayBars data={days} />}
            </Card>
          </div>
          <Card padding="none">
            <div className="p-5 pb-0">
              <CardTitle>By distributor</CardTitle>
            </div>
            <Table
              columns={cols}
              rows={dist}
              rowKey={(r) => r.id}
              empty={<EmptyState compact title="No distributors linked" description="No facilities yet - ask Kamai to link your tenant to a distributor." />}
            />
          </Card>
        </div>
      )}
    </>
  )
}
