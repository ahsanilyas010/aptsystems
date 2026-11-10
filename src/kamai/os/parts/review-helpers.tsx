import { Badge } from '../../ui'
import type { KamaiProductsRow } from '../../lib/db-types'
import { ListingBadge } from '../../distributor/lib/listing'

export interface Edit {
  name?: string
  category?: string
  description?: string
  image_url?: string
  margin?: string
}

/** Parses a margin input; null when empty or outside 0..500. */
export function parseMargin(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 500 ? n : null
}

/** ceil(price * (1 + margin/100)); mirrors the DB function. */
export function finalMinor(priceMinor: number, marginPct: number): number {
  return Math.ceil(Number(priceMinor) * (1 + marginPct / 100) - 1e-9)
}

export function ReviewStatus({ p }: { p: KamaiProductsRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <ListingBadge status={p.listing_status} />
      {p.review_note ? <span className="max-w-[160px] whitespace-normal text-[11px] text-k-muted">{p.review_note}</span> : null}
      {!p.active ? <Badge tone="muted" size="sm">Inactive</Badge> : null}
    </div>
  )
}
