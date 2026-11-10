import { useState } from 'react'
import { Card, CardTitle, EmptyState, PageHeader, Spinner, Stat, Table, Tabs, type Column } from '../../ui'
import { PKR, PKRCompact, fmtInt, pct } from '../../lib/format'
import { Bar } from '../parts/Bar'
import { errMsg, useBrandProducts, useTenantNames, useTid } from '../lib/data'
import { useSellThrough, type Agg } from '../lib/sellthrough'

type Dim = 'sku' | 'area' | 'distributor'

export function Component() {
  const tid = useTid()
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const [dim, setDim] = useState<Dim>('sku')
  const products = useBrandProducts()
  const st = useSellThrough(Number(days))
  const names = useTenantNames(st.data?.byDistributor.map((d) => d.key) ?? [])

  const linked = (products.data ?? []).filter((p) => p.brand_tenant_id === tid && p.tenant_id !== tid)
  const d = st.data
  const rows: Agg[] = !d ? [] : dim === 'sku' ? d.bySku : dim === 'area' ? d.byArea : d.byDistributor.map((x) => ({ ...x, label: names.data?.[x.key] ?? `${x.key.slice(0, 8)}…` }))
  const maxGmv = Math.max(1, ...rows.map((r) => r.gmv))
  const cols: Column<Agg>[] = [
    { key: 'label', header: dim === 'sku' ? 'SKU' : dim === 'area' ? 'Area' : 'Distributor', render: (r) => <span className="font-semibold text-k-dark">{r.label}</span> },
    { key: 'units', header: 'Units', align: 'right', render: (r) => fmtInt(r.units) },
    { key: 'gmv', header: 'GMV', align: 'right', render: (r) => PKR(r.gmv) },
    { key: 'stores', header: 'Stores', align: 'right', hideOnMobile: true, render: (r) => fmtInt(r.stores) },
    { key: 'bar', header: '', width: 140, hideOnMobile: true, render: (r) => <Bar value={r.gmv} max={maxGmv} /> },
  ]

  const err = products.error ?? st.error
  return (
    <>
      <PageHeader title="Sell-through" eyebrow="Brand" description="Delivered units and GMV (excl. tax) of your SKUs across linked distributors." actions={<Tabs variant="pills" value={days} onChange={setDays} items={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />} />
      {err ? (
        <Card><EmptyState title="Could not load sell-through" description={errMsg(err)} /></Card>
      ) : products.isLoading || st.isLoading ? (
        <Spinner label="Loading sell-through…" />
      ) : linked.length === 0 ? (
        <Card>
          <EmptyState
            title="No distributor sales yet"
            description="Sell-through appears when a distributor lists your SKUs and a store order is delivered. Add your products first, then ask Kamai to link your tenant to your distributors."
          />
        </Card>
      ) : d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat tone="dark" label="GMV" value={PKRCompact(d.totalGmv)} sub={`last ${days} days`} />
            <Stat label="Units" value={fmtInt(d.totalUnits)} />
            <Stat label="Stores reached" value={fmtInt(d.storeCount)} />
            <Stat label="Repeat rate" value={d.storeCount ? pct(d.repeatStores / d.storeCount) : '—'} sub={`${fmtInt(d.repeatStores)} stores ordered 2+ times`} />
          </div>
          <Card>
            <CardTitle>Top SKUs by GMV</CardTitle>
            {d.bySku.length === 0 ? (
              <EmptyState compact title="No delivered sales in this period" />
            ) : (
              <ol className="space-y-2.5">
                {d.bySku.slice(0, 5).map((r, i) => (
                  <li key={r.key} className="grid grid-cols-[20px_1fr_90px] items-center gap-3 text-[13px]">
                    <span className="font-bold text-k-muted">{i + 1}</span>
                    <span className="min-w-0"><span className="block truncate font-semibold text-k-dark">{r.label}</span><Bar value={r.gmv} max={d.bySku[0].gmv} /></span>
                    <span className="text-right font-bold">{PKRCompact(r.gmv)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card padding="none">
            <div className="p-4 pb-0"><Tabs value={dim} onChange={setDim} items={[{ key: 'sku', label: 'By SKU' }, { key: 'area', label: 'By store area' }, { key: 'distributor', label: 'By distributor' }]} /></div>
            <Table columns={cols} rows={rows} rowKey={(r) => r.key} empty={<EmptyState compact title="No delivered sales in this period" />} />
          </Card>
        </div>
      ) : null}
    </>
  )
}
