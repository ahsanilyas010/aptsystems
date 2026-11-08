import { useState } from 'react'
import { KeyRound, Plus, UserX } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Table, statusTone, useToast } from '../../ui'
import type { Column } from '../../ui'
import { callKamaiApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { fmtDate, humanize } from '../../lib/format'
import type { KamaiMembershipsRow } from '../../lib/db-types'
import { ErrorState, NoTenant, errMsg, useCan, useRefreshAll, useStores, useTenantId, useTenantRow, useTq } from '../lib/data'
import { randomPin } from '../lib/phone'
import { ProvisionModal, type ProvisionTarget } from '../parts/ProvisionModal'

export function Component() {
  const tid = useTenantId()
  const toast = useToast()
  const refresh = useRefreshAll()
  const { user } = useAuth()
  const manage = useCan(['owner', 'manager'])
  const tenant = useTenantRow()
  const stores = useStores()
  const q = useTq<KamaiMembershipsRow[]>(['members'], (t) => supabase.from('kamai_memberships').select('*').eq('tenant_id', t).neq('role', 'store').order('created_at', { ascending: false }).limit(500))
  const [prov, setProv] = useState<ProvisionTarget | null>(null)
  const [pinFor, setPinFor] = useState<KamaiMembershipsRow | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [dis, setDis] = useState<KamaiMembershipsRow | null>(null)

  if (!tid) return <NoTenant />

  async function resetPin() {
    if (!pinFor) return
    if (!/^\d{6}$/.test(pin)) return setErr('PIN must be exactly 6 digits')
    setBusy('pin')
    setErr(null)
    try {
      await callKamaiApi('reset_pin', { user_id: pinFor.user_id, pin })
      toast.success('PIN reset. Share the new PIN securely.')
      setPinFor(null)
      setPin('')
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy('')
    }
  }
  async function disable() {
    if (!dis) return
    setBusy('dis')
    try {
      await callKamaiApi('disable_user', { user_id: dis.user_id })
      toast.success('Member disabled')
      setDis(null)
      await refresh()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy('')
    }
  }

  const cols: Column<KamaiMembershipsRow>[] = [
    { key: 'u', header: 'Member', render: (m) => (<div><span className="font-mono text-xs font-semibold">{m.user_id.slice(0, 8)}</span>{m.user_id === user?.id ? <Badge tone="blue" size="sm" className="ml-2">You</Badge> : null}</div>) },
    { key: 'r', header: 'Role', render: (m) => <Badge tone="dark">{humanize(m.role)}</Badge> },
    { key: 's', header: 'Store', hideOnMobile: true, render: (m) => (m.store_id ? stores.map.get(m.store_id)?.name ?? '—' : '—') },
    { key: 'st', header: 'Status', render: (m) => <Badge tone={statusTone(m.status)}>{humanize(m.status)}</Badge> },
    { key: 'c', header: 'Added', hideOnMobile: true, render: (m) => fmtDate(m.created_at) },
    {
      key: 'a', header: '', align: 'right',
      render: (m) => manage && m.user_id !== user?.id ? (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" icon={<KeyRound size={13} />} onClick={() => { setPinFor(m); setPin(randomPin()); setErr(null) }}>Reset PIN</Button>
          {m.status !== 'disabled' ? <Button size="sm" variant="ghost" icon={<UserX size={13} />} onClick={() => setDis(m)}>Disable</Button> : null}
        </span>
      ) : null,
    },
  ]

  return (
    <>
      <PageHeader title="Team" eyebrow="Distributor" description="Staff and riders with access to this tenant."
        actions={manage ? <Button icon={<Plus size={15} />} onClick={() => setProv({ tenantId: tid, tenantName: tenant.data?.name ?? 'Distributor' })}>Add member</Button> : null} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <Card padding="none">
          <Table columns={cols} rows={q.data ?? []} rowKey={(m) => m.user_id} loading={q.isLoading} empty={<EmptyState title="No team members" />} />
        </Card>
      )}
      <p className="mt-3 text-xs text-k-muted">Store logins are managed from the Stores page.</p>
      <ProvisionModal target={prov} onClose={() => setProv(null)} />
      <Modal open={!!pinFor} onClose={() => setPinFor(null)} size="sm" title="Reset PIN" footer={<><Button variant="ghost" onClick={() => setPinFor(null)}>Cancel</Button><Button onClick={resetPin} loading={busy === 'pin'}>Reset PIN</Button></>}>
        <Input label="New 6-digit PIN" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        {err ? <p className="mt-2 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      </Modal>
      <Modal open={!!dis} onClose={() => setDis(null)} size="sm" title="Disable member?" footer={<><Button variant="ghost" onClick={() => setDis(null)}>Cancel</Button><Button variant="danger" onClick={disable} loading={busy === 'dis'}>Disable</Button></>}>
        <p className="text-sm text-k-text">This member loses access to this tenant. If they have no other active membership their login is banned.</p>
      </Modal>
    </>
  )
}
