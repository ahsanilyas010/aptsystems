import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Table, useToast } from '../../ui'
import type { Column } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR } from '../../lib/format'
import { fromMinor, toMinor } from '../../lib/money'
import type { KamaiPriceListItemsRow, KamaiPriceListsRow, KamaiProductsRow, PriceTier } from '../../lib/db-types'
import { Gate, errMsg, useRefreshAll, useTq } from '../lib/data'
import { TIERS } from './AddStoreModal'

export function PriceLists({ products, tenantId, canEdit }: { products: KamaiProductsRow[]; tenantId: string; canEdit: boolean }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const lists = useTq<KamaiPriceListsRow[]>(['plists'], (t) => supabase.from('kamai_price_lists').select('*').eq('tenant_id', t).order('name'))
  const [sel, setSel] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [nm, setNm] = useState('')
  const [tier, setTier] = useState<PriceTier>('default')
  const [err, setErr] = useState<string | null>(null)
  const listId = sel || lists.data?.[0]?.id || ''
  const items = useTq<KamaiPriceListItemsRow[]>(['plitems', listId], (t) => supabase.from('kamai_price_list_items').select('*').eq('tenant_id', t).eq('price_list_id', listId).limit(5000), { enabled: !!listId })
  const itemMap = useMemo(() => new Map((items.data ?? []).map((i) => [i.product_id, i])), [items.data])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const current = lists.data?.find((l) => l.id === listId)

  async function createList() {
    setErr(null)
    if (!nm.trim()) return setErr('Name required')
    const { data, error } = await supabase.from('kamai_price_lists').insert({ tenant_id: tenantId, name: nm.trim(), tier, is_default: (lists.data?.length ?? 0) === 0 }).select('id').single()
    if (error) return setErr(error.message)
    toast.success('Price list created')
    setAdding(false)
    setNm('')
    setSel(data.id)
    await refresh()
  }

  async function savePrice(p: KamaiProductsRow) {
    const raw = edits[p.id]
    if (raw === undefined) return
    try {
      const existing = itemMap.get(p.id)
      if (raw.trim() === '') {
        if (existing) {
          const { error } = await supabase.from('kamai_price_list_items').delete().eq('id', existing.id).eq('tenant_id', tenantId)
          if (error) throw new Error(error.message)
        }
      } else {
        const { error } = await supabase.from('kamai_price_list_items').upsert({ tenant_id: tenantId, price_list_id: listId, product_id: p.id, price_minor: toMinor(raw) }, { onConflict: 'price_list_id,product_id' })
        if (error) throw new Error(error.message)
      }
      setEdits((e) => {
        const n = { ...e }
        delete n[p.id]
        return n
      })
      toast.success(`${p.sku} saved`)
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const cols: Column<KamaiProductsRow>[] = [
    { key: 'sku', header: 'SKU', render: (p) => p.sku },
    { key: 'name', header: 'Product', render: (p) => p.name },
    { key: 'base', header: 'Trade price', align: 'right', hideOnMobile: true, render: (p) => PKR(p.trade_price_minor) },
    {
      key: 'price',
      header: 'List price (Rs)',
      align: 'right',
      render: (p) => {
        const cur = itemMap.get(p.id)
        const val = edits[p.id] ?? (cur ? String(fromMinor(cur.price_minor)) : '')
        return (
          <input
            aria-label={`Price for ${p.sku}`}
            disabled={!canEdit}
            inputMode="decimal"
            placeholder={String(fromMinor(p.trade_price_minor))}
            value={val}
            onChange={(e) => setEdits((x) => ({ ...x, [p.id]: e.target.value }))}
            onBlur={() => void savePrice(p)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-9 w-28 rounded-lg border border-k-border bg-k-surface px-2 text-right text-sm focus:border-k-green focus:outline-none focus:ring-2 focus:ring-k-green/30"
          />
        )
      },
    },
  ]

  return (
    <>
      <Gate q={lists} isEmpty={!lists.data?.length} empty={<EmptyState title="No price lists" description="Create a list per store tier. Empty prices fall back to the product trade price." action={canEdit ? <Button onClick={() => setAdding(true)}>Create price list</Button> : undefined} />}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select aria-label="Price list" className="min-w-[220px]" value={listId} onChange={(e) => setSel(e.target.value)} options={(lists.data ?? []).map((l) => ({ value: l.id, label: `${l.name} (${l.tier}${l.is_default ? ', default' : ''})` }))} />
          {current ? <Badge tone={current.active ? 'green' : 'muted'}>{current.active ? 'Active' : 'Inactive'}</Badge> : null}
          {canEdit ? <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>New list</Button> : null}
        </div>
        <Card padding="none">
          <Gate q={items}>
            <Table columns={cols} rows={products.filter((p) => p.active)} rowKey={(p) => p.id} dense />
          </Gate>
        </Card>
        <p className="mt-2 text-xs text-k-muted">Type a price and press Enter or tab out to save. Clear the box to fall back to the trade price.</p>
      </Gate>
      <Modal open={adding} onClose={() => setAdding(false)} title="New price list" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={createList}>Create</Button></>}>
        <div className="space-y-3">
          <Input label="Name" value={nm} onChange={(e) => setNm(e.target.value)} />
          <Select label="Store tier" value={tier} onChange={(e) => setTier(e.target.value as PriceTier)} options={TIERS} />
          {err ? <p className="text-sm font-semibold text-k-red">{err}</p> : null}
        </div>
      </Modal>
    </>
  )
}
