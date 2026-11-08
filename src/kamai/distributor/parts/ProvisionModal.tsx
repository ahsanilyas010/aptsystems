import { useEffect, useState } from 'react'
import { Copy, MessageCircle, Shuffle } from 'lucide-react'
import { Button, Input, Modal, Select, useToast } from '../../ui'
import { callKamaiApi } from '../../lib/api'
import { digitsOnly, normMobile, randomPin, waLink } from '../lib/phone'
import { errMsg, useRefreshAll } from '../lib/data'

interface ProvisionResult {
  ok?: boolean
  user_id: string
  login: { kind: 'mobile_pin' | 'email_invite'; identifier: string }
  action_link?: string
}

export interface ProvisionTarget {
  tenantId: string
  tenantName: string
  /** fixed role (store provisioning) */
  role?: string
  storeId?: string
  fullName?: string
  mobile?: string | null
}

const ROLE_OPTS = ['owner', 'manager', 'booker', 'finance', 'viewer', 'rider'].map((r) => ({ value: r, label: r }))
const LOGIN_URL = 'https://apt.assorted.group/auth/login'

export function inviteText(name: string, tenant: string, mobile: string, pin: string, role: string): string {
  const who = role === 'store' ? 'Aap ka store account' : 'Aap ka account'
  return `Assalam o Alaikum ${name || ''}! ${tenant} ki taraf se Kamai mein ${who} tayyar hai.\n\nLogin: ${LOGIN_URL}\nMobile: ${mobile}\nPIN: ${pin}\n\nPehli dafa login karne ke baad apna PIN zaroor badal lein. Shukriya!`
}

export function ProvisionModal({ target, onClose }: { target: ProvisionTarget | null; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const [role, setRole] = useState('booker')
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ res: ProvisionResult; text: string; mobile: string } | null>(null)

  useEffect(() => {
    if (!target) return
    setRole(target.role ?? 'booker')
    setName(target.fullName ?? '')
    setMobile(target.mobile ?? '')
    setEmail('')
    setPin('')
    setErr(null)
    setDone(null)
  }, [target])

  if (!target) return null
  const fixedRole = target.role
  const effRole = fixedRole ?? role
  const useEmail = !fixedRole && email.trim().length > 0

  async function submit() {
    if (!target) return
    setErr(null)
    const m = normMobile(mobile)
    if (name.trim().length < 2) return setErr('Name is required')
    if (!useEmail) {
      if (!m) return setErr('Enter a valid mobile, e.g. 0300 1234567')
      if (!/^\d{6}$/.test(pin)) return setErr('PIN must be exactly 6 digits')
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { tenant_id: target.tenantId, role: effRole, full_name: name.trim() }
      if (target.storeId) payload.store_id = target.storeId
      if (useEmail) payload.email = email.trim()
      else {
        payload.mobile = m
        payload.pin = pin
      }
      if (useEmail && m) payload.mobile = m
      const res = await callKamaiApi<ProvisionResult>('provision_user', payload)
      setDone({ res, mobile: m ?? '', text: inviteText(name.trim(), target.tenantName, m ?? '', useEmail ? '(email invite bheji gayi hai)' : pin, effRole) })
      toast.success('Login created')
      void refresh()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed, select the text manually')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={done ? 'Login ready' : fixedRole === 'store' ? 'Provision store login' : 'Add team member'}
      description={done ? undefined : fixedRole === 'store' ? 'Creates a mobile + 6-digit PIN login for this store.' : undefined}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} loading={busy}>Create login</Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-k-border bg-k-surface2 p-3 text-sm">
            <div className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Login identifier</div>
            <div className="mt-1 break-all font-mono font-semibold text-k-dark">{done.res.login.identifier}</div>
            <div className="mt-1 text-xs text-k-muted">{done.res.login.kind === 'mobile_pin' ? 'Signs in with mobile + PIN' : 'Invitation email sent'}</div>
          </div>
          {done.res.action_link ? (
            <Input label="Invite link" readOnly value={done.res.action_link} onFocus={(e) => e.currentTarget.select()} />
          ) : null}
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-[1px] text-k-muted">WhatsApp invite (Roman Urdu)</div>
            <pre className="whitespace-pre-wrap rounded-xl border border-k-border bg-k-surface p-3 text-[13px] text-k-text">{done.text}</pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Copy size={14} />} onClick={() => copy(done.text)}>Copy text</Button>
            {done.mobile && digitsOnly(done.mobile) ? (
              <a href={waLink(done.mobile, done.text)} target="_blank" rel="noreferrer noopener">
                <Button icon={<MessageCircle size={14} />}>Open WhatsApp</Button>
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!fixedRole ? <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={ROLE_OPTS} /> : null}
          <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Mobile" inputMode="tel" placeholder="0300 1234567" value={mobile} onChange={(e) => setMobile(e.target.value)} required={!useEmail} />
          {!fixedRole ? <Input label="Email (optional, sends an invite instead of a PIN)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /> : null}
          {!useEmail ? (
            <div className="flex items-end gap-2">
              <Input className="flex-1" label="6-digit PIN" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
              <Button variant="secondary" icon={<Shuffle size={14} />} onClick={() => setPin(randomPin())}>Generate</Button>
            </div>
          ) : null}
          {err ? <p className="text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
        </div>
      )}
    </Modal>
  )
}
