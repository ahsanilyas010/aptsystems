import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Camera } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, Input, PageHeader, Select, Spinner, Stat, Textarea, statusTone, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate } from '../../lib/format'
import { toMinor } from '../../lib/money'
import type { KamaiCashDepositsRow, KamaiPaymentsRow } from '../../lib/db-types'
import { CASH_CAP_MINOR, errMsg, karachiDate, startOfKarachiDay, useRiderTenant } from '../lib/data'
import { resizeImage, uploadPod } from '../lib/media'
import { ErrorState } from '../parts/States'

// UI channel -> DB enum (bank | office | raast | other); the UI label is kept in notes.
const METHODS = [
  { value: 'cdm', label: 'CDM (cash deposit machine)', db: 'bank' },
  { value: 'branch', label: 'Bank branch', db: 'bank' },
  { value: 'wallet_raast', label: 'Wallet / Raast', db: 'raast' },
  { value: 'agent', label: 'Agent / office', db: 'other' },
] as const

type Pay = Pick<KamaiPaymentsRow, 'id' | 'amount_minor' | 'channel' | 'collected_at'>

export function Component() {
  const { tenantId, userId } = useRiderTenant()
  const qc = useQueryClient()
  const toast = useToast()
  const today = karachiDate()
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('cdm')
  const [amount, setAmount] = useState('')
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [slip, setSlip] = useState<Blob | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['delivery', 'cash', tenantId, userId, today],
    enabled: Boolean(tenantId && userId),
    queryFn: async () => {
      const [pay, dep] = await Promise.all([
        supabase.from('kamai_payments').select('id,amount_minor,channel,collected_at').eq('tenant_id', tenantId as string).eq('collected_by', userId as string).gte('collected_at', startOfKarachiDay(today)),
        supabase.from('kamai_cash_deposits').select('*').eq('tenant_id', tenantId as string).eq('rider_user_id', userId as string).order('business_date', { ascending: false }).limit(30),
      ])
      if (pay.error) throw pay.error
      if (dep.error) throw dep.error
      return { payments: (pay.data ?? []) as Pay[], deposits: (dep.data ?? []) as KamaiCashDepositsRow[] }
    },
  })

  const close = useMutation({
    mutationFn: async () => {
      const minor = toMinor(amount)
      if (!(minor >= 0) || amount.trim() === '') throw new Error('Jama ki raqam likhein. / Enter the deposited amount.')
      if (ref.trim().length < 4) throw new Error('Deposit reference zaroori hai. / A deposit reference is required.')
      let slipUrl: string | null = null
      if (slip) {
        const r = await uploadPod(`${tenantId}/cash/${today}/slip.jpg`, slip, 'image/jpeg')
        if (r.error) throw new Error(r.error)
        slipUrl = r.url
      }
      const m = METHODS.find((x) => x.value === method)!
      const { data, error } = await supabase.rpc('kamai_close_cash_day', {
        p_tenant: tenantId, p_rider_user_id: userId, p_business_date: today, p_deposited_minor: minor,
        p_method: m.db, p_deposit_ref: ref.trim(), p_slip_url: slipUrl, p_notes: [`via ${m.value}`, notes.trim()].filter(Boolean).join(' | '),
      })
      if (error) throw error
      return data as KamaiCashDepositsRow
    },
    onSuccess: (row) => {
      const v = Number(row?.variance_minor ?? 0)
      if (v === 0) toast.success('Din band, cash match hai. / Day closed, cash matches.')
      else toast.warning(`Din band, farq ${PKR(v, { sign: true })}. / Closed with variance.`)
      setAmount(''); setRef(''); setNotes(''); setSlip(null); setFormErr(null)
      void qc.invalidateQueries({ queryKey: ['delivery', 'cash'] })
    },
    onError: (e) => setFormErr(errMsg(e)),
  })

  if (!tenantId) return <EmptyState title="Rider tenant nahi mila" />
  if (q.isLoading) return <Spinner label="Cash load ho raha hai…" />
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />

  const { payments, deposits } = q.data!
  const total = payments.reduce((a, p) => a + Number(p.amount_minor), 0)
  const cash = payments.filter((p) => p.channel === 'cash').reduce((a, p) => a + Number(p.amount_minor), 0)
  const byMethod = new Map<string, number>()
  for (const p of payments) byMethod.set(p.channel, (byMethod.get(p.channel) ?? 0) + Number(p.amount_minor))
  const todayDep = deposits.find((d) => d.business_date === today)
  const onHand = Math.max(0, cash - Number(todayDep?.deposited_minor ?? 0))
  const typed = amount.trim() === '' ? null : toMinor(amount)
  const variance = typed == null ? null : typed - cash

  return (
    <>
      <PageHeader title="Cash" eyebrow={`Aaj · ${fmtDate(today)}`} />
      <div className="flex flex-col gap-4">
        {onHand > CASH_CAP_MINOR ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-k-red-light px-4 py-3 text-sm font-semibold text-k-red">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            Aapke paas {PKR(onHand)} cash hai, limit Rs 50,000 se zyada. Foran jama karwayein. / Cash on hand exceeds the Rs 50,000 cap; deposit now.
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Aaj ki wasooli" value={PKR(total)} />
          <Stat label="Cash (expected)" value={PKR(cash)} />
        </div>
        <Card padding="sm">
          <CardTitle>Tareeqe ke hisaab se</CardTitle>
          {byMethod.size === 0 ? <p className="text-sm text-k-muted">Aaj abhi koi wasooli nahi. / No collections yet today.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {[...byMethod.entries()].map(([k, v]) => <li key={k} className="flex justify-between"><span className="capitalize">{k}</span><span className="font-bold">{PKR(v)}</span></li>)}
            </ul>
          )}
        </Card>

        <Card padding="sm">
          <CardTitle dot="amber" action={todayDep ? <Badge tone={statusTone(todayDep.status)}>{todayDep.status}</Badge> : undefined}>Din band / Deposit</CardTitle>
          <div className="flex flex-col gap-3">
            <Select label="Jama kahan kiya" size="lg" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
            <Input label="Jama ki raqam (Rs)" inputMode="decimal" size="lg" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Expected cash: ${PKR(cash)}`} />
            {variance != null ? (
              <div className={variance === 0 ? 'text-sm font-bold text-k-green' : 'text-sm font-bold text-k-red'}>
                Farq / Variance: {PKR(variance, { sign: true })}{variance === 0 ? ' (match)' : variance < 0 ? ' (kam)' : ' (zyada)'}
              </div>
            ) : null}
            <Input label="Deposit reference / slip no." size="lg" value={ref} onChange={(e) => setRef(e.target.value)} />
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-k-border bg-k-surface text-sm font-semibold text-k-dark">
              <Camera size={18} />{slip ? 'Slip photo lagi hui' : 'Slip ki photo lein'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void resizeImage(f).then(setSlip).catch((x) => setFormErr(errMsg(x))) }} />
            </label>
            <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {formErr ? <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">{formErr}</div> : null}
            <Button size="lg" block loading={close.isPending} onClick={() => { setFormErr(null); close.mutate() }}>{todayDep ? 'Deposit update karein' : 'Din band karein'}</Button>
          </div>
        </Card>

        <Card padding="sm">
          <CardTitle>Pichle deposits</CardTitle>
          {deposits.length === 0 ? <EmptyState compact title="Abhi koi deposit nahi" /> : (
            <ul className="flex flex-col divide-y divide-k-border">
              {deposits.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="font-semibold text-k-dark">{fmtDate(d.business_date)}</div>
                    <div className="text-xs text-k-muted">{d.method}{d.deposit_ref ? ` · ${d.deposit_ref}` : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{PKR(d.deposited_minor)}</div>
                    <div className="flex items-center justify-end gap-1.5">
                      {Number(d.variance_minor) !== 0 ? <span className="text-xs font-semibold text-k-red">{PKR(d.variance_minor, { sign: true })}</span> : null}
                      <Badge size="sm" tone={statusTone(d.status)}>{d.status}</Badge>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
