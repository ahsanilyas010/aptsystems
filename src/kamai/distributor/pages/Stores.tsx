import { useMemo, useState } from 'react'
import { Plus, Search, Upload } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table, statusTone } from '../../ui'
import type { Column } from '../../ui'
import { PKR, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiCreditAccountsRow, KamaiStoresRow } from '../../lib/db-types'
import { ErrorState, NoTenant, useCan, useStores, useTenantId, useTq } from '../lib/data'
import { AddStoreModal, TIERS } from '../parts/AddStoreModal'
import { ImportStoresModal } from '../parts/ImportStoresModal'
import { StoreDrawer } from '../parts/StoreDrawer'

type AccLite = Pick<KamaiCreditAccountsRow, 'store_id' | 'tier' | 'limit_minor' | 'status'>

export function Component() {
  const tid = useTenantId()
  const canEdit = useCan(['owner', 'manager', 'booker'])
  const stores = useStores()
  const accs = useTq<AccLite[]>(['accts-lite'], (t) => supabase.from('kamai_credit_accounts').select('store_id,tier,limit_minor,status').eq('tenant_id', t).limit(5000))
  const [q, setQ] = useState('')
  const [tier, setTier] = useState('')
  const [credit, setCredit] = useState('')
  const [status, setStatus] = useState('')
  const [add, setAdd] = useState(false)
  const [imp, setImp] = useState(false)
  const [sel, setSel] = useState<KamaiStoresRow | null>(null)

  const accMap = useMemo(() => new Map((accs.data ?? []).map((a) => [a.store_id, a])), [accs.data])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return stores.rows.filter((r) => {
      if (tier && r.tier !== tier) return false
      if (status && r.status !== status) return false
      const cs = accMap.get(r.id)?.status ?? r.credit_status
      if (credit && cs !== credit) return false
      if (!s) return true
      return [r.name, r.owner_name, r.mobile, r.area, r.payment_ref_code].some((v) => v?.toLowerCase().includes(s))
    })
  }, [stores.rows, accMap, q, tier, credit, status])

  if (!tid) return <NoTenant />

  const cols: Column<KamaiStoresRow>[] = [
    {
      key: 'name',
      header: 'Store',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-k-dark">{r.name}</div>
          <div className="text-xs text-k-muted">{r.owner_name ?? '—'} · {r.mobile ?? 'no mobile'}</div>
        </div>
      ),
    },
    { key: 'area', header: 'Area', hideOnMobile: true, render: (r) => r.area ?? '—' },
    { key: 'tier', header: 'Price tier', hideOnMobile: true, render: (r) => r.tier ?? 'default' },
    { key: 'terms', header: 'Terms', hideOnMobile: true, render: (r) => (r.payment_terms_days ? `${r.payment_terms_days} d` : 'COD') },
    {
      key: 'credit',
      header: 'Credit',
      render: (r) => {
        const a = accMap.get(r.id)
        const st = a?.status ?? r.credit_status
        return (
          <div>
            <Badge tone={statusTone(st)}>{humanize(st)}</Badge>
            <div className="mt-0.5 text-xs text-k-muted">{a ? `T${a.tier} · ${PKR(a.limit_minor)}` : PKR(r.credit_limit_minor)}</div>
          </div>
        )
      },
    },
    { key: 'status', header: 'Status', hideOnMobile: true, render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
  ]

  return (
    <>
      <PageHeader
        title="Stores"
        eyebrow="Distributor"
        description="Retail customers, their credit terms and logins."
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" icon={<Upload size={15} />} onClick={() => setImp(true)}>Import CSV</Button>
              <Button icon={<Plus size={15} />} onClick={() => setAdd(true)}>Add store</Button>
            </>
          ) : null
        }
      />
      <Card padding="sm" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input aria-label="Search stores" placeholder="Search name, owner, mobile, area, ref code" prefix={<Search size={15} />} className="sm:col-span-2 lg:col-span-1" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Price tier" value={tier} onChange={(e) => setTier(e.target.value)} options={[{ value: '', label: 'All price tiers' }, ...TIERS]} />
          <Select aria-label="Credit status" value={credit} onChange={(e) => setCredit(e.target.value)} options={[{ value: '', label: 'All credit statuses' }, ...['cash_only', 'active', 'paused', 'frozen', 'written_off'].map((v) => ({ value: v, label: humanize(v) }))]} />
          <Select aria-label="Store status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }]} />
        </div>
      </Card>
      {stores.isError ? <ErrorState error={stores.error} onRetry={() => void stores.refetch()} /> : null}
      {!stores.isError ? (
        <Card padding="none">
          <Table
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            loading={stores.isLoading}
            onRowClick={setSel}
            empty={<EmptyState title={stores.rows.length ? 'No stores match these filters' : 'No stores yet'} description={stores.rows.length ? undefined : 'Add your first store or import a CSV.'} />}
            footer={rows.length ? <tr><td colSpan={cols.length} className="px-4 py-2 text-xs text-k-muted">{rows.length} of {stores.rows.length} stores</td></tr> : undefined}
          />
        </Card>
      ) : null}
      <AddStoreModal open={add} onClose={() => setAdd(false)} tenantId={tid} />
      <ImportStoresModal open={imp} onClose={() => setImp(false)} tenantId={tid} />
      <StoreDrawer key={sel?.id} store={sel} onClose={() => setSel(null)} />
    </>
  )
}
