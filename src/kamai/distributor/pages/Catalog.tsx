import { useMemo, useState } from 'react'
import { Download, Plus, Search, Send, Upload } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Table, Tabs, useToast } from '../../ui'
import type { Column } from '../../ui'
import { PKR } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiProductsRow } from '../../lib/db-types'
import { notifyAdmin } from '../../lib/api'
import { ErrorState, NoTenant, errMsg, rpc, useCan, useProducts, useRefreshAll, useTenantId } from '../lib/data'
import { ListingBadge, OnboardingBanner, useOnboarding } from '../lib/listing'
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
  const toast = useToast()
  const refresh = useRefreshAll()
  const onb = useOnboarding()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  async function exportWithCosts() {
    // cost prices live in kamai_product_costs (owner, manager, finance); other roles export without them
    const { data } = await supabase.from('kamai_product_costs').select('product_id,cost_price_minor').eq('tenant_id', tid as string)
    exportProducts(prods.rows, Object.fromEntries((data ?? []).map((r) => [r.product_id as string, r.cost_price_minor as number])))
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? prods.rows.filter((p) => [p.sku, p.name, p.category, p.gtin14, p.hs_code].some((v) => v?.toLowerCase().includes(s))) : prods.rows
  }, [prods.rows, q])

  const submittable = (p: KamaiProductsRow) => p.listing_status === 'draft' || p.listing_status === 'changes_requested'
  const pickedIds = rows.filter((p) => picked.has(p.id) && submittable(p)).map((p) => p.id)
  const allSubmittable = rows.filter(submittable)

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function submitForReview(ids: string[]) {
    if (!ids.length) return
    setSubmitting(true)
    try {
      const r = await rpc<{ submitted: number }>('kamai_submit_products', { p_product_ids: ids })
      toast.success(`${r?.submitted ?? ids.length} product(s) submitted for review`)
      setPicked(new Set())
      notifyAdmin()
      await refresh()
    } catch (e) {
      toast.error(errMsg(e), { title: 'Could not submit' })
    } finally {
      setSubmitting(false)
    }
  }

  function openRow(p: KamaiProductsRow) {
    if (p.listing_status === 'submitted') {
      toast.info('This product is in review and cannot be edited until the review is done.')
      return
    }
    setEdit(p)
  }

  if (!tid) return <NoTenant />

  const cols: Column<KamaiProductsRow>[] = [
    ...(canEdit
      ? [{
          key: 'pick',
          width: 40,
          header: (
            <input
              type="checkbox"
              aria-label="Select all drafts"
              disabled={!allSubmittable.length}
              checked={allSubmittable.length > 0 && allSubmittable.every((p) => picked.has(p.id))}
              onChange={(e) => setPicked(e.target.checked ? new Set(allSubmittable.map((p) => p.id)) : new Set())}
            />
          ),
          render: (p: KamaiProductsRow) =>
            submittable(p) ? (
              <span onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label={`Select ${p.sku}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              </span>
            ) : null,
        } satisfies Column<KamaiProductsRow>]
      : []),
    { key: 'img', header: '', width: 48, render: (p) => (p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-10 w-10 rounded-lg border border-k-border object-cover" /> : <div className="h-10 w-10 rounded-lg bg-k-surface2" />) },
    { key: 'sku', header: 'SKU', render: (p) => <span className="font-mono text-xs font-semibold">{p.sku}</span> },
    { key: 'name', header: 'Product', render: (p) => (<div><div className="font-semibold text-k-dark">{p.name}</div><div className="text-xs text-k-muted">{p.category ?? '—'}{p.pack_size ? ` · ${p.pack_size}` : ''}</div></div>) },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <div className="max-w-[220px]">
          <ListingBadge status={p.listing_status} />
          {p.review_note && (p.listing_status === 'changes_requested' || p.listing_status === 'rejected') ? <div className="mt-1 whitespace-normal text-xs text-k-muted">{p.review_note}</div> : null}
        </div>
      ),
    },
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
            {canEdit ? (
              <Button icon={<Send size={15} />} loading={submitting} disabled={!(pickedIds.length || allSubmittable.length)} onClick={() => void submitForReview(pickedIds.length ? pickedIds : allSubmittable.map((p) => p.id))}>
                {pickedIds.length ? `Submit ${pickedIds.length} for review` : 'Submit all drafts'}
              </Button>
            ) : null}
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
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ key: 'products', label: 'Products', badge: prods.rows.length }, ...(onb.hidePriceLists ? [] : [{ key: 'prices' as const, label: 'Price lists' }])]} />
      </PageHeader>
      <OnboardingBanner />
      {prods.isError ? <ErrorState error={prods.error} onRetry={() => void prods.refetch()} /> : null}
      {!prods.isError && tab === 'products' ? (
        <>
          <Input aria-label="Search products" className="mb-3 max-w-md" placeholder="Search SKU, name, category, GTIN, HS code" prefix={<Search size={15} />} value={q} onChange={(e) => setQ(e.target.value)} />
          <Card padding="none">
            <Table columns={cols} rows={rows} rowKey={(p) => p.id} loading={prods.isLoading} onRowClick={canEdit ? openRow : undefined} empty={<EmptyState title="No products" description="Add a product or import a CSV." />} />
          </Card>
        </>
      ) : null}
      {!prods.isError && tab === 'prices' && !onb.hidePriceLists ? <PriceLists products={prods.rows} tenantId={tid} canEdit={canEdit} /> : null}
      <ProductModal product={edit} onClose={() => setEdit(null)} tenantId={tid} />
      <ImportProductsModal open={imp} onClose={() => setImp(false)} tenantId={tid} />
    </>
  )
}
