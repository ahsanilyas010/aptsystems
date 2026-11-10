import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type {
  DpdBucket,
  KamaiFacilitiesRow,
  KamaiFinancingsRow,
  KamaiVCollectionsRow,
  KamaiVLenderPositionsRow,
  KamaiVParRow,
} from '../../lib/db-types'

export const BUCKETS: DpdBucket[] = ['current', '1-7', '8-14', '15-30', '31-60', '61-90', '90+']

/** Exact column order of view kamai_v_lender_positions (the daily loan tape). */
export const TAPE_COLUMNS = [
  'distributor_tenant_id',
  'exposure_id',
  'order_id',
  'invoice_id',
  'invoice_number',
  'store_id',
  'store_name',
  'area',
  'credit_tier',
  'credit_limit_minor',
  'origination_date',
  'due_date',
  'tenor_days',
  'original_minor',
  'financed_minor',
  'outstanding_minor',
  'paid_minor',
  'credited_minor',
  'last_payment_at',
  'dpd',
  'dpd_bucket',
  'status',
  'restructured',
  'write_off_date',
  'lender_tenant_id',
  'delivery_proof_flag',
  'eligible_flag',
  'ineligibility_reason',
  'created_at',
] as const satisfies ReadonlyArray<keyof KamaiVLenderPositionsRow>

const PAGE = 1000
const MAX_ROWS = 20000

/** Page through a PostgREST query builder factory (range pagination). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export function useTid(): string | null {
  return useAuth().activeTenantId
}

export function usePositions() {
  const tid = useTid()
  return useQuery({
    queryKey: ['lender', tid, 'positions'],
    enabled: !!tid,
    queryFn: () =>
      fetchAll<KamaiVLenderPositionsRow>((a, b) =>
        supabase.from('kamai_v_lender_positions').select('*').order('due_date', { ascending: true }).order('exposure_id').range(a, b),
      ),
  })
}

export function usePar() {
  const tid = useTid()
  return useQuery({
    queryKey: ['lender', tid, 'par'],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_v_par').select('*')
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiVParRow[]
    },
  })
}

export function useCollections(days = 30) {
  const tid = useTid()
  return useQuery({
    queryKey: ['lender', tid, 'collections', days],
    enabled: !!tid,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase.from('kamai_v_collections').select('*').gte('collected_on', since).order('collected_on')
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiVCollectionsRow[]
    },
  })
}

export function useFacilities() {
  const tid = useTid()
  return useQuery({
    queryKey: ['lender', tid, 'facilities'],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_facilities').select('*').eq('lender_tenant_id', tid).order('created_at')
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiFacilitiesRow[]
    },
  })
}

export function useFinancings() {
  const tid = useTid()
  return useQuery({
    queryKey: ['lender', tid, 'financings'],
    enabled: !!tid,
    queryFn: () =>
      fetchAll<KamaiFinancingsRow>((a, b) =>
        supabase.from('kamai_financings').select('*').eq('lender_tenant_id', tid).order('disbursed_at', { ascending: false }).range(a, b),
      ),
  })
}

/** id -> tenant name for the given tenant ids (best effort: RLS may hide some). */
export function useTenantNames(ids: string[]) {
  const tid = useTid()
  const key = [...new Set(ids.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['lender', tid, 'tenant-names', key.join(',')],
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

export function nameOf(map: Record<string, string> | undefined, id: string | null | undefined): string {
  if (!id) return '—'
  return map?.[id] ?? `${id.slice(0, 8)}…`
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function sum(rows: Array<number | null | undefined>): number {
  return rows.reduce<number>((a, v) => a + (v ?? 0), 0)
}

/**
 * Cohort gate: the first 50 matured (due date passed) credit exposures; share collected
 * in full by the due date. Value: share on count, because the gate is "50 orders".
 */
export interface GateResult {
  cohortSize: number
  target: number
  onTime: number
  rate: number | null
  matured: number
}

export function computeGate(rows: KamaiVLenderPositionsRow[], target = 50): GateResult {
  const today = new Date().toISOString().slice(0, 10)
  const matured = rows.filter((r) => r.due_date && r.due_date < today).sort((a, b) => String(a.origination_date).localeCompare(String(b.origination_date)))
  const cohort = matured.slice(0, target)
  const onTime = cohort.filter((r) => {
    if ((r.outstanding_minor ?? 0) > 0 || r.status === 'written_off') return false
    if (!r.last_payment_at || !r.due_date) return (r.credited_minor ?? 0) >= (r.original_minor ?? 0) && (r.original_minor ?? 0) > 0
    return r.last_payment_at.slice(0, 10) <= r.due_date
  }).length
  return { cohortSize: cohort.length, target, onTime, rate: cohort.length ? onTime / cohort.length : null, matured: matured.length }
}
