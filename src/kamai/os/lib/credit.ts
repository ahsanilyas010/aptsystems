import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { DpdBucket, KamaiVParRow } from '../../lib/db-types'

export const BUCKETS: DpdBucket[] = ['current', '1-7', '8-14', '15-30', '31-60', '61-90', '90+']

const opts = { staleTime: 60_000, retry: false } as const

export interface ParPortfolio {
  rows: KamaiVParRow[]
  outstanding: number
  par7: number | null
  par30: number | null
  par60: number | null
  par90: number | null
  snapshotDate: string | null
}

/** PAR 7/30/60/90 from view kamai_v_par (latest snapshot per tenant), aggregated balance-weighted. */
export function usePar() {
  return useQuery({
    queryKey: ['os', 'credit', 'par'],
    queryFn: async (): Promise<ParPortfolio> => {
      const { data, error } = await supabase.from('kamai_v_par').select('*')
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as KamaiVParRow[]
      const sum = (f: (r: KamaiVParRow) => number | null) => rows.reduce((a, r) => a + Number(f(r) ?? 0), 0)
      const outstanding = sum((r) => r.outstanding_minor)
      const ratio = (m: number) => (outstanding > 0 ? m / outstanding : null)
      const dates = rows.map((r) => r.snapshot_date).filter(Boolean) as string[]
      return {
        rows,
        outstanding,
        par7: ratio(sum((r) => r.par7_minor)),
        par30: ratio(sum((r) => r.par30_minor)),
        par60: ratio(sum((r) => r.par60_minor)),
        par90: ratio(sum((r) => r.par90_minor)),
        snapshotDate: dates.sort().at(-1) ?? null,
      }
    },
    ...opts,
  })
}

export interface DpdDistribution {
  date: string | null
  buckets: Array<{ bucket: DpdBucket; stores: number; outstanding: number }>
  totalStores: number
  totalOutstanding: number
}

/** DPD bucket distribution from the latest kamai_credit_snapshots date. */
export function useDpdDistribution() {
  return useQuery({
    queryKey: ['os', 'credit', 'dpd'],
    queryFn: async (): Promise<DpdDistribution> => {
      const latest = await supabase.from('kamai_credit_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1)
      if (latest.error) throw new Error(latest.error.message)
      const date = (latest.data?.[0] as { snapshot_date?: string } | undefined)?.snapshot_date ?? null
      const empty = BUCKETS.map((bucket) => ({ bucket, stores: 0, outstanding: 0 }))
      if (!date) return { date: null, buckets: empty, totalStores: 0, totalOutstanding: 0 }
      const { data, error } = await supabase.from('kamai_credit_snapshots').select('bucket, outstanding_minor').eq('snapshot_date', date).limit(20000)
      if (error) throw new Error(error.message)
      const acc = new Map<DpdBucket, { stores: number; outstanding: number }>(BUCKETS.map((b) => [b, { stores: 0, outstanding: 0 }]))
      for (const r of (data ?? []) as Array<{ bucket: DpdBucket; outstanding_minor: number }>) {
        const a = acc.get(r.bucket)
        if (a) {
          a.stores += 1
          a.outstanding += Number(r.outstanding_minor || 0)
        }
      }
      const buckets = BUCKETS.map((bucket) => ({ bucket, ...(acc.get(bucket) as { stores: number; outstanding: number }) }))
      return { date, buckets, totalStores: buckets.reduce((a, b) => a + b.stores, 0), totalOutstanding: buckets.reduce((a, b) => a + b.outstanding, 0) }
    },
    ...opts,
  })
}

export interface DisputeRates {
  overall: number | null
  delivered: number
  disputed: number
  byTenant: Array<{ tenant_id: string; delivered: number; disputed: number; rate: number }>
}

/** Dispute rate = disputed / (delivered + disputed), overall and per tenant. */
export function useDisputeRates() {
  return useQuery({
    queryKey: ['os', 'credit', 'disputes'],
    queryFn: async (): Promise<DisputeRates> => {
      const { data, error } = await supabase.from('kamai_orders').select('tenant_id, fulfilment_status').in('fulfilment_status', ['delivered', 'disputed']).limit(50000)
      if (error) throw new Error(error.message)
      const m = new Map<string, { delivered: number; disputed: number }>()
      for (const r of (data ?? []) as Array<{ tenant_id: string; fulfilment_status: string }>) {
        const e = m.get(r.tenant_id) ?? { delivered: 0, disputed: 0 }
        if (r.fulfilment_status === 'disputed') e.disputed += 1
        else e.delivered += 1
        m.set(r.tenant_id, e)
      }
      const byTenant = [...m.entries()].map(([tenant_id, e]) => ({ tenant_id, ...e, rate: e.delivered + e.disputed > 0 ? e.disputed / (e.delivered + e.disputed) : 0 }))
      const delivered = byTenant.reduce((a, t) => a + t.delivered, 0)
      const disputed = byTenant.reduce((a, t) => a + t.disputed, 0)
      return { overall: delivered + disputed > 0 ? disputed / (delivered + disputed) : null, delivered, disputed, byTenant: byTenant.sort((a, b) => b.rate - a.rate) }
    },
    ...opts,
  })
}

export interface CashVariance {
  ratio: number | null
  expected: number
  variance: number
  days: number
}

/** Rider cash variance = sum(|variance|) / sum(expected) over the last 30 days of day-closes. */
export function useCashVariance() {
  return useQuery({
    queryKey: ['os', 'credit', 'cash'],
    queryFn: async (): Promise<CashVariance> => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase.from('kamai_cash_deposits').select('expected_minor, variance_minor').gte('business_date', since).limit(20000)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ expected_minor: number; variance_minor: number }>
      const expected = rows.reduce((a, r) => a + Number(r.expected_minor || 0), 0)
      const variance = rows.reduce((a, r) => a + Math.abs(Number(r.variance_minor || 0)), 0)
      return { ratio: expected > 0 ? variance / expected : null, expected, variance, days: 30 }
    },
    ...opts,
  })
}

/** Share (by amount) of exposures already past due that were paid on or before the due date. */
export function useCollectedWithinTerms() {
  return useQuery({
    queryKey: ['os', 'credit', 'terms'],
    queryFn: async (): Promise<{ ratio: number | null; exposures: number }> => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.from('kamai_credit_exposures').select('status, due_date, closed_at, original_minor').lte('due_date', today).limit(50000)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ status: string; due_date: string; closed_at: string | null; original_minor: number }>
      const total = rows.reduce((a, r) => a + Number(r.original_minor || 0), 0)
      const ok = rows.filter((r) => r.status === 'paid' && r.closed_at && r.closed_at.slice(0, 10) <= r.due_date).reduce((a, r) => a + Number(r.original_minor || 0), 0)
      return { ratio: total > 0 ? ok / total : null, exposures: rows.length }
    },
    ...opts,
  })
}
