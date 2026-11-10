import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { LayoutGrid, Plus, Rows3, Search } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table, Tabs, statusTone } from '../../ui'
import type { Column } from '../../ui'
import { PKR, fmtDateTime, humanize, padNo } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { FulfilmentStatus, KamaiOrdersRow } from '../../lib/db-types'
import { ErrorState, NoTenant, useCan, useStores, useTenantId, useTq } from '../lib/data'
import { NEXT, TransitionModal, transitionLabel, type TransitionTarget } from '../parts/OrderActions'
import { NewOrderModal } from '../parts/NewOrderModal'

const BOARD: FulfilmentStatus[] = ['booked', 'credit_approved', 'packed', 'dispatched', 'delivered']
const OTHER: FulfilmentStatus[] = ['cancelled', 'rejected', 'disputed']
type View = 'board' | 'table'

export function Component() {
  const tid = useTenantId()
  const nav = useNavigate()
  const canWrite = useCan(['owner', 'manager', 'booker'])
  const stores = useStores()
  const [view, setView] = useState<View>('board')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [tr, setTr] = useState<{ o: KamaiOrdersRow; to: TransitionTarget } | null>(null)
  const orders = useTq<KamaiOrdersRow[]>(['orders'], (t) => supabase.from('kamai_orders').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(600))

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (orders.data ?? []).filter((o) => {
      if (status && o.fulfilment_status !== status) return false
      if (!s) return true
      return String(o.order_no).includes(s) || (stores.map.get(o.store_id)?.name ?? '').toLowerCase().includes(s)
    })
  }, [orders.data, status, q, stores.map])

  if (!tid) return <NoTenant />
  const storeName = (id: string) => stores.map.get(id)?.name ?? 'Unknown store'

  const cols: Column<KamaiOrdersRow>[] = [
    { key: 'no', header: 'Order', render: (o) => <span className="font-semibold text-k-dark">{padNo('#', o.order_no, 5)}</span> },
    { key: 'store', header: 'Store', render: (o) => storeName(o.store_id) },
    { key: 'st', header: 'State', render: (o) => <Badge tone={statusTone(o.fulfilment_status)}>{humanize(o.fulfilment_status)}</Badge> },
    { key: 'mode', header: 'Payment', hideOnMobile: true, render: (o) => (o.payment_mode === 'cod' ? 'COD' : 'Credit') },
    { key: 'at', header: 'Created', hideOnMobile: true, render: (o) => fmtDateTime(o.created_at) },
    { key: 'tot', header: 'Total', align: 'right', render: (o) => <span className="font-semibold">{PKR(o.total_minor)}</span> },
  ]

  const card = (o: KamaiOrdersRow) => (
    <div key={o.id} className="rounded-xl border border-k-border bg-k-surface p-3 shadow-sm">
      <button className="block w-full text-left" onClick={() => nav(`/distributor/orders/${o.id}`)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-k-dark">{padNo('#', o.order_no, 5)}</span>
          <span className="text-sm font-semibold">{PKR(o.total_minor)}</span>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-k-text">{storeName(o.store_id)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-k-muted">{o.payment_mode === 'cod' ? 'COD' : 'Credit'} · {o.items_count} items</div>
      </button>
      {canWrite && NEXT[o.fulfilment_status]?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {NEXT[o.fulfilment_status]!.filter((t) => t !== 'credit_approved').map((t) => (
            <Button key={t} size="sm" variant={t === 'cancelled' || t === 'rejected' ? 'ghost' : 'secondary'} onClick={() => setTr({ o, to: t })}>{transitionLabel(t).replace(' order', '')}</Button>
          ))}
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      <PageHeader title="Orders" eyebrow="Distributor" description="Pipeline from booking to delivery."
        actions={canWrite ? <Button icon={<Plus size={15} />} onClick={() => setCreating(true)}>New order</Button> : null}>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs<View> variant="pills" value={view} onChange={setView} items={[{ key: 'board', label: <span className="flex items-center gap-1.5"><LayoutGrid size={14} />Board</span> }, { key: 'table', label: <span className="flex items-center gap-1.5"><Rows3 size={14} />Table</span> }]} />
          <Input aria-label="Search orders" className="min-w-[200px] flex-1 sm:max-w-xs" placeholder="Order no. or store" prefix={<Search size={15} />} value={q} onChange={(e) => setQ(e.target.value)} />
          {view === 'table' ? <Select aria-label="State" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All states' }, ...[...BOARD, ...OTHER].map((s) => ({ value: s, label: humanize(s) }))]} /> : null}
        </div>
      </PageHeader>
      {orders.isError ? <ErrorState error={orders.error} onRetry={() => void orders.refetch()} /> : null}
      {!orders.isError && view === 'table' ? (
        <Card padding="none">
          <Table columns={cols} rows={rows} rowKey={(o) => o.id} loading={orders.isLoading} onRowClick={(o) => nav(`/distributor/orders/${o.id}`)} empty={<EmptyState title="No orders found" />} />
        </Card>
      ) : null}
      {!orders.isError && view === 'board' ? (
        orders.isLoading ? <Card><p className="text-sm text-k-muted">Loading…</p></Card> : (
          <>
            <div className="flex gap-3 overflow-x-auto pb-3">
              {BOARD.map((s) => {
                const col = rows.filter((o) => o.fulfilment_status === s)
                return (
                  <section key={s} className="w-[270px] shrink-0 rounded-2xl border border-k-border bg-k-surface2 p-3">
                    <header className="mb-2 flex items-center justify-between">
                      <Badge tone={statusTone(s)}>{humanize(s)}</Badge>
                      <span className="text-xs font-bold text-k-muted">{col.length}</span>
                    </header>
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto">{col.length ? col.slice(0, 40).map(card) : <p className="py-4 text-center text-xs text-k-light">Empty</p>}</div>
                  </section>
                )
              })}
            </div>
            {rows.some((o) => OTHER.includes(o.fulfilment_status)) ? (
              <p className="mt-2 text-xs text-k-muted">{rows.filter((o) => OTHER.includes(o.fulfilment_status)).length} cancelled, rejected or disputed orders are in the Table view.</p>
            ) : null}
          </>
        )
      ) : null}
      <NewOrderModal open={creating} onClose={() => setCreating(false)} tenantId={tid} onCreated={(id) => nav(`/distributor/orders/${id}`)} />
      <TransitionModal key={tr ? tr.o.id + tr.to : 'x'} orderId={tr?.o.id ?? ''} orderNo={tr?.o.order_no} to={tr?.to ?? null} onClose={() => setTr(null)} />
    </>
  )
}
