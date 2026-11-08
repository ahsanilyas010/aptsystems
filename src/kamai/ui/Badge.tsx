import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export type BadgeTone = 'green' | 'amber' | 'red' | 'dark' | 'blue' | 'muted'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** show a leading dot */
  dot?: boolean
  size?: 'sm' | 'md'
}

const TONE: Record<BadgeTone, string> = {
  green: 'bg-k-green-light text-k-green',
  amber: 'bg-[#fff8e6] text-[#b07800]',
  red: 'bg-k-red-light text-k-red',
  dark: 'bg-[#eef0ee] text-k-dark',
  blue: 'bg-[#e8f0ff] text-[#2563eb]',
  muted: 'bg-k-surface2 text-k-muted',
}

export function Badge({ tone = 'dark', dot, size = 'md', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-bold tracking-[0.5px]',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-[3px] text-[11px]',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** Map common Kamai statuses to a badge tone. */
export function statusTone(status: string | null | undefined): BadgeTone {
  switch ((status ?? '').toLowerCase()) {
    case 'delivered':
    case 'paid':
    case 'settled':
    case 'active':
    case 'approved':
    case 'verified':
    case 'matched':
    case 'issued':
    case 'done':
      return 'green'
    case 'booked':
    case 'packed':
    case 'pending':
    case 'hold':
    case 'queued':
    case 'invited':
    case 'draft':
    case 'recorded':
    case 'paused':
      return 'amber'
    case 'cancelled':
    case 'rejected':
    case 'disputed':
    case 'declined':
    case 'frozen':
    case 'written_off':
    case 'void':
    case 'failed':
    case 'disabled':
      return 'red'
    case 'dispatched':
    case 'credit_approved':
    case 'financed':
    case 'in_transit':
      return 'blue'
    default:
      return 'dark'
  }
}
