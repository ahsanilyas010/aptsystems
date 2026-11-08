import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileJson } from 'lucide-react'
import { Button, Card, CardTitle, EmptyState, PageHeader, Spinner, useToast } from '../../ui'
import { downloadCsv, toCsv } from '../../lib/csv'
import { fmtDateTime, fmtInt } from '../../lib/format'
import type { KamaiVLenderPositionsRow } from '../../lib/db-types'
import { ComplianceBanner } from '../parts/ComplianceBanner'
import { TAPE_COLUMNS, errMsg, sum, usePositions, useTid } from '../lib/data'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../lib/data'

const SUM_FIELDS = ['original_minor', 'financed_minor', 'outstanding_minor', 'paid_minor', 'credited_minor'] as const

function summaryRow(rows: KamaiVLenderPositionsRow[]): Record<string, unknown> {
  const s: Record<string, unknown> = Object.fromEntries(TAPE_COLUMNS.map((c) => [c, '']))
  s.exposure_id = '__SUMMARY__'
  s.invoice_number = `${rows.length} rows`
  for (const f of SUM_FIELDS) s[f] = sum(rows.map((r) => r[f]))
  s.eligible_flag = rows.filter((r) => r.eligible_flag).length
  return s
}

const stampKey = (tid: string | null) => `kamai-lender-tape-${tid}`
function readStamp(tid: string | null): string | null {
  try { return localStorage.getItem(stampKey(tid)) } catch { return null }
}

export function Component() {
  const tid = useTid()
  const toast = useToast()
  const qc = useQueryClient()
  const pos = usePositions()
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null)
  const [stamp, setStamp] = useState<string | null>(() => readStamp(tid))
  const today = new Date().toISOString().slice(0, 10)

  async function generate(kind: 'csv' | 'json') {
    setBusy(kind)
    try {
      const rows = await fetchAll<KamaiVLenderPositionsRow>((a, b) =>
        supabase.from('kamai_v_lender_positions').select(TAPE_COLUMNS.join(',')).order('due_date').order('exposure_id').range(a, b),
      )
      const now = new Date().toISOString()
      const summary = summaryRow(rows)
      if (kind === 'csv') {
        downloadCsv(`kamai-positions-${today}.csv`, toCsv([...rows, summary] as Array<Record<string, unknown>>, [...TAPE_COLUMNS]))
      } else {
        const blob = new Blob([JSON.stringify({ generated_at: now, lender_tenant_id: tid, columns: TAPE_COLUMNS, count: rows.length, summary, positions: rows }, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `kamai-positions-${today}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      try { localStorage.setItem(stampKey(tid), now) } catch { /* storage unavailable */ }
      setStamp(now)
      qc.invalidateQueries({ queryKey: ['lender', tid, 'positions'] })
      toast.success(`${fmtInt(rows.length)} positions exported`)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader title="Export" eyebrow="Lender" description="Daily loan tape of every position visible to your tenant." />
      <ComplianceBanner />
      {pos.error ? (
        <Card><EmptyState title="Could not load positions" description={errMsg(pos.error)} /></Card>
      ) : pos.isLoading ? (
        <Spinner label="Loading positions…" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardTitle>Today&apos;s positions tape</CardTitle>
            {(pos.data ?? []).length === 0 ? (
              <EmptyState compact title="No positions to export yet" description="The tape fills when linked distributors deliver credit orders. Ask Kamai to link your tenant." />
            ) : (
              <>
                <p className="mb-4 text-sm text-k-text">{fmtInt((pos.data ?? []).length)} positions as of {today}. Last generated: <b>{stamp ? fmtDateTime(stamp) : 'never on this device'}</b></p>
                <div className="flex flex-wrap gap-3">
                  <Button icon={<Download size={16} />} loading={busy === 'csv'} onClick={() => generate('csv')}>Download CSV</Button>
                  <Button variant="secondary" icon={<FileJson size={16} />} loading={busy === 'json'} onClick={() => generate('json')}>Download JSON</Button>
                </div>
              </>
            )}
          </Card>
          <Card>
            <CardTitle>Daily file contract</CardTitle>
            <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-k-text">
              <li>One row per credit exposure from view <code>kamai_v_lender_positions</code>, sorted by due date then exposure id.</li>
              <li>Refreshed daily after the 06:30 PKT job; money columns are integer paisa (divide by 100 for rupees); dates are ISO 8601, DPD is measured in Asia/Karachi.</li>
              <li>File name <code>kamai-positions-YYYY-MM-DD.csv</code>, UTF-8 with BOM, header row first, empty cell = null, booleans as true/false.</li>
              <li>The final row is a summary: <code>exposure_id = __SUMMARY__</code>, sums of original, financed, outstanding, paid and credited, and the eligible count in <code>eligible_flag</code>. Drop it before loading.</li>
              <li>The JSON file wraps the same rows: <code>generated_at, lender_tenant_id, columns, count, summary, positions[]</code>.</li>
            </ul>
            <div className="mb-1 text-xs font-bold uppercase tracking-[1px] text-k-muted">Columns, in order</div>
            <div className="flex flex-wrap gap-1.5">
              {TAPE_COLUMNS.map((c) => (
                <code key={c} className="rounded-md bg-k-surface2 px-2 py-0.5 text-xs text-k-dark">{c}</code>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
