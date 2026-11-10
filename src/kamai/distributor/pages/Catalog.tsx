import { useMemo, useState } from 'react'
import { Download, Plus, Search, Upload } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Table, Tabs } from '../../ui'
import type { Column } from '../../ui'
import { PKR } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiProductsRow } from '../../lib/db-types'
import { ErrorState, NoTenant, useCan, useProducts, useTenantId } from '../lib/data'
import { PriceLists } from '../parts/PriceLists'
import { ProductModal } from '../parts/ProductModal'
import { ImportProductsModal, exportProducts } from '../parts/ProductCsv'

type Tab = 'products' | 'prices'

export function Component() {
  const tid = useTenantId()
  const canEdit = useCan(['owner', 'manager'])
  const prods = useProducts()
  const [tab, setTab] = useState<Tab>('products')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<KamaiProductsRow | 'new' | null>(null)
  const [imp, setImp] = useState(false)

  async function exportWithCosts() {
    // cost prices live in kamai_product_costs (owner, manager, finance); other roles export without them
    const { data } = await supabase.from('kamai_product_costs').select('product_id,cost_price_minor').eq('tenant_id', tid as string)
    exportProducts(prods.rows, Object.fromEntries((data ?? []).map((r) => [r.product_id as string, r.cost_price_minor as number])))
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? prods.rows.filter((p) => [p.sku, p.name, p.category, p.gtin14, p.hs_code].some((v) => v?.toLowerCase().includes(s))) : prods.rows
  }, [prods.rows, q])

  if (!tid) return <NoTenant />

  const cols: Column<KamaiProductsRow>[] = [
    { key: 'sku', header: 'SKU', render: (p) => <span className="font-mono text-xs font-semibold">{p.sku}</span> },
    { key: 'name', header: 'Product', render: (p) => (<div><div className="font-semibold text-k-dark">{p.name}</div><div className="text-xs text-k-muted">{p.category ?? '—'}{p.pack_size ? ` · ${p.pack_size}` : ''}</div></div>) },
    { key: 'gtin', header: 'GTIN', hideOnMobile: true, render: (p) => <span className="font-mono text-xs">{p.gtin14 ?? '—'}</span> },
    { key: 'hs', header: 'HS code', hideOnMobile: true, render: (p) => p.hs_code ?? <Badge tone="amber" size="sm">Missing</Badge> },
    { key: 'tax', header: 'Tax', hideOnMobile: true, align: 'right', render: (p) => `${p.tax_rate_pct}%${p.is_third_schedule ? ' (3rd sch)' : ''}` },
    { key: 'retail', header: 'Retail', hideOnMobile: true, align: 'right', render: (p) => (p.retail_price_minor != null ? PKR(p.retail_price_minor) : '—') },
    { key: 'trade', header: 'Trade', align: 'right', render: (p) => <span className="font-semibold">{PKR(p.trade_price_minor)}</span> },
    { key: 'active', header: '', render: (p) => (p.active ? null : <Badge tone="muted">Inactive</Badge>) },
  ]

  return (
    <>
      <PageHeader
        title="Catalog"
        eyebrow="Distributor"
        description="Products with FBR fields, price lists and tier prices."
        actions={
          <>
            <Button variant="secondary" icon={<Download size={15} />} onClick={() => void exportWithCosts()} disabled={!prods.rows.length}>Export CSV</Button>
            {canEdit ? (
              <>
                <Button variant="secondary" icon={<Upload size={15} />} onClick={() => setImp(true)}>Import CSV</Button>
                <Button icon={<Plus size={15} />} onClick={() => setEdit('new')}>Add product</Button>
              </>
            ) : null}
          </>
        }
      >
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ key: 'products', label: 'Products', badge: prods.rows.length }, { key: 'prices', label: 'Price lists' }]} />
      </PageHeader>
      {prods.isError ? <ErrorState error={prods.error} onRetry={() => void prods.refetch()} /> : null}
      {!prods.isError && tab === 'products' ? (
        <>
          <Input aria-label="Search products" className="mb-3 max-w-md" placeholder="Search SKU, name, category, GTIN, HS code" prefix={<Search size={15} />} value={q} onChange={(e) => setQ(e.target.value)} />
          <Card padding="none">
            <Table columns={cols} rows={rows} rowKey={(p) => p.id} loading={prods.isLoading} onRowClick={canEdit ? setEdit : undefined} empty={<EmptyState title="No products" description="Add a product or import a CSV." />} />
          </Card>
        </>
      ) : null}
      {!prods.isError && tab === 'prices' ? <PriceLists products={prods.rows} tenantId={tid} canEdit={canEdit} /> : null}
      <ProductModal product={edit} onClose={() => setEdit(null)} tenantId={tid} />
      <ImportProductsModal open={imp} onClose={() => setImp(false)} tenantId={tid} />
    </>
  )
}
