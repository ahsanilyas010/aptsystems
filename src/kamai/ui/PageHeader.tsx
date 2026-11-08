import type { ReactNode } from 'react'
import { cx } from './cx'

export interface PageHeaderProps {
  title: ReactNode
  /** small uppercase label above the title, e.g. "Distributor · Rawalpindi" */
  eyebrow?: ReactNode
  description?: ReactNode
  /** right-aligned actions (Buttons) */
  actions?: ReactNode
  /** optional slot below (Tabs, filters) */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, eyebrow, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx('mb-6 flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-xs font-bold uppercase tracking-[2px] text-k-muted">{eyebrow}</div> : null}
          <h1 className="text-xl font-bold leading-tight text-k-dark md:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-[13px] text-k-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  )
}
