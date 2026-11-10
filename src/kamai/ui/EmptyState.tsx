import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cx } from './cx'

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ title, description, icon, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 py-4' : 'gap-3 py-12', className)}>
      <div className={cx('flex items-center justify-center rounded-full bg-k-green-light text-k-green', compact ? 'h-9 w-9' : 'h-12 w-12')}>
        {icon ?? <Inbox size={compact ? 18 : 22} />}
      </div>
      <div className={cx('font-bold text-k-dark', compact ? 'text-sm' : 'text-base')}>{title}</div>
      {description ? <p className="max-w-sm text-[13px] text-k-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
