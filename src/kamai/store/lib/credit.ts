import type { KamaiCreditAccountsRow, PaymentMode } from '../../lib/db-types'
import { humanize } from '../../lib/format'
import { PKR } from '../../lib/format'

export interface Preview {
  tone: 'ok' | 'warn' | 'info'
  key: string
  vars?: Record<string, string | number>
}

export function availableCredit(acc: KamaiCreditAccountsRow | null | undefined, outstanding: number): number {
  if (!acc) return 0
  return Math.max(0, Number(acc.limit_minor) - outstanding)
}

/** Client-side hint only; the server decides in kamai_submit_order. */
export function creditPreview(opts: {
  mode: PaymentMode
  total: number
  acc: KamaiCreditAccountsRow | null | undefined
  outstanding: number
  hasOverdue: boolean
}): Preview | null {
  if (opts.mode === 'cod') return { tone: 'info', key: 'st_prev_cod' }
  if (!opts.acc) return null
  if (opts.acc.status !== 'active') return { tone: 'warn', key: 'st_prev_off', vars: { status: humanize(opts.acc.status).toLowerCase() } }
  if (opts.hasOverdue) return { tone: 'warn', key: 'st_prev_overdue' }
  const avail = availableCredit(opts.acc, opts.outstanding)
  if (opts.total > avail) return { tone: 'warn', key: 'st_prev_over', vars: { over: PKR(opts.total - avail) } }
  return { tone: 'ok', key: 'st_prev_ok' }
}

/** Estimated tax for a cart line (server recalculates; third schedule uses the retail price). */
export function estimateTax(qty: number, priceMinor: number, retailMinor: number | null, ratePct: number, thirdSchedule: boolean): number {
  const base = thirdSchedule && retailMinor ? retailMinor : priceMinor
  return Math.round((qty * base * Number(ratePct)) / 100)
}
