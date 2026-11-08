import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth, useStoreMembership } from '../../lib/auth'
import type {
  KamaiCreditAccountsRow,
  KamaiCreditExposuresRow,
  KamaiOrderItemsRow,
  KamaiOrdersRow,
  KamaiPaymentsRow,
  KamaiProductsRow,
  KamaiStoresRow,
  KamaiTenantsRow,
  PaymentMode,
  SubmitOrderResult,
} from '../../lib/db-types'
import { enqueueOrder, isNetworkError } from './offline-queue'

export interface StoreCtx {
  tenantId: string
  storeId: string
}

/** Tenant + store of the logged-in store owner (RequireStore guarantees one exists). */
export function useStoreCtx(): StoreCtx | null {
  const m = useStoreMembership()
  const { activeTenantId } = useAuth()
  if (!m || !m.store_id) return null
  return { tenantId: m.tenant_id ?? activeTenantId ?? '', storeId: m.store_id }
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

export function useStoreRow(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'store', c?.tenantId, c?.storeId],
    enabled: !!c,
    queryFn: async () =>
      must<KamaiStoresRow>(supabase.from('kamai_stores').select('*').eq('tenant_id', c!.tenantId).eq('id', c!.storeId).maybeSingle()),
  })
}

export function useTenantRow(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'tenant', c?.tenantId],
    enabled: !!c,
    queryFn: async () => must<KamaiTenantsRow>(supabase.from('kamai_tenants').select('*').eq('id', c!.tenantId).maybeSingle()),
  })
}

export function useCreditAccount(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'credit', c?.tenantId, c?.storeId],
    enabled: !!c,
    queryFn: async () =>
      must<KamaiCreditAccountsRow>(
        supabase.from('kamai_credit_accounts').select('*').eq('tenant_id', c!.tenantId).eq('store_id', c!.storeId).maybeSingle(),
      ),
  })
}

/** Open exposures (one per delivered credit invoice with a balance), oldest due date first. */
export function useExposures(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'exposures', c?.tenantId, c?.storeId],
    enabled: !!c,
    queryFn: async () =>
      (await must<KamaiCreditExposuresRow[]>(
        supabase
          .from('kamai_credit_exposures')
          .select('*')
          .eq('tenant_id', c!.tenantId)
          .eq('store_id', c!.storeId)
          .eq('status', 'open')
          .gt('outstanding_minor', 0)
          .order('due_date', { ascending: true }),
      )) ?? [],
  })
}

export interface InvoiceLite {
  id: string
  display_number: string
  total_incl_minor: number
  due_date: string | null
}

export function useInvoiceMap(c: StoreCtx | null, ids: string[]) {
  const key = [...ids].sort().join(',')
  return useQuery({
    queryKey: ['kamai-store', 'invoices', c?.tenantId, key],
    enabled: !!c && ids.length > 0,
    queryFn: async () => {
      const rows = (await must<InvoiceLite[]>(
        supabase.from('kamai_invoices').select('id,display_number,total_incl_minor,due_date').eq('tenant_id', c!.tenantId).in('id', ids),
      )) ?? []
      return Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, InvoiceLite>
    },
  })
}

export interface ProductView extends KamaiProductsRow {
  price_minor: number
}

/** Active products with the store's price-list price (falls back to trade price). */
export function useProducts(c: StoreCtx | null, priceListId: string | null | undefined, ready: boolean) {
  return useQuery({
    queryKey: ['kamai-store', 'products', c?.tenantId, priceListId ?? 'default'],
    enabled: !!c && ready,
    queryFn: async (): Promise<ProductView[]> => {
      const products =
        (await must<KamaiProductsRow[]>(
          supabase.from('kamai_products').select('*').eq('tenant_id', c!.tenantId).eq('active', true).order('name', { ascending: true }).limit(2000),
        )) ?? []
      let listId = priceListId ?? null
      if (!listId) {
        const d = await must<{ id: string }[]>(
          supabase.from('kamai_price_lists').select('id').eq('tenant_id', c!.tenantId).eq('is_default', true).limit(1),
        )
        listId = d?.[0]?.id ?? null
      }
      const prices = new Map<string, number>()
      if (listId) {
        const items =
          (await must<Array<{ product_id: string; price_minor: number }>>(
            supabase.from('kamai_price_list_items').select('product_id,price_minor').eq('tenant_id', c!.tenantId).eq('price_list_id', listId).limit(5000),
          )) ?? []
        for (const i of items) prices.set(i.product_id, Number(i.price_minor))
      }
      return products.map((p) => ({ ...p, price_minor: prices.get(p.id) ?? Number(p.trade_price_minor) }))
    },
  })
}

export function useOrders(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'orders', c?.tenantId, c?.storeId],
    enabled: !!c,
    queryFn: async () =>
      (await must<KamaiOrdersRow[]>(
        supabase
          .from('kamai_orders')
          .select('*')
          .eq('tenant_id', c!.tenantId)
          .eq('store_id', c!.storeId)
          .order('created_at', { ascending: false })
          .limit(60),
      )) ?? [],
  })
}

export function useOrderItems(c: StoreCtx | null, orderId: string | undefined) {
  return useQuery({
    queryKey: ['kamai-store', 'order-items', c?.tenantId, orderId],
    enabled: !!c && !!orderId,
    queryFn: async () =>
      (await must<KamaiOrderItemsRow[]>(
        supabase.from('kamai_order_items').select('*').eq('tenant_id', c!.tenantId).eq('order_id', orderId!).order('created_at', { ascending: true }),
      )) ?? [],
  })
}

export function usePayments(c: StoreCtx | null) {
  return useQuery({
    queryKey: ['kamai-store', 'payments', c?.tenantId, c?.storeId],
    enabled: !!c,
    queryFn: async () =>
      (await must<KamaiPaymentsRow[]>(
        supabase
          .from('kamai_payments')
          .select('*')
          .eq('tenant_id', c!.tenantId)
          .eq('store_id', c!.storeId)
          .order('collected_at', { ascending: false })
          .limit(10),
      )) ?? [],
  })
}

export function sumOutstanding(ex: KamaiCreditExposuresRow[] | undefined): number {
  return (ex ?? []).reduce((a, e) => a + Number(e.outstanding_minor), 0)
}

export function daysOverdue(due: string | null | undefined): number {
  if (!due) return 0
  const d = new Date(`${due.slice(0, 10)}T23:59:59+05:00`).getTime()
  const diff = Date.now() - d
  return diff > 0 ? Math.ceil(diff / 86_400_000) : 0
}

export type SubmitOutcome = { kind: 'sent'; result: SubmitOrderResult } | { kind: 'queued' }

/** Send an order; on a network failure keep it in the IndexedDB outbox so it replays idempotently. */
export async function submitOrder(
  c: StoreCtx,
  items: Array<{ product_id: string; qty: number }>,
  mode: PaymentMode,
  clientOrderId: string,
  notes?: string,
): Promise<SubmitOutcome> {
  const payload = {
    tenant_id: c.tenantId,
    store_id: c.storeId,
    items,
    payment_mode: mode,
    source: 'store_pwa' as const,
    client_order_id: clientOrderId,
    ...(notes ? { notes } : {}),
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (!offline) {
    const { data, error } = await supabase.rpc('kamai_submit_order', { p: payload })
    if (!error) return { kind: 'sent', result: data as SubmitOrderResult }
    if (!isNetworkError(error)) throw new Error(error.message)
  }
  await enqueueOrder(payload)
  return { kind: 'queued' }
}
