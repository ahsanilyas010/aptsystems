import { useEffect, useState } from 'react'
import { Badge, Button, Input, Modal, Select, Textarea, useToast } from '../../ui'
import { PKR } from '../../lib/format'
import { toMinor } from '../../lib/money'
import type { PaymentChannel, RecordPaymentResult } from '../../lib/db-types'
import { errMsg, rpc, useRefreshAll, useStores } from '../lib/data'

const CHANNELS: PaymentChannel[] = ['cash', 'raast', 'ibft', 'easypaisa', 'jazzcash', 'cheque', 'rtp']

export function RecordPaymentModal({ open, onClose, tenantId, presetStoreId }: { open: boolean; onClose: () => void; tenantId: string; presetStoreId?: string }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const stores = useStores()
  const [storeId, setStoreId] = useState('')
  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState<PaymentChannel>('cash')
  const [ext, setExt] = useState('')
  const [refCode, setRefCode] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<RecordPaymentResult | null>(null)

  useEffect(() => {
    if (open) {
      setStoreId(presetStoreId ?? '')
      setAmount(''); setChannel('cash'); setExt(''); setRefCode(''); setNotes(''); setErr(null); setRes(null)
    }
  }, [open, presetStoreId])

  const store = stores.map.get(storeId)

  async function submit() {
    setErr(null)
    const amt = toMinor(amount)
    if (!storeId) return setErr('Choose a store')
    if (amt <= 0) return setErr('Enter an amount greater than zero')
    if (channel !== 'cash' && ext.trim().length < 6 && !notes.trim()) return setErr('Non-cash payments need an external reference (6+ characters) or a note')
    setBusy(true)
    try {
      const r = await rpc<RecordPaymentResult>('kamai_record_payment', {
        p: { tenant_id: tenantId, store_id: storeId, amount_minor: amt, channel, external_ref: ext.trim() || undefined, reference_code: refCode.trim() || undefined, notes: notes.trim() || undefined },
      })
      setRes(r)
      toast.success('Payment recorded')
      await refresh()
    } catch (e) {
      const m = errMsg(e)
      setErr(m.includes('DUPLICATE_PAYMENT') ? 'A payment with this external reference already exists.' : m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={res ? 'Payment recorded' : 'Record payment'}
      footer={res ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Record</Button></>}>
      {res ? (
        <div className="space-y-3 text-sm">
          <div className="flex gap-2"><Badge tone="green">Allocated {PKR(res.allocated_minor)}</Badge>{res.unallocated_minor > 0 ? <Badge tone="amber">Unallocated {PKR(res.unallocated_minor)}</Badge> : null}</div>
          {res.allocations.length ? (
            <ul className="space-y-1 text-[13px] text-k-muted">{res.allocations.map((a) => <li key={a.exposure_id}>{PKR(a.amount_minor)} applied to invoice {a.closed ? '(now closed)' : ''}</li>)}</ul>
          ) : <p className="text-k-muted">No open invoices to allocate against; kept as store credit.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Select label="Store" placeholder="Select store" value={storeId} onChange={(e) => { setStoreId(e.target.value); setRefCode('') }} options={stores.rows.map((s) => ({ value: s.id, label: s.name }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Amount (Rs)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as PaymentChannel)} options={CHANNELS.map((c) => ({ value: c, label: c.toUpperCase() }))} />
            <Input label="External reference" value={ext} onChange={(e) => setExt(e.target.value)} hint={channel === 'cash' ? 'Optional for cash' : 'Bank / wallet transaction id'} />
            <Input label="Reference code" value={refCode} placeholder={store?.payment_ref_code ?? ''} onChange={(e) => setRefCode(e.target.value.toUpperCase())} hint="Defaults to the store's code" />
          </div>
          <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="text-xs text-k-muted">Allocated oldest invoice first (FIFO).</p>
          {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
        </div>
      )}
    </Modal>
  )
}
