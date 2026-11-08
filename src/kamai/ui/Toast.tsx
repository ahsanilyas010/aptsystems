import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react'
import { cx } from './cx'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
  kind?: ToastKind
  title?: ReactNode
  /** ms; 0 = sticky. default 4000 (errors 7000) */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface ToastItem extends Required<Pick<ToastOptions, 'kind'>> {
  id: number
  message: ReactNode
  title?: ReactNode
  action?: ToastOptions['action']
}

export interface ToastApi {
  toast: (message: ReactNode, opts?: ToastOptions) => number
  success: (message: ReactNode, opts?: Omit<ToastOptions, 'kind'>) => number
  error: (message: ReactNode, opts?: Omit<ToastOptions, 'kind'>) => number
  info: (message: ReactNode, opts?: Omit<ToastOptions, 'kind'>) => number
  warning: (message: ReactNode, opts?: Omit<ToastOptions, 'kind'>) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={18} className="text-k-green" />,
  error: <XCircle size={18} className="text-k-red" />,
  warning: <AlertTriangle size={18} className="text-k-accent" />,
  info: <Info size={18} className="text-[#2563eb]" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((t) => t.id !== id))
    const h = timers.current.get(id)
    if (h) {
      window.clearTimeout(h)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback(
    (message: ReactNode, opts?: ToastOptions) => {
      const id = ++seq.current
      const kind = opts?.kind ?? 'info'
      setItems((xs) => [...xs.slice(-4), { id, message, kind, title: opts?.title, action: opts?.action }])
      const duration = opts?.duration ?? (kind === 'error' ? 7000 : 4000)
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration))
      return id
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m, o) => toast(m, { ...o, kind: 'success' }),
      error: (m, o) => toast(m, { ...o, kind: 'error' }),
      info: (m, o) => toast(m, { ...o, kind: 'info' }),
      warning: (m, o) => toast(m, { ...o, kind: 'warning' }),
      dismiss,
    }),
    [toast, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[1100] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-5"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-k-surface p-3.5 text-sm text-k-text shadow-lg',
              t.kind === 'error' ? 'border-k-red/30' : t.kind === 'success' ? 'border-k-green/30' : 'border-k-border',
            )}
          >
            <span className="mt-px shrink-0">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              {t.title ? <div className="font-bold text-k-dark">{t.title}</div> : null}
              <div className={cx(t.title && 'text-k-muted')}>{t.message}</div>
              {t.action ? (
                <button
                  onClick={() => {
                    t.action?.onClick()
                    dismiss(t.id)
                  }}
                  className="mt-1.5 text-xs font-bold uppercase tracking-wide text-k-green"
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-m-1 shrink-0 rounded p-1 text-k-light hover:text-k-dark">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext)
  if (!v) throw new Error('useToast must be used inside <ToastProvider> (mounted by KamaiRoot)')
  return v
}
