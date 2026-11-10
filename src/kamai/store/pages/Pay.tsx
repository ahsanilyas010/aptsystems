import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardTitle, EmptyState, Input, Select, statusTone, useToast } from '../../ui'
import { PKR, fmtDate } from '../../lib/format'
import { toMinor } from '../../lib/money'
import { useLang } from '../../lib/i18n'
import type { Json, PaymentChannel, ReportPaymentResult } from '../../lib/db-types'
import { daysOverdue, sumOutstanding, useExposures, useInvoiceMap, usePayments, useStoreCtx, useStoreRow, useTenantRow } from '../lib/data'
import { CopyButton, ErrorBox, Loading } from '../lib/parts'
import '../lib/strings'

const CHANNELS: Array<{ v: PaymentChannel; label: string }> = [
  { v: 'raast', label: 'Raast' },
  { v: 'ibft', label: 'Bank transfer (IBFT)' },
  { v: 'easypaisa', label: 'Easypaisa' },
  { v: 'jazzcash', label: 'JazzCash' },
]

function settingStr(settings: Json | undefined, key: string): string {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const v = settings[key]
    if (typeof v === 'string') return v
  }
  return ''
}

export function Component() {
  const { t } = useLang()
  const toast = useToast()
  const qc = useQueryClient()
  const ctx = useStoreCtx()
  const store = useStoreRow(ctx)
  const tenant = useTenantRow(ctx)
  const exposures = useExposures(ctx)
  const payments = usePayments(ctx)
  const ids = useMemo(() => (exposures.data ?? []).map((e) => e.invoice_id).filter((x): x is string => !!x), [exposures.data])
  const invs = useInvoiceMap(ctx, ids)

  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState<PaymentChannel>('raast')
  const [txn, setTxn] = useState('')
  const [done, setDone] = useState(false)

  const outstanding = sumOutstanding(exposures.data)
  const iban = tenant.data?.bank_iban || settingStr(tenant.data?.settings, 'bank_iban')
  const raast = tenant.data?.raast_alias || settingStr(tenant.data?.settings, 'raast_alias')
  const refCode = store.data?.payment_ref_code

  const amountMinor = toMinor(amount)
  const valid = amountMinor > 0 && txn.trim().length >= 6

  const pay = useMutation({
    mutationFn: async () => {
      // Store members cannot record payments; they report one, which the distributor verifies.
      const { data, error } = await supabase.rpc('kamai_report_payment', {
        p_store_id: ctx!.storeId,
        p_amount_minor: amountMinor,
        p_method: channel,
        p_reference: txn.trim(),
        p_order_id: null,
      })
      if (error) throw new Error(error.message)
      return data as ReportPaymentResult
    },
    onSuccess: () => {
      setDone(true)
      setAmount('')
      setTxn('')
      toast.success(t('st_paid_ok'))
      void qc.invalidateQueries({ queryKey: ['kamai-store'] })
    },
    onError: (e: Error) => toast.error(/not allowed|42501/i.test(e.message) ? t('st_paid_denied') : e.message, { duration: 9000 }),
  })

  if (!ctx || exposures.isLoading) return <Loading />

  return (
    <div className="flex flex-col gap-4">
      <Card tone="dark">
        <div className="text-xs font-bold uppercase tracking-[2px] text-k-green-mid">{t('st_outstanding')}</div>
        <div className="mt-2 text-4xl font-extrabold text-white">{exposures.error ? '—' : PKR(outstanding)}</div>
      </Card>

      <Card>
        <CardTitle>{t('st_inv_due')}</CardTitle>
        {exposures.error ? (
          <ErrorBox error={exposures.error} onRetry={() => void exposures.refetch()} />
        ) : (exposures.data ?? []).length === 0 ? (
          <EmptyState compact icon={<CheckCircle2 size={18} />} title={t('st_no_open_inv')} description={t('st_no_due')} />
        ) : (
          <ul className="divide-y divide-k-border">
            {(exposures.data ?? []).map((e) => {
              const od = daysOverdue(e.due_date)
              const inv = e.invoice_id ? invs.data?.[e.invoice_id] : undefined
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm font-bold text-k-dark">{inv?.display_number ?? fmtDate(e.origination_date)}</div>
                    <div className={od > 0 ? 'text-xs font-semibold text-k-red' : 'text-xs text-k-muted'}>
                      {od > 0 ? t('st_overdue_by', { n: od }) : t('st_due_on', { date: fmtDate(e.due_date) })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-extrabold text-k-dark">{PKR(e.outstanding_minor)}</div>
                    {Number(e.paid_minor) > 0 ? <div className="text-xs text-k-muted">{PKR(e.paid_minor)} {t('paid')}</div> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t('st_how_pay')}</CardTitle>
        {tenant.error ? <ErrorBox error={tenant.error} onRetry={() => void tenant.refetch()} /> : null}
        {!iban && !raast && !tenant.isLoading && !tenant.error ? <p className="mb-3 text-sm text-k-muted">{t('st_no_bank')}</p> : null}
        {iban ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[1px] text-k-muted">{t('st_iban')}</div>
              <div className="break-all text-sm font-bold text-k-dark">{iban}</div>
            </div>
            <CopyButton value={iban} />
          </div>
        ) : null}
        {raast ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[1px] text-k-muted">{t('st_raast')}</div>
              <div className="break-all text-sm font-bold text-k-dark">{raast}</div>
            </div>
            <CopyButton value={raast} />
          </div>
        ) : null}
        {refCode ? (
          <div className="rounded-xl bg-k-green-light p-3">
            <div className="text-xs font-bold uppercase tracking-[1px] text-k-green">{t('st_ref_code')}</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="text-2xl font-extrabold tracking-wider text-k-dark">{refCode}</div>
              <CopyButton value={refCode} />
            </div>
            <p className="mt-1 text-xs text-k-muted">{t('st_ref_hint')}</p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>{t('st_i_paid')}</CardTitle>
        {done ? (
          <div className="mb-3 rounded-xl bg-k-green-light px-3 py-2 text-sm font-bold text-k-green">{t('st_paid_ok')}</div>
        ) : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setDone(false)
            if (valid) pay.mutate()
          }}
        >
          <Input
            size="lg"
            label={t('st_amount')}
            inputMode="decimal"
            placeholder={outstanding > 0 ? String(Math.round(outstanding / 100)) : '0'}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <Select label={t('st_channel')} value={channel} onChange={(e) => setChannel(e.target.value as PaymentChannel)} options={CHANNELS.map((c) => ({ value: c.v, label: c.label }))} />
          <Input size="lg" label={t('st_txn_id')} hint={t('st_txn_hint')} value={txn} onChange={(e) => setTxn(e.target.value)} autoCapitalize="characters" />
          <Button type="submit" size="lg" block disabled={!valid} loading={pay.isPending}>
            {t('st_submit_paid')}
          </Button>
        </form>
      </Card>

      {(payments.data ?? []).length > 0 ? (
        <Card>
          <CardTitle>{t('st_recent_pay')}</CardTitle>
          <ul className="divide-y divide-k-border">
            {(payments.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-sm font-bold text-k-dark">{PKR(p.amount_minor)}</div>
                  <div className="text-xs text-k-muted">
                    {fmtDate(p.collected_at)} · {p.channel}
                  </div>
                </div>
                <Badge tone={statusTone(p.status)}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {payments.error ? <ErrorBox error={payments.error} /> : null}
    </div>
  )
}
