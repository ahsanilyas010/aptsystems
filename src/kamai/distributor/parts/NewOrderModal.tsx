import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { Badge, Button, Input, Modal, Select, Textarea, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, humanize } from '../../lib/format'
import type { KamaiPriceListItemsRow, KamaiPriceListsRow, SubmitOrderResult } from '../../lib/db-types'
import { errMsg, rpc, useProducts, useRefreshAll, useStores, useTq } from '../lib/data'

export function NewOrderModal({ open, onClose, tenantId, onCreated }: { open: boolean; onClose: () => void; tenantId: string; onCreated?: (orderId: string) => void }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const stores = useStores()
  const products = useProducts()
  const lists = useTq<KamaiPriceListsRow[]>(['plists'], (t) => supabase.from('kamai_price_lists').select('*').eq('tenant_id', t), { enabled: open })
  const [storeId, setStoreId] = useState('')
  const [mode, setMode] = useState<'credit' | 'cod'>('credit')
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitOrderResult | null>(null)
  const [cid, setCid] = useState('')

  useEffect(() => {
    if (open) {
      setCid(crypto.randomUUID())
      setResult(null)
      setErr(null)
      setCart({})
      setStoreId('')
      setNotes('')
      setQ('')
    }
  }, [open])

  const store = stores.map.get(storeId)
  const listId = store?.price_list_id ?? lists.data?.find((l) => l.is_default)?.id ?? ''
  const items = useTq<KamaiPriceListItemsRow[]>(['plitems', listId], (t) => supabase.from('kamai_price_list_items').select('*').eq('tenant_id', t).eq('price_list_id', listId).limit(5000), { enabled: open && !!listId })
  const priceOf = useMemo(() => {
    const m = new Map((items.data ?? []).map((i) => [i.product_id, Number(i.price_minor)]))
    return (p: { id: string; trade_price_minor: number }) => m.get(p.id) ?? Number(p.trade_price_minor)
  }, [items.data])

  const active = products.rows.filter((p) => p.active)
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? active.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)) : active).slice(0, 30)
  }, [active, q])
  const lines = active.filter((p) => cart[p.id] > 0)
  const est = lines.reduce((s, p) => s + priceOf(p) * cart[p.id], 0)
  const setQty = (id: string, n: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(99999, n)) }))

  async function submit() {
    setErr(null)
    if (!storeId) return setErr('Choose a store')
    if (!lines.length) return setErr('Add at least one item')
    setBusy(true)
    try {
      const res = await rpc<SubmitOrderResult>('kamai_submit_order', {
        p: { tenant_id: tenantId, store_id: storeId, source: 'booker', payment_mode: mode, client_order_id: cid, notes: notes.trim() || undefined, items: lines.map((p) => ({ product_id: p.id, qty: cart[p.id] })) },
      })
      setResult(res)
      toast.success(`Order #${res.order.order_no} booked`)
      await refresh()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const d = result?.decision
  return (
    <Modal open={open} onClose={onClose} size="lg" title={result ? `Order #${result.order.order_no} created` : 'New order'}
      footer={result ? (
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={() => { onCreated?.(result.order.id); onClose() }}>Open order</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Submit order</Button>
        </>
      )}>
      {result ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-k-border bg-k-surface2 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Credit decision</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={d?.decision === 'approved' || d?.decision === 'cod' ? 'green' : 'amber'}>{humanize(d?.decision ?? 'pending')}</Badge>
              <span className="text-sm text-k-text">Order total {PKR(result.order.total_minor)}</span>
            </div>
            {d ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-k-muted">Available credit</dt><dd className="font-semibold">{PKR(d.available_minor)}</dd></div>
                <div><dt className="text-xs text-k-muted">Current exposure</dt><dd className="font-semibold">{PKR(d.exposure_minor)}</dd></div>
              </dl>
            ) : null}
            {d?.reason_codes?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{d.reason_codes.map((c) => <Badge key={c} tone="amber">{c}</Badge>)}</div> : null}
            {result.replayed ? <p className="mt-2 text-xs text-k-muted">This order had already been submitted.</p> : null}
          </div>
          {d && d.decision === 'hold' ? <p className="text-[13px] text-k-muted">The order is on credit hold. A manager can approve it manually or convert it to COD from the order page.</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Store" placeholder="Select store" value={storeId} onChange={(e) => setStoreId(e.target.value)} options={stores.rows.filter((s) => s.status === 'active').map((s) => ({ value: s.id, label: `${s.name}${s.area ? ` · ${s.area}` : ''}` }))} />
            <Select label="Payment" value={mode} onChange={(e) => setMode(e.target.value as 'credit' | 'cod')} options={[{ value: 'credit', label: 'Credit (subject to limit)' }, { value: 'cod', label: 'Cash on delivery' }]} />
          </div>
          <Input aria-label="Search products" placeholder="Search product or SKU" prefix={<Search size={15} />} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded-xl border border-k-border">
            {products.isLoading ? <p className="p-4 text-sm text-k-muted">Loading products…</p> : null}
            {hits.map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-b border-k-border px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-k-dark">{p.name}</div>
                  <div className="text-xs text-k-muted">{p.sku} · {PKR(priceOf(p))}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Less" className="rounded-lg border border-k-border p-1.5 text-k-muted hover:bg-k-surface2" onClick={() => setQty(p.id, (cart[p.id] ?? 0) - 1)}><Minus size={14} /></button>
                  <input aria-label={`Quantity ${p.sku}`} inputMode="numeric" className="h-8 w-14 rounded-lg border border-k-border text-center text-sm" value={cart[p.id] ?? 0} onChange={(e) => setQty(p.id, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))} />
                  <button type="button" aria-label="More" className="rounded-lg border border-k-border p-1.5 text-k-muted hover:bg-k-surface2" onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1)}><Plus size={14} /></button>
                </div>
              </div>
            ))}
            {!products.isLoading && !hits.length ? <p className="p-4 text-sm text-k-muted">No products match.</p> : null}
          </div>
          {lines.length ? (
            <div className="rounded-xl bg-k-surface2 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-[1px] text-k-muted">Basket</div>
              {lines.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <span className="min-w-0 truncate">{cart[p.id]} x {p.name}</span>
                  <span className="flex items-center gap-2 font-semibold">{PKR(priceOf(p) * cart[p.id])}<button aria-label="Remove" onClick={() => setQty(p.id, 0)} className="text-k-light hover:text-k-red"><X size={14} /></button></span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-k-border pt-2 text-sm font-bold"><span>Estimated subtotal</span><span>{PKR(est)}</span></div>
              <p className="mt-1 text-xs text-k-muted">Final prices and sales tax are calculated by the server on submit.</p>
            </div>
          ) : null}
          <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
        </div>
      )}
    </Modal>
  )
}
