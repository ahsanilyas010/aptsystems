import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MapPin, Navigation, Phone } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, Spinner, statusTone } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR } from '../../lib/format'
import { mapsUrl } from '../../lib/geo'
import type { KamaiOrderItemsRow } from '../../lib/db-types'
import { STORE_COLS, errMsg, useRiderTenant, type OrderRow, type StoreRow } from '../lib/data'
import { listQueue, onQueueChange, removeQueued, type QueuedDelivery } from '../lib/queue'
import { ConfirmForm } from '../parts/ConfirmForm'
import { CodCollect } from '../parts/CodCollect'
import { ErrorState } from '../parts/States'

async function fetchDetail(tenantId: string, id: string) {
  const o = await supabase.from('kamai_orders').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (o.error) throw o.error
  if (!o.data) return null
  const order = o.data as OrderRow
  const [it, st, pay] = await Promise.all([
    supabase.from('kamai_order_items').select('*').eq('tenant_id', tenantId).eq('order_id', id).order('created_at'),
    supabase.from('kamai_stores').select(STORE_COLS).eq('tenant_id', tenantId).eq('id', order.store_id).maybeSingle(),
    supabase.from('kamai_payments').select('amount_minor').eq('tenant_id', tenantId).eq('order_id', id),
  ])
  if (it.error) throw it.error
  if (st.error) throw st.error
  const paidMinor = ((pay.data ?? []) as Array<{ amount_minor: number }>).reduce((a, p) => a + Number(p.amount_minor), 0)
  return { order, items: (it.data ?? []) as KamaiOrderItemsRow[], store: (st.data ?? null) as StoreRow | null, paidMinor }
}

export function Component() {
  const { id = '' } = useParams()
  const { tenantId } = useRiderTenant()
  const qc = useQueryClient()
  const [queued, setQueued] = useState<QueuedDelivery | null>(null)

  const q = useQuery({
    queryKey: ['delivery', 'order', tenantId, id],
    queryFn: () => fetchDetail(tenantId as string, id),
    enabled: Boolean(tenantId && id),
  })

  useEffect(() => {
    const load = () => void listQueue().then((l) => setQueued(l.find((x) => x.orderId === id) ?? null))
    load()
    return onQueueChange(load)
  }, [id])

  const refresh = () => void qc.invalidateQueries({ queryKey: ['delivery'] })

  const back = (
    <Link to="/delivery" className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-k-green">
      <ArrowLeft size={16} /> Runs
    </Link>
  )

  if (!tenantId) return <>{back}<EmptyState title="Rider tenant nahi mila" /></>
  if (q.isLoading) return <>{back}<Spinner label="Order load ho raha hai…" /></>
  if (q.isError) return <>{back}<ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /></>
  if (!q.data) return <>{back}<EmptyState title="Order nahi mila" description="Ye order aapko assign nahi ya hata diya gaya. / Order not found or not assigned to you." /></>

  const { order, items, store, paidMinor } = q.data
  const delivered = order.fulfilment_status === 'delivered'

  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card padding="sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-k-dark">{store?.name ?? 'Store'}</div>
            <div className="text-xs text-k-muted">Order #{order.order_no}{store?.owner_name ? ` · ${store.owner_name}` : ''}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone={statusTone(order.fulfilment_status)} dot>{order.fulfilment_status}</Badge>
            <Badge tone={order.payment_mode === 'cod' ? 'amber' : 'muted'}>{order.payment_mode.toUpperCase()}</Badge>
          </div>
        </div>
        {store?.address ? <div className="mt-2 flex items-start gap-1 text-sm text-k-muted"><MapPin size={14} className="mt-0.5 shrink-0" />{store.address}</div> : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {store?.mobile ? <a href={`tel:${store.mobile}`} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-k-border text-sm font-semibold text-k-dark"><Phone size={16} />Call</a> : null}
          {store?.latitude != null && store?.longitude != null ? (
            <a href={mapsUrl({ lat: store.latitude, lng: store.longitude })} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-k-border text-sm font-semibold text-k-dark"><Navigation size={16} />Directions</a>
          ) : null}
        </div>
        <div className="mt-3 flex justify-between border-t border-k-border pt-3 text-sm">
          <span className="text-k-muted">Total</span>
          <span className="font-extrabold text-k-dark">{PKR(order.total_minor)}</span>
        </div>
      </Card>

      {queued ? (
        <Card padding="sm" tone="muted">
          <CardTitle dot="amber">{queued.error ? 'Queued delivery fail hui' : 'Offline: sync ka intezar'}</CardTitle>
          <p className="text-sm text-k-text">{queued.error ?? 'Delivery confirmation phone mein save hai; internet aate hi bhej di jayegi. / Saved on this phone; it will be sent when you are back online.'}</p>
          {queued.error ? (
            <Button className="mt-3" variant="secondary" onClick={() => void removeQueued(queued.id).then(refresh)}>Queue se hata dein / Discard</Button>
          ) : null}
        </Card>
      ) : null}

      {delivered ? (
        <>
          <Card padding="sm">
            <CardTitle>Delivered items</CardTitle>
            <ul className="flex flex-col gap-1.5 text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{i.name}</span><span className="shrink-0 font-semibold">{i.delivered_qty}/{i.qty}</span></li>
              ))}
            </ul>
          </Card>
          {order.payment_mode === 'cod' && tenantId ? <CodCollect tenantId={tenantId} order={order} paidMinor={paidMinor} onDone={refresh} /> : (
            <Card padding="sm" tone="muted"><p className="text-sm text-k-muted">Credit order: koi cash collection nahi. / Credit order, no cash to collect.</p></Card>
          )}
        </>
      ) : order.fulfilment_status === 'packed' || order.fulfilment_status === 'dispatched' ? (
        queued && !queued.error ? null : <ConfirmForm tenantId={tenantId} order={order} items={items} store={store} onDone={refresh} />
      ) : (
        <Card padding="sm" tone="muted"><p className="text-sm text-k-muted">Order ki halat "{order.fulfilment_status}" hai; delivery mumkin nahi. / This order is {order.fulfilment_status}; it cannot be delivered.</p></Card>
      )}
    </div>
  )
}
