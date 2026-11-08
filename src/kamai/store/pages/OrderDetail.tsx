import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardTitle, Textarea, cx, statusTone, useToast } from '../../ui'
import { PKR, fmtDateTime } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import type { KamaiDeliveryOtpsRow, KamaiDeliveryProofsRow, KamaiOrderEventsRow, KamaiOrdersRow } from '../../lib/db-types'
import { useOrderItems, useStoreCtx } from '../lib/data'
import { ErrorBox, Loading, Row } from '../lib/parts'
import '../lib/strings'

const STEPS = ['booked', 'credit_approved', 'packed', 'dispatched', 'delivered'] as const
const STEP_AT: Record<(typeof STEPS)[number], keyof KamaiOrdersRow> = {
  booked: 'created_at',
  credit_approved: 'credit_approved_at',
  packed: 'packed_at',
  dispatched: 'dispatched_at',
  delivered: 'delivered_at',
}

export function Component() {
  const { id } = useParams()
  const { t } = useLang()
  const ctx = useStoreCtx()
  const toast = useToast()
  const qc = useQueryClient()
  const items = useOrderItems(ctx, id)

  const order = useQuery({
    queryKey: ['kamai-store', 'order', ctx?.tenantId, id],
    enabled: !!ctx && !!id,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_orders').select('*').eq('tenant_id', ctx!.tenantId).eq('id', id!).maybeSingle()
      if (error) throw new Error(error.message)
      return data as KamaiOrdersRow | null
    },
  })
  const status = order.data?.fulfilment_status

  const events = useQuery({
    queryKey: ['kamai-store', 'order-events', ctx?.tenantId, id],
    enabled: !!ctx && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_order_events').select('*').eq('tenant_id', ctx!.tenantId).eq('order_id', id!).order('at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiOrderEventsRow[]
    },
  })

  const otp = useQuery({
    queryKey: ['kamai-store', 'otp', ctx?.tenantId, id],
    enabled: !!ctx && !!id && status === 'dispatched',
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_delivery_otps').select('*').eq('tenant_id', ctx!.tenantId).eq('order_id', id!).maybeSingle()
      if (error) throw new Error(error.message)
      return data as KamaiDeliveryOtpsRow | null
    },
  })

  const proof = useQuery({
    queryKey: ['kamai-store', 'proof', ctx?.tenantId, id],
    enabled: !!ctx && !!id && (status === 'delivered' || status === 'disputed'),
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_delivery_proofs').select('*').eq('tenant_id', ctx!.tenantId).eq('order_id', id!).maybeSingle()
      if (error) throw new Error(error.message)
      return data as KamaiDeliveryProofsRow | null
    },
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['kamai-store'] })

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('kamai_transition_order', { p_order_id: id, p_to_state: 'cancelled', p_reason: 'Cancelled by store', p_meta: {} })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success(t('st_cancelled_ok'))
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!ctx || order.isLoading) return <Loading />
  if (order.error) return <ErrorBox error={order.error} onRetry={() => void order.refetch()} />
  const o = order.data
  if (!o) return <ErrorBox error={new Error(t('no_data'))} />

  const reached = (s: (typeof STEPS)[number]) => STEPS.indexOf(s) <= STEPS.indexOf(status as (typeof STEPS)[number]) || (status === 'disputed' && true)
  const terminalBad = status === 'cancelled' || status === 'rejected'
  const lastEvent = [...(events.data ?? [])].reverse().find((e) => e.to_state === status)
  const reason = o.cancellation_reason || lastEvent?.reason

  return (
    <div className="flex flex-col gap-4">
      <Link to="/store/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-k-muted">
        <ArrowLeft size={16} /> {t('orders')}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-k-dark">{t('st_order_no', { no: o.order_no })}</h1>
        <Badge tone={statusTone(o.fulfilment_status)} dot>
          {t(`st_s_${o.fulfilment_status}`)}
        </Badge>
      </div>

      {status === 'dispatched' ? (
        <Card tone="dark" className="text-center">
          <div className="text-xs font-bold uppercase tracking-[2px] text-k-green-mid">{t('st_otp_title')}</div>
          {otp.data ? (
            <>
              <div className="my-3 text-5xl font-extrabold tracking-[10px] text-white" aria-label={t('st_otp_title')}>
                {otp.data.code}
              </div>
              <p className="text-[13px] text-[#b8c4bd]">{t('st_otp_hint')}</p>
              <p className="mt-1 text-xs text-[#b8c4bd]">{t('st_otp_exp', { time: fmtDateTime(otp.data.expires_at) })}</p>
            </>
          ) : otp.error ? (
            <div className="mt-3"><ErrorBox error={otp.error} /></div>
          ) : (
            <p className="mt-2 text-[13px] text-[#b8c4bd]">{t('st_otp_wait')}</p>
          )}
        </Card>
      ) : null}

      {status === 'delivered' || status === 'disputed' ? <DisputeCard orderId={o.id} status={status} proof={proof.data} loadError={proof.error} onChanged={refresh} /> : null}

      <Card>
        <CardTitle>{t('st_timeline')}</CardTitle>
        <ol className="flex flex-col">
          {STEPS.map((s, i) => {
            const done = !terminalBad ? reached(s) : s === 'booked' || !!o[STEP_AT[s]]
            const at = o[STEP_AT[s]] as string | null
            return (
              <li key={s} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-full', done ? 'bg-k-green text-white' : 'border border-k-border text-k-light')}>
                    {done ? <Check size={14} /> : <Circle size={8} />}
                  </span>
                  {i < STEPS.length - 1 ? <span className={cx('w-0.5 flex-1', done ? 'bg-k-green' : 'bg-k-border')} style={{ minHeight: 22 }} /> : null}
                </div>
                <div className="pb-4">
                  <div className={cx('text-sm font-bold', done ? 'text-k-dark' : 'text-k-light')}>{t(`st_s_${s}`)}</div>
                  {at ? <div className="text-xs text-k-muted">{fmtDateTime(at)}</div> : null}
                </div>
              </li>
            )
          })}
          {terminalBad || status === 'disputed' ? (
            <li className="rounded-xl bg-k-red-light px-3 py-2 text-sm font-bold text-k-red">
              {t(`st_s_${status}`)}
              {reason ? <div className="mt-0.5 text-xs font-semibold">{t('st_reason', { reason })}</div> : null}
            </li>
          ) : null}
        </ol>
      </Card>

      <Card>
        <CardTitle>{t('st_lines')}</CardTitle>
        {items.isLoading ? (
          <Loading />
        ) : items.error ? (
          <ErrorBox error={items.error} />
        ) : (
          <ul className="divide-y divide-k-border">
            {(items.data ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold text-k-dark">{i.name}</span>
                <span className="text-k-muted">
                  {status === 'delivered' && i.delivered_qty !== i.qty ? `${i.delivered_qty}/${i.qty}` : i.qty} × {PKR(i.unit_price_minor)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 border-t border-k-border pt-2">
          <Row label={t('subtotal')}>{PKR(o.subtotal_minor)}</Row>
          <Row label={t('tax')}>{PKR(o.tax_minor)}</Row>
          <Row label={t('total')} className="text-base">{PKR(o.total_minor)}</Row>
          <Row label={t('st_pay_mode')}>{o.payment_mode === 'cod' ? t('st_cod') : t('st_credit')}</Row>
        </div>
      </Card>

      {status === 'booked' ? (
        <Button variant="danger" size="lg" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
          {t('st_cancel_order')}
        </Button>
      ) : null}
    </div>
  )
}

function DisputeCard({
  orderId,
  status,
  proof,
  loadError,
  onChanged,
}: {
  orderId: string
  status: string
  proof: KamaiDeliveryProofsRow | null | undefined
  loadError: unknown
  onChanged: () => void
}) {
  const { t } = useLang()
  const toast = useToast()
  const key = `kamai-store-ok-${orderId}`
  const [ok, setOk] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const dispute = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('kamai_dispute_delivery', { p_order_id: orderId, p_reason: reason.trim() })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success(t('st_dispute_done'))
      setOpen(false)
      onChanged()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (status === 'disputed') {
    return (
      <Card tone="muted" padding="sm" className="text-sm">
        <div className="font-bold text-k-red">{t('st_dispute_done')}</div>
        {proof?.dispute_reason ? <div className="mt-1 text-k-muted">{t('st_reason', { reason: proof.dispute_reason })}</div> : null}
      </Card>
    )
  }
  if (loadError) return <ErrorBox error={loadError} />
  const until = proof?.dispute_window_ends_at
  if (!until || new Date(until).getTime() < Date.now()) return null
  if (ok) return <Card tone="green" padding="sm" className="text-center text-sm font-bold">{t('st_thanks')}</Card>

  return (
    <Card>
      <CardTitle>{t('st_dispute_q')}</CardTitle>
      {!open ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-14"
              onClick={() => {
                try {
                  localStorage.setItem(key, '1')
                } catch {
                  /* ignore */
                }
                setOk(true)
              }}
            >
              {t('st_yes')}
            </Button>
            <Button size="lg" variant="danger" className="h-14" onClick={() => setOpen(true)}>
              {t('st_problem')}
            </Button>
          </div>
          <p className="mt-3 text-xs text-k-muted">{t('st_dispute_until', { time: fmtDateTime(until) })}</p>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('st_dispute_ph')} />
          <Button size="lg" variant="danger" block disabled={reason.trim().length < 3} loading={dispute.isPending} onClick={() => dispute.mutate()}>
            {t('st_dispute_send')}
          </Button>
          <Button variant="ghost" block onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
        </div>
      )}
    </Card>
  )
}
