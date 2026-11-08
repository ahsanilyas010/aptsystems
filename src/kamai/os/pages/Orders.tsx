import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { FulfilmentStatus, KamaiOrderEventsRow, KamaiOrderItemsRow, KamaiOrdersRow } from '../../lib/db-types'
import { PKR, fmtDateTime, humanize } from '../../lib/format'
import { Badge, Input, PageHeader, Select, Spinner, Table, cx, statusTone, type Column } from '../../ui'
import { Drawer } from '../components/Drawer'
import { Panel, Stack } from '../components/content-ui'
import { ErrorState } from '../components/QueryState'
import { useOsKpiView } from '../lib/kpi'
import { errMsg, tenantNameMap, useAllTenants } from '../lib/tenants'

const STATES: FulfilmentStatus[] = ['booked', 'credit_approved', 'packed', 'dispatched', 'delivered', 'disputed', 'cancelled', 'rejected']
const LIMIT = 300

function useOrders(tenant: string, status: string) {
  return useQuery({
    queryKey: ['os', 'orders', tenant, status],
    queryFn: async (): Promise<KamaiOrdersRow[]> => {
      let q = supabase.from('kamai_orders').select('*').order('created_at', { ascending: false }).limit(LIMIT)
      if (tenant) q = q.eq('tenant_id', tenant)
      if (status) q = q.eq('fulfilment_status', status)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiOrdersRow[]
    },
    staleTime: 30_000,
    retry: false,
  })
}

function useStoreNames(ids: string[]) {
  const key = [...new Set(ids)].sort()
  return useQuery({
    queryKey: ['os', 'orders', 'stores', key.join(',')],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_stores').select('id, name').in('id', key)
      if (error) throw new Error(error.message)
      return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
    },
    staleTime: 60_000,
    retry: false,
  })
}

function OrderDetail({ order, tenantName, storeName }: { order: KamaiOrdersRow; tenantName: string; storeName: string }) {
  const items = useQuery({
    queryKey: ['os', 'order-items', order.tenant_id, order.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_order_items').select('*').eq('tenant_id', order.tenant_id).eq('order_id', order.id)
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiOrderItemsRow[]
    },
    retry: false,
  })
  const events = useQuery({
    queryKey: ['os', 'order-events', order.tenant_id, order.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_order_events').select('*').eq('tenant_id', order.tenant_id).eq('order_id', order.id).order('at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiOrderEventsRow[]
    },
    retry: false,
  })
  const kv: Array<[string, string]> = [
    ['Tenant', tenantName], ['Store', storeName], ['Source', humanize(order.source)], ['Payment', order.payment_mode.toUpperCase()],
    ['Finance', humanize(order.finance_status)], ['Subtotal', PKR(order.subtotal_minor)], ['Tax', PKR(order.tax_minor)], ['Total', PKR(order.total_minor)],
    ['Created', fmtDateTime(order.created_at)], ['Delivered', fmtDateTime(order.delivered_at)],
  ]
  const itemCols: Column<KamaiOrderItemsRow>[] = [
    { key: 'name', header: 'Item', render: (i) => (<div><div className="font-semibold text-k-dark">{i.name}</div><div className="text-xs text-k-muted">{i.sku}</div></div>) },
    { key: 'qty', header: 'Qty', align: 'right', render: (i) => `${i.delivered_qty}/${i.qty}` },
    { key: 'total', header: 'Line', align: 'right', render: (i) => PKR(i.line_total_minor + i.tax_minor) },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(order.fulfilment_status)} dot>{humanize(order.fulfilment_status)}</Badge>
        {order.cancellation_reason ? <Badge tone="red">{order.cancellation_reason}</Badge> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {kv.map(([k, v]) => (
          <div key={k}><dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">{k}</dt><dd className="font-semibold text-k-dark">{v}</dd></div>
        ))}
      </dl>
      {order.notes ? <p className="rounded-lg bg-k-surface2 p-3 text-sm text-k-text">{order.notes}</p> : null}
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[2px] text-k-muted">Items</h3>
        {items.error ? <ErrorState error={items.error} /> : <Table dense columns={itemCols} rows={items.data ?? []} rowKey={(i) => i.id} loading={items.isLoading} />}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[2px] text-k-muted">Order events</h3>
        {events.isLoading ? <Spinner label="Loading…" /> : events.error ? <ErrorState error={events.error} /> : (events.data ?? []).length === 0 ? (
          <p className="text-sm text-k-muted">No events recorded.</p>
        ) : (
          <ol className="relative flex flex-col gap-4 border-l-2 border-k-border pl-5">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-k-surface bg-k-green" />
                <div className="text-sm font-semibold text-k-dark">{e.from_state ? `${humanize(e.from_state)} → ` : ''}{humanize(e.to_state)}</div>
                <div className="text-xs text-k-muted">{fmtDateTime(e.at)}{e.actor ? ` · ${e.actor.slice(0, 8)}` : ''}</div>
                {e.reason ? <div className="mt-0.5 text-[13px] text-k-text">{e.reason}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

export function Component() {
  const kpi = useOsKpiView()
  const tenants = useAllTenants()
  const [tenant, setTenant] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<KamaiOrdersRow | null>(null)
  const orders = useOrders(tenant, status)
  const names = tenantNameMap(tenants.data)
  const stores = useStoreNames((orders.data ?? []).map((o) => o.store_id))

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return orders.data ?? []
    return (orders.data ?? []).filter((o) => String(o.order_no).includes(s) || (stores.data?.get(o.store_id) ?? '').toLowerCase().includes(s))
  }, [orders.data, search, stores.data])

  const counts = kpi.live && !tenant ? kpi.k.kamai_orders_by_state : null
  const localCounts = useMemo(() => {
    const c: Partial<Record<FulfilmentStatus, number>> = {}
    for (const o of orders.data ?? []) c[o.fulfilment_status] = (c[o.fulfilment_status] ?? 0) + 1
    return c
  }, [orders.data])
  const countOf = (s: FulfilmentStatus) => (counts ?? (status ? { [status]: orders.data?.length ?? 0 } : localCounts))[s] ?? 0

  const columns: Column<KamaiOrdersRow>[] = [
    { key: 'no', header: 'Order', render: (o) => <span className="font-bold text-k-dark">#{o.order_no}</span> },
    { key: 'tenant', header: 'Tenant', hideOnMobile: true, render: (o) => names.get(o.tenant_id) ?? o.tenant_id.slice(0, 8) },
    { key: 'store', header: 'Store', render: (o) => stores.data?.get(o.store_id) ?? '…' },
    { key: 'status', header: 'Status', render: (o) => <Badge tone={statusTone(o.fulfilment_status)} dot>{humanize(o.fulfilment_status)}</Badge> },
    { key: 'mode', header: 'Pay', hideOnMobile: true, render: (o) => <Badge tone={o.payment_mode === 'cod' ? 'amber' : 'blue'} size="sm">{o.payment_mode.toUpperCase()}</Badge> },
    { key: 'total', header: 'Total', align: 'right', render: (o) => PKR(o.total_minor) },
    { key: 'created', header: 'Created', hideOnMobile: true, render: (o) => fmtDateTime(o.created_at) },
  ]

  return (
    <Stack>
      <PageHeader eyebrow="Kamai OS" title="Orders pipeline" description={`Cross-tenant view of Kamai orders by fulfilment status. Showing the latest ${LIMIT} matching orders.`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {STATES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? '' : s)}
            className={cx(
              'rounded-xl border p-3 text-left transition-colors',
              status === s ? 'border-k-green bg-k-green-light' : 'border-k-border bg-k-surface hover:bg-k-surface2',
            )}
          >
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-k-muted">{humanize(s)}</div>
            <div className="mt-1 text-2xl font-extrabold text-k-dark">{countOf(s)}</div>
          </button>
        ))}
      </div>
      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Select label="Tenant" value={tenant} onChange={(e) => setTenant(e.target.value)} options={[{ value: '', label: 'All tenants' }, ...(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, ...STATES.map((s) => ({ value: s, label: humanize(s) }))]} />
          <Input label="Search" prefix={<Search size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no or store" className="[&_input]:pl-9" />
        </div>
        {orders.error ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : (
          <Table columns={columns} rows={filtered} rowKey={(o) => o.id} loading={orders.isLoading} onRowClick={setSelected} empty={<p className="py-6 text-center text-sm text-k-muted">No orders match these filters.</p>} />
        )}
      </Panel>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order #${selected.order_no}` : ''} subtitle={selected ? fmtDateTime(selected.created_at) : undefined}>
        {selected ? <OrderDetail order={selected} tenantName={names.get(selected.tenant_id) ?? selected.tenant_id} storeName={stores.data?.get(selected.store_id) ?? selected.store_id} /> : null}
      </Drawer>
      {tenants.error ? <p className="text-xs text-k-muted">Tenant names unavailable: {errMsg(tenants.error)}</p> : null}
    </Stack>
  )
}
