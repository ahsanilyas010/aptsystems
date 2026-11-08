import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Modal, Spinner, statusTone } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate, fmtDateTime, humanize } from '../../lib/format'
import type { KamaiDeliveryProofsRow, KamaiInvoicesRow, KamaiOrderItemsRow, KamaiOrdersRow, KamaiVLenderPositionsRow } from '../../lib/db-types'
import { useTid } from '../lib/data'

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-k-border py-2 text-sm last:border-b-0">
      <span className="text-k-muted">{k}</span>
      <span className="text-right font-semibold text-k-dark">{v}</span>
    </div>
  )
}

function Flag({ ok, yes, no }: { ok: boolean | null | undefined; yes: string; no: string }) {
  return <Badge tone={ok ? 'green' : 'red'}>{ok ? yes : no}</Badge>
}

export function PositionDrawer({
  row,
  onClose,
  onFinance,
  canFinance,
}: {
  row: KamaiVLenderPositionsRow | null
  onClose: () => void
  onFinance: (r: KamaiVLenderPositionsRow) => void
  canFinance: boolean
}) {
  const tid = useTid()
  const q = useQuery({
    queryKey: ['lender', tid, 'position-detail', row?.exposure_id],
    enabled: !!row?.order_id,
    queryFn: async () => {
      const [o, p, it, inv] = await Promise.all([
        supabase.from('kamai_orders').select('*').eq('id', row?.order_id).maybeSingle(),
        supabase.from('kamai_delivery_proofs').select('*').eq('order_id', row?.order_id).maybeSingle(),
        supabase.from('kamai_order_items').select('*').eq('order_id', row?.order_id).order('created_at'),
        row?.invoice_id ? supabase.from('kamai_invoices').select('*').eq('id', row.invoice_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ])
      const err = o.error ?? p.error ?? it.error ?? inv.error
      if (err) throw new Error(err.message)
      return {
        order: o.data as KamaiOrdersRow | null,
        proof: p.data as KamaiDeliveryProofsRow | null,
        items: (it.data ?? []) as KamaiOrderItemsRow[],
        invoice: inv.data as KamaiInvoicesRow | null,
      }
    },
  })
  const d = q.data
  const photo = d?.proof?.photo_url
  const canShowFinance = canFinance && !!row && row.status === 'open' && (row.financed_minor ?? 0) === 0 && !!row.eligible_flag

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="lg"
      title={row ? `${row.store_name ?? 'Store'} · ${row.invoice_number ?? 'no invoice'}` : ''}
      description={row ? `${row.area ?? ''} · due ${fmtDate(row.due_date)} · ${row.dpd ?? 0} DPD` : undefined}
      footer={
        <>
          {canShowFinance && row ? <Button onClick={() => onFinance(row)}>Finance this order</Button> : null}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {row ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(row.status)}>{humanize(row.status)}</Badge>
            <Badge tone={row.eligible_flag ? 'green' : 'red'}>{row.eligible_flag ? 'Eligible' : `Ineligible: ${humanize(row.ineligibility_reason)}`}</Badge>
            <Flag ok={row.delivery_proof_flag} yes="Delivery photo on file" no="No delivery photo" />
          </div>
          <div>
            <Row k="Original" v={PKR(row.original_minor)} />
            <Row k="Outstanding" v={PKR(row.outstanding_minor)} />
            <Row k="Paid / credited" v={`${PKR(row.paid_minor)} / ${PKR(row.credited_minor)}`} />
            <Row k="Financed" v={PKR(row.financed_minor)} />
            <Row k="Tier / limit" v={`T${row.credit_tier ?? '—'} · ${PKR(row.credit_limit_minor)}`} />
          </div>
          {q.isLoading ? <Spinner label="Loading order…" /> : null}
          {q.error ? <p className="rounded-lg bg-k-red-light p-3 text-sm text-k-red">{(q.error as Error).message}</p> : null}
          {d ? (
            <>
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-[1px] text-k-muted">Order</h3>
                {d.order ? (
                  <>
                    <Row k="Order no" v={`#${d.order.order_no}`} />
                    <Row k="Status" v={<Badge tone={statusTone(d.order.fulfilment_status)}>{humanize(d.order.fulfilment_status)}</Badge>} />
                    <Row k="Total" v={PKR(d.order.total_minor)} />
                    <Row k="Delivered" v={fmtDateTime(d.order.delivered_at)} />
                  </>
                ) : (
                  <p className="text-sm text-k-muted">Order not visible to your tenant.</p>
                )}
                {d.items.length ? (
                  <ul className="mt-2 space-y-1 text-[13px] text-k-text">
                    {d.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <span>{i.name} × {i.delivered_qty || i.qty}</span>
                        <span>{PKR(i.line_total_minor)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-[1px] text-k-muted">Delivery proof</h3>
                {d.proof ? (
                  <>
                    <Row k="OTP verified" v={<Flag ok={!!d.proof.otp_verified_at} yes={fmtDateTime(d.proof.otp_verified_at)} no="Not verified" />} />
                    <Row
                      k="GPS"
                      v={
                        <>
                          <Flag ok={d.proof.geofence_ok} yes="Inside geofence" no={d.proof.flagged ? 'Flagged' : 'Outside / unknown'} />
                          {d.proof.distance_m != null ? <span className="ml-2 text-xs text-k-muted">{Math.round(d.proof.distance_m)} m</span> : null}
                        </>
                      }
                    />
                    {d.proof.override_reason ? <Row k="Override reason" v={d.proof.override_reason} /> : null}
                    <Row k="Receiver" v={d.proof.receiver_name ?? '—'} />
                    {d.proof.disputed_at ? <Row k="Dispute" v={d.proof.dispute_reason ?? 'Open'} /> : null}
                    {photo ? (
                      photo.startsWith('http') ? (
                        <a href={photo} target="_blank" rel="noreferrer">
                          <img src={photo} alt="Delivery proof" className="mt-3 max-h-64 rounded-xl border border-k-border object-cover" />
                        </a>
                      ) : (
                        <p className="mt-2 break-all text-xs text-k-muted">Photo: {photo}</p>
                      )
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-k-muted">No delivery proof recorded.</p>
                )}
              </section>
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-[1px] text-k-muted">Invoice</h3>
                {d.invoice ? (
                  <>
                    <Row k="Number" v={d.invoice.display_number} />
                    <Row k="Date" v={fmtDate(d.invoice.invoice_date)} />
                    <Row k="Total incl. tax" v={PKR(d.invoice.total_incl_minor)} />
                    <Row k="FBR" v={d.invoice.fbr_invoice_number ?? humanize(d.invoice.fbr_status) ?? '—'} />
                    {d.invoice.pdf_url ? (
                      <a className="mt-2 inline-block text-sm font-bold text-k-green" href={d.invoice.pdf_url} target="_blank" rel="noreferrer">
                        Open invoice PDF
                      </a>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-k-muted">No invoice linked.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
