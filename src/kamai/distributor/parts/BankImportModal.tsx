import { useEffect, useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { Badge, Button, Modal, Select, Input, useToast } from '../../ui'
import { parseCsv } from '../../lib/csv'
import { supabase } from '../../lib/supabase'
import { toMinor } from '../../lib/money'
import type { BankLineInput, Json } from '../../lib/db-types'
import { errMsg, rpc, useRefreshAll, useTenantRow } from '../lib/data'

interface Mapping { date: string; narration: string; amount: string; credit: string; debit: string; ref: string; bank_name: string }
const EMPTY: Mapping = { date: '', narration: '', amount: '', credit: '', debit: '', ref: '', bank_name: '' }

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function parseBankDate(s: string): string | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function BankImportModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const tenant = useTenantRow()
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null)
  const [map, setMap] = useState<Mapping>(EMPTY)
  const [save, setSave] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setRows([]); setHeaders([]); setFile(null); setErr(null); setResult(null) }
  }, [open])
  useEffect(() => {
    const saved = (tenant.data?.settings as { bank_csv_mapping?: Partial<Mapping> } | null)?.bank_csv_mapping
    if (saved) setMap({ ...EMPTY, ...saved })
  }, [tenant.data])

  const lines = useMemo(() => {
    const out: BankLineInput[] = []
    let bad = 0
    for (const r of rows) {
      const date = map.date ? parseBankDate(r[map.date] ?? '') : null
      let amt = 0
      let direction: 'credit' | 'debit' = 'credit'
      if (map.credit || map.debit) {
        const c = map.credit ? num(r[map.credit]) : 0
        const d = map.debit ? num(r[map.debit]) : 0
        if (c > 0) { amt = c; direction = 'credit' } else if (d > 0) { amt = d; direction = 'debit' }
      } else if (map.amount) {
        const a = num(r[map.amount])
        amt = Math.abs(a); direction = a < 0 ? 'debit' : 'credit'
      }
      if (!date || amt <= 0) { bad++; continue }
      out.push({ line_date: date, narration: map.narration ? r[map.narration] : undefined, amount_minor: toMinor(amt), direction, bank_ref: map.ref ? r[map.ref] || undefined : undefined })
    }
    return { out, bad }
  }, [rows, map])

  async function onFile(f: File | undefined) {
    if (!f) return
    setErr(null)
    try {
      const text = await f.text()
      const res = await parseCsv<Record<string, string>>(text, { normalizeHeaders: false })
      if (!res.rows.length) throw new Error('The file has no rows')
      setHeaders(res.fields)
      setRows(res.rows)
      setFile({ name: f.name, hash: await sha256(text) })
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  async function run() {
    if (!file) return
    setErr(null)
    if (!map.date || !(map.amount || map.credit || map.debit)) return setErr('Map the date column and an amount (or credit/debit) column')
    if (!lines.out.length) return setErr('No valid lines found with this mapping')
    setBusy(true)
    try {
      if (save) {
        const cur = (tenant.data?.settings ?? {}) as Record<string, Json>
        const { error } = await supabase.from('kamai_tenants').update({ settings: { ...cur, bank_csv_mapping: map as unknown as Json } }).eq('id', tenantId)
        if (error) toast.warning(`Mapping not saved: ${error.message}`)
      }
      const dates = lines.out.map((l) => l.line_date).sort()
      const imp = await rpc<{ statement_id: string; inserted: number; duplicate: boolean }>('kamai_import_bank_lines', {
        p_statement: { tenant_id: tenantId, file_hash: file.hash, file_name: file.name, bank_name: map.bank_name || undefined, period_start: dates[0], period_end: dates[dates.length - 1] },
        p_lines: lines.out,
      })
      if (imp.duplicate) {
        setResult('This statement file was already imported. Nothing new was added.')
      } else {
        const m = await rpc<{ matched_by_reference: number; matched_by_external_ref: number; proposed: number; ambiguous: number }>('kamai_match_bank_lines', { p_statement_id: imp.statement_id })
        setResult(`${imp.inserted} lines imported. Matched by reference ${m.matched_by_reference}, by external ref ${m.matched_by_external_ref}, proposed ${m.proposed}, ambiguous ${m.ambiguous}.`)
      }
      await refresh()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const opts = [{ value: '', label: '(none)' }, ...headers.map((h) => ({ value: h, label: h }))]
  const sel = (label: string, k: keyof Mapping) => <Select label={label} value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))} options={opts} />
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Import bank statement" description="Upload a CSV, map the columns, then lines are auto-matched to recorded payments."
      footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={run} loading={busy} disabled={!file}>Import and match</Button></>}>
      {result ? <p className="text-sm text-k-text">{result}</p> : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-k-border bg-k-surface2 px-4 py-6 text-sm font-semibold text-k-muted hover:border-k-green">
            <Upload size={18} />{file?.name ?? 'Choose a bank statement CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {headers.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {sel('Date column', 'date')}{sel('Narration column', 'narration')}
                {sel('Amount column (signed)', 'amount')}{sel('Bank reference column', 'ref')}
                {sel('Credit column (if separate)', 'credit')}{sel('Debit column (if separate)', 'debit')}
                <Input label="Bank name" value={map.bank_name} onChange={(e) => setMap((m) => ({ ...m, bank_name: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-k-green" checked={save} onChange={(e) => setSave(e.target.checked)} />Remember this mapping for next time</label>
              <div className="flex gap-2"><Badge tone="green">{lines.out.length} usable lines</Badge>{lines.bad ? <Badge tone="amber">{lines.bad} rows skipped</Badge> : null}</div>
            </>
          ) : null}
          {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
        </div>
      )}
    </Modal>
  )
}
