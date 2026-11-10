import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Plus, Upload } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, Table, Tabs, statusTone } from '../../ui'
import type { Column } from '../../ui'
import { PKR, fmtDate, fmtDateTime, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiBankStatementsRow, KamaiCreditExposuresRow, KamaiPaymentsRow } from '../../lib/db-types'
import { ErrorState, Gate, NoTenant, daysBetween, todayPktDate, useCan, useStores, useTenantId, useTq } from '../lib/data'
import { BankImportModal } from '../parts/BankImportModal'
import { CashDayClose } from '../parts/CashDayClose'
import { RecordPaymentModal } from '../parts/RecordPaymentModal'
import { UnmatchedQueue } from '../parts/UnmatchedQueue'

type Tab = 'payments' | 'open' | 'bank' | 'unmatched' | 'cash'

export function Component() {
  const tid = useTenantId()
  const [tab, setTab] = useState<Tab>('payments')
  const [rec, setRec] = useState(false)
  const [imp, setImp] = useState(false)
  const canRecord = useCan(['owner', 'manager', 'booker', 'finance'])
  const canBank = useCan(['owner', 'manager', 'finance'])
  if (!tid) return <NoTenant />
  return (
    <>
      <PageHeader title="Payments" eyebrow="Distributor" description="Collections, open items, bank reconciliation and rider cash."
        actions={<>
          {canBank ? <Button variant="secondary" icon={<Upload size={15} />} onClick={() => setImp(true)}>Import bank CSV</Button> : null}
          {canRecord ? <Button icon={<Plus size={15} />} onClick={() => setRec(true)}>Record payment</Button> : null}
        </>}>
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ key: 'payments', label: 'Payments' }, { key: 'open', label: 'Open items' }, { key: 'bank', label: 'Bank statements' }, { key: 'unmatched', label: 'Unmatched' }, { key: 'cash', label: 'Rider cash' }]} />
      </PageHeader>
      {tab === 'payments' ? <PaymentList /> : null}
      {tab === 'open' ? <OpenItems /> : null}
      {tab === 'bank' ? <Statements /> : null}
      {tab === 'unmatched' ? <UnmatchedQueue /> : null}
      {tab === 'cash' ? <CashDayClose tenantId={tid} /> : null}
      <RecordPaymentModal open={rec} onClose={() => setRec(false)} tenantId={tid} />
      <BankImportModal open={imp} onClose={() => setImp(false)} tenantId={tid} />
    </>
  )
}

function PaymentList() {
  const stores = useStores()
  const q = useTq<KamaiPaymentsRow[]>(['payments'], (t) => supabase.from('kamai_payments').select('*').eq('tenant_id', t).order('collected_at', { ascending: false }).limit(300))
  const cols: Column<KamaiPaymentsRow>[] = [
    { key: 'd', header: 'Collected', render: (p) => fmtDateTime(p.collected_at) },
    { key: 's', header: 'Store', render: (p) => stores.map.get(p.store_id)?.name ?? '—' },
    { key: 'c', header: 'Channel', hideOnMobile: true, render: (p) => humanize(p.channel) },
    { key: 'r', header: 'Reference', hideOnMobile: true, render: (p) => <span className="font-mono text-xs">{p.external_ref ?? p.reference_code ?? '—'}</span> },
    { key: 'st', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge> },
    { key: 'a', header: 'Amount', align: 'right', render: (p) => <span className="font-semibold">{PKR(p.amount_minor)}</span> },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No payments yet" description="Record a collection to allocate it against open invoices." />}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(p) => p.id} dense />
      </Gate>
    </Card>
  )
}

function OpenItems() {
  const stores = useStores()
  const today = todayPktDate()
  const q = useTq<KamaiCreditExposuresRow[]>(['open-items'], (t) => supabase.from('kamai_credit_exposures').select('*').eq('tenant_id', t).eq('status', 'open').gt('outstanding_minor', 0).order('due_date').limit(2000))
  const rows = useMemo(() => (q.data ?? []).map((e) => ({ ...e, dpd: daysBetween(e.due_date, today) })), [q.data, today])
  const total = rows.reduce((s, r) => s + Number(r.outstanding_minor), 0)
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 's', header: 'Store', render: (r) => stores.map.get(r.store_id)?.name ?? '—' },
    { key: 'o', header: 'Order', hideOnMobile: true, render: (r) => <Link className="text-k-green" to={`/distributor/orders/${r.order_id}`}>Open</Link> },
    { key: 'due', header: 'Due', render: (r) => fmtDate(r.due_date) },
    { key: 'dpd', header: 'Status', render: (r) => (r.dpd > 0 ? <Badge tone={r.dpd > 30 ? 'red' : 'amber'}>{r.dpd} d late</Badge> : <Badge tone="green">Not due</Badge>) },
    { key: 'out', header: 'Outstanding', align: 'right', render: (r) => <span className="font-semibold">{PKR(r.outstanding_minor)}</span> },
  ]
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <Card padding="none">
      <Table columns={cols} rows={rows} rowKey={(r) => r.id} loading={q.isLoading} dense empty={<EmptyState title="No open items" compact />}
        footer={rows.length ? <tr><td colSpan={cols.length} className="px-4 py-2 text-right text-sm font-bold">Total outstanding {PKR(total)}</td></tr> : undefined} />
    </Card>
  )
}

function Statements() {
  const q = useTq<KamaiBankStatementsRow[]>(['statements'], (t) => supabase.from('kamai_bank_statements').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(100))
  const cols: Column<KamaiBankStatementsRow>[] = [
    { key: 'f', header: 'File', render: (s) => s.file_name ?? s.bank_name ?? 'Statement' },
    { key: 'p', header: 'Period', hideOnMobile: true, render: (s) => `${fmtDate(s.period_start)} to ${fmtDate(s.period_end)}` },
    { key: 'n', header: 'Lines', align: 'right', render: (s) => s.rows_total },
    { key: 'at', header: 'Imported', render: (s) => fmtDateTime(s.created_at) },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No bank statements" description="Import a bank CSV to reconcile Raast and IBFT receipts automatically." />}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(s) => s.id} dense />
      </Gate>
    </Card>
  )
}
