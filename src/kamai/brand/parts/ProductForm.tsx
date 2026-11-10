import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox, Input, Modal, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { fromMinor, toMinor } from '../../lib/money'
import type { KamaiProductsRow } from '../../lib/db-types'
import { HS_RE, errMsg, normaliseGtin, useTid } from '../lib/data'

interface Form {
  sku: string
  name: string
  category: string
  gtin: string
  hs_code: string
  tax: string
  mrp: string
  trade: string
  third: boolean
  image_url: string
  active: boolean
}

const EMPTY: Form = { sku: '', name: '', category: '', gtin: '', hs_code: '', tax: '18', mrp: '', trade: '', third: false, image_url: '', active: true }

function fromRow(p: KamaiProductsRow): Form {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category ?? '',
    gtin: p.gtin14 ?? '',
    hs_code: p.hs_code ?? '',
    tax: String(p.tax_rate_pct),
    mrp: p.retail_price_minor != null ? String(fromMinor(p.retail_price_minor)) : '',
    trade: String(fromMinor(p.trade_price_minor)),
    third: p.is_third_schedule,
    image_url: p.image_url ?? '',
    active: p.active,
  }
}

export function ProductForm({ open, product, onClose }: { open: boolean; product: KamaiProductsRow | null; onClose: () => void }) {
  const tid = useTid()
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState<Form>(EMPTY)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (open) {
      setF(product ? fromRow(product) : EMPTY)
      setTouched(false)
    }
  }, [open, product])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const g = normaliseGtin(f.gtin)
  const errors = {
    sku: !/^[A-Za-z0-9._-]{1,40}$/.test(f.sku) ? 'Letters, digits . _ - only, up to 40' : '',
    name: !f.name.trim() ? 'Required' : '',
    gtin: g.error ?? '',
    hs: f.hs_code && !HS_RE.test(f.hs_code) ? 'Format 0000.00 or 0000.0000' : '',
    tax: Number(f.tax) < 0 || Number(f.tax) > 100 || f.tax === '' ? '0 to 100' : '',
  }
  const invalid = Object.values(errors).some(Boolean)

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        tenant_id: tid,
        brand_tenant_id: tid,
        sku: f.sku.trim(),
        name: f.name.trim(),
        category: f.category.trim() || null,
        gtin14: g.gtin14,
        gtin_type: g.type,
        hs_code: f.hs_code.trim() || null,
        tax_rate_pct: Number(f.tax),
        retail_price_minor: f.mrp.trim() ? toMinor(f.mrp) : null,
        trade_price_minor: toMinor(f.trade),
        is_third_schedule: f.third,
        image_url: f.image_url.trim() || null,
        active: f.active,
      }
      const q = product
        ? supabase.from('kamai_products').update(payload).eq('id', product.id).eq('tenant_id', tid)
        : supabase.from('kamai_products').insert(payload)
      const { error } = await q
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success(product ? 'Product updated' : 'Product added')
      qc.invalidateQueries({ queryKey: ['brand', tid] })
      onClose()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  const show = (e: string) => (touched ? e || undefined : undefined)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Edit product' : 'Add product'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => (invalid ? setTouched(true) : save.mutate())}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="SKU" required value={f.sku} onChange={(e) => set('sku', e.target.value)} error={show(errors.sku)} disabled={!!product} />
        <Input label="Name" required value={f.name} onChange={(e) => set('name', e.target.value)} error={show(errors.name)} />
        <Input label="Category" value={f.category} onChange={(e) => set('category', e.target.value)} />
        <Input label="GTIN" inputMode="numeric" value={f.gtin} onChange={(e) => set('gtin', e.target.value)} error={show(errors.gtin)} hint={g.gtin14 ? `Stored as ${g.gtin14}` : '8, 12, 13 or 14 digits; padded to 14'} />
        <Input label="HS code" value={f.hs_code} onChange={(e) => set('hs_code', e.target.value)} error={show(errors.hs)} placeholder="1905.9090" />
        <Input label="Tax rate (%)" inputMode="decimal" value={f.tax} onChange={(e) => set('tax', e.target.value)} error={show(errors.tax)} />
        <Input label="MRP / retail price (Rs)" inputMode="decimal" value={f.mrp} onChange={(e) => set('mrp', e.target.value)} />
        <Input label="Trade price (Rs)" inputMode="decimal" value={f.trade} onChange={(e) => set('trade', e.target.value)} />
        <Input className="sm:col-span-2" label="Image URL" value={f.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://" />
        <Checkbox label="Third schedule item" description="Tax is charged on retail price" checked={f.third} onChange={(e) => set('third', e.target.checked)} />
        <Checkbox label="Active" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
      </div>
    </Modal>
  )
}
