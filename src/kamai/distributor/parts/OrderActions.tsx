import { useState } from 'react'
import { Button, Input, Modal, Select, Textarea, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import type { FulfilmentStatus, KamaiMembershipsRow } from '../../lib/db-types'
import { humanize } from '../../lib/format'
import { Gate, errMsg, rpc, useRefreshAll, useTq } from '../lib/data'

export type TransitionTarget = Exclude<FulfilmentStatus, 'delivered' | 'disputed'>

/** Allowed manual transitions per state (delivery goes through the rider app). */
export const NEXT: Partial<Record<FulfilmentStatus, TransitionTarget[]>> = {
  booked: ['credit_approved', 'rejected', 'cancelled'],
  credit_approved: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['cancelled'],
}

export const NEEDS_REASON = new Set<string>(['cancelled', 'rejected', 'credit_approved'])

const LABEL: Record<TransitionTarget, string> = {
  booked: 'Book',
  credit_approved: 'Approve credit (override)',
  packed: 'Mark packed',
  dispatched: 'Dispatch',
  cancelled: 'Cancel order',
  rejected: 'Reject order',
}
export const transitionLabel = (t: TransitionTarget) => LABEL[t]

export function TransitionModal({ orderId, orderNo, to, onClose }: { orderId: string; orderNo?: number; to: TransitionTarget | null; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!to) return null
  const need = NEEDS_REASON.has(to)
  async function go() {
    if (!to) return
    if (need && reason.trim().length < 3) return setErr('A reason is required')
    setBusy(true)
    setErr(null)
    try {
      await rpc('kamai_transition_order', { p_order_id: orderId, p_to_state: to, p_reason: reason.trim() || null, p_meta: {} })
      toast.success(`Order ${humanize(to).toLowerCase()}`)
      await refresh()
      setReason('')
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  const danger = to === 'cancelled' || to === 'rejected'
  return (
    <Modal open onClose={onClose} size="sm" title={`${LABEL[to]}${orderNo ? ` #${orderNo}` : ''}`}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={danger ? 'danger' : 'primary'} onClick={go} loading={busy}>Confirm</Button></>}>
      <div className="space-y-3">
        {to === 'credit_approved' ? <p className="text-[13px] text-k-muted">Overrides the credit hold. Only a manager or owner may do this and the reason is logged.</p> : null}
        {need ? <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus /> : <p className="text-sm text-k-muted">Move this order to <b>{humanize(to)}</b>?</p>}
        {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      </div>
    </Modal>
  )
}

export function AssignRiderModal({ orderId, tenantId, current, open, onClose }: { orderId: string; tenantId: string; current: string | null; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const riders = useTq<KamaiMembershipsRow[]>(['riders'], (t) => supabase.from('kamai_memberships').select('*').eq('tenant_id', t).eq('role', 'rider').eq('status', 'active'), { enabled: open })
  const [rider, setRider] = useState('')
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!open) return null
  async function go() {
    const id = manual.trim() || rider
    if (!id) return setErr('Choose a rider')
    setBusy(true)
    setErr(null)
    try {
      await rpc('kamai_assign_rider', { p_order_id: orderId, p_rider_user_id: id })
      toast.success('Rider assigned')
      await refresh()
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  void tenantId
  return (
    <Modal open onClose={onClose} size="sm" title="Assign rider" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Assign</Button></>}>
      <div className="space-y-3">
        <Gate q={riders} isEmpty={false}>
          <Select label="Active riders" placeholder="Select rider" value={rider} onChange={(e) => setRider(e.target.value)}
            options={(riders.data ?? []).map((r) => ({ value: r.user_id, label: `Rider ${r.user_id.slice(0, 8)}${r.user_id === current ? ' (current)' : ''}` }))} />
          {!riders.data?.length ? <p className="text-xs text-k-muted">No active riders. Add one under Team, or paste a user id below.</p> : null}
        </Gate>
        <Input label="Or rider user id" value={manual} onChange={(e) => setManual(e.target.value)} />
        {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      </div>
    </Modal>
  )
}
