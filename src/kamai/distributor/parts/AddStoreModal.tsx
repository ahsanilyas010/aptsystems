import { useState } from 'react'
import { Button, Input, Modal, Select, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { errMsg, useRefreshAll, useStores, useTenantRow } from '../lib/data'
import { nextRefCodes, normMobile } from '../lib/phone'

export const TIERS = [
  { value: 'default', label: 'Default' },
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' },
]

export function AddStoreModal({ open, onClose, tenantId }: { open: boolean; onClose: () => void; tenantId: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const refresh = useRefreshAll()
  const stores = useStores()
  const tenant = useTenantRow()
  const [f, setF] = useState({ name: '', owner_name: '', mobile: '', address: '', area: '', category: '', tier: 'default', terms: '0', lat: '', lng: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function save() {
    setErr(null)
    if (!f.name.trim()) return setErr('Store name is required')
    const m = f.mobile.trim() ? normMobile(f.mobile) : null
    if (f.mobile.trim() && !m) return setErr('Mobile is not valid')
    const terms = Number(f.terms || 0)
    if (!Number.isInteger(terms) || terms < 0 || terms > 90) return setErr('Payment terms must be 0 to 90 days')
    const lat = f.lat ? Number(f.lat) : null
    const lng = f.lng ? Number(f.lng) : null
    if ((lat !== null && (Number.isNaN(lat) || Math.abs(lat) > 90)) || (lng !== null && (Number.isNaN(lng) || Math.abs(lng) > 180))) return setErr('Latitude / longitude invalid')
    setBusy(true)
    try {
      const slug = tenant.data?.slug ?? 'store'
      const existing = stores.rows.map((s) => s.payment_ref_code)
      for (let attempt = 0; attempt < 3; attempt++) {
        const [code] = nextRefCodes(slug, existing, 1, attempt)
        const { error } = await supabase.from('kamai_stores').insert({
          tenant_id: tenantId,
          name: f.name.trim(),
          owner_name: f.owner_name.trim() || null,
          mobile: m,
          address: f.address.trim() || null,
          area: f.area.trim() || null,
          category: f.category.trim() || null,
          tier: f.tier,
          payment_terms_days: terms,
          latitude: lat,
          longitude: lng,
          payment_ref_code: code,
          created_by: user?.id ?? null,
        })
        if (!error) {
          toast.success('Store added')
          await refresh()
          setF({ name: '', owner_name: '', mobile: '', address: '', area: '', category: '', tier: 'default', terms: '0', lat: '', lng: '' })
          onClose()
          return
        }
        if (error.code !== '23505') throw new Error(error.message)
      }
      throw new Error('Could not allocate a unique payment reference code, try again')
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add store"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save store</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Store name" value={f.name} onChange={set('name')} required />
        <Input label="Owner" value={f.owner_name} onChange={set('owner_name')} />
        <Input label="Mobile" inputMode="tel" placeholder="0300 1234567" value={f.mobile} onChange={set('mobile')} />
        <Input className="sm:col-span-2" label="Address" value={f.address} onChange={set('address')} />
        <Input label="Area" value={f.area} onChange={set('area')} />
        <Input label="Category" value={f.category} onChange={set('category')} />
        <Select label="Price tier" value={f.tier} onChange={set('tier')} options={TIERS} />
        <Input label="Payment terms (days)" inputMode="numeric" value={f.terms} onChange={set('terms')} hint="0 = cash on delivery" />
        <Input label="Latitude" inputMode="decimal" value={f.lat} onChange={set('lat')} />
        <Input label="Longitude" inputMode="decimal" value={f.lng} onChange={set('lng')} />
      </div>
      {err ? <p className="mt-3 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
    </Modal>
  )
}
