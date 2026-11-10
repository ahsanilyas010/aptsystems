import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Card, EmptyState, Input, PageHeader, Spinner, Table, type Column } from '../../ui'
import { PKR, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiPriceListItemsRow, KamaiPriceListsRow, KamaiProductsRow } from '../../lib/db-types'
import { chunk, errMsg, useBrandProducts, useTenantNames, useTid } from '../lib/data'

interface Listing {
  product: KamaiProductsRow
  prices: Array<{ list: string; tier: string; price: number }>
}

export function Component() {
  const tid = useTid()
  const products = useBrandProducts()
  const [search, setSearch] = useState('')
  const listed = useMemo(() => (products.data ?? []).filter((p) => p.brand_tenant_id === tid && p.tenant_id !== tid), [products.data, tid])
  const names = useTenantNames(listed.map((p) => p.tenant_id))

  const prices = useQuery({
    queryKey: ['brand', tid, 'listing-prices', listed.length],
    enabled: !!tid && listed.length > 0,
    queryFn: async () => {
      const items: KamaiPriceListItemsRow[] = []
      for (const part of chunk(listed.map((p) => p.id), 80)) {
        const { data, error } = await supabase.from('kamai_price_list_items').select('*').in('product_id', part).limit(10000)
        if (error) throw new Error(error.message)
        items.push(...((data ?? []) as KamaiPriceListItemsRow[]))
      }
      const lists = new Map<string, KamaiPriceListsRow>()
      for (const part of chunk([...new Set(items.map((i) => i.price_list_id))], 80)) {
        const { data, error } = await supabase.from('kamai_price_lists').select('*').in('id', part)
        if (error) throw new Error(error.message)
        for (const l of (data ?? []) as KamaiPriceListsRow[]) lists.set(l.id, l)
      }
      return { items, lists }
    },
  })

  const rows: Listing[] = useMemo(() => {
    const s = search.trim().toLowerCase()
    return listed
      .filter((p) => !s || [p.name, p.sku, names.data?.[p.tenant_id]].some((v) => v?.toLowerCase().includes(s)))
      .map((p) => ({
        product: p,
        prices: (prices.data?.items ?? [])
          .filter((i) => i.product_id === p.id)
          .map((i) => ({ list: prices.data?.lists.get(i.price_list_id)?.name ?? 'Price list', tier: prices.data?.lists.get(i.price_list_id)?.tier ?? '', price: i.price_minor })),
      }))
      .sort((a, b) => (names.data?.[a.product.tenant_id] ?? '').localeCompare(names.data?.[b.product.tenant_id] ?? '') || a.product.sku.localeCompare(b.product.sku))
  }, [listed, prices.data, names.data, search])

  const cols: Column<Listing>[] = [
    { key: 'dist', header: 'Distributor', render: (r) => <span className="font-semibold text-k-dark">{names.data?.[r.product.tenant_id] ?? `${r.product.tenant_id.slice(0, 8)}…`}</span> },
    { key: 'sku', header: 'Product', render: (r) => (<div><div>{r.product.name}</div><div className="text-xs text-k-muted">{r.product.sku}</div></div>) },
    { key: 'trade', header: 'Trade price', align: 'right', render: (r) => PKR(r.product.trade_price_minor) },
    {
      key: 'lists',
      header: 'Price lists',
      hideOnMobile: true,
      render: (r) =>
        r.prices.length === 0 ? <span className="text-k-light">—</span> : (
          <div className="flex flex-wrap gap-1.5">
            {r.prices.map((p, i) => <Badge key={i} tone="dark">{p.list}{p.tier && p.tier !== 'default' ? ` (${p.tier})` : ''}: {PKR(p.price)}</Badge>)}
          </div>
        ),
    },
    { key: 'st', header: 'Status', render: (r) => <Badge tone={r.product.active ? 'green' : 'muted'}>{humanize(r.product.active ? 'active' : 'inactive')}</Badge> },
  ]

  const err = products.error ?? prices.error
  return (
    <>
      <PageHeader title="Listings" eyebrow="Brand" description="Distributors that list your SKUs and the trade price they set. Read-only." />
      {err ? (
        <Card><EmptyState title="Could not load listings" description={errMsg(err)} /></Card>
      ) : products.isLoading ? (
        <Spinner label="Loading listings…" />
      ) : listed.length === 0 ? (
        <Card>
          <EmptyState
            title="No distributor listings yet"
            description="A listing appears when a distributor adds a product that points to your brand. Ask Kamai to link your tenant to your distributors, then share your SKU list with them."
          />
        </Card>
      ) : (
        <Card padding="none">
          <div className="border-b border-k-border p-4"><Input placeholder="Search distributor, SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Table columns={cols} rows={rows} rowKey={(r) => r.product.id} loading={prices.isLoading} empty={<EmptyState compact title="No listings match" />} />
        </Card>
      )}
    </>
  )
}
