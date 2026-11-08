import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { KamaiOrderItemsRow, KamaiOrdersRow, KamaiProductsRow, KamaiStoresRow } from '../../lib/db-types'
import { chunk, useBrandProducts, useTid } from './data'

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

type Item = Pick<KamaiOrderItemsRow, 'order_id' | 'product_id' | 'delivered_qty' | 'line_total_minor' | 'tenant_id'>
type Ord = Pick<KamaiOrdersRow, 'id' | 'tenant_id' | 'store_id' | 'fulfilment_status' | 'delivered_at'>

async function inChunks<T>(table: string, cols: string, col: string, ids: string[], extra?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (const part of chunk(ids, 80)) {
    let q = supabase.from(table).select(cols).in(col, part)
    if (extra) q = extra(q)
    const { data, error } = await q.limit(10000)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
  }
  return out
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
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const items = await inChunks<Item>('kamai_order_items', 'order_id,product_id,delivered_qty,line_total_minor,tenant_id', 'product_id', ids, (q) => q.gte('created_at', new Date(Date.now() - (days + 60) * 86_400_000).toISOString()))
      const orders = await inChunks<Ord>('kamai_orders', 'id,tenant_id,store_id,fulfilment_status,delivered_at', 'id', [...new Set(items.map((i) => i.order_id))])
      const ok = new Map(orders.filter((o) => o.fulfilment_status === 'delivered' && o.delivered_at && o.delivered_at >= since).map((o) => [o.id, o]))
      const storeIds = [...new Set([...ok.values()].map((o) => o.store_id))]
      const stores = storeIds.length ? await inChunks<Pick<KamaiStoresRow, 'id' | 'area'>>('kamai_stores', 'id,area', 'id', storeIds) : []
      const area = new Map(stores.map((s) => [s.id, s.area?.trim() || 'Unknown']))
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
      for (const it of items) {
        const o = ok.get(it.order_id)
        if (!o) continue
        const p = pById.get(it.product_id)
        const units = it.delivered_qty ?? 0
        const gmv = it.line_total_minor ?? 0
        totalUnits += units
        totalGmv += gmv
        bump(sku, it.product_id, p ? `${p.name} (${p.sku})` : it.product_id.slice(0, 8), units, gmv, o.store_id)
        bump(ar, area.get(o.store_id) ?? 'Unknown', area.get(o.store_id) ?? 'Unknown', units, gmv, o.store_id)
        bump(ds, o.tenant_id, o.tenant_id, units, gmv, o.store_id)
        const s = ordersPerStore.get(o.store_id) ?? new Set<string>()
        s.add(o.id)
        ordersPerStore.set(o.store_id, s)
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
