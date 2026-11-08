import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from './cx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** footer slot (usually Buttons) */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  /** disable closing by backdrop click / Escape */
  persistent?: boolean
  className?: string
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', full: 'max-w-[calc(100vw-16px)]' }

export function Modal({ open, onClose, title, description, children, footer, size = 'md', persistent, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose()
    }
    document.addEventListener('keydown', onKey)
    // focus first focusable
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-modal-close])')
      el?.focus()
    }, 0)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose, persistent])

  if (!open) return null
  return createPortal(
    <div
      className="kamai-root fixed inset-0 z-[1000] flex items-end justify-center bg-k-dark/55 p-2 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (!persistent && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cx('flex max-h-[96vh] w-full flex-col overflow-hidden rounded-2xl border border-k-border bg-k-surface shadow-2xl', SIZE[size], className)}
      >
        {(title || !persistent) && (
          <div className="flex items-start justify-between gap-3 border-b border-k-border px-5 py-4">
            <div className="min-w-0">
              {title ? <h2 className="text-base font-bold text-k-dark">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-[13px] text-k-muted">{description}</p> : null}
            </div>
            {!persistent ? (
              <button data-modal-close onClick={onClose} aria-label="Close" className="-m-1 rounded-lg p-1 text-k-muted hover:bg-k-surface2 hover:text-k-dark">
                <X size={18} />
              </button>
            ) : null}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-k-border bg-k-surface2 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
