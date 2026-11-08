import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Pencil, PlayCircle } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Table, Tabs, statusTone, useToast } from '../../ui'
import type { Column } from '../../ui'
import { PKR, fmtDate, fmtDateTime, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiCreditAccountsRow, KamaiCreditDecisionsRow, KamaiCreditExposuresRow } from '../../lib/db-types'
import { ErrorState, Gate, NoTenant, daysBetween, errMsg, rpc, todayPktDate, useCan, useRefreshAll, useStores, useTenantId, useTq } from '../lib/data'
import { CreditOverrideModal } from '../parts/CreditOverrideModal'
import { PolicyForm } from '../parts/PolicyForm'

type Tab = 'accounts' | 'aging' | 'decisions' | 'policy'
const BUCKETS: Array<{ key: string; label: string; test: (d: number) => boolean }> = [
  { key: 'current', label: 'Current', test: (d) => d <= 0 },
  { key: '1-7', label: '1-7 days', test: (d) => d >= 1 && d <= 7 },
  { key: '8-14', label: '8-14 days', test: (d) => d >= 8 && d <= 14 },
  { key: '15-30', label: '15-30 days', test: (d) => d >= 15 && d <= 30 },
  { key: '31-60', label: '31-60 days', test: (d) => d >= 31 && d <= 60 },
  { key: '61-90', label: '61-90 days', test: (d) => d >= 61 && d <= 90 },
  { key: '90+', label: '90+ days', test: (d) => d > 90 },
]
const bucketTone = (k: string) => (k === 'current' ? 'green' : k === '1-7' || k === '8-14' ? 'amber' : 'red') as 'green' | 'amber' | 'red'

export function Component() {
  const tid = useTenantId()
  const [tab, setTab] = useState<Tab>('accounts')
  if (!tid) return <NoTenant />
  return (
    <>
      <PageHeader title="Credit" eyebrow="Distributor" description="Policy, store limits, receivable aging and decisions.">
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ key: 'accounts', label: 'Accounts' }, { key: 'aging', label: 'Exposure aging' }, { key: 'decisions', label: 'Decisions' }, { key: 'policy', label: 'Policy' }]} />
      </PageHeader>
      {tab === 'accounts' ? <Accounts /> : null}
      {tab === 'aging' ? <Aging /> : null}
      {tab === 'decisions' ? <Decisions /> : null}
      {tab === 'policy' ? <PolicyForm tenantId={tid} /> : null}
    </>
  )
}

function Accounts() {
  const toast = useToast()
  const refresh = useRefreshAll()
  const canEval = useCan(['owner', 'manager', 'finance'])
  const canOverride = useCan(['owner', 'manager'])
  const stores = useStores()
  const q = useTq<KamaiCreditAccountsRow[]>(['accounts'], (t) => supabase.from('kamai_credit_accounts').select('*').eq('tenant_id', t).order('limit_minor', { ascending: false }).limit(5000))
  const [ov, setOv] = useState<KamaiCreditAccountsRow | null>(null)
  const [busy, setBusy] = useState<string>('')

  async function evaluate(storeId: string) {
    setBusy(storeId)
    try {
      await rpc('kamai_evaluate_store', { p_store_id: storeId })
      toast.success('Evaluation complete')
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  async function evaluateAll() {
    setBusy('all')
    let ok = 0
    let failed = 0
    for (const s of stores.rows.filter((x) => x.status === 'active')) {
      try {
        await rpc('kamai_evaluate_store', { p_store_id: s.id })
        ok++
      } catch {
        failed++
      }
    }
    toast[failed ? 'warning' : 'success'](`${ok} stores evaluated${failed ? `, ${failed} failed` : ''}`)
    await refresh()
    setBusy('')
  }

  const cols: Column<KamaiCreditAccountsRow>[] = [
    { key: 's', header: 'Store', render: (a) => stores.map.get(a.store_id)?.name ?? a.store_id.slice(0, 8) },
    { key: 'tier', header: 'Tier', render: (a) => `Tier ${a.tier}` },
    { key: 'st', header: 'Status', render: (a) => <Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge> },
    { key: 'lim', header: 'Limit', align: 'right', render: (a) => PKR(a.limit_minor) },
    { key: 'ten', header: 'Tenor', hideOnMobile: true, align: 'right', render: (a) => `${a.tenor_days} d` },
    { key: 'rev', header: 'Reviewed', hideOnMobile: true, render: (a) => fmtDate(a.last_reviewed_at) },
    { key: 'rc', header: 'Reasons', hideOnMobile: true, render: (a) => (a.reason_codes ?? []).slice(0, 2).join(', ') || '—' },
    {
      key: 'act', header: '', align: 'right',
      render: (a) => (
        <span className="flex justify-end gap-1.5">
          {canEval ? <Button size="sm" variant="secondary" loading={busy === a.store_id} icon={<PlayCircle size={13} />} onClick={() => void evaluate(a.store_id)}>Run</Button> : null}
          {canOverride ? <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setOv(a)}>Override</Button> : null}
        </span>
      ),
    },
  ]
  const without = stores.rows.filter((s) => s.status === 'active' && !(q.data ?? []).some((a) => a.store_id === s.id)).length
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {canEval ? <Button icon={<PlayCircle size={15} />} loading={busy === 'all'} onClick={evaluateAll}>Run evaluation for all stores</Button> : null}
        {without ? <span className="text-[13px] text-k-muted">{without} active stores have no credit account yet.</span> : null}
      </div>
      <Card padding="none">
        <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No credit accounts" description="Run an evaluation to create accounts for your stores." />}>
          <Table columns={cols} rows={q.data ?? []} rowKey={(a) => a.store_id} />
        </Gate>
      </Card>
      <CreditOverrideModal account={ov} storeName={ov ? stores.map.get(ov.store_id)?.name : undefined} onClose={() => setOv(null)} />
    </>
  )
}

function Aging() {
  const stores = useStores()
  const today = todayPktDate()
  const q = useTq<KamaiCreditExposuresRow[]>(['aging'], (t) => supabase.from('kamai_credit_exposures').select('*').eq('tenant_id', t).eq('status', 'open').gt('outstanding_minor', 0).order('due_date').limit(5000))
  const rows = useMemo(() => (q.data ?? []).map((e) => ({ ...e, dpd: daysBetween(e.due_date, today) })), [q.data, today])
  const summary = BUCKETS.map((b) => {
    const m = rows.filter((r) => b.test(r.dpd))
    return { ...b, count: m.length, sum: m.reduce((s, r) => s + Number(r.outstanding_minor), 0) }
  })
  const total = summary.reduce((s, b) => s + b.sum, 0)
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 's', header: 'Store', render: (r) => stores.map.get(r.store_id)?.name ?? '—' },
    { key: 'o', header: 'Order', hideOnMobile: true, render: (r) => <Link className="text-k-green" to={`/distributor/orders/${r.order_id}`}>Open</Link> },
    { key: 'd', header: 'Due', render: (r) => fmtDate(r.due_date) },
    { key: 'dpd', header: 'DPD', align: 'right', render: (r) => (r.dpd > 0 ? <Badge tone={r.dpd > 30 ? 'red' : 'amber'}>{r.dpd}</Badge> : <Badge tone="green">Current</Badge>) },
    { key: 'org', header: 'Original', hideOnMobile: true, align: 'right', render: (r) => PKR(r.original_minor) },
    { key: 'out', header: 'Outstanding', align: 'right', render: (r) => <span className="font-semibold">{PKR(r.outstanding_minor)}</span> },
  ]
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {summary.map((b) => (
          <div key={b.key} className="rounded-xl border border-k-border bg-k-surface p-3">
            <Badge tone={bucketTone(b.key)} size="sm">{b.label}</Badge>
            <div className="mt-2 text-base font-extrabold text-k-dark">{PKR(b.sum)}</div>
            <div className="text-xs text-k-muted">{b.count} invoices{total ? ` · ${Math.round((b.sum / total) * 100)}%` : ''}</div>
          </div>
        ))}
      </div>
      <Card padding="none">
        <div className="p-5 pb-0"><CardTitle dot="amber">Open exposures, oldest first</CardTitle></div>
        <Table columns={cols} rows={[...rows].sort((a, b) => b.dpd - a.dpd)} rowKey={(r) => r.id} loading={q.isLoading} dense empty={<EmptyState title="No open receivables" compact />} />
      </Card>
    </>
  )
}

function Decisions() {
  const stores = useStores()
  const q = useTq<KamaiCreditDecisionsRow[]>(['decisions'], (t) => supabase.from('kamai_credit_decisions').select('*').eq('tenant_id', t).order('decided_at', { ascending: false }).limit(200))
  const cols: Column<KamaiCreditDecisionsRow>[] = [
    { key: 'at', header: 'When', render: (d) => fmtDateTime(d.decided_at) },
    { key: 's', header: 'Store', render: (d) => stores.map.get(d.store_id)?.name ?? '—' },
    { key: 'd', header: 'Decision', render: (d) => <Badge tone={d.decision === 'approved' || d.decision === 'cod' ? 'green' : 'amber'}>{humanize(d.decision)}</Badge> },
    { key: 'tot', header: 'Order', align: 'right', render: (d) => <Link className="text-k-green" to={`/distributor/orders/${d.order_id}`}>{PKR(d.order_total_minor)}</Link> },
    { key: 'av', header: 'Available', hideOnMobile: true, align: 'right', render: (d) => PKR(d.available_minor) },
    { key: 'ex', header: 'Exposure', hideOnMobile: true, align: 'right', render: (d) => PKR(d.exposure_minor) },
    { key: 'rc', header: 'Reasons', hideOnMobile: true, render: (d) => (d.reason_codes ?? []).join(', ') || '—' },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No decisions yet" />}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(d) => d.id} dense />
      </Gate>
    </Card>
  )
}
