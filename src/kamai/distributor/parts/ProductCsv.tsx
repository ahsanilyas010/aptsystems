import { useState } from 'react'
import { z } from 'zod'
import { Upload } from 'lucide-react'
import { Badge, Button, Modal, Table, useToast } from '../../ui'
import type { Column } from '../../ui'
import { downloadRowsAsCsv, parseCsv } from '../../lib/csv'
import { fromMinor, toMinor } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { KamaiProductsRow } from '../../lib/db-types'
import { errMsg, useRefreshAll } from '../lib/data'
import { padGtin14, validateGtin } from '../lib/gtin'

export const PRODUCT_CSV_COLUMNS = ['sku', 'name', 'name_ur', 'category', 'gtin', 'hs_code', 'fbr_uom', 'tax_rate_pct', 'sale_type', 'is_third_schedule', 'retail_price', 'cost_price', 'trade_price', 'pack_size', 'active'] as const

export function exportProducts(rows: KamaiProductsRow[], costs: Record<string, number> = {}) {
  const data = rows.map((p) => ({
    sku: p.sku, name: p.name, name_ur: p.name_ur ?? '', category: p.category ?? '', gtin: p.gtin14 ?? '', hs_code: p.hs_code ?? '', fbr_uom: p.fbr_uom ?? '',
    tax_rate_pct: p.tax_rate_pct, sale_type: p.sale_type, is_third_schedule: p.is_third_schedule ? 'yes' : 'no',
    retail_price: p.retail_price_minor != null ? fromMinor(p.retail_price_minor) : '', cost_price: costs[p.id] != null ? fromMinor(costs[p.id]) : '',
    trade_price: fromMinor(p.trade_price_minor), pack_size: p.pack_size ?? '', active: p.active ? 'yes' : 'no',
  }))
  downloadRowsAsCsv('kamai-products', data as unknown as Array<Record<string, unknown>>, [...PRODUCT_CSV_COLUMNS])
}

const yes = (v: unknown) => /^(1|y|yes|true)$/i.test(String(v ?? '').trim())
const optNum = z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(/[^0-9.-]/g, ''))), z.number().min(0).optional())

const Schema = z.object({
  sku: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/, 'invalid sku'),
  name: z.string().trim().min(1, 'name required').max(200),
  name_ur: z.string().trim().optional(),
  category: z.string().trim().optional(),
  gtin: z.string().trim().optional().refine((v) => !v || validateGtin(v) === null, 'GTIN invalid'),
  hs_code: z.string().trim().optional().refine((v) => !v || /^[0-9]{4}\.[0-9]{2,4}$/.test(v), 'HS code like 2106.9090'),
  fbr_uom: z.string().trim().optional(),
  tax_rate_pct: z.preprocess((v) => (v === '' || v == null ? 0 : Number(v)), z.number().min(0).max(100)),
  sale_type: z.string().trim().optional(),
  is_third_schedule: z.any().transform(yes),
  retail_price: optNum,
  cost_price: optNum,
  trade_price: z.preprocess((v) => (v === '' || v == null ? 0 : Number(String(v).replace(/[^0-9.-]/g, ''))), z.number().min(0)),
  pack_size: z.string().trim().optional(),
  active: z.any().transform((v) => (v === '' || v == null ? true : yes(v))),
})

interface Parsed { line: number; raw: Record<string, string>; data?: z.infer<typeof Schema>; errors: string[] }

export function ImportProductsModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const refresh = useRefreshAll()
  const [rows, setRows] = useState<Parsed[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = rows.filter((r) => !r.errors.length)

  async function onFile(f: File | undefined) {
    if (!f) return
    setErr(null)
    try {
      const res = await parseCsv<Record<string, string>>(f)
      if (!res.fields.includes('sku') || !res.fields.includes('name')) throw new Error(`CSV needs sku and name columns. Expected: ${PRODUCT_CSV_COLUMNS.join(',')}`)
      const seen = new Set<string>()
      setRows(res.rows.map((raw, i) => {
        const p = Schema.safeParse(raw)
        const errors = p.success ? [] : p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`)
        if (p.success) {
          if (p.data.is_third_schedule && p.data.retail_price == null) errors.push('third schedule needs retail_price')
          if (seen.has(p.data.sku)) errors.push('duplicate sku in file')
          seen.add(p.data.sku)
        }
        return { line: i + 2, raw, data: p.success ? p.data : undefined, errors }
      }))
      setName(f.name)
    } catch (e) {
      setErr(errMsg(e))
      setRows([])
    }
  }

  async function run() {
    setBusy(true)
    setErr(null)
    try {
      const payload = valid.map((r) => {
        const d = r.data!
        const digits = (d.gtin ?? '').replace(/\D/g, '')
        return {
          tenant_id: tenantId, sku: d.sku, name: d.name, name_ur: d.name_ur || null, category: d.category || null,
          gtin14: padGtin14(digits), gtin_type: digits ? digits.length : null, hs_code: d.hs_code || null, fbr_uom: d.fbr_uom || null,
          tax_rate_pct: d.tax_rate_pct, sale_type: d.sale_type || 'Goods at standard rate (default)', is_third_schedule: d.is_third_schedule,
          retail_price_minor: d.retail_price != null ? toMinor(d.retail_price) : null,
          trade_price_minor: toMinor(d.trade_price), pack_size: d.pack_size || null, active: d.active, created_by: user?.id ?? null,
        }
      })
      for (let i = 0; i < payload.length; i += 200) {
        const { data: saved, error } = await supabase.from('kamai_products').upsert(payload.slice(i, i + 200), { onConflict: 'tenant_id,sku' }).select('id,sku')
        if (error) throw new Error(`Batch ${i / 200 + 1}: ${error.message}`)
        const idBySku = new Map((saved ?? []).map((r) => [r.sku as string, r.id as string]))
        const costRows = valid.slice(i, i + 200).flatMap((r) => {
          const pid = idBySku.get(r.data!.sku)
          return pid && r.data!.cost_price != null ? [{ product_id: pid, tenant_id: tenantId, cost_price_minor: toMinor(r.data!.cost_price) }] : []
        })
        if (costRows.length) {
          const cr = await supabase.from('kamai_product_costs').upsert(costRows, { onConflict: 'product_id' })
          if (cr.error) throw new Error(`Batch ${i / 200 + 1} costs: ${cr.error.message}`)
        }
      }
      toast.success(`${payload.length} products imported`)
      await refresh()
      setRows([])
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<Parsed>[] = [
    { key: 'l', header: 'Line', width: 56, render: (r) => r.line },
    { key: 'sku', header: 'SKU', render: (r) => r.raw.sku },
    { key: 'n', header: 'Name', hideOnMobile: true, render: (r) => r.raw.name },
    { key: 'r', header: 'Result', render: (r) => (r.errors.length ? <span className="text-xs font-semibold text-k-red">{r.errors.join('; ')}</span> : <Badge tone="green">OK</Badge>) },
  ]
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Import products from CSV" description={`Columns: ${PRODUCT_CSV_COLUMNS.join(', ')}. Existing SKUs are updated. Prices in rupees.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={run} loading={busy} disabled={!valid.length}>Import {valid.length} rows</Button></>}>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-k-border bg-k-surface2 px-4 py-6 text-sm font-semibold text-k-muted hover:border-k-green">
        <Upload size={18} />{name || 'Choose a CSV file'}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {err ? <p className="mt-3 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      {rows.length ? (
        <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-k-border">
          <Table columns={cols} rows={rows} rowKey={(r) => r.line} dense stickyHeader />
        </div>
      ) : null}
    </Modal>
  )
}
