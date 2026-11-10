import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, MessageSquareWarning, X } from 'lucide-react'
import { Button, Card, EmptyState, Input, Select, Table, Textarea, useToast, type Column } from '../../ui'
import { PKR } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { uploadProductImage } from '../../lib/product-image'
import type { KamaiProductMarginsRow, KamaiProductsRow, ListingStatus, ReviewAction, ReviewPatch } from '../../lib/db-types'
import { ErrorState } from '../components/QueryState'
import { errMsg } from '../lib/tenants'
import { REVIEW_KEY, useRefreshReviews, useReviewQueue } from '../lib/reviews'
import { ReviewStatus, finalMinor, parseMargin, type Edit } from './review-helpers'

const FILTERS: Array<{ value: ListingStatus | 'all'; label: string }> = [
  { value: 'submitted', label: 'In review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Drafts' },
  { value: 'all', label: 'All' },
]

function useTenantProducts(tenantId: string) {
  return useQuery({
    queryKey: [...REVIEW_KEY, 'products', tenantId],
    enabled: !!tenantId,
    retry: false,
    staleTime: 10_000,
    queryFn: async () => {
      const [p, m] = await Promise.all([
        supabase.from('kamai_products').select('*').eq('tenant_id', tenantId).order('submitted_at', { ascending: true, nullsFirst: false }).limit(2000),
        supabase.from('kamai_product_margins').select('*').eq('tenant_id', tenantId).limit(5000),
      ])
      if (p.error) throw new Error(p.error.message)
      if (m.error) throw new Error(m.error.message)
      return {
        products: (p.data ?? []) as KamaiProductsRow[],
        margins: new Map(((m.data ?? []) as KamaiProductMarginsRow[]).map((r) => [r.product_id, r])),
      }
    },
  })
}

export function ReviewProducts({ tenantId, onTenant }: { tenantId: string; onTenant: (id: string) => void }) {
  const toast = useToast()
  const refresh = useRefreshReviews()
  const queue = useReviewQueue()
  const data = useTenantProducts(tenantId)
  const [filter, setFilter] = useState<ListingStatus | 'all'>('submitted')
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkMargin, setBulkMargin] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadFor = useRef<string | null>(null)

  const rows = useMemo(() => (data.data?.products ?? []).filter((p) => filter === 'all' || p.listing_status === filter), [data.data, filter])
  const margins = data.data?.margins

  const edit = (id: string, patch: Edit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }))
  const marginOf = (p: KamaiProductsRow): string => edits[p.id]?.margin ?? (margins?.get(p.id) ? String(margins.get(p.id)?.margin_pct) : '')
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  function patchOf(p: KamaiProductsRow): ReviewPatch {
    const e = edits[p.id] ?? {}
    const out: ReviewPatch = {}
    if (e.name !== undefined && e.name.trim() !== p.name) out.name = e.name.trim()
    if (e.category !== undefined && e.category.trim() !== (p.category ?? '')) out.category = e.category.trim()
    if (e.image_url !== undefined && e.image_url !== (p.image_url ?? '')) out.image_url = e.image_url
    if (e.description !== undefined && e.description.trim() !== (p.description ?? '')) out.description = e.description.trim()
    return out
  }

  async function review(p: KamaiProductsRow, action: ReviewAction) {
    const margin = parseMargin(marginOf(p))
    if (action === 'approve' && margin === null) return toast.error('Enter a margin between 0 and 500 before approving.')
    if (action !== 'approve' && !note.trim()) return toast.error('Write a review note so the distributor knows what to fix.')
    setBusy(p.id)
    try {
      const { error } = await supabase.rpc('kamai_review_product', {
        p_product_id: p.id,
        p_action: action,
        p_margin_pct: action === 'approve' ? margin : null,
        p_patch: patchOf(p),
        p_note: note.trim() || null,
      })
      if (error) throw new Error(error.message)
      toast.success(`${p.sku}: ${action === 'approve' ? 'approved and published' : action === 'reject' ? 'rejected' : 'changes requested'}`)
      setEdits(({ [p.id]: _drop, ...rest }) => rest)
      setPicked((s) => {
        const n = new Set(s)
        n.delete(p.id)
        return n
      })
      await refresh()
    } catch (e) {
      toast.error(errMsg(e), { title: 'Review failed' })
    } finally {
      setBusy(null)
    }
  }

  async function bulk(action: ReviewAction) {
    const sel = rows.filter((p) => picked.has(p.id))
    if (!sel.length) return
    if (action !== 'approve' && !note.trim()) return toast.error('Write a review note first.')
    setBusy('bulk')
    try {
      let done = 0
      let failed = 0
      if (action === 'approve') {
        const margins = sel.map((p) => parseMargin(marginOf(p)))
        if (margins.some((m) => m === null)) throw new Error('Every selected product needs a margin between 0 and 500 (use "Apply to selected").')
        const same = margins.every((m) => m === margins[0])
        const anyPatch = sel.some((p) => Object.keys(patchOf(p)).length > 0)
        if (same && !anyPatch) {
          const { data: r, error } = await supabase.rpc('kamai_review_products_bulk', { p_product_ids: sel.map((p) => p.id), p_action: 'approve', p_margin_pct: margins[0], p_note: note.trim() || null })
          if (error) throw new Error(error.message)
          done = r?.done ?? 0
          failed = r?.failed ?? 0
        } else {
          for (const p of sel) {
            const { error } = await supabase.rpc('kamai_review_product', { p_product_id: p.id, p_action: 'approve', p_margin_pct: parseMargin(marginOf(p)), p_patch: patchOf(p), p_note: note.trim() || null })
            if (error) failed += 1
            else done += 1
          }
        }
      } else {
        const { data: r, error } = await supabase.rpc('kamai_review_products_bulk', { p_product_ids: sel.map((p) => p.id), p_action: action, p_margin_pct: null, p_note: note.trim() })
        if (error) throw new Error(error.message)
        done = r?.done ?? 0
        failed = r?.failed ?? 0
      }
      if (failed) toast.warning(`${done} done, ${failed} failed`)
      else toast.success(`${done} product(s) updated`)
      setPicked(new Set())
      await refresh()
    } catch (e) {
      toast.error(errMsg(e), { title: 'Bulk review failed' })
    } finally {
      setBusy(null)
    }
  }

  function applyBulkMargin() {
    if (parseMargin(bulkMargin) === null) return toast.error('Margin must be between 0 and 500.')
    setEdits((e) => {
      const n = { ...e }
      for (const id of picked) n[id] = { ...n[id], margin: bulkMargin.trim() }
      return n
    })
  }

  async function onFile(file: File | undefined) {
    const id = uploadFor.current
    const p = rows.find((r) => r.id === id)
    if (!file || !p) return
    setBusy(p.id)
    try {
      edit(p.id, { image_url: await uploadProductImage(p.tenant_id, file) })
    } catch (e) {
      toast.error(errMsg(e), { title: 'Image upload failed' })
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const reviewable = (p: KamaiProductsRow) => p.listing_status !== 'draft'
  const cols: Column<KamaiProductsRow>[] = [
    {
      key: 'pick',
      width: 36,
      header: <input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((p) => picked.has(p.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.filter(reviewable).map((p) => p.id)) : new Set())} />,
      render: (p) => (reviewable(p) ? <input type="checkbox" aria-label={`Select ${p.sku}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /> : null),
    },
    {
      key: 'img',
      header: 'Image',
      width: 88,
      render: (p) => {
        const url = edits[p.id]?.image_url ?? p.image_url ?? ''
        return (
          <button type="button" className="group relative block" onClick={() => { uploadFor.current = p.id; fileRef.current?.click() }} aria-label={`Replace image for ${p.sku}`}>
            {url ? <img src={url} alt="" loading="lazy" className="h-16 w-16 rounded-lg border border-k-border object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-k-surface2 text-[10px] text-k-light">Add</div>}
            <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/55 text-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100">{busy === p.id ? '...' : 'Replace'}</span>
          </button>
        )
      },
    },
    {
      key: 'name',
      header: 'Title / category',
      className: 'min-w-[220px]',
      render: (p) => {
        const e = edits[p.id] ?? {}
        const o = p.original
        const wasName = o?.name && o.name !== p.name ? o.name : null
        return (
          <div className="flex flex-col gap-1.5">
            <input aria-label="Title" className="h-9 w-full rounded-lg border border-k-border bg-k-surface px-2 text-sm font-semibold" value={e.name ?? p.name} onChange={(ev) => edit(p.id, { name: ev.target.value })} />
            <input aria-label="Category" placeholder="Category" className="h-8 w-full rounded-lg border border-k-border bg-k-surface px-2 text-xs" value={e.category ?? p.category ?? ''} onChange={(ev) => edit(p.id, { category: ev.target.value })} />
            {'description' in p ? <textarea aria-label="Description" placeholder="Description" rows={2} className="w-full rounded-lg border border-k-border bg-k-surface px-2 py-1 text-xs" value={e.description ?? p.description ?? ''} onChange={(ev) => edit(p.id, { description: ev.target.value })} /> : null}
            <div className="text-[11px] text-k-muted">{p.sku}{wasName ? <span className="ml-1 text-[#b07800]">· submitted as “{wasName}”</span> : null}{Object.keys(patchOf(p)).length ? <span className="ml-1 font-bold text-[#2563eb]">· edited</span> : null}</div>
          </div>
        )
      },
    },
    { key: 'status', header: 'Status', render: (p) => <ReviewStatus p={p} /> },
    { key: 'dist', header: 'Their price', align: 'right', render: (p) => <span className="font-semibold">{PKR(p.trade_price_minor)}</span> },
    {
      key: 'margin',
      header: 'Margin %',
      width: 100,
      render: (p) => <input aria-label={`Margin for ${p.sku}`} inputMode="decimal" placeholder="0" className="h-9 w-20 rounded-lg border border-k-border bg-k-surface px-2 text-right text-sm" value={marginOf(p)} onChange={(ev) => edit(p.id, { margin: ev.target.value })} />,
    },
    {
      key: 'final',
      header: 'Final price',
      align: 'right',
      render: (p) => {
        const m = parseMargin(marginOf(p))
        return <span className="font-bold text-k-green">{m === null ? '—' : PKR(finalMinor(p.trade_price_minor, m))}</span>
      },
    },
    {
      key: 'act',
      header: '',
      align: 'right',
      render: (p) =>
        reviewable(p) ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" icon={<Check size={14} />} loading={busy === p.id} onClick={() => void review(p, 'approve')}>Approve</Button>
            <Button size="sm" variant="secondary" aria-label="Request changes" icon={<MessageSquareWarning size={14} />} disabled={busy === p.id} onClick={() => void review(p, 'request_changes')} />
            <Button size="sm" variant="danger" aria-label="Reject" icon={<X size={14} />} disabled={busy === p.id} onClick={() => void review(p, 'reject')} />
          </div>
        ) : <span className="text-xs text-k-light">Not submitted</span>,
    },
  ]

  if (queue.error) return <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <Select
          label="Distributor"
          value={tenantId}
          onChange={(e) => { onTenant(e.target.value); setPicked(new Set()); setEdits({}) }}
          placeholder="Choose a distributor"
          options={(queue.data ?? []).map((r) => ({ value: r.tenant_id, label: `${r.tenant_name}${r.submitted_count ? ` (${r.submitted_count} in review)` : ''}` }))}
        />
        <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value as ListingStatus | 'all')} options={FILTERS} />
        <div className="flex items-end gap-2">
          <Input label="Bulk margin %" inputMode="decimal" placeholder="e.g. 8" value={bulkMargin} onChange={(e) => setBulkMargin(e.target.value)} className="flex-1" />
          <Button variant="secondary" disabled={!picked.size} onClick={applyBulkMargin}>Apply to {picked.size || ''}</Button>
        </div>
      </div>
      <Textarea label="Review note (shown to the distributor for “changes” or “reject”)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="mb-3" />
      {picked.size ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-k-green-light px-3 py-2">
          <span className="text-sm font-bold text-k-dark">{picked.size} selected</span>
          <Button size="sm" icon={<Check size={14} />} loading={busy === 'bulk'} onClick={() => void bulk('approve')}>Approve</Button>
          <Button size="sm" variant="secondary" disabled={busy === 'bulk'} onClick={() => void bulk('request_changes')}>Request changes</Button>
          <Button size="sm" variant="danger" disabled={busy === 'bulk'} onClick={() => void bulk('reject')}>Reject</Button>
        </div>
      ) : null}
      {data.error ? <ErrorState error={data.error} onRetry={() => void data.refetch()} /> : null}
      {!data.error ? (
        <Card padding="none">
          <Table
            columns={cols}
            rows={rows}
            rowKey={(p) => p.id}
            loading={!!tenantId && data.isLoading}
            empty={<EmptyState title={tenantId ? 'No products in this view' : 'Pick a distributor'} description={tenantId ? 'Change the filter to see other statuses.' : 'Choose a distributor above to review their products.'} compact />}
          />
        </Card>
      ) : null}
      <p className="mt-2 text-xs text-k-muted">Final price = their price + margin, rounded up to the next paisa. The distributor never sees the margin or the final price.</p>
    </>
  )
}
