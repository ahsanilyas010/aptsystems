import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, Modal, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { fromMinor, toMinor } from '../../lib/money'
import { useAuth } from '../../lib/auth'
import { uploadProductImage } from '../../lib/product-image'
import { ListingBadge } from '../lib/listing'
import type { KamaiProductsRow } from '../../lib/db-types'
import { errMsg, useRefreshAll } from '../lib/data'
import { padGtin14, validateGtin } from '../lib/gtin'

const HS_RE = /^[0-9]{4}\.[0-9]{2,4}$/
const SKU_RE = /^[A-Za-z0-9._-]{1,40}$/

interface Form {
  sku: string; name: string; name_ur: string; category: string; gtin: string; hs_code: string; fbr_uom: string
  tax: string; sale_type: string; third: boolean; retail: string; cost: string; trade: string; pack: string; active: boolean; image_url: string
}
const EMPTY: Form = { sku: '', name: '', name_ur: '', category: '', gtin: '', hs_code: '', fbr_uom: 'Numbers, pieces, units', tax: '18', sale_type: 'Goods at standard rate (default)', third: false, retail: '', cost: '', trade: '', pack: '', active: true, image_url: '' }

function fromRow(p: KamaiProductsRow): Form {
  return {
    sku: p.sku, name: p.name, name_ur: p.name_ur ?? '', category: p.category ?? '', gtin: p.gtin14 ?? '', hs_code: p.hs_code ?? '', fbr_uom: p.fbr_uom ?? '',
    tax: String(p.tax_rate_pct), sale_type: p.sale_type, third: p.is_third_schedule,
    retail: p.retail_price_minor != null ? String(fromMinor(p.retail_price_minor)) : '', cost: '',
    trade: String(fromMinor(p.trade_price_minor)), pack: p.pack_size ?? '', active: p.active, image_url: p.image_url ?? '',
  }
}

/** open: null = closed, 'new' = create, row = edit */
export function ProductModal({ product, onClose, tenantId }: { product: KamaiProductsRow | 'new' | null; onClose: () => void; tenantId: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const refresh = useRefreshAll()
  const [f, setF] = useState<Form>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [origCost, setOrigCost] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (product) setF(product === 'new' ? EMPTY : fromRow(product))
    setErr(null)
    setOrigCost('')
    if (product && product !== 'new') {
      // cost lives in kamai_product_costs (owner, manager, finance only); other roles simply get no row
      let live = true
      void supabase.from('kamai_product_costs').select('cost_price_minor').eq('product_id', product.id).maybeSingle().then(({ data }) => {
        if (!live || !data) return
        const c = String(fromMinor(data.cost_price_minor as number))
        setOrigCost(c)
        setF((p) => ({ ...p, cost: c }))
      })
      return () => { live = false }
    }
  }, [product])
  if (!product) return null
  const edit = product !== 'new' ? product : null
  const gtinErr = validateGtin(f.gtin)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function pickImage(file: File | undefined) {
    if (!file) return
    setErr(null)
    setUploading(true)
    try {
      const url = await uploadProductImage(tenantId, file)
      setF((p) => ({ ...p, image_url: url }))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    setErr(null)
    if (!SKU_RE.test(f.sku)) return setErr('SKU: letters, digits . _ - only (max 40)')
    if (!f.name.trim()) return setErr('Name is required')
    if (gtinErr) return setErr(gtinErr)
    if (f.hs_code && !HS_RE.test(f.hs_code)) return setErr('HS code format must be like 2106.9090')
    const tax = Number(f.tax)
    if (Number.isNaN(tax) || tax < 0 || tax > 100) return setErr('Tax rate must be 0 to 100')
    const digits = f.gtin.replace(/\D/g, '')
    const row = {
      tenant_id: tenantId,
      sku: f.sku.trim(),
      name: f.name.trim(),
      name_ur: f.name_ur.trim() || null,
      category: f.category.trim() || null,
      gtin14: padGtin14(f.gtin),
      gtin_type: digits ? digits.length : null,
      hs_code: f.hs_code.trim() || null,
      fbr_uom: f.fbr_uom.trim() || null,
      tax_rate_pct: tax,
      sale_type: f.sale_type.trim() || 'Goods at standard rate (default)',
      is_third_schedule: f.third,
      retail_price_minor: f.retail ? toMinor(f.retail) : null,
      trade_price_minor: toMinor(f.trade),
      pack_size: f.pack.trim() || null,
      image_url: f.image_url || null,
      active: f.active,
    }
    if (f.third && row.retail_price_minor == null) return setErr('Third schedule items need a retail price')
    setBusy(true)
    try {
      const res = edit
        ? await supabase.from('kamai_products').update(row).eq('id', edit.id).eq('tenant_id', tenantId).select('id').single()
        : await supabase.from('kamai_products').insert({ ...row, created_by: user?.id ?? null }).select('id').single()
      if (res.error) throw new Error(res.error.code === '23505' ? 'SKU or GTIN already exists' : res.error.message)
      if (f.cost !== origCost) {
        const pid = (res.data as { id: string }).id
        const cr = f.cost
          ? await supabase.from('kamai_product_costs').upsert({ product_id: pid, tenant_id: tenantId, cost_price_minor: toMinor(f.cost) }, { onConflict: 'product_id' })
          : await supabase.from('kamai_product_costs').delete().eq('product_id', pid)
        if (cr.error) throw new Error(`Product saved, but cost was not: ${cr.error.message}`)
      }
      toast.success(edit ? 'Product updated' : 'Product added')
      await refresh()
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={edit ? `Edit ${edit.sku}` : 'Add product'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={uploading}>Save product</Button>
        </>
      }
    >
      {edit && edit.review_note && (edit.listing_status === 'changes_requested' || edit.listing_status === 'rejected') ? (
        <div className="mb-3 rounded-lg bg-[#fff8e6] px-3 py-2 text-sm text-k-dark">
          <div className="mb-0.5 flex items-center gap-2 font-bold"><ListingBadge status={edit.listing_status} /> Review note</div>
          {edit.review_note}
        </div>
      ) : null}
      {edit && edit.listing_status === 'approved' ? (
        <p className="mb-3 rounded-lg bg-k-surface2 px-3 py-2 text-xs text-k-muted">This product is live. Changing its name, description, image or price sends it back to Draft and it must be submitted for review again.</p>
      ) : null}
      <div className="mb-3 flex items-center gap-3">
        {f.image_url ? <img src={f.image_url} alt="" className="h-20 w-20 rounded-xl border border-k-border object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-k-surface2 text-xs text-k-light">No image</div>}
        <div className="flex flex-col gap-1.5">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>{f.image_url ? 'Replace image' : 'Upload image'}</Button>
          {f.image_url ? <button type="button" className="text-left text-xs font-semibold text-k-red" onClick={() => setF((p) => ({ ...p, image_url: '' }))}>Remove</button> : null}
          <span className="text-[11px] text-k-light">JPG, PNG or WebP, up to 2 MB</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="SKU" value={f.sku} onChange={set('sku')} required disabled={!!edit} />
        <Input label="Pack size" value={f.pack} onChange={set('pack')} />
        <Input className="sm:col-span-2" label="Name" value={f.name} onChange={set('name')} required />
        <Input label="Name (Urdu)" dir="rtl" value={f.name_ur} onChange={set('name_ur')} />
        <Input label="Category" value={f.category} onChange={set('category')} />
        <Input label="GTIN" inputMode="numeric" value={f.gtin} onChange={set('gtin')} error={gtinErr ?? undefined} hint={f.gtin && !gtinErr ? `Stored as ${padGtin14(f.gtin)}` : '8, 12, 13 or 14 digits, padded to 14'} />
        <Input label="HS code" placeholder="2106.9090" value={f.hs_code} onChange={set('hs_code')} />
        <Input label="FBR unit of measure" value={f.fbr_uom} onChange={set('fbr_uom')} />
        <Input label="Sales tax rate (%)" inputMode="decimal" value={f.tax} onChange={set('tax')} />
        <Input className="sm:col-span-2" label="Sale type" value={f.sale_type} onChange={set('sale_type')} />
        <Input label="Trade price (Rs)" inputMode="decimal" value={f.trade} onChange={set('trade')} />
        <Input label="Cost price (Rs)" inputMode="decimal" value={f.cost} onChange={set('cost')} />
        <Input label="Retail price / MRP (Rs)" inputMode="decimal" value={f.retail} onChange={set('retail')} hint="Tax is charged on retail price for third-schedule items" />
        <div className="flex flex-col justify-end gap-2">
          <Checkbox label="Third schedule item" checked={f.third} onChange={(e) => setF((p) => ({ ...p, third: e.target.checked }))} />
          <Checkbox label="Active" checked={f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} />
        </div>
      </div>
      {err ? <p className="mt-3 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
    </Modal>
  )
}
