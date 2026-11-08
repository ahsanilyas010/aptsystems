import { useState } from 'react'
import { useNavigate } from 'react-router'
import { KeyRound, Pencil, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardTitle, Table, Tabs, statusTone, useToast } from '../../ui'
import type { Column } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate, fmtDateTime, humanize, padNo } from '../../lib/format'
import type { KamaiCreditAccountsRow, KamaiInvoicesRow, KamaiOrdersRow, KamaiPaymentsRow, KamaiStoresRow } from '../../lib/db-types'
import { Drawer, Dl } from '../lib/Drawer'
import { Gate, errMsg, rpc, useCan, useRefreshAll, useTenantRow, useTq } from '../lib/data'
import { CreditOverrideModal } from './CreditOverrideModal'
import { ProvisionModal, type ProvisionTarget } from './ProvisionModal'

type Tab = 'overview' | 'invoices' | 'payments' | 'orders'

export function StoreDrawer({ store, onClose }: { store: KamaiStoresRow | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  if (!store) return null
  return (
    <Drawer open onClose={onClose} title={store.name} subtitle={`${store.area ?? 'No area'} · ${store.payment_ref_code}`}>
      <Tabs<Tab>
        variant="pills"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'invoices', label: 'Invoices' },
          { key: 'payments', label: 'Payments' },
          { key: 'orders', label: 'Orders' },
        ]}
      />
      {tab === 'overview' ? <Overview store={store} /> : null}
      {tab === 'invoices' ? <Invoices storeId={store.id} /> : null}
      {tab === 'payments' ? <Payments storeId={store.id} /> : null}
      {tab === 'orders' ? <Orders storeId={store.id} /> : null}
    </Drawer>
  )
}

function Overview({ store }: { store: KamaiStoresRow }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const tenant = useTenantRow()
  const canManage = useCan(['owner', 'manager'])
  const canEval = useCan(['owner', 'manager', 'finance'])
  const acc = useTq<KamaiCreditAccountsRow | null>(['acct', store.id], (t) => supabase.from('kamai_credit_accounts').select('*').eq('tenant_id', t).eq('store_id', store.id).maybeSingle())
  const out = useTq<number>(['outstanding', store.id], async () => {
    try {
      return { data: Number(await rpc<number>('kamai_store_outstanding', { p_store_id: store.id })), error: null }
    } catch (e) {
      return { data: null, error: { message: errMsg(e) } }
    }
  })
  const [override, setOverride] = useState(false)
  const [prov, setProv] = useState<ProvisionTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const a = acc.data

  async function evaluate() {
    setBusy(true)
    try {
      await rpc('kamai_evaluate_store', { p_store_id: store.id })
      toast.success('Evaluation complete')
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardTitle>Store</CardTitle>
        <Dl
          items={[
            ['Owner', store.owner_name],
            ['Mobile', store.mobile],
            ['Address', store.address],
            ['Category', store.category],
            ['Price tier', store.tier],
            ['Payment terms', `${store.payment_terms_days} days`],
            ['Status', <Badge key="s" tone={statusTone(store.status)}>{humanize(store.status)}</Badge>],
            ['Location', store.latitude != null && store.longitude != null ? `${store.latitude.toFixed(5)}, ${store.longitude.toFixed(5)}` : 'Not set'],
          ]}
        />
      </Card>
      <Card>
        <CardTitle
          dot="amber"
          action={
            <span className="flex gap-1.5">
              {canEval ? <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} loading={busy} onClick={evaluate}>Evaluate</Button> : null}
              {canManage && a ? <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setOverride(true)}>Edit limit</Button> : null}
            </span>
          }
        >
          Credit account
        </CardTitle>
        <Gate q={acc} isEmpty={!a} empty={<p className="text-sm text-k-muted">No credit account yet. Run an evaluation to create one.</p>}>
          {a ? (
            <Dl
              items={[
                ['Tier', `Tier ${a.tier}`],
                ['Status', <Badge key="s" tone={statusTone(a.status)}>{humanize(a.status)}</Badge>],
                ['Limit', PKR(a.limit_minor)],
                ['Outstanding', out.data != null ? PKR(out.data) : '—'],
                ['Tenor', `${a.tenor_days} days`],
                ['Reviewed', fmtDate(a.last_reviewed_at)],
                ['Reason codes', a.reason_codes?.join(', ') || '—'],
              ]}
            />
          ) : null}
        </Gate>
      </Card>
      {canManage ? (
        <Card>
          <CardTitle dot="none">Store login</CardTitle>
          <p className="mb-3 text-[13px] text-k-muted">Create a mobile + 6-digit PIN login so this store can order from the phone app.</p>
          <Button
            icon={<KeyRound size={15} />}
            onClick={() => setProv({ tenantId: store.tenant_id, tenantName: tenant.data?.name ?? 'Distributor', role: 'store', storeId: store.id, fullName: store.owner_name ?? store.name, mobile: store.mobile })}
          >
            Provision login
          </Button>
        </Card>
      ) : null}
      <CreditOverrideModal account={override ? a ?? null : null} storeName={store.name} onClose={() => setOverride(false)} />
      <ProvisionModal target={prov} onClose={() => setProv(null)} />
    </>
  )
}

function Invoices({ storeId }: { storeId: string }) {
  const q = useTq<KamaiInvoicesRow[]>(['s-inv', storeId], (t) => supabase.from('kamai_invoices').select('*').eq('tenant_id', t).eq('store_id', storeId).order('invoice_date', { ascending: false }).limit(100))
  const cols: Column<KamaiInvoicesRow>[] = [
    { key: 'n', header: 'Invoice', render: (r) => r.display_number },
    { key: 'd', header: 'Date', render: (r) => fmtDate(r.invoice_date) },
    { key: 's', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
    { key: 't', header: 'Total', align: 'right', render: (r) => PKR(r.total_incl_minor) },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<p className="p-5 text-sm text-k-muted">No invoices yet.</p>}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} dense />
      </Gate>
    </Card>
  )
}

function Payments({ storeId }: { storeId: string }) {
  const q = useTq<KamaiPaymentsRow[]>(['s-pay', storeId], (t) => supabase.from('kamai_payments').select('*').eq('tenant_id', t).eq('store_id', storeId).order('collected_at', { ascending: false }).limit(100))
  const cols: Column<KamaiPaymentsRow>[] = [
    { key: 'd', header: 'Date', render: (r) => fmtDateTime(r.collected_at) },
    { key: 'c', header: 'Channel', render: (r) => humanize(r.channel) },
    { key: 's', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
    { key: 'a', header: 'Amount', align: 'right', render: (r) => PKR(r.amount_minor) },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<p className="p-5 text-sm text-k-muted">No payments yet.</p>}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} dense />
      </Gate>
    </Card>
  )
}

function Orders({ storeId }: { storeId: string }) {
  const nav = useNavigate()
  const q = useTq<KamaiOrdersRow[]>(['s-ord', storeId], (t) => supabase.from('kamai_orders').select('*').eq('tenant_id', t).eq('store_id', storeId).order('created_at', { ascending: false }).limit(100))
  const cols: Column<KamaiOrdersRow>[] = [
    { key: 'n', header: 'Order', render: (r) => padNo('#', r.order_no, 5) },
    { key: 'd', header: 'Date', render: (r) => fmtDate(r.created_at) },
    { key: 's', header: 'Status', render: (r) => <Badge tone={statusTone(r.fulfilment_status)}>{humanize(r.fulfilment_status)}</Badge> },
    { key: 't', header: 'Total', align: 'right', render: (r) => PKR(r.total_minor) },
  ]
  return (
    <Card padding="none">
      <Gate q={q} isEmpty={!q.data?.length} empty={<p className="p-5 text-sm text-k-muted">No orders yet.</p>}>
        <Table columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} dense onRowClick={(r) => nav(`/distributor/orders/${r.id}`)} />
      </Gate>
    </Card>
  )
}
