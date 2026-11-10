import { useMemo } from 'react'
import { Link } from 'react-router'
import { Badge, Card, CardTitle, PageHeader, Stat, Table, statusTone } from '../../ui'
import type { Column } from '../../ui'
import { PKR, PKRCompact, pct, fmtDate, humanize } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiCreditAccountsRow, KamaiCreditExposuresRow, KamaiOrdersRow, KamaiPaymentsRow } from '../../lib/db-types'
import { OnboardingBanner } from '../lib/listing'
import { daysBetween, ErrorState, NoTenant, startOfTodayPkt, todayPktDate, useStores, useTenantId, useTq } from '../lib/data'

const STATES = ['booked', 'credit_approved', 'packed', 'dispatched', 'delivered', 'cancelled', 'rejected', 'disputed'] as const

type ExpLite = Pick<KamaiCreditExposuresRow, 'id' | 'store_id' | 'order_id' | 'due_date' | 'outstanding_minor' | 'original_minor'>
type AccLite = Pick<KamaiCreditAccountsRow, 'store_id' | 'limit_minor' | 'status' | 'tier'>

export function Component() {
  const tid = useTenantId()
  const today = todayPktDate()
  const stores = useStores()
  const orders = useTq<Pick<KamaiOrdersRow, 'id' | 'fulfilment_status' | 'total_minor'>[]>(['dash-orders', today], (t) =>
    supabase.from('kamai_orders').select('id,fulfilment_status,total_minor').eq('tenant_id', t).gte('created_at', startOfTodayPkt()).limit(5000),
  )
  const exposures = useTq<ExpLite[]>(['dash-exposures'], (t) =>
    supabase.from('kamai_credit_exposures').select('id,store_id,order_id,due_date,outstanding_minor,original_minor').eq('tenant_id', t).eq('status', 'open').gt('outstanding_minor', 0).limit(10000),
  )
  const pays = useTq<Pick<KamaiPaymentsRow, 'amount_minor' | 'channel'>[]>(['dash-pay', today], (t) =>
    supabase.from('kamai_payments').select('amount_minor,channel').eq('tenant_id', t).gte('collected_at', startOfTodayPkt()).neq('status', 'rejected').limit(5000),
  )
  const accounts = useTq<AccLite[]>(['dash-acc'], (t) => supabase.from('kamai_credit_accounts').select('store_id,limit_minor,status,tier').eq('tenant_id', t).limit(5000))

  const calc = useMemo(() => {
    const ords = orders.data ?? []
    const byState: Record<string, number> = {}
    let gmv = 0
    for (const o of ords) {
      byState[o.fulfilment_status] = (byState[o.fulfilment_status] ?? 0) + 1
      if (o.fulfilment_status !== 'cancelled' && o.fulfilment_status !== 'rejected') gmv += Number(o.total_minor)
    }
    const ex = exposures.data ?? []
    let outstanding = 0
    let par30 = 0
    const perStore = new Map<string, number>()
    const overdue: Array<ExpLite & { dpd: number }> = []
    for (const e of ex) {
      const o = Number(e.outstanding_minor)
      outstanding += o
      perStore.set(e.store_id, (perStore.get(e.store_id) ?? 0) + o)
      const dpd = daysBetween(e.due_date, today)
      if (dpd > 30) par30 += o
      if (dpd > 0) overdue.push({ ...e, dpd })
    }
    overdue.sort((a, b) => b.dpd - a.dpd)
    const cash = (pays.data ?? []).reduce((s, p) => s + Number(p.amount_minor), 0)
    const low = (accounts.data ?? [])
      .map((a) => {
        const used = perStore.get(a.store_id) ?? 0
        const lim = Number(a.limit_minor)
        return { ...a, used, util: lim > 0 ? used / lim : used > 0 ? 1 : 0 }
      })
      .filter((a) => a.util >= 0.8 || a.status === 'paused' || a.status === 'frozen')
      .sort((a, b) => b.util - a.util)
    return { byState, gmv, outstanding, par30: outstanding > 0 ? par30 / outstanding : 0, overdue, cash, low, total: ords.length }
  }, [orders.data, exposures.data, pays.data, accounts.data, today])

  if (!tid) return <NoTenant />
  const firstErr = orders.error ?? exposures.error ?? pays.error ?? accounts.error

  const overdueCols: Column<(typeof calc.overdue)[number]>[] = [
    { key: 'store', header: 'Store', render: (r) => stores.map.get(r.store_id)?.name ?? '—' },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (r) => fmtDate(r.due_date) },
    { key: 'dpd', header: 'DPD', align: 'right', render: (r) => <Badge tone={r.dpd > 30 ? 'red' : 'amber'}>{r.dpd} d</Badge> },
    { key: 'out', header: 'Outstanding', align: 'right', render: (r) => <span className="font-semibold">{PKR(r.outstanding_minor)}</span> },
  ]
  const lowCols: Column<(typeof calc.low)[number]>[] = [
    { key: 'store', header: 'Store', render: (r) => stores.map.get(r.store_id)?.name ?? '—' },
    { key: 'st', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
    { key: 'util', header: 'Used', align: 'right', render: (r) => `${PKR(r.used)} / ${PKR(r.limit_minor)} (${pct(r.util, { digits: 0 })})` },
  ]

  return (
    <>
      <PageHeader title="Dashboard" eyebrow="Distributor" description="Today at a glance: orders, receivables and credit health." />
      <OnboardingBanner />
      {firstErr ? <div className="mb-4"><ErrorState error={firstErr} /></div> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders today" value={calc.total} sub={`${calc.byState.delivered ?? 0} delivered`} />
        <Stat label="GMV today" value={PKRCompact(calc.gmv)} sub="excl. cancelled" tone="dark" />
        <Stat label="Outstanding" value={PKRCompact(calc.outstanding)} sub={`${(exposures.data ?? []).length} open invoices`} />
        <Stat label="PAR 30" value={pct(calc.par30)} tone={calc.par30 > 0.08 ? 'light' : 'green'} sub="share >30 days past due" deltaTone={calc.par30 > 0.08 ? 'bad' : 'good'} delta={calc.par30 > 0.08 ? 'Above 8% pause line' : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cash collected today" value={PKRCompact(calc.cash)} sub={`${(pays.data ?? []).length} payments`} />
        <Stat label="Overdue invoices" value={calc.overdue.length} sub="past due date" />
        <Stat label="Low-credit stores" value={calc.low.length} sub="80%+ used or paused" />
        <Stat label="Stores" value={stores.rows.length} sub="in this tenant" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Link className="text-xs font-semibold text-k-green" to="/distributor/orders">Open orders</Link>}>Orders today by state</CardTitle>
          <div className="flex flex-wrap gap-2">
            {STATES.map((s) => (
              <div key={s} className="min-w-[96px] flex-1 rounded-xl border border-k-border bg-k-surface2 px-3 py-2">
                <div className="text-xl font-extrabold text-k-dark">{calc.byState[s] ?? 0}</div>
                <Badge tone={statusTone(s)} size="sm">{humanize(s)}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card padding="none">
          <div className="p-5 pb-0"><CardTitle dot="red">Low-credit stores</CardTitle></div>
          <Table columns={lowCols} rows={calc.low.slice(0, 8)} rowKey={(r) => r.store_id} loading={accounts.isLoading} dense />
        </Card>
      </div>
      <Card padding="none" className="mt-4">
        <div className="p-5 pb-0"><CardTitle dot="amber" action={<Link className="text-xs font-semibold text-k-green" to="/distributor/credit">Credit</Link>}>Overdue list</CardTitle></div>
        <Table columns={overdueCols} rows={calc.overdue.slice(0, 15)} rowKey={(r) => r.id} loading={exposures.isLoading} dense />
      </Card>
    </>
  )
}
