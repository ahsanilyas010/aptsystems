import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Table, statusTone, useToast } from '../../ui'
import type { Column } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate, humanize } from '../../lib/format'
import { toMinor } from '../../lib/money'
import type { CashDepositMethod, KamaiCashDepositsRow, KamaiMembershipsRow } from '../../lib/db-types'
import { Gate, errMsg, rpc, todayPktDate, useCan, useRefreshAll, useTq } from '../lib/data'

export function CashDayClose({ tenantId }: { tenantId: string }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const canClose = useCan(['owner', 'manager', 'finance'])
  const q = useTq<KamaiCashDepositsRow[]>(['cash'], (t) => supabase.from('kamai_cash_deposits').select('*').eq('tenant_id', t).order('business_date', { ascending: false }).limit(200))
  const riders = useTq<KamaiMembershipsRow[]>(['riders'], (t) => supabase.from('kamai_memberships').select('*').eq('tenant_id', t).eq('role', 'rider'))
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ rider: '', date: todayPktDate(), amount: '', method: 'office' as CashDepositMethod, ref: '', notes: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rname = (id: string) => `Rider ${id.slice(0, 8)}`

  async function save() {
    setErr(null)
    if (!f.rider) return setErr('Choose a rider')
    if (toMinor(f.amount) < 0 || f.amount === '') return setErr('Enter the deposited amount')
    setBusy(true)
    try {
      await rpc('kamai_close_cash_day', { p_tenant: tenantId, p_rider_user_id: f.rider, p_business_date: f.date, p_deposited_minor: toMinor(f.amount), p_method: f.method, p_deposit_ref: f.ref || null, p_slip_url: null, p_notes: f.notes || null })
      toast.success('Cash day closed')
      await refresh()
      setOpen(false)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<KamaiCashDepositsRow>[] = [
    { key: 'd', header: 'Date', render: (r) => fmtDate(r.business_date) },
    { key: 'r', header: 'Rider', render: (r) => rname(r.rider_user_id) },
    { key: 'e', header: 'Expected', align: 'right', render: (r) => PKR(r.expected_minor) },
    { key: 'dep', header: 'Deposited', align: 'right', render: (r) => PKR(r.deposited_minor) },
    { key: 'v', header: 'Variance', align: 'right', render: (r) => <span className={r.variance_minor === 0 ? 'text-k-muted' : 'font-bold text-k-red'}>{PKR(r.variance_minor, { sign: true })}</span> },
    { key: 'm', header: 'Method', hideOnMobile: true, render: (r) => humanize(r.method) },
    { key: 's', header: 'Status', render: (r) => <Badge tone={r.status === 'reconciled' ? 'green' : r.status === 'variance' ? 'red' : statusTone(r.status)}>{humanize(r.status)}</Badge> },
  ]
  return (
    <>
      <div className="mb-3 flex justify-end">{canClose ? <Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>Close a rider day</Button> : null}</div>
      <Card padding="none">
        <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No cash deposits" description="Riders close their day from the delivery app, or you can close it here." />}>
          <Table columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} dense />
        </Gate>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Close rider cash day" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} loading={busy}>Close day</Button></>}>
        <div className="space-y-3">
          <Select label="Rider" placeholder="Select rider" value={f.rider} onChange={(e) => setF({ ...f, rider: e.target.value })} options={(riders.data ?? []).map((r) => ({ value: r.user_id, label: rname(r.user_id) }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Business date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <Input label="Deposited (Rs)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <Select label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as CashDepositMethod })} options={['office', 'bank', 'raast', 'other'].map((v) => ({ value: v, label: humanize(v) }))} />
            <Input label="Deposit reference" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
          </div>
          <Input label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
        </div>
      </Modal>
    </>
  )
}
