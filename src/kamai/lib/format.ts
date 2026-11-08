import { fromMinor } from './money'

const PKR_FMT = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 })
const PKR_FMT_2 = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Paisa -> "Rs 12,450". Pass { decimals: true } for "Rs 12,450.50". */
export function PKR(minor: number | bigint | string | null | undefined, opts?: { decimals?: boolean; sign?: boolean }): string {
  const rupees = fromMinor(minor)
  const abs = Math.abs(rupees)
  const body = opts?.decimals ? PKR_FMT_2.format(abs) : PKR_FMT.format(Math.round(abs))
  const neg = rupees < 0 ? '-' : opts?.sign && rupees > 0 ? '+' : ''
  return `${neg}Rs ${body}`
}

/** Compact rupees for stat tiles: paisa -> "Rs 1.2M" / "Rs 45K". */
export function PKRCompact(minor: number | bigint | string | null | undefined): string {
  const r = fromMinor(minor)
  const abs = Math.abs(r)
  const sign = r < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rs ${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}Rs ${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`
  if (abs >= 1_000) return `${sign}Rs ${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
  return `${sign}Rs ${PKR_FMT.format(Math.round(abs))}`
}

function toDate(d: string | number | Date | null | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null
  const dt = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** "8 Nov 2026" (Asia/Karachi). */
export function fmtDate(d: string | number | Date | null | undefined, fallback = '—'): string {
  const dt = toDate(d)
  if (!dt) return fallback
  return dt.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

/** "8 Nov 2026, 14:05" (Asia/Karachi). */
export function fmtDateTime(d: string | number | Date | null | undefined, fallback = '—'): string {
  const dt = toDate(d)
  if (!dt) return fallback
  return dt.toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Karachi',
  })
}

/** Relative time: "3 min ago", "2 d ago", "in 4 h". */
export function fmtRelative(d: string | number | Date | null | undefined, fallback = '—'): string {
  const dt = toDate(d)
  if (!dt) return fallback
  const diff = dt.getTime() - Date.now()
  const abs = Math.abs(diff)
  const unit = abs < 60_000 ? ['s', 1000] : abs < 3_600_000 ? ['min', 60_000] : abs < 86_400_000 ? ['h', 3_600_000] : ['d', 86_400_000]
  const n = Math.round(abs / (unit[1] as number))
  return diff < 0 ? `${n} ${unit[0]} ago` : `in ${n} ${unit[0]}`
}

/** 0.0834 -> "8.3%" when `ratio` is true (default), or 8.34 -> "8.3%" when false. */
export function pct(value: number | null | undefined, opts?: { ratio?: boolean; digits?: number; fallback?: string }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return opts?.fallback ?? '—'
  const ratio = opts?.ratio ?? true
  const v = ratio ? value * 100 : value
  return `${v.toFixed(opts?.digits ?? 1)}%`
}

/** Plain integer with thousands separators. */
export function fmtInt(n: number | bigint | string | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined || n === '') return fallback
  const v = Number(n)
  return Number.isFinite(v) ? PKR_FMT.format(Math.round(v)) : fallback
}

/** "ORD-000123" style zero padded numbers. */
export function padNo(prefix: string, n: number | string, width = 6): string {
  return `${prefix}${String(n).padStart(width, '0')}`
}

/** Title-case a snake_case status: 'credit_approved' -> 'Credit approved'. */
export function humanize(s: string | null | undefined): string {
  if (!s) return ''
  const t = s.replace(/[_-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Mask a Pakistani mobile: +923001234567 -> +92 300 ••• 4567 */
export function maskMobile(m: string | null | undefined): string {
  if (!m) return '—'
  const digits = m.replace(/\D/g, '')
  if (digits.length < 7) return m
  return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ••• ${digits.slice(-4)}`
}
