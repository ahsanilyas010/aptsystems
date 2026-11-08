import { useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, statusTone, type Column } from '../../ui'
import { PKR, fmtDate, fmtInt, humanize } from '../../lib/format'
import type { KamaiVLenderPositionsRow } from '../../lib/db-types'
import { ComplianceBanner } from '../parts/ComplianceBanner'
import { FinanceModal, useCanAct } from '../parts/ActionModals'
import { PositionDrawer } from '../parts/PositionDrawer'
import { BUCKETS, errMsg, nameOf, useFacilities, usePositions, useTenantNames } from '../lib/data'

const PAGE = 100

export function Component() {
  const pos = usePositions()
  const fac = useFacilities()
  const canAct = useCanAct()
  const rows = useMemo(() => pos.data ?? [], [pos.data])
  const names = useTenantNames(rows.map((r) => r.distributor_tenant_id ?? ''))

  const [dist, setDist] = useState('')
  const [bucket, setBucket] = useState('')
  const [status, setStatus] = useState('')
  const [store, setStore] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [sel, setSel] = useState<KamaiVLenderPositionsRow | null>(null)
  const [finance, setFinance] = useState<KamaiVLenderPositionsRow | null>(null)

  const distIds = [...new Set(rows.map((r) => r.distributor_tenant_id).filter((x): x is string => !!x))]
  const stores = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (r.store_id && (!dist || r.distributor_tenant_id === dist)) m.set(r.store_id, r.store_name ?? r.store_id)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows, dist])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!dist || r.distributor_tenant_id === dist) &&
        (!bucket || r.dpd_bucket === bucket) &&
        (!status || r.status === status) &&
        (!store || r.store_id === store) &&
        (!s || [r.store_name, r.invoice_number, r.area, r.order_id].some((v) => v?.toLowerCase().includes(s))),
    )
  }, [rows, dist, bucket, status, store, q])

  const cols: Column<KamaiVLenderPositionsRow>[] = [
    { key: 'store', header: 'Store', render: (r) => (<div><div className="font-semibold text-k-dark">{r.store_name}</div><div className="text-xs text-k-muted">{r.area ?? '—'}</div></div>) },
    { key: 'inv', header: 'Invoice', hideOnMobile: true, render: (r) => r.invoice_number ?? '—' },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (r) => fmtDate(r.due_date) },
    { key: 'out', header: 'Outstanding', align: 'right', render: (r) => PKR(r.outstanding_minor) },
    { key: 'dpd', header: 'DPD', align: 'right', render: (r) => (<Badge tone={(r.dpd ?? 0) > 30 ? 'red' : (r.dpd ?? 0) > 0 ? 'amber' : 'green'}>{r.dpd_bucket}</Badge>) },
    { key: 'status', header: 'Status', hideOnMobile: true, render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
    { key: 'elig', header: 'Eligible', hideOnMobile: true, render: (r) => <Badge tone={r.eligible_flag ? 'green' : 'red'}>{r.eligible_flag ? 'Yes' : 'No'}</Badge> },
    {
      key: 'act',
      header: '',
      align: 'right',
      render: (r) =>
        canAct && r.status === 'open' && r.eligible_flag && (r.financed_minor ?? 0) === 0 ? (
          <Button size="sm" onClick={(e) => { e.stopPropagation(); setFinance(r) }}>Finance</Button>
        ) : (r.financed_minor ?? 0) > 0 ? <Badge tone="blue">Financed</Badge> : null,
    },
  ]

  return (
    <>
      <PageHeader title="Exposures" eyebrow="Lender" description="Loan tape: one row per credit exposure. Tap a row for the order, delivery proof and invoice." />
      <ComplianceBanner />
      {pos.error ? (
        <Card><EmptyState title="Could not load exposures" description={errMsg(pos.error)} /></Card>
      ) : pos.isLoading ? (
        <Spinner label="Loading exposures…" />
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No exposures yet" description="Exposures appear when a linked distributor delivers a credit order. If nothing shows after deliveries, ask Kamai to link your tenant." /></Card>
      ) : (
        <Card padding="none">
          <div className="grid grid-cols-2 gap-3 border-b border-k-border p-4 lg:grid-cols-5">
            <Input className="col-span-2 lg:col-span-1" placeholder="Search store, invoice, area" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} />
            <Select value={dist} onChange={(e) => { setDist(e.target.value); setStore(''); setLimit(PAGE) }} options={[{ value: '', label: 'All distributors' }, ...distIds.map((id) => ({ value: id, label: nameOf(names.data, id) }))]} />
            <Select value={bucket} onChange={(e) => { setBucket(e.target.value); setLimit(PAGE) }} options={[{ value: '', label: 'All buckets' }, ...BUCKETS.map((b) => ({ value: b, label: b }))]} />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setLimit(PAGE) }} options={[{ value: '', label: 'All statuses' }, ...['open', 'paid', 'restructured', 'written_off'].map((s) => ({ value: s, label: humanize(s) }))]} />
            <Select value={store} onChange={(e) => { setStore(e.target.value); setLimit(PAGE) }} options={[{ value: '', label: 'All stores' }, ...stores.map(([id, n]) => ({ value: id, label: n }))]} />
          </div>
          <Table
            columns={cols}
            rows={filtered.slice(0, limit)}
            rowKey={(r) => r.exposure_id ?? ''}
            onRowClick={setSel}
            empty={<EmptyState compact title="No exposures match these filters" />}
          />
          <div className="flex items-center justify-between gap-3 border-t border-k-border p-3 text-[13px] text-k-muted">
            <span>Showing {fmtInt(Math.min(limit, filtered.length))} of {fmtInt(filtered.length)}</span>
            {filtered.length > limit ? <Button size="sm" variant="secondary" onClick={() => setLimit(limit + PAGE)}>Show more</Button> : null}
          </div>
        </Card>
      )}
      <PositionDrawer row={sel} onClose={() => setSel(null)} canFinance={canAct} onFinance={(r) => { setSel(null); setFinance(r) }} />
      <FinanceModal row={finance} facilities={fac.data ?? []} onClose={() => setFinance(null)} />
    </>
  )
}
