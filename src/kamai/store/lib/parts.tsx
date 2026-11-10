import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Minus, Package, Plus, RefreshCw } from 'lucide-react'
import { Button, Card, EmptyState, Modal, Spinner, cx, useToast } from '../../ui'
import { useLang } from '../../lib/i18n'
import { MAX_ATTEMPTS, flushQueue, removeJob, resetJob, useQueue } from './offline-queue'
import './strings'

export function Loading() {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-k-muted">
      <Spinner size={18} /> {t('loading')}
    </div>
  )
}

/** Query error: shows the message (migrations may not be applied yet) with a retry. */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useLang()
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return (
    <Card tone="muted" padding="sm" className="border-k-red/30">
      <EmptyState
        compact
        icon={<AlertTriangle size={18} className="text-k-red" />}
        title={t('st_error')}
        description={msg || t('st_not_ready')}
        action={onRetry ? <Button size="md" variant="secondary" onClick={onRetry} icon={<RefreshCw size={14} />}>{t('st_retry')}</Button> : undefined}
      />
    </Card>
  )
}

export function ProductThumb({ url, name, size = 56 }: { url: string | null | undefined; name: string; size?: number }) {
  const [bad, setBad] = useState(false)
  return (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-k-green-light text-k-green" style={{ width: size, height: size }}>
      {url && !bad ? (
        <img src={url} alt={name} loading="lazy" className="h-full w-full object-cover" onError={() => setBad(true)} />
      ) : (
        <Package size={Math.round(size / 2.4)} />
      )}
    </div>
  )
}

/** Large tap-target quantity stepper. */
export function Stepper({ qty, onChange, addLabel }: { qty: number; onChange: (q: number) => void; addLabel?: string }) {
  if (qty <= 0) {
    return (
      <Button size="lg" className="h-11 min-w-24" onClick={() => onChange(1)} icon={<Plus size={18} />}>
        {addLabel}
      </Button>
    )
  }
  return (
    <div className="inline-flex items-center overflow-hidden rounded-xl border border-k-border bg-k-surface">
      <button type="button" aria-label="-" className="flex h-11 w-11 items-center justify-center text-k-dark active:bg-k-surface2" onClick={() => onChange(qty - 1)}>
        <Minus size={18} />
      </button>
      <input
        aria-label="qty"
        inputMode="numeric"
        className="h-11 w-12 bg-transparent text-center text-base font-bold text-k-dark outline-none"
        value={qty}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
      />
      <button type="button" aria-label="+" className="flex h-11 w-11 items-center justify-center text-k-green active:bg-k-surface2" onClick={() => onChange(qty + 1)}>
        <Plus size={18} />
      </button>
    </div>
  )
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useLang()
  const toast = useToast()
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      ta.remove()
    }
    setDone(true)
    toast.success(t('st_copied'))
    window.setTimeout(() => setDone(false), 1500)
  }
  return (
    <Button size="md" variant="secondary" onClick={copy} icon={done ? <Check size={14} /> : <Copy size={14} />}>
      {label ?? t('st_copy')}
    </Button>
  )
}

export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 py-2 text-sm', className)}>
      <span className="text-k-muted">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold text-k-dark">{children}</span>
    </div>
  )
}

/** "Pending (n)" pill; opens the outbox with retry/discard. */
export function PendingPill() {
  const { t } = useLang()
  const { jobs, pending, failed } = useQueue()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (jobs.length === 0) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx('rounded-full px-3 py-1 text-xs font-bold', failed > 0 && pending === 0 ? 'bg-k-red text-white' : 'bg-k-accent text-k-dark')}
      >
        {failed > 0 && pending === 0 ? t('st_failed_n', { n: failed }) : t('st_pending', { n: pending })}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('st_pending_title')}
        description={t('st_queued')}
        footer={
          <Button
            loading={busy}
            icon={<RefreshCw size={14} />}
            onClick={async () => {
              setBusy(true)
              try {
                await flushQueue()
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('st_retry_now')}
          </Button>
        }
      >
        <ul className="flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.client_order_id} className="rounded-xl border border-k-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2 font-semibold text-k-dark">
                <span>{t('st_items', { n: j.payload.items.length })}</span>
                <span className="text-xs text-k-muted">{t('st_attempts', { n: j.attempts })}{j.attempts >= MAX_ATTEMPTS ? ' (max)' : ''}</span>
              </div>
              {j.last_error ? <div className="mt-1 text-xs text-k-red">{j.last_error}</div> : null}
              <div className="mt-2 flex gap-2">
                {j.attempts >= MAX_ATTEMPTS ? (
                  <Button size="sm" variant="secondary" onClick={() => void resetJob(j.client_order_id)}>
                    {t('st_retry')}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void removeJob(j.client_order_id)}>
                  {t('st_discard')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  )
}
