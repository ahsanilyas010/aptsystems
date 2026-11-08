import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Badge, Button, Modal, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { downloadCsv, parseCsv } from '../../lib/csv'
import { toMinor } from '../../lib/money'
import { HS_RE, chunk, errMsg, normaliseGtin, useTid } from '../lib/data'

const HEADERS = ['sku', 'name', 'category', 'gtin', 'hs_code', 'tax_rate_pct', 'mrp', 'trade_price', 'third_schedule', 'image_url']

export function downloadTemplate() {
  // Leading apostrophe-free: GTIN/HS are plain text columns; open the file as text in Excel (Data > From Text) to keep leading zeros.
  const text = [HEADERS.join(','), '"BR-001","Sample biscuit 50g","Biscuits","08901234567897","1905.9090","18","50","42","no","https://example.com/a.jpg"'].join('\n')
  downloadCsv('kamai-products-template.csv', text)
}

interface Parsed {
  line: number
  payload?: Record<string, unknown>
  error?: string
  sku: string
}

export function CsvImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tid = useTid()
  const toast = useToast()
  const qc = useQueryClient()
  const [rows, setRows] = useState<Parsed[]>([])
  const [fileErr, setFileErr] = useState('')

  async function onFile(file: File | undefined) {
    setFileErr('')
    setRows([])
    if (!file) return
    try {
      const res = await parseCsv(file)
      const missing = ['sku', 'name'].filter((h) => !res.fields.includes(h))
      if (missing.length) return setFileErr(`Missing column: ${missing.join(', ')}`)
      setRows(
        res.rows.map((r, i) => {
          const g = normaliseGtin(r.gtin ?? '')
          const sku = (r.sku ?? '').trim()
          const tax = r.tax_rate_pct ? Number(r.tax_rate_pct) : 0
          const error = !/^[A-Za-z0-9._-]{1,40}$/.test(sku) ? 'Invalid SKU' : !r.name ? 'Name required' : g.error ? g.error : r.hs_code && !HS_RE.test(r.hs_code) ? 'HS code format 0000.00' : !(tax >= 0 && tax <= 100) ? 'Tax rate 0-100' : undefined
          return {
            line: i + 2,
            sku,
            error,
            payload: error
              ? undefined
              : {
                  tenant_id: tid,
                  brand_tenant_id: tid,
                  sku,
                  name: r.name,
                  category: r.category || null,
                  gtin14: g.gtin14,
                  gtin_type: g.type,
                  hs_code: r.hs_code || null,
                  tax_rate_pct: tax,
                  retail_price_minor: r.mrp ? toMinor(r.mrp) : null,
                  trade_price_minor: toMinor(r.trade_price),
                  is_third_schedule: /^(yes|y|true|1)$/i.test(r.third_schedule ?? ''),
                  image_url: r.image_url || null,
                },
          }
        }),
      )
    } catch (e) {
      setFileErr(errMsg(e))
    }
  }

  const good = rows.filter((r) => r.payload)
  const imp = useMutation({
    mutationFn: async () => {
      for (const part of chunk(good.map((r) => r.payload as Record<string, unknown>), 100)) {
        const { error } = await supabase.from('kamai_products').upsert(part as never, { onConflict: 'tenant_id,sku' })
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => {
      toast.success(`${good.length} products imported`)
      qc.invalidateQueries({ queryKey: ['brand', tid] })
      setRows([])
      onClose()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Import products from CSV"
      description="Existing SKUs are updated. GTIN and HS code are read as text so leading zeros are kept."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={imp.isPending} disabled={good.length === 0} onClick={() => imp.mutate()}>Import {good.length || ''} rows</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={downloadTemplate}>Download template</Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-k-border px-3 py-1.5 text-xs font-semibold text-k-dark hover:bg-k-surface2">
            <Upload size={14} /> Choose CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        <p className="text-xs text-k-muted">Columns: {HEADERS.join(', ')}. Required: sku, name. Money in rupees; third_schedule is yes or no.</p>
        {fileErr ? <p className="text-sm font-semibold text-k-red">{fileErr}</p> : null}
        {rows.length ? (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-k-border">
            {rows.map((r) => (
              <div key={r.line} className="flex items-center justify-between gap-3 border-b border-k-border px-3 py-1.5 text-[13px] last:border-b-0">
                <span>Line {r.line} · {r.sku || '(no sku)'}</span>
                {r.error ? <Badge tone="red">{r.error}</Badge> : <Badge tone="green">OK</Badge>}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
