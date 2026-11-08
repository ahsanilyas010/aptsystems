import type { ReactNode } from 'react'
import { cx } from './cx'

export interface TabItem<K extends string = string> {
  key: K
  label: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps<K extends string = string> {
  items: TabItem<K>[]
  value: K
  onChange: (key: K) => void
  /** 'underline' (default, like the dashboard nav) or 'pills' */
  variant?: 'underline' | 'pills'
  className?: string
}

/** Controlled tabs. Horizontally scrollable on small screens. */
export function Tabs<K extends string = string>({ items, value, onChange, variant = 'underline', className }: TabsProps<K>) {
  return (
    <div
      role="tablist"
      className={cx(
        'flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        variant === 'underline' ? 'border-b border-k-border' : 'rounded-xl bg-k-surface2 p-1',
        className,
      )}
    >
      {items.map((it) => {
        const active = it.key === value
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            disabled={it.disabled}
            onClick={() => onChange(it.key)}
            className={cx(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-semibold transition-colors disabled:opacity-40',
              variant === 'underline'
                ? cx('-mb-px border-b-[3px] px-4 py-3', active ? 'border-k-green text-k-green' : 'border-transparent text-k-muted hover:text-k-green')
                : cx('rounded-lg px-3.5 py-2', active ? 'bg-k-surface text-k-dark shadow-sm' : 'text-k-muted hover:text-k-dark'),
            )}
          >
            {it.label}
            {it.badge !== undefined ? (
              <span className={cx('rounded-full px-1.5 py-px text-[10px] font-bold', active ? 'bg-k-green-light text-k-green' : 'bg-k-surface2 text-k-muted')}>{it.badge}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
