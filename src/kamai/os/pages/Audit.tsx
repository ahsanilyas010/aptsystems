import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Json, KamaiAuditLogRow } from '../../lib/db-types'
import { fmtDateTime } from '../../lib/format'
import { Badge, Button, Input, Modal, PageHeader, Select, Table, type BadgeTone, type Column } from '../../ui'
import { Panel, Stack } from '../components/content-ui'
import { ErrorState } from '../components/QueryState'
import { tenantNameMap, useAllTenants } from '../lib/tenants'

const TABLES = [
  'kamai_tenants', 'kamai_memberships', 'kamai_products', 'kamai_price_list_items', 'kamai_stores', 'kamai_orders',
  'kamai_credit_accounts', 'kamai_payments', 'kamai_facilities', 'kamai_financings', 'kamai_ledger_accounts',
]
const PAGE = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OP_TONE: Record<string, BadgeTone> = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red' }

interface Filters {
  table: string
  tenant: string
  actor: string
  from: string
  to: string
}
const EMPTY: Filters = { table: '', tenant: '', actor: '', from: '', to: '' }

function useAudit(f: Filters) {
  return useInfiniteQuery({
    queryKey: ['os', 'audit', f],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<KamaiAuditLogRow[]> => {
      let q = supabase.from('kamai_audit_log').select('*').order('at', { ascending: false }).order('id', { ascending: false }).range(pageParam, pageParam + PAGE - 1)
      if (f.table) q = q.eq('table_name', f.table)
      if (f.tenant) q = q.eq('tenant_id', f.tenant)
      if (f.actor && UUID_RE.test(f.actor.trim())) q = q.eq('actor', f.actor.trim())
      if (f.from) q = q.gte('at', new Date(`${f.from}T00:00:00+05:00`).toISOString())
      if (f.to) q = q.lt('at', new Date(new Date(`${f.to}T00:00:00+05:00`).getTime() + 86_400_000).toISOString())
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiAuditLogRow[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
    retry: false,
    staleTime: 15_000,
  })
}

const show = (v: Json | undefined): string => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v))
const obj = (j: Json | null): Record<string, Json> => (j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, Json>) : {})

function Diff({ row }: { row: KamaiAuditLogRow }) {
  const o = obj(row.old_row)
  const n = obj(row.new_row)
  const keys = row.op === 'UPDATE' ? (row.changed_keys?.length ? row.changed_keys : Object.keys(n).filter((k) => show(o[k]) !== show(n[k]))) : Object.keys(row.op === 'INSERT' ? n : o)
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Table</dt><dd className="font-semibold text-k-dark">{row.table_name}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Record</dt><dd className="break-all text-xs text-k-dark">{row.record_id ?? '—'}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Actor</dt><dd className="break-all text-xs text-k-dark">{row.actor ?? 'system'}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">When</dt><dd className="text-k-dark">{fmtDateTime(row.at)}</dd></div>
      </dl>
      {keys.length === 0 ? <p className="text-sm text-k-muted">No field-level changes were recorded.</p> : (
        <div className="overflow-x-auto rounded-xl border border-k-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-k-surface2 text-left text-[10px] font-bold uppercase tracking-[1px] text-k-muted">
                <th className="px-3 py-2">Field</th>
                {row.op !== 'INSERT' ? <th className="px-3 py-2">Before</th> : null}
                {row.op !== 'DELETE' ? <th className="px-3 py-2">After</th> : null}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t border-k-border align-top">
                  <td className="px-3 py-2 font-semibold text-k-dark">{k}</td>
                  {row.op !== 'INSERT' ? <td className="max-w-[220px] break-words bg-k-red-light/50 px-3 py-2 text-k-red">{show(o[k])}</td> : null}
                  {row.op !== 'DELETE' ? <td className="max-w-[220px] break-words bg-k-green-light/60 px-3 py-2 text-k-green">{show(n[k])}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Component() {
  const tenants = useAllTenants()
  const names = tenantNameMap(tenants.data)
  const [f, setF] = useState<Filters>(EMPTY)
  const [selected, setSelected] = useState<KamaiAuditLogRow | null>(null)
  const q = useAudit(f)
  const rows = q.data?.pages.flat() ?? []
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }))
  const actorBad = f.actor.trim() !== '' && !UUID_RE.test(f.actor.trim())

  const columns: Column<KamaiAuditLogRow>[] = [
    { key: 'at', header: 'When', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.at)}</span> },
    { key: 'op', header: 'Op', render: (r) => <Badge tone={OP_TONE[r.op] ?? 'dark'} size="sm">{r.op}</Badge> },
    { key: 'table', header: 'Table', render: (r) => <span className="font-semibold text-k-dark">{r.table_name.replace(/^kamai_/, '')}</span> },
    { key: 'tenant', header: 'Tenant', hideOnMobile: true, render: (r) => (r.tenant_id ? names.get(r.tenant_id) ?? r.tenant_id.slice(0, 8) : '—') },
    { key: 'actor', header: 'Actor', hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.actor ? r.actor.slice(0, 8) : 'system'}</span> },
    { key: 'keys', header: 'Changed', render: (r) => <span className="text-xs text-k-muted">{r.changed_keys?.length ? r.changed_keys.slice(0, 4).join(', ') + (r.changed_keys.length > 4 ? ` +${r.changed_keys.length - 4}` : '') : r.op === 'INSERT' ? 'new row' : r.op === 'DELETE' ? 'row removed' : '—'}</span> },
  ]

  return (
    <Stack>
      <PageHeader eyebrow="Kamai OS" title="Audit log" description="Append-only row-version log of tenancy, catalog, stores, orders, credit, payments, ledger and financing changes." />
      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Select label="Table" value={f.table} onChange={(e) => set('table', e.target.value)} options={[{ value: '', label: 'All tables' }, ...TABLES.map((t) => ({ value: t, label: t.replace(/^kamai_/, '') }))]} />
          <Select label="Tenant" value={f.tenant} onChange={(e) => set('tenant', e.target.value)} options={[{ value: '', label: 'All tenants' }, ...(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
          <Input label="Actor (user id)" value={f.actor} onChange={(e) => set('actor', e.target.value)} placeholder="uuid" error={actorBad ? 'Enter a full user id (uuid)' : undefined} />
          <Input label="From" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          <Input label="To" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Table dense columns={columns} rows={rows} rowKey={(r) => r.id} loading={q.isLoading} onRowClick={setSelected} empty={<p className="py-6 text-center text-sm text-k-muted">No audit entries match these filters.</p>} />
            <div className="mt-3 flex items-center justify-between text-xs text-k-muted">
              <span>{rows.length} entries loaded</span>
              <div className="flex gap-2">
                {JSON.stringify(f) !== JSON.stringify(EMPTY) ? <Button size="sm" variant="ghost" onClick={() => setF(EMPTY)}>Clear filters</Button> : null}
                {q.hasNextPage ? <Button size="sm" variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button> : null}
              </div>
            </div>
          </>
        )}
      </Panel>
      <Modal open={!!selected} onClose={() => setSelected(null)} size="lg" title={selected ? `${selected.op} · ${selected.table_name}` : ''} description="Field-level changes recorded by the audit trigger.">
        {selected ? <Diff row={selected} /> : null}
      </Modal>
    </Stack>
  )
}
