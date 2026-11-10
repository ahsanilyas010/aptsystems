import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge, Card, EmptyState, PageHeader, Table, Tabs } from '../../ui'
import type { Column } from '../../ui'
import { PKR, fmtDateTime, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiLedgerBalancesRow, KamaiLedgerEntriesRow, KamaiLedgerLinesRow } from '../../lib/db-types'
import { Gate, NoTenant, useTenantId, useTq } from '../lib/data'
import { Settlement } from '../parts/Settlement'

type Tab = 'accounts' | 'journal' | 'trial' | 'settlement'

function useBalances() {
  return useTq<KamaiLedgerBalancesRow[]>(['balances'], (t) => supabase.from('kamai_ledger_balances').select('*').eq('tenant_id', t).order('code'))
}

export function Component() {
  const tid = useTenantId()
  const [tab, setTab] = useState<Tab>('accounts')
  if (!tid) return <NoTenant />
  return (
    <>
      <PageHeader title="Ledger" eyebrow="Distributor" description="Double-entry accounts, journal and trial balance.">
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ key: 'accounts', label: 'Accounts' }, { key: 'journal', label: 'Journal' }, { key: 'trial', label: 'Trial balance' }, { key: 'settlement', label: 'Settlement' }]} />
      </PageHeader>
      {tab === 'accounts' ? <Accounts /> : null}
      {tab === 'journal' ? <Journal /> : null}
      {tab === 'trial' ? <Trial /> : null}
      {tab === 'settlement' ? <Settlement /> : null}
    </>
  )
}

function Accounts() {
  const q = useBalances()
  const cols: Column<KamaiLedgerBalancesRow>[] = [
    { key: 'c', header: 'Code', render: (a) => <span className="font-mono text-xs font-semibold">{a.code}</span> },
    { key: 'n', header: 'Account', render: (a) => a.name },
    { key: 't', header: 'Type', hideOnMobile: true, render: (a) => <Badge tone="muted">{humanize(a.type)}</Badge> },
    { key: 'b', header: 'Balance', align: 'right', render: (a) => <span className="font-semibold">{PKR(a.balance_minor, { decimals: true })}</span> },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No ledger accounts" description="The chart of accounts is created when the tenant is seeded." />}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(a) => a.account_id ?? a.code ?? ''} dense />
      </Gate>
    </Card>
  )
}

function Journal() {
  const bal = useBalances()
  const q = useTq<KamaiLedgerEntriesRow[]>(['entries'], (t) => supabase.from('kamai_ledger_entries').select('*').eq('tenant_id', t).order('effective_at', { ascending: false }).limit(200))
  const [open, setOpen] = useState<string | null>(null)
  const acct = useMemo(() => new Map((bal.data ?? []).map((a) => [a.account_id, a])), [bal.data])
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<EmptyState title="No journal entries" description="Entries post automatically on delivery and payment." />}>
        <ul className="divide-y divide-k-border">
          {(q.data ?? []).map((e) => (
            <li key={e.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-k-surface2" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                {open === e.id ? <ChevronDown size={16} className="shrink-0 text-k-muted" /> : <ChevronRight size={16} className="shrink-0 text-k-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-k-dark">{e.memo ?? `${humanize(e.source_type)} ${e.source_id.slice(0, 8)}`}</div>
                  <div className="text-xs text-k-muted">{fmtDateTime(e.effective_at)} · {humanize(e.source_type)}{e.reverses_entry_id ? ' · reversal' : ''}</div>
                </div>
                <Badge tone={e.status === 'posted' ? 'green' : 'amber'}>{humanize(e.status)}</Badge>
              </button>
              {open === e.id ? <Lines entryId={e.id} acct={acct} /> : null}
            </li>
          ))}
        </ul>
      </Gate>
    </Card>
  )
}

function Lines({ entryId, acct }: { entryId: string; acct: Map<string | null, KamaiLedgerBalancesRow> }) {
  const q = useTq<KamaiLedgerLinesRow[]>(['lines', entryId], (t) => supabase.from('kamai_ledger_lines').select('*').eq('tenant_id', t).eq('entry_id', entryId).order('id'))
  return (
    <div className="bg-k-surface2 px-4 pb-3 pl-11">
      <Gate q={q} isEmpty={!q.data?.length}>
        <table className="w-full text-xs">
          <tbody>
            {(q.data ?? []).map((l) => {
              const a = acct.get(l.account_id)
              return (
                <tr key={l.id} className="border-b border-k-border last:border-0">
                  <td className="py-1.5 pr-2 font-mono">{a?.code ?? l.account_id.slice(0, 6)}</td>
                  <td className="pr-2">{a?.name ?? ''}{l.memo ? <span className="text-k-muted"> · {l.memo}</span> : null}</td>
                  <td className="w-28 pr-2 text-right">{l.direction === 'debit' ? PKR(l.amount_minor, { decimals: true }) : ''}</td>
                  <td className="w-28 text-right">{l.direction === 'credit' ? PKR(l.amount_minor, { decimals: true }) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Gate>
    </div>
  )
}

function Trial() {
  const q = useBalances()
  const rows = useMemo(
    () =>
      (q.data ?? []).map((a) => {
        const b = Number(a.balance_minor ?? 0)
        const debitNormal = a.normal_side === 'debit'
        const debit = debitNormal ? (b >= 0 ? b : 0) : b < 0 ? -b : 0
        const credit = !debitNormal ? (b >= 0 ? b : 0) : b < 0 ? -b : 0
        return { ...a, debit, credit }
      }),
    [q.data],
  )
  const td = rows.reduce((s, r) => s + r.debit, 0)
  const tc = rows.reduce((s, r) => s + r.credit, 0)
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'c', header: 'Code', render: (a) => <span className="font-mono text-xs font-semibold">{a.code}</span> },
    { key: 'n', header: 'Account', render: (a) => a.name },
    { key: 'd', header: 'Debit', align: 'right', render: (a) => (a.debit ? PKR(a.debit, { decimals: true }) : '') },
    { key: 'cr', header: 'Credit', align: 'right', render: (a) => (a.credit ? PKR(a.credit, { decimals: true }) : '') },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!rows.length} empty={<EmptyState title="Nothing to show" />}>
        <Table columns={cols} rows={rows} rowKey={(a) => a.account_id ?? a.code ?? ''} dense
          footer={<tr><td colSpan={2} className="px-4 py-3 text-sm font-bold">Totals {td === tc ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Out of balance</Badge>}</td><td className="px-4 py-3 text-right text-sm font-bold">{PKR(td, { decimals: true })}</td><td className="px-4 py-3 text-right text-sm font-bold">{PKR(tc, { decimals: true })}</td></tr>} />
      </Gate>
    </Card>
  )
}
