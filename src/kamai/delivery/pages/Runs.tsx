import { useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Navigation, Phone, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, statusTone } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR } from '../../lib/format'
import { mapsUrl } from '../../lib/geo'
import { STORE_COLS, errMsg, startOfKarachiDay, useRiderTenant, type OrderRow, type StoreRow } from '../lib/data'
import { ErrorState } from '../parts/States'

interface RunOrder extends OrderRow {
  store: StoreRow | null
  paidMinor: number
}

async function fetchRun(tenantId: string, userId: string): Promise<{ active: RunOrder[]; done: RunOrder[] }> {
  const [act, dn] = await Promise.all([
    supabase.from('kamai_orders').select('*').eq('tenant_id', tenantId).eq('rider_user_id', userId).in('fulfilment_status', ['packed', 'dispatched']).order('created_at'),
    supabase.from('kamai_orders').select('*').eq('tenant_id', tenantId).eq('rider_user_id', userId).eq('fulfilment_status', 'delivered').gte('delivered_at', startOfKarachiDay()).order('delivered_at', { ascending: false }),
  ])
  if (act.error) throw act.error
  if (dn.error) throw dn.error
  const orders = [...((act.data ?? []) as OrderRow[]), ...((dn.data ?? []) as OrderRow[])]
  const storeIds = [...new Set(orders.map((o) => o.store_id))]
  const codIds = orders.filter((o) => o.payment_mode === 'cod').map((o) => o.id)
  const [st, pay] = await Promise.all([
    storeIds.length ? supabase.from('kamai_stores').select(STORE_COLS).eq('tenant_id', tenantId).in('id', storeIds) : Promise.resolve({ data: [], error: null }),
    codIds.length ? supabase.from('kamai_payments').select('order_id,amount_minor').eq('tenant_id', tenantId).in('order_id', codIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (st.error) throw st.error
  const stores = new Map(((st.data ?? []) as StoreRow[]).map((s) => [s.id, s]))
  const paid = new Map<string, number>()
  for (const p of (pay.data ?? []) as Array<{ order_id: string | null; amount_minor: number }>) {
    if (p.order_id) paid.set(p.order_id, (paid.get(p.order_id) ?? 0) + Number(p.amount_minor))
  }
  const enrich = (o: OrderRow): RunOrder => ({ ...o, store: stores.get(o.store_id) ?? null, paidMinor: paid.get(o.id) ?? 0 })
  return { active: ((act.data ?? []) as OrderRow[]).map(enrich), done: ((dn.data ?? []) as OrderRow[]).map(enrich) }
}

function OrderCard({ o }: { o: RunOrder }) {
  const collect = o.payment_mode === 'cod' ? Math.max(0, Number(o.total_minor) - o.paidMinor) : 0
  const s = o.store
  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <Link to={`/delivery/orders/${o.id}`} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-k-dark">{s?.name ?? 'Store'}</div>
          <div className="text-xs text-k-muted">Order #{o.order_no} · {o.items_count} items</div>
          {s?.address ? <div className="mt-1 flex items-start gap-1 text-xs text-k-muted"><MapPin size={13} className="mt-0.5 shrink-0" />{s.address}</div> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={statusTone(o.fulfilment_status)} dot>{o.fulfilment_status}</Badge>
          <Badge tone={o.payment_mode === 'cod' ? 'amber' : 'muted'}>{o.payment_mode.toUpperCase()}</Badge>
        </div>
      </Link>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-k-muted">Total</div>
          <div className="text-lg font-extrabold text-k-dark">{PKR(o.total_minor)}</div>
        </div>
        {o.payment_mode === 'cod' ? (
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-k-muted">Collect</div>
            <div className={collect > 0 ? 'text-lg font-extrabold text-k-red' : 'text-lg font-extrabold text-k-green'}>{collect > 0 ? PKR(collect) : 'Done'}</div>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {s?.mobile ? (
          <a href={`tel:${s.mobile}`} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-k-border bg-k-surface text-sm font-semibold text-k-dark"><Phone size={16} />Call</a>
        ) : <span className="flex h-12 items-center justify-center rounded-xl bg-k-surface2 text-xs text-k-light">No phone</span>}
        {s?.latitude != null && s?.longitude != null ? (
          <a href={mapsUrl({ lat: s.latitude, lng: s.longitude })} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-k-border bg-k-surface text-sm font-semibold text-k-dark"><Navigation size={16} />Map</a>
        ) : <span className="flex h-12 items-center justify-center rounded-xl bg-k-surface2 text-xs text-k-light">No map</span>}
        <Link to={`/delivery/orders/${o.id}`} className="flex h-12 items-center justify-center rounded-xl bg-k-green text-sm font-bold text-white">Open</Link>
      </div>
    </Card>
  )
}

function Groups({ orders }: { orders: RunOrder[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, RunOrder[]>()
    for (const o of orders) {
      const k = o.store?.area?.trim() || 'Other area'
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [orders])
  return (
    <div className="flex flex-col gap-5">
      {groups.map(([area, list]) => (
        <section key={area} className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-[2px] text-k-muted">{area} · {list.length}</h2>
          {list.map((o) => <OrderCard key={o.id} o={o} />)}
        </section>
      ))}
    </div>
  )
}

export function Component() {
  const { tenantId, userId } = useRiderTenant()
  const q = useQuery({
    queryKey: ['delivery', 'runs', tenantId, userId],
    queryFn: () => fetchRun(tenantId as string, userId as string),
    enabled: Boolean(tenantId && userId),
  })

  return (
    <>
      <PageHeader
        title="Aaj ki runs"
        eyebrow="Delivery"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} />} loading={q.isFetching && !q.isLoading} onClick={() => void q.refetch()}>Refresh</Button>}
      />
      {!tenantId ? (
        <EmptyState title="Rider tenant nahi mila" description="Aapka account kisi distributor se rider ke taur par juda nahi. / Your account is not linked to a distributor as a rider." />
      ) : q.isLoading ? (
        <Spinner label="Runs load ho rahi hain…" />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {q.data && q.data.active.length > 0 ? <Groups orders={q.data.active} /> : <EmptyState title="Koi order assign nahi" description="Packed ya dispatched orders yahan nazar aayenge. / Packed and dispatched orders assigned to you appear here." />}
          {q.data && q.data.done.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-bold uppercase tracking-[2px] text-k-muted">Aaj deliver hue · {q.data.done.length}</h2>
              {q.data.done.map((o) => <OrderCard key={o.id} o={o} />)}
            </section>
          ) : null}
        </div>
      )}
    </>
  )
}
