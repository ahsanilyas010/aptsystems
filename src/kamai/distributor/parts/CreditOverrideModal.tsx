import { useEffect, useState } from 'react'
import { Button, Input, Modal, Select, Textarea, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { toMinor, fromMinor } from '../../lib/money'
import type { CreditStatus, KamaiCreditAccountsRow } from '../../lib/db-types'
import { errMsg, useRefreshAll } from '../lib/data'

export const CREDIT_STATUSES: CreditStatus[] = ['cash_only', 'active', 'paused', 'frozen', 'written_off']

/** Manual override of a store's credit limit / status. A reason is mandatory and stored in reason_codes. */
export function CreditOverrideModal({ account, storeName, onClose }: { account: KamaiCreditAccountsRow | null; storeName?: string; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const [limit, setLimit] = useState('')
  const [status, setStatus] = useState<CreditStatus>('active')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!account) return
    setLimit(String(fromMinor(account.limit_minor)))
    setStatus(account.status)
    setReason('')
    setErr(null)
  }, [account])

  if (!account) return null

  async function save() {
    if (!account) return
    setErr(null)
    const lim = toMinor(limit)
    if (lim < 0) return setErr('Limit cannot be negative')
    if (reason.trim().length < 5) return setErr('Please give a reason (min 5 characters)')
    setBusy(true)
    try {
      const { error } = await supabase
        .from('kamai_credit_accounts')
        .update({ limit_minor: lim, status, reason_codes: ['MANUAL_OVERRIDE', `NOTE: ${reason.trim().slice(0, 200)}`], last_reviewed_at: new Date().toISOString() })
        .eq('store_id', account.store_id)
        .eq('tenant_id', account.tenant_id)
      if (error) throw new Error(error.message)
      toast.success('Credit account updated')
      await refresh()
      onClose()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Manual credit override"
      description={storeName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save override</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Credit limit (Rs)" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} hint="The nightly engine keeps a manual limit until the tier changes." />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as CreditStatus)} options={CREDIT_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      </div>
    </Modal>
  )
}
