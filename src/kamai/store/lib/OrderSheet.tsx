import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Banknote, CreditCard } from 'lucide-react'
import { Button, Modal, cx, useToast } from '../../ui'
import { PKR } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import type { PaymentMode } from '../../lib/db-types'
import { submitOrder, type StoreCtx } from './data'
import { markOrdered } from './pwa'
import './strings'

export function PayModeToggle({ value, onChange }: { value: PaymentMode; onChange: (m: PaymentMode) => void }) {
  const { t } = useLang()
  const opts: Array<{ v: PaymentMode; label: string; icon: JSX.Element }> = [
    { v: 'credit', label: t('st_credit'), icon: <CreditCard size={20} /> },
    { v: 'cod', label: t('st_cod'), icon: <Banknote size={20} /> },
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cx(
            'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-[13px] font-bold',
            value === o.v ? 'border-k-green bg-k-green-light text-k-green' : 'border-k-border bg-k-surface text-k-muted',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface SheetLine {
  product_id: string
  name: string
  qty: number
  unit_minor: number
}

/** Confirm-and-send sheet. The client_order_id is fixed per opening, so a double tap or replay is idempotent. */
export function OrderSheet({
  open,
  onClose,
  ctx,
  lines,
  mode: initialMode,
  onDone,
}: {
  open: boolean
  onClose: () => void
  ctx: StoreCtx
  lines: SheetLine[]
  mode?: PaymentMode
  onDone?: () => void
}) {
  const { t } = useLang()
  const toast = useToast()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [mode, setMode] = useState<PaymentMode>(initialMode ?? 'credit')
  const [cid, setCid] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setCid(crypto.randomUUID())
  }, [open])

  const total = lines.reduce((a, l) => a + l.qty * l.unit_minor, 0)

  const send = async () => {
    setBusy(true)
    try {
      const out = await submitOrder(
        ctx,
        lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        mode,
        cid,
      )
      markOrdered()
      void qc.invalidateQueries({ queryKey: ['kamai-store'] })
      onDone?.()
      onClose()
      if (out.kind === 'queued') {
        toast.info(t('st_queued'), { duration: 9000 })
        nav('/store/orders')
        return
      }
      const o = out.result.order
      const hold = out.result.decision?.decision === 'hold'
      toast.success(t(hold ? 'st_ordered_hold' : 'st_ordered', { no: o.order_no }))
      nav(`/store/orders/${o.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('st_confirm_reorder')}
      footer={
        <Button size="lg" block loading={busy} disabled={lines.length === 0} onClick={send}>
          {t('st_send_order')} · {PKR(total)}
        </Button>
      }
    >
      <ul className="mb-4 divide-y divide-k-border">
        {lines.map((l) => (
          <li key={l.product_id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold text-k-dark">{l.name}</span>
            <span className="text-k-muted">
              {l.qty} × {PKR(l.unit_minor)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mb-2 text-xs font-bold uppercase tracking-[1px] text-k-muted">{t('st_pay_mode')}</div>
      <PayModeToggle value={mode} onChange={setMode} />
      <p className="mt-3 text-xs text-k-light">{t('st_prices_note')}</p>
    </Modal>
  )
}
