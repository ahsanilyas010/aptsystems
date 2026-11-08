import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, FileText, KeyRound, MapPin, Truck } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Spinner, Table, statusTone, useToast } from '../../ui'
import type { Column } from '../../ui'
import { callKamaiApi } from '../../lib/api'
import { PKR, fmtDateTime, humanize, padNo } from '../../lib/format'
import { mapsUrl } from '../../lib/geo'
import { supabase } from '../../lib/supabase'
import type { KamaiCreditDecisionsRow, KamaiDeliveryProofsRow, KamaiInvoicesRow, KamaiOrderEventsRow, KamaiOrderItemsRow, KamaiOrdersRow } from '../../lib/db-types'
import { Dl } from '../lib/Drawer'
import { ErrorState, Gate, NoTenant, errMsg, rpc, useCan, useRefreshAll, useStores, useTenantId, useTq } from '../lib/data'
import { AssignRiderModal, NEXT, TransitionModal, transitionLabel, type TransitionTarget } from '../parts/OrderActions'

export function Component() {
  const { id = '' } = useParams()
  const tid = useTenantId()
  const toast = useToast()
  const refresh = useRefreshAll()
  const canWrite = useCan(['owner', 'manager', 'booker'])
  const stores = useStores()
  const [to, setTo] = useState<TransitionTarget | null>(null)
  const [assign, setAssign] = useState(false)
  const [busy, setBusy] = useState('')
  const [otpInfo, setOtpInfo] = useState<string | null>(null)

  const order = useTq<KamaiOrdersRow | null>(['order', id], (t) => supabase.from('kamai_orders').select('*').eq('tenant_id', t).eq('id', id).maybeSingle())
  const items = useTq<KamaiOrderItemsRow[]>(['order-items', id], (t) => supabase.from('kamai_order_items').select('*').eq('tenant_id', t).eq('order_id', id).order('created_at'))
  const events = useTq<KamaiOrderEventsRow[]>(['order-events', id], (t) => supabase.from('kamai_order_events').select('*').eq('tenant_id', t).eq('order_id', id).order('at', { ascending: false }))
  const proof = useTq<KamaiDeliveryProofsRow | null>(['order-proof', id], (t) => supabase.from('kamai_delivery_proofs').select('*').eq('tenant_id', t).eq('order_id', id).maybeSingle())
  const decision = useTq<KamaiCreditDecisionsRow | null>(['order-decision', id], (t) => supabase.from('kamai_credit_decisions').select('*').eq('tenant_id', t).eq('order_id', id).order('decided_at', { ascending: false }).limit(1).maybeSingle())
  const invoiceId = order.data?.invoice_id
  const invoice = useTq<KamaiInvoicesRow | null>(['order-invoice', invoiceId], (t) => supabase.from('kamai_invoices').select('*').eq('tenant_id', t).eq('id', invoiceId as string).maybeSingle(), { enabled: !!invoiceId })

  if (!tid) return <NoTenant />
  if (order.isLoading) return <Spinner label="Loading order…" />
  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />
  const o = order.data
  if (!o) return <EmptyState title="Order not found" action={<Link to="/distributor/orders"><Button variant="secondary">Back to orders</Button></Link>} />
  const store = stores.map.get(o.store_id)
  const d = decision.data
  const p = proof.data

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key)
    try {
      const msg = await fn()
      if (msg) toast.success(msg)
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  async function issueOtp() {
    await run('otp', async () => {
      try {
        const r = await callKamaiApi<{ delivered?: boolean; expires_at?: string; note?: string; reason?: string }>('send_delivery_otp', { order_id: o!.id })
        setOtpInfo(r.delivered ? `OTP sent on WhatsApp, valid until ${fmtDateTime(r.expires_at)}` : `OTP issued (valid until ${fmtDateTime(r.expires_at)}). ${r.note ?? 'The store sees the code in its app.'}`)
      } catch {
        const r = await rpc<{ expires_at: string }>('kamai_issue_delivery_otp', { p_order_id: o!.id })
        setOtpInfo(`OTP issued, valid until ${fmtDateTime(r.expires_at)}. The store sees the code in its app.`)
      }
      return 'Delivery OTP issued'
    })
  }

  const itemCols: Column<KamaiOrderItemsRow>[] = [
    { key: 'p', header: 'Item', render: (i) => (<div><div className="font-semibold text-k-dark">{i.name}</div><div className="text-xs text-k-muted">{i.sku}</div></div>) },
    { key: 'q', header: 'Qty', align: 'right', render: (i) => (i.delivered_qty ? `${i.delivered_qty}/${i.qty}` : i.qty) },
    { key: 'u', header: 'Price', align: 'right', hideOnMobile: true, render: (i) => PKR(i.unit_price_minor, { decimals: true }) },
    { key: 'tax', header: 'Tax', align: 'right', hideOnMobile: true, render: (i) => PKR(i.tax_minor, { decimals: true }) },
    { key: 't', header: 'Line', align: 'right', render: (i) => PKR(i.line_total_minor + i.tax_minor, { decimals: true }) },
  ]

  return (
    <>
      <Link to="/distributor/orders" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-k-muted hover:text-k-green"><ArrowLeft size={14} />Orders</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">Order {padNo('#', o.order_no, 5)} <Badge tone={statusTone(o.fulfilment_status)}>{humanize(o.fulfilment_status)}</Badge></span>}
        eyebrow={store?.name ?? 'Order'}
        description={`Created ${fmtDateTime(o.created_at)} · ${o.payment_mode === 'cod' ? 'Cash on delivery' : 'Credit'} · ${humanize(o.source)}`}
        actions={canWrite ? (
          <>
            {(NEXT[o.fulfilment_status] ?? []).map((t) => (
              <Button key={t} variant={t === 'cancelled' || t === 'rejected' ? 'danger' : t === 'credit_approved' ? 'secondary' : 'primary'} onClick={() => setTo(t)}>{transitionLabel(t)}</Button>
            ))}
            {['credit_approved', 'packed', 'dispatched'].includes(o.fulfilment_status) ? <Button variant="secondary" icon={<Truck size={15} />} onClick={() => setAssign(true)}>{o.rider_user_id ? 'Reassign rider' : 'Assign rider'}</Button> : null}
            {o.fulfilment_status === 'dispatched' ? <Button variant="secondary" icon={<KeyRound size={15} />} loading={busy === 'otp'} onClick={issueOtp}>Issue OTP</Button> : null}
          </>
        ) : null}
      />
      {otpInfo ? <Card tone="muted" className="mb-4 text-sm">{otpInfo}</Card> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card padding="none">
            <div className="p-5 pb-0"><CardTitle>Items</CardTitle></div>
            <Gate q={items} isEmpty={!items.data?.length}>
              <Table columns={itemCols} rows={items.data ?? []} rowKey={(i) => i.id} dense
                footer={<tr><td colSpan={itemCols.length} className="px-4 py-3 text-right text-sm"><div className="text-k-muted">Subtotal {PKR(o.subtotal_minor, { decimals: true })} · Tax {PKR(o.tax_minor, { decimals: true })}</div><div className="text-base font-extrabold text-k-dark">Total {PKR(o.total_minor, { decimals: true })}</div></td></tr>} />
            </Gate>
          </Card>
          <Card>
            <CardTitle dot="none">Timeline</CardTitle>
            <Gate q={events} isEmpty={!events.data?.length} empty={<p className="text-sm text-k-muted">No events yet.</p>}>
              <ol className="space-y-3">
                {(events.data ?? []).map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-k-green" />
                    <div className="min-w-0 text-sm">
                      <div className="font-semibold text-k-dark">{e.from_state ? `${humanize(e.from_state)} → ` : ''}{humanize(e.to_state)}</div>
                      <div className="text-xs text-k-muted">{fmtDateTime(e.at)}{e.actor ? ` · ${e.actor.slice(0, 8)}` : ''}</div>
                      {e.reason ? <div className="mt-0.5 text-[13px] text-k-text">Reason: {e.reason}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Gate>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle dot="amber" action={canWrite && d && o.fulfilment_status === 'booked' && o.payment_mode === 'credit' ? <Button size="sm" variant="secondary" loading={busy === 'cod'} onClick={() => run('cod', async () => { await rpc('kamai_convert_order_to_cod', { p_order_id: o.id }); return 'Converted to COD' })}>Convert to COD</Button> : undefined}>Credit decision</CardTitle>
            <Gate q={decision} isEmpty={!d} empty={<p className="text-sm text-k-muted">No decision recorded.</p>}>
              {d ? (
                <div className="space-y-3">
                  <Badge tone={d.decision === 'approved' || d.decision === 'cod' ? 'green' : 'amber'}>{humanize(d.decision)}</Badge>
                  <Dl items={[['Available', PKR(d.available_minor)], ['Exposure', PKR(d.exposure_minor)], ['Order total', PKR(d.order_total_minor)], ['Decided', fmtDateTime(d.decided_at)]]} />
                  {d.reason_codes?.length ? <div className="flex flex-wrap gap-1.5">{d.reason_codes.map((c) => <Badge key={c} tone="amber" size="sm">{c}</Badge>)}</div> : null}
                </div>
              ) : null}
            </Gate>
          </Card>
          <Card>
            <CardTitle dot="none">Delivery</CardTitle>
            <Dl items={[['Rider', o.rider_user_id ? `Rider ${o.rider_user_id.slice(0, 8)}` : 'Not assigned'], ['Delivered', fmtDateTime(o.delivered_at)]]} />
            {p ? (
              <div className="mt-4 space-y-3 border-t border-k-border pt-4">
                <Dl items={[
                  ['Receiver', p.receiver_name], ['Result', p.delivery_status ? humanize(p.delivery_status) : '—'],
                  ['OTP verified', p.otp_verified_at ? fmtDateTime(p.otp_verified_at) : 'No'],
                  ['Geofence', p.geofence_ok == null ? '—' : p.geofence_ok ? `OK (${Math.round(p.distance_m ?? 0)} m)` : `Outside (${Math.round(p.distance_m ?? 0)} m)`],
                  ['Dispute window ends', fmtDateTime(p.dispute_window_ends_at)],
                ]} />
                {p.flagged ? <Badge tone="red">Flagged{p.override_reason ? `: ${p.override_reason}` : ''}</Badge> : null}
                {p.disputed_at ? <p className="text-sm text-k-red">Disputed: {p.dispute_reason}</p> : null}
                {p.delivered_lat != null && p.delivered_lng != null ? <a className="inline-flex items-center gap-1 text-[13px] font-semibold text-k-green" href={mapsUrl({ lat: p.delivered_lat, lng: p.delivered_lng })} target="_blank" rel="noreferrer noopener"><MapPin size={13} />Delivery location</a> : null}
                <div className="flex gap-2">
                  {p.photo_url ? <a href={p.photo_url} target="_blank" rel="noreferrer noopener"><img src={p.photo_url} alt="Delivery proof" className="h-24 w-24 rounded-lg border border-k-border object-cover" /></a> : null}
                  {p.signature_url ? <a href={p.signature_url} target="_blank" rel="noreferrer noopener"><img src={p.signature_url} alt="Signature" className="h-24 w-24 rounded-lg border border-k-border bg-white object-contain" /></a> : null}
                </div>
              </div>
            ) : <p className="mt-3 text-sm text-k-muted">No delivery proof yet.</p>}
          </Card>
          <Card>
            <CardTitle dot="none">Invoice</CardTitle>
            {invoiceId ? (
              <Gate q={invoice}>
                <div className="flex items-center justify-between gap-2">
                  <div><div className="font-semibold text-k-dark">{invoice.data?.display_number ?? '—'}</div><div className="text-xs text-k-muted">{invoice.data ? PKR(invoice.data.total_incl_minor) : ''}</div></div>
                  <Link to={`/distributor/invoices?open=${invoiceId}`}><Button size="sm" variant="secondary" icon={<FileText size={14} />}>View</Button></Link>
                </div>
              </Gate>
            ) : <p className="text-sm text-k-muted">Issued automatically on delivery.</p>}
          </Card>
          {o.notes || o.cancellation_reason ? <Card><CardTitle dot="none">Notes</CardTitle><p className="text-sm">{o.cancellation_reason ? `Cancelled: ${o.cancellation_reason}` : o.notes}</p></Card> : null}
        </div>
      </div>
      <TransitionModal key={to ?? 'x'} orderId={o.id} orderNo={o.order_no} to={to} onClose={() => setTo(null)} />
      <AssignRiderModal orderId={o.id} tenantId={tid} current={o.rider_user_id} open={assign} onClose={() => setAssign(false)} />
    </>
  )
}
