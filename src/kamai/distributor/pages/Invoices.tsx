import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Search } from 'lucide-react'
import { Badge, Card, EmptyState, Input, PageHeader, Select, Table, statusTone } from '../../ui'
import type { Column } from '../../ui'
import { PKR, fmtDate, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiInvoiceItemsRow, KamaiInvoicesRow } from '../../lib/db-types'
import { ErrorState, NoTenant, useStores, useTenantId, useTq } from '../lib/data'
import { fbrReadiness } from '../lib/fbr'
import { InvoiceView } from '../parts/InvoiceView'

export function Component() {
  const tid = useTenantId()
  const [params, setParams] = useSearchParams()
  const stores = useStores()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [fbr, setFbr] = useState('')
  const inv = useTq<KamaiInvoicesRow[]>(['invoices'], (t) => supabase.from('kamai_invoices').select('*').eq('tenant_id', t).order('serial_no', { ascending: false }).limit(500))
  const lines = useTq<Array<Pick<KamaiInvoiceItemsRow, 'invoice_id' | 'hs_code'>>>(['invoice-hs'], (t) => supabase.from('kamai_invoice_items').select('invoice_id,hs_code').eq('tenant_id', t).limit(20000))

  const hsMap = useMemo(() => {
    const m = new Map<string, Array<{ hs_code: string | null }>>()
    for (const l of lines.data ?? []) m.set(l.invoice_id, [...(m.get(l.invoice_id) ?? []), l])
    return m
  }, [lines.data])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (inv.data ?? []).filter((i) => {
      if (status && i.status !== status) return false
      if (fbr) {
        const ok = fbrReadiness(i, hsMap.get(i.id)).ok
        if ((fbr === 'ready') !== ok) return false
      }
      return !s || i.display_number.toLowerCase().includes(s) || (stores.map.get(i.store_id)?.name ?? '').toLowerCase().includes(s)
    })
  }, [inv.data, q, status, fbr, hsMap, stores.map])

  const openId = params.get('open')
  const open = openId ? (inv.data ?? []).find((i) => i.id === openId) ?? null : null
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true })

  if (!tid) return <NoTenant />

  const cols: Column<KamaiInvoicesRow>[] = [
    { key: 'n', header: 'Invoice', render: (i) => <span className="font-semibold text-k-dark">{i.display_number}</span> },
    { key: 'type', header: 'Type', hideOnMobile: true, render: (i) => i.invoice_type },
    { key: 's', header: 'Store', render: (i) => stores.map.get(i.store_id)?.name ?? '—' },
    { key: 'd', header: 'Date', hideOnMobile: true, render: (i) => fmtDate(i.invoice_date) },
    { key: 'st', header: 'Status', render: (i) => <Badge tone={statusTone(i.status)}>{humanize(i.status)}</Badge> },
    {
      key: 'fbr', header: 'FBR',
      render: (i) => {
        if (lines.isLoading) return <span className="text-xs text-k-light">…</span>
        const r = fbrReadiness(i, hsMap.get(i.id))
        return r.ok ? <Badge tone="green">Ready</Badge> : <span title={r.missing.join(', ')}><Badge tone="amber">Missing: {r.missing.filter((m) => !m.includes('optional')).join(', ')}</Badge></span>
      },
    },
    { key: 't', header: 'Total', align: 'right', render: (i) => <span className="font-semibold">{PKR(i.total_incl_minor)}</span> },
  ]

  return (
    <>
      <PageHeader title="Invoices" eyebrow="Distributor" description="Gapless sale invoices, debit and credit notes with FBR readiness." />
      <Card padding="sm" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input aria-label="Search invoices" placeholder="Invoice no. or store" prefix={<Search size={15} />} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, ...['draft', 'issued', 'paid', 'void'].map((v) => ({ value: v, label: humanize(v) }))]} />
          <Select aria-label="FBR readiness" value={fbr} onChange={(e) => setFbr(e.target.value)} options={[{ value: '', label: 'All FBR states' }, { value: 'ready', label: 'FBR ready' }, { value: 'missing', label: 'Missing data' }]} />
        </div>
      </Card>
      {inv.isError ? <ErrorState error={inv.error} onRetry={() => void inv.refetch()} /> : (
        <Card padding="none">
          <Table columns={cols} rows={rows} rowKey={(i) => i.id} loading={inv.isLoading} onRowClick={(i) => setOpen(i.id)} empty={<EmptyState title="No invoices" description="Invoices are issued automatically when an order is delivered." />} />
        </Card>
      )}
      <InvoiceView invoice={open} onClose={() => setOpen(null)} />
    </>
  )
}
