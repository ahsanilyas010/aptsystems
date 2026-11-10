import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { KamaiBrandSellthroughRow, KamaiProductsRow } from '../../lib/db-types'
import { useBrandProducts, useTid } from './data'

export interface Agg {
  key: string
  label: string
  units: number
  gmv: number
  stores: number
}

export interface SellThrough {
  totalUnits: number
  totalGmv: number
  storeCount: number
  repeatStores: number
  bySku: Agg[]
  byArea: Agg[]
  byDistributor: Agg[]
}

function rollup(map: Map<string, { label: string; units: number; gmv: number; stores: Set<string> }>): Agg[] {
  return [...map].map(([key, v]) => ({ key, label: v.label, units: v.units, gmv: v.gmv, stores: v.stores.size })).sort((a, b) => b.gmv - a.gmv)
}

/** Delivered sell-through of the brand's SKUs in the last `days` days. */
export function useSellThrough(days: number) {
  const tid = useTid()
  const products = useBrandProducts()
  const prods: KamaiProductsRow[] = (products.data ?? []).filter((p) => p.brand_tenant_id === tid)
  const ids = prods.map((p) => p.id)
  return useQuery({
    queryKey: ['brand', tid, 'sellthrough', days, ids.length],
    enabled: !!tid && products.isSuccess,
    queryFn: async (): Promise<SellThrough> => {
      const { data, error } = await supabase.rpc('kamai_brand_sellthrough', { p_days: days })
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as KamaiBrandSellthroughRow[]
      const pById = new Map(prods.map((p) => [p.id, p]))

      const sku = new Map<string, { label: string; units: number; gmv: number; stores: Set<string> }>()
      const ar = new Map<string, { label: string; units: number; gmv: number; stores: Set<string> }>()
      const ds = new Map<string, { label: string; units: number; gmv: number; stores: Set<string> }>()
      const ordersPerStore = new Map<string, Set<string>>()
      let totalUnits = 0
      let totalGmv = 0
      const bump = (m: typeof sku, key: string, label: string, units: number, gmv: number, store: string) => {
        const v = m.get(key) ?? { label, units: 0, gmv: 0, stores: new Set<string>() }
        v.units += units
        v.gmv += gmv
        v.stores.add(store)
        m.set(key, v)
      }
      for (const it of rows) {
        const p = pById.get(it.product_id)
        const units = it.delivered_qty ?? 0
        const gmv = it.line_total_minor ?? 0
        const areaName = it.area?.trim() || 'Unknown'
        totalUnits += units
        totalGmv += gmv
        bump(sku, it.product_id, p ? `${p.name} (${p.sku})` : `${it.product_name} (${it.sku})`, units, gmv, it.store_id)
        bump(ar, areaName, areaName, units, gmv, it.store_id)
        bump(ds, it.distributor_tenant_id, it.distributor_tenant_id, units, gmv, it.store_id)
        const so = ordersPerStore.get(it.store_id) ?? new Set<string>()
        so.add(it.order_id)
        ordersPerStore.set(it.store_id, so)
      }
      return {
        totalUnits,
        totalGmv,
        storeCount: ordersPerStore.size,
        repeatStores: [...ordersPerStore.values()].filter((s) => s.size >= 2).length,
        bySku: rollup(sku),
        byArea: rollup(ar),
        byDistributor: rollup(ds),
      }
    },
  })
}
