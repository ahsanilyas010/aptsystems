import { useMemo, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, type Column } from '../../ui'
import { PKR } from '../../lib/format'
import type { KamaiProductsRow } from '../../lib/db-types'
import { CsvImport } from '../parts/CsvImport'
import { ProductForm } from '../parts/ProductForm'
import { errMsg, useBrandProducts, useTid } from '../lib/data'

export function Component() {
  const tid = useTid()
  const q = useBrandProducts()
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<KamaiProductsRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const own = useMemo(() => (q.data ?? []).filter((p) => p.tenant_id === tid), [q.data, tid])
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? own.filter((p) => [p.sku, p.name, p.gtin14, p.category].some((v) => v?.toLowerCase().includes(s))) : own
  }, [own, search])

  const cols: Column<KamaiProductsRow>[] = [
    { key: 'sku', header: 'SKU', render: (p) => (<div><div className="font-semibold text-k-dark">{p.name}</div><div className="text-xs text-k-muted">{p.sku}{p.category ? ` · ${p.category}` : ''}</div></div>) },
    { key: 'gtin', header: 'GTIN-14', hideOnMobile: true, render: (p) => p.gtin14 ?? '—' },
    { key: 'hs', header: 'HS', hideOnMobile: true, render: (p) => p.hs_code ?? '—' },
    { key: 'tax', header: 'Tax', align: 'right', hideOnMobile: true, render: (p) => `${p.tax_rate_pct}%${p.is_third_schedule ? ' · 3rd' : ''}` },
    { key: 'mrp', header: 'MRP', align: 'right', render: (p) => (p.retail_price_minor != null ? PKR(p.retail_price_minor) : '—') },
    { key: 'trade', header: 'Trade', align: 'right', hideOnMobile: true, render: (p) => PKR(p.trade_price_minor) },
    { key: 'st', header: '', render: (p) => <Badge tone={p.active ? 'green' : 'muted'}>{p.active ? 'Active' : 'Inactive'}</Badge> },
  ]

  return (
    <>
      <PageHeader
        title="Products"
        eyebrow="Brand"
        description="Your catalogue with FBR tax data. Distributors list these SKUs against their own prices."
        actions={
          <>
            <Button variant="secondary" icon={<Upload size={16} />} onClick={() => setImporting(true)}>Import CSV</Button>
            <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Add product</Button>
          </>
        }
      />
      {q.error ? (
        <Card><EmptyState title="Could not load products" description={errMsg(q.error)} /></Card>
      ) : q.isLoading ? (
        <Spinner label="Loading products…" />
      ) : own.length === 0 ? (
        <Card>
          <EmptyState
            title="No products yet"
            description="Add a product or import a CSV. Each SKU needs a valid GTIN and HS code so distributors can invoice it to FBR."
            action={<Button onClick={() => setAdding(true)}>Add your first product</Button>}
          />
        </Card>
      ) : (
        <Card padding="none">
          <div className="border-b border-k-border p-4"><Input placeholder="Search SKU, name, GTIN, category" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Table columns={cols} rows={rows} rowKey={(p) => p.id} onRowClick={setEdit} empty={<EmptyState compact title="No products match" />} />
        </Card>
      )}
      <ProductForm open={adding || !!edit} product={edit} onClose={() => { setAdding(false); setEdit(null) }} />
      <CsvImport open={importing} onClose={() => setImporting(false)} />
    </>
  )
}
