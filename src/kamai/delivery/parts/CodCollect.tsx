import { useState } from 'react'
import { Banknote } from 'lucide-react'
import { Button, Card, CardTitle, Input, Select, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR } from '../../lib/format'
import { toMinor, fromMinor } from '../../lib/money'
import { errMsg, type OrderRow } from '../lib/data'

const CHANNELS = [
  { value: 'cash', label: 'Cash' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'raast', label: 'Raast' },
]

export function CodCollect({ tenantId, order, paidMinor, onDone }: { tenantId: string; order: OrderRow; paidMinor: number; onDone: () => void }) {
  const toast = useToast()
  const due = Math.max(0, Number(order.total_minor) - paidMinor)
  const [amount, setAmount] = useState(String(fromMinor(due)))
  const [channel, setChannel] = useState('cash')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (due <= 0) {
    return (
      <Card padding="sm" tone="green">
        <div className="flex items-center gap-2 font-bold"><Banknote size={18} />COD wasool ho chuka: {PKR(paidMinor)}</div>
      </Card>
    )
  }

  async function submit() {
    setError(null)
    const minor = toMinor(amount)
    if (minor <= 0) return setError('Raqam likhein. / Enter an amount.')
    if (channel !== 'cash' && ref.trim().length < 6) return setError('Non-cash ke liye reference (6+ characters) zaroori hai. / A reference of 6+ characters is required for non-cash.')
    if (!navigator.onLine) return setError('Internet nahi hai. Wapas online ho kar payment record karein. / You are offline; record the payment when back online.')
    setBusy(true)
    try {
      const { error: e } = await supabase.rpc('kamai_record_payment', {
        p: { tenant_id: tenantId, store_id: order.store_id, order_id: order.id, amount_minor: minor, channel, ...(ref.trim() ? { external_ref: ref.trim() } : {}) },
      })
      if (e) throw e
      toast.success('Payment record ho gayi. / Payment recorded.')
      onDone()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card padding="sm">
      <CardTitle dot="amber">COD wasooli</CardTitle>
      <div className="mb-3 flex items-end justify-between">
        <span className="text-sm text-k-muted">Baqaya / Amount to collect</span>
        <span className="text-2xl font-extrabold text-k-red">{PKR(due)}</span>
      </div>
      <div className="flex flex-col gap-3">
        <Input label="Raqam (Rs)" inputMode="decimal" size="lg" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Tareeqa" size="lg" value={channel} onChange={(e) => setChannel(e.target.value)} options={CHANNELS} />
        {channel !== 'cash' ? <Input label="Reference / TID" size="lg" value={ref} onChange={(e) => setRef(e.target.value)} /> : null}
        {error ? <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">{error}</div> : null}
        <Button size="lg" block loading={busy} onClick={() => void submit()}>Wasooli record karein</Button>
      </div>
    </Card>
  )
}
