import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Right-hand slide-over panel (full width on phones). */
export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="kamai-root fixed inset-0 z-[900] flex justify-end bg-k-dark/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className="flex h-full w-full max-w-2xl flex-col border-l border-k-border bg-k-bg shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-k-border bg-k-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-k-dark">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-[13px] text-k-muted">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="-m-1 rounded-lg p-1 text-k-muted hover:bg-k-surface2 hover:text-k-dark">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}

export function Dl({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-k-text">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
