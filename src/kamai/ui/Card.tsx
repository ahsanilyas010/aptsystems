import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** dark green or green filled card */
  tone?: 'default' | 'dark' | 'green' | 'muted'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const TONE: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'bg-k-surface border-k-border text-k-text',
  dark: 'bg-k-dark border-k-dark text-[#f5f6f2]',
  green: 'bg-k-green border-k-green text-white',
  muted: 'bg-k-surface2 border-k-border text-k-text',
}
const PAD: Record<NonNullable<CardProps['padding']>, string> = { none: '', sm: 'p-4', md: 'p-5 md:p-6', lg: 'p-6 md:p-8' }

export function Card({ tone = 'default', padding = 'md', className, children, ...rest }: CardProps) {
  return (
    <div className={cx('rounded-2xl border', TONE[tone], PAD[padding], className)} {...rest}>
      {children}
    </div>
  )
}

export interface CardTitleProps {
  children: ReactNode
  /** colored dot before the title */
  dot?: 'green' | 'amber' | 'red' | 'none'
  /** right-aligned slot (badge, button) */
  action?: ReactNode
  className?: string
}

const DOT: Record<NonNullable<CardTitleProps['dot']>, string> = { green: 'bg-k-green', amber: 'bg-k-accent', red: 'bg-k-red', none: 'hidden' }

/** Uppercase 12px tracking label used at the top of a Card. */
export function CardTitle({ children, dot = 'green', action, className }: CardTitleProps) {
  return (
    <div className={cx('mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[2px] text-k-muted', className)}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', DOT[dot])} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action ? <span className="shrink-0 normal-case tracking-normal">{action}</span> : null}
    </div>
  )
}

/** Thin section heading with a trailing rule, as in the original dashboard. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cx('mb-5 flex items-center gap-2.5 text-xl font-bold text-k-dark after:h-px after:flex-1 after:bg-k-border after:content-[""]', className)}>
      {children}
    </h2>
  )
}
