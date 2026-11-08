import type { ReactNode } from 'react'
import { cx } from './cx'

export interface StatProps {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'light' | 'dark' | 'green'
  /** small trend/delta line, e.g. "+12% vs last week" */
  delta?: ReactNode
  deltaTone?: 'good' | 'bad' | 'neutral'
  icon?: ReactNode
  className?: string
  onClick?: () => void
}

const TONE: Record<NonNullable<StatProps['tone']>, { card: string; label: string; value: string; sub: string }> = {
  light: { card: 'bg-k-surface border-k-border', label: 'text-k-muted', value: 'text-k-dark', sub: 'text-k-muted' },
  dark: { card: 'bg-k-dark border-k-dark', label: 'text-k-green-mid', value: 'text-white', sub: 'text-[#b8c4bd]' },
  green: { card: 'bg-k-green border-k-green', label: 'text-[#d9f2e3]', value: 'text-white', sub: 'text-[#d9f2e3]' },
}
const DELTA: Record<NonNullable<StatProps['deltaTone']>, string> = { good: 'text-k-green', bad: 'text-k-red', neutral: 'text-k-muted' }

export function Stat({ label, value, sub, tone = 'light', delta, deltaTone = 'neutral', icon, className, onClick }: StatProps) {
  const t = TONE[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cx('flex flex-col gap-2 rounded-2xl border p-5 text-left md:p-6', t.card, onClick && 'cursor-pointer hover:brightness-[0.98]', className)}
    >
      <div className={cx('flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[1px]', t.label)}>
        <span className="truncate">{label}</span>
        {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      </div>
      <div className={cx('text-[28px] font-extrabold leading-none tracking-tight md:text-4xl', t.value)}>{value}</div>
      {(sub || delta) && (
        <div className={cx('flex items-center gap-2 text-[13px]', t.sub)}>
          {delta ? <span className={cx('font-bold', tone === 'light' ? DELTA[deltaTone] : '')}>{delta}</span> : null}
          {sub ? <span className="truncate">{sub}</span> : null}
        </div>
      )}
    </Tag>
  )
}
