import type { Json, KamaiInvoiceItemsRow, KamaiInvoicesRow } from '../../lib/db-types'

export function snap(j: Json | null | undefined): Record<string, string | null> {
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, string | null>) : {}
}

export interface Readiness {
  ok: boolean
  missing: string[]
}

/** FBR (PRAL e-invoicing) readiness: seller NTN, buyer NTN/CNIC for registered buyers, HS code per line. */
export function fbrReadiness(inv: KamaiInvoicesRow, items: Array<Pick<KamaiInvoiceItemsRow, 'hs_code'>> | undefined): Readiness {
  const missing: string[] = []
  if (!snap(inv.seller_snapshot).ntn) missing.push('Seller NTN')
  if (!inv.buyer_ntn_cnic) missing.push(inv.buyer_registration_type === 'Registered' ? 'Buyer NTN' : 'Buyer CNIC (optional)')
  if (items && items.some((i) => !i.hs_code)) missing.push('HS code')
  const hard = missing.filter((m) => !m.includes('optional'))
  return { ok: hard.length === 0, missing }
}
