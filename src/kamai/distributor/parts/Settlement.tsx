import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Card, CardTitle, Input, useToast } from '../../ui'
import { downloadRowsAsCsv } from '../../lib/csv'
import { supabase } from '../../lib/supabase'
import { PKR } from '../../lib/format'
import { fromMinor } from '../../lib/money'
import { errMsg, todayPktDate, useStores, useTenantId } from '../lib/data'

function weekStart(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`)
  const day = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - day)
  return dt.toISOString().slice(0, 10)
}
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

export function Settlement() {
  const tid = useTenantId()
  const toast = useToast()
  const stores = useStores()
  const [from, setFrom] = useState(() => addDays(weekStart(todayPktDate()), -7))
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ invoiced: number; collected: number; count: number } | null>(null)
  const to = addDays(from, 6)

  async function exportCsv() {
    if (!tid) return
    setBusy(true)
    try {
      const startIso = new Date(`${from}T00:00:00+05:00`).toISOString()
      const endIso = new Date(`${addDays(from, 7)}T00:00:00+05:00`).toISOString()
      const [inv, pay] = await Promise.all([
        supabase.from('kamai_invoices').select('display_number,invoice_type,invoice_date,store_id,total_excl_st_minor,sales_tax_minor,total_incl_minor,status').eq('tenant_id', tid).gte('invoice_date', from).lte('invoice_date', to).neq('status', 'void').order('invoice_date').limit(5000),
        supabase.from('kamai_payments').select('collected_at,store_id,channel,amount_minor,external_ref,reference_code,status').eq('tenant_id', tid).gte('collected_at', startIso).lt('collected_at', endIso).neq('status', 'rejected').order('collected_at').limit(5000),
      ])
      if (inv.error) throw new Error(inv.error.message)
      if (pay.error) throw new Error(pay.error.message)
      const name = (id: string) => stores.map.get(id)?.name ?? id
      const rows: Array<Record<string, string | number>> = []
      let invoiced = 0
      let collected = 0
      for (const i of inv.data ?? []) {
        const sign = i.invoice_type === 'Credit Note' ? -1 : 1
        invoiced += sign * Number(i.total_incl_minor)
        rows.push({ section: 'Invoice', date: i.invoice_date, reference: i.display_number, store: name(i.store_id), detail: `${i.invoice_type} (${i.status})`, excl_tax: sign * fromMinor(i.total_excl_st_minor), sales_tax: sign * fromMinor(i.sales_tax_minor), debit: sign > 0 ? fromMinor(i.total_incl_minor) : 0, credit: sign < 0 ? fromMinor(i.total_incl_minor) : 0 })
      }
      for (const p of pay.data ?? []) {
        collected += Number(p.amount_minor)
        rows.push({ section: 'Payment', date: String(p.collected_at).slice(0, 10), reference: p.external_ref ?? p.reference_code ?? '', store: name(p.store_id), detail: p.channel, excl_tax: '', sales_tax: '', debit: 0, credit: fromMinor(p.amount_minor) })
      }
      rows.push({ section: 'Summary', date: `${from} to ${to}`, reference: '', store: '', detail: 'Invoiced (net of credit notes)', excl_tax: '', sales_tax: '', debit: fromMinor(invoiced), credit: 0 })
      rows.push({ section: 'Summary', date: `${from} to ${to}`, reference: '', store: '', detail: 'Collected', excl_tax: '', sales_tax: '', debit: 0, credit: fromMinor(collected) })
      rows.push({ section: 'Summary', date: `${from} to ${to}`, reference: '', store: '', detail: 'Net movement in receivables', excl_tax: '', sales_tax: '', debit: fromMinor(invoiced - collected), credit: 0 })
      setSummary({ invoiced, collected, count: (inv.data?.length ?? 0) + (pay.data?.length ?? 0) })
      downloadRowsAsCsv(`settlement-${from}`, rows, ['section', 'date', 'reference', 'store', 'detail', 'excl_tax', 'sales_tax', 'debit', 'credit'])
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-xl">
      <CardTitle>Weekly settlement statement</CardTitle>
      <p className="mb-4 text-[13px] text-k-muted">Invoices and collections for a Monday to Sunday week, exported as CSV for the brand or lender.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Week starting" type="date" value={from} onChange={(e) => setFrom(weekStart(e.target.value || from))} />
        <div className="pb-2 text-sm text-k-muted">to {to}</div>
        <Button icon={<Download size={15} />} loading={busy} onClick={exportCsv}>Export CSV</Button>
      </div>
      {summary ? <p className="mt-4 text-sm text-k-text">{summary.count} lines. Invoiced {PKR(summary.invoiced)}, collected {PKR(summary.collected)}.</p> : null}
    </Card>
  )
}
