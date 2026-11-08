import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { KamaiProductsRow } from '../../lib/db-types'

export function useTid(): string | null {
  return useAuth().activeTenantId
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** All products linked to this brand: its own catalogue plus distributor SKUs pointing at it. */
export function useBrandProducts() {
  const tid = useTid()
  return useQuery({
    queryKey: ['brand', tid, 'products'],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kamai_products')
        .select('*')
        .or(`tenant_id.eq.${tid},brand_tenant_id.eq.${tid}`)
        .order('sku')
        .limit(5000)
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiProductsRow[]
    },
  })
}

/** GS1 mod-10 check digit validation for GTIN-8/12/13/14. Returns padded 14 digit code or an error. */
export function normaliseGtin(raw: string): { gtin14: string | null; type: number | null; error?: string } {
  const d = raw.replace(/\s+/g, '')
  if (!d) return { gtin14: null, type: null }
  if (!/^\d+$/.test(d)) return { gtin14: null, type: null, error: 'GTIN must contain digits only' }
  if (![8, 12, 13, 14].includes(d.length)) return { gtin14: null, type: null, error: 'GTIN must be 8, 12, 13 or 14 digits' }
  const p = d.padStart(14, '0')
  let s = 0
  for (let i = 0; i < 13; i++) s += Number(p[i]) * (i % 2 === 0 ? 3 : 1)
  if ((10 - (s % 10)) % 10 !== Number(p[13])) return { gtin14: null, type: null, error: 'Check digit is wrong' }
  return { gtin14: p, type: d.length }
}

export const HS_RE = /^\d{4}\.\d{2,4}$/

/** id -> tenant name (best effort; RLS may hide some). */
export function useTenantNames(ids: string[]) {
  const tid = useTid()
  const key = [...new Set(ids.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['brand', tid, 'tenant-names', key.join(',')],
    enabled: !!tid && key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_tenants').select('id,name').in('id', key)
      if (error) throw new Error(error.message)
      const m: Record<string, string> = {}
      for (const r of (data ?? []) as Array<{ id: string; name: string }>) m[r.id] = r.name
      return m
    },
  })
}
