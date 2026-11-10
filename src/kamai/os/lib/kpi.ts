import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { OsKpis } from '../../lib/db-types'

/** Last known numbers from the original dashboard; shown when the live RPC is unavailable. */
export const SNAPSHOT: OsKpis = {
  invoices: 230, voided: 21, invoiced_total: 6_420_000, unpaid_total: 2_700_000, open_bal_total: 0,
  ar_60plus: 790_000, ar_60plus_count: 53, collected_yesterday: 0,
  orders_all: 91, live_orders: 54, live_value: 886_000, cancelled: 30, rejected: 7,
  orders_7d: 4, value_7d: 0, heroes_active_7d: 2, stuck_orders: 0,
  stores: 177, stores_ordered: 39, heroes_registered: 55, heroes_active: 5,
  kamai_tenants: 0, kamai_stores: 0, kamai_orders_by_state: {}, kamai_outstanding_minor: 0, kamai_par30: null, kamai_wa_queued: 0,
  generated_at: '',
}

/** Rupees (legacy numeric) -> "6.42M" / "886K" / "950". */
export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n) || 0
  if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (v >= 1e3) return Math.round(v / 1e3) + 'K'
  return String(Math.round(v))
}

export interface KpiView {
  /** true when the numbers come from kamai_os_kpis */
  live: boolean
  loading: boolean
  error: string | null
  generatedAt: string | null
  k: OsKpis
  invoiced: string
  invoicedSub: string
  appOrders: string
  appOrdersSub: string
  /** "Rs 2.7M" */
  ar: string
  ar60: string
  /** whole percent as number, 0..100 */
  activationPct: number
  cancelPct: number
  activationRate: string
  cancelRate: string
  refetch: () => void
}

const int = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-PK')

export function buildKpiView(k: OsKpis, live: boolean, extra: Pick<KpiView, 'loading' | 'error' | 'generatedAt' | 'refetch'>): KpiView {
  const ar = Number(k.unpaid_total) + Number(k.open_bal_total)
  const activationPct = k.heroes_registered > 0 ? Math.round((100 * k.heroes_active) / k.heroes_registered) : 0
  const cancelPct = k.orders_all > 0 ? Math.round((100 * k.cancelled) / k.orders_all) : 0
  return {
    live,
    ...extra,
    k,
    invoiced: fmtMoney(k.invoiced_total),
    invoicedSub: `PKR across ${int(k.invoices)} invoices (${int(k.voided)} voided)`,
    appOrders: fmtMoney(k.live_value),
    appOrdersSub: `PKR, ${int(k.live_orders)} live orders since June (${int(k.cancelled)} cancelled, ${int(k.rejected)} rejected)`,
    ar: 'Rs ' + fmtMoney(ar),
    ar60: 'Rs ' + fmtMoney(k.ar_60plus),
    activationPct,
    cancelPct,
    activationRate: activationPct + '%',
    cancelRate: cancelPct + '%',
  }
}

/** Live KPIs from rpc kamai_os_kpis with graceful fallback to the dashboard snapshot. */
export function useOsKpiView(): KpiView {
  const q = useQuery({
    queryKey: ['os', 'kpis'],
    queryFn: async (): Promise<OsKpis> => {
      const { data, error } = await supabase.rpc('kamai_os_kpis')
      if (error) throw new Error(error.message)
      if (!data || typeof data !== 'object') throw new Error('kamai_os_kpis returned no data')
      return { ...SNAPSHOT, ...(data as OsKpis) }
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: false,
  })
  const live = !!q.data
  return buildKpiView(q.data ?? SNAPSHOT, live, {
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    generatedAt: q.data?.generated_at || null,
    refetch: () => void q.refetch(),
  })
}
