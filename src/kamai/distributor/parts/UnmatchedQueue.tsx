import { useState } from 'react'
import { Badge, Button, Card, EmptyState, Modal, Table, useToast } from '../../ui'
import type { Column } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate, fmtDateTime, humanize } from '../../lib/format'
import type { KamaiBankLinesRow, KamaiPaymentsRow } from '../../lib/db-types'
import { Gate, errMsg, rpc, useCan, useRefreshAll, useStores, useTq } from '../lib/data'

export function UnmatchedQueue() {
  const toast = useToast()
  const refresh = useRefreshAll()
  const can = useCan(['owner', 'manager', 'finance'])
  const stores = useStores()
  const lines = useTq<KamaiBankLinesRow[]>(['bank-unmatched'], (t) => supabase.from('kamai_bank_lines').select('*').eq('tenant_id', t).eq('match_status', 'unmatched').eq('direction', 'credit').order('line_date', { ascending: false }).limit(300))
  const [sel, setSel] = useState<KamaiBankLinesRow | null>(null)
  const cands = useTq<KamaiPaymentsRow[]>(['pay-recorded'], (t) => supabase.from('kamai_payments').select('*').eq('tenant_id', t).eq('status', 'recorded').neq('channel', 'cash').order('collected_at', { ascending: false }).limit(300), { enabled: !!sel })
  const [busy, setBusy] = useState('')

  async function match(pid: string) {
    if (!sel) return
    setBusy(pid)
    try {
      await rpc('kamai_confirm_bank_match', { p_line_id: sel.id, p_payment_id: pid })
      toast.success('Matched')
      setSel(null)
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  const cols: Column<KamaiBankLinesRow>[] = [
    { key: 'd', header: 'Date', render: (l) => fmtDate(l.line_date) },
    { key: 'n', header: 'Narration', render: (l) => <span className="line-clamp-2 break-words">{l.narration ?? '—'}</span> },
    { key: 'r', header: 'Ref', hideOnMobile: true, render: (l) => l.extracted_ref ?? l.bank_ref ?? '—' },
    { key: 'a', header: 'Amount', align: 'right', render: (l) => <span className="font-semibold">{PKR(l.amount_minor)}</span> },
    { key: 'act', header: '', align: 'right', render: (l) => (can ? <Button size="sm" variant="secondary" onClick={() => setSel(l)}>Match</Button> : null) },
  ]
  const sorted = [...(cands.data ?? [])].sort((a, b) => Math.abs(Number(a.amount_minor) - Number(sel?.amount_minor ?? 0)) - Math.abs(Number(b.amount_minor) - Number(sel?.amount_minor ?? 0)))
  return (
    <>
      <Card padding="none">
        <Gate q={lines} isEmpty={!lines.data?.length} empty={<EmptyState title="Nothing to match" description="All imported credit lines are matched." />}>
          <Table columns={cols} rows={lines.data ?? []} rowKey={(l) => l.id} dense />
        </Gate>
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} size="lg" title="Match bank line to a payment" description={sel ? `${fmtDate(sel.line_date)} · ${PKR(sel.amount_minor)} · ${sel.narration ?? ''}` : undefined}>
        <Gate q={cands} isEmpty={!sorted.length} empty={<p className="text-sm text-k-muted">No unmatched non-cash payments. Record the payment first, then match.</p>}>
          <ul className="divide-y divide-k-border">
            {sorted.slice(0, 40).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <div className="font-semibold text-k-dark">{stores.map.get(p.store_id)?.name ?? '—'} <span className="font-normal text-k-muted">{PKR(p.amount_minor)}</span></div>
                  <div className="text-xs text-k-muted">{humanize(p.channel)} · {fmtDateTime(p.collected_at)} · {p.external_ref ?? p.reference_code ?? 'no ref'}</div>
                </div>
                <div className="flex items-center gap-2">
                  {Number(p.amount_minor) === Number(sel?.amount_minor) ? <Badge tone="green" size="sm">Same amount</Badge> : null}
                  <Button size="sm" loading={busy === p.id} onClick={() => void match(p.id)}>Match</Button>
                </div>
              </li>
            ))}
          </ul>
        </Gate>
      </Modal>
    </>
  )
}
