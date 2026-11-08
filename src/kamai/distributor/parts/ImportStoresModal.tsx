import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Upload } from 'lucide-react'
import { Badge, Button, Modal, Table, useToast } from '../../ui'
import type { Column } from '../../ui'
import { parseCsv } from '../../lib/csv'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { errMsg, useRefreshAll, useStores, useTenantRow } from '../lib/data'
import { nextRefCodes, normMobile } from '../lib/phone'

const num = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(min).max(max).optional())

const RowSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  owner_name: z.string().trim().optional(),
  mobile: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? normMobile(v) : null))
    .refine((v) => v !== undefined, 'mobile invalid'),
  address: z.string().trim().optional(),
  area: z.string().trim().optional(),
  latitude: num(-90, 90),
  longitude: num(-180, 180),
  category: z.string().trim().optional(),
  tier: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(['A', 'B', 'C', 'default']).optional()),
  payment_terms_days: z.preprocess((v) => (v === '' || v == null ? 0 : Number(v)), z.number().int().min(0).max(90)),
})

interface Parsed {
  line: number
  raw: Record<string, string>
  data?: z.infer<typeof RowSchema>
  errors: string[]
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function ImportStoresModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const refresh = useRefreshAll()
  const stores = useStores()
  const tenant = useTenantRow()
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null)
  const [rows, setRows] = useState<Parsed[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const existingMobiles = useMemo(() => new Set(stores.rows.map((s) => s.mobile).filter(Boolean)), [stores.rows])
  const valid = rows.filter((r) => r.errors.length === 0)

  async function onFile(f: File | undefined) {
    if (!f) return
    setErr(null)
    try {
      const text = await f.text()
      const hash = await sha256(text)
      const res = await parseCsv<Record<string, string>>(text)
      if (!res.fields.includes('name')) throw new Error('CSV needs a "name" column. Expected: name,owner_name,mobile,address,area,latitude,longitude,category,tier,payment_terms_days')
      const seen = new Set<string>()
      const parsed: Parsed[] = res.rows.map((raw, i) => {
        const p = RowSchema.safeParse(raw)
        const errors = p.success ? [] : p.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`)
        if (p.success && p.data.mobile) {
          if (existingMobiles.has(p.data.mobile)) errors.push('mobile already exists')
          else if (seen.has(p.data.mobile)) errors.push('duplicate mobile in file')
          seen.add(p.data.mobile)
        }
        return { line: i + 2, raw, data: p.success ? p.data : undefined, errors }
      })
      setRows(parsed)
      setFile({ name: f.name, hash })
    } catch (e) {
      setErr(errMsg(e))
      setRows([])
      setFile(null)
    }
  }

  async function run() {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const failed = rows.filter((r) => r.errors.length)
      const { data: imp, error: ie } = await supabase
        .from('kamai_store_imports')
        .insert({ tenant_id: tenantId, file_name: file.name, file_hash: file.hash, rows_total: rows.length, rows_failed: failed.length, errors: failed.map((r) => ({ line: r.line, errors: r.errors })), status: 'pending', created_by: user?.id ?? null })
        .select('id')
        .single()
      if (ie) throw new Error(ie.code === '23505' ? 'This exact file was already imported' : ie.message)
      const codes = nextRefCodes(tenant.data?.slug ?? 'store', stores.rows.map((s) => s.payment_ref_code), valid.length)
      const payload = valid.map((r, i) => ({
        tenant_id: tenantId,
        name: r.data!.name,
        owner_name: r.data!.owner_name || null,
        mobile: r.data!.mobile ?? null,
        address: r.data!.address || null,
        area: r.data!.area || null,
        latitude: r.data!.latitude ?? null,
        longitude: r.data!.longitude ?? null,
        category: r.data!.category || null,
        tier: r.data!.tier ?? 'default',
        payment_terms_days: r.data!.payment_terms_days,
        payment_ref_code: codes[i],
        created_by: user?.id ?? null,
      }))
      let created = 0
      const batchErrors: Array<{ batch: number; error: string }> = []
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await supabase.from('kamai_stores').insert(payload.slice(i, i + 200))
        if (error) batchErrors.push({ batch: i / 200 + 1, error: error.message })
        else created += Math.min(200, payload.length - i)
      }
      await supabase
        .from('kamai_store_imports')
        .update({ rows_created: created, rows_failed: failed.length + (payload.length - created), status: batchErrors.length && !created ? 'failed' : 'done', errors: [...failed.map((r) => ({ line: r.line, errors: r.errors })), ...batchErrors] })
        .eq('id', imp.id)
      if (batchErrors.length) toast.warning(`${created} stores created, ${payload.length - created} failed: ${batchErrors[0].error}`)
      else toast.success(`${created} stores imported`)
      await refresh()
      setRows([])
      setFile(null)
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<Parsed>[] = [
    { key: 'line', header: 'Line', width: 56, render: (r) => r.line },
    { key: 'name', header: 'Name', render: (r) => r.raw.name },
    { key: 'mobile', header: 'Mobile', hideOnMobile: true, render: (r) => r.raw.mobile },
    { key: 'area', header: 'Area', hideOnMobile: true, render: (r) => r.raw.area },
    { key: 'res', header: 'Result', render: (r) => (r.errors.length ? <span className="text-xs font-semibold text-k-red">{r.errors.join('; ')}</span> : <Badge tone="green">OK</Badge>) },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Import stores from CSV"
      description="Columns: name, owner_name, mobile, address, area, latitude, longitude, category, tier, payment_terms_days"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} loading={busy} disabled={!valid.length}>Import {valid.length} valid rows</Button>
        </>
      }
    >
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-k-border bg-k-surface2 px-4 py-6 text-sm font-semibold text-k-muted hover:border-k-green">
        <Upload size={18} />
        {file ? file.name : 'Choose a CSV file'}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {err ? <p className="mt-3 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      {rows.length ? (
        <div className="mt-4">
          <div className="mb-2 flex gap-2 text-xs">
            <Badge tone="green">{valid.length} valid</Badge>
            <Badge tone={rows.length - valid.length ? 'red' : 'muted'}>{rows.length - valid.length} with errors</Badge>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-k-border">
            <Table columns={cols} rows={rows} rowKey={(r) => r.line} dense stickyHeader />
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
