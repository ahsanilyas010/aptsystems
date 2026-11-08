import { useEffect, useState } from 'react'
import { Button, Card, CardTitle, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import type { Json } from '../../lib/db-types'
import { ErrorState, NoTenant, errMsg, useCan, useRefreshAll, useTenantId, useTenantRow } from '../lib/data'

const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Azad Jammu and Kashmir', 'Gilgit-Baltistan']
const DEFAULT_OPT_IN = 'Aap Kamai ke zariye order, invoice aur payment reminders WhatsApp par hasil karne ki ijazat dete hain. STOP likh kar kisi bhi waqt band karwa sakte hain.'

type F = { legal_name: string; ntn: string; strn: string; province: string; address: string; invoice_prefix: string; bank_iban: string; raast_alias: string; geofence: string; dispute: string; optin: string }
const EMPTY: F = { legal_name: '', ntn: '', strn: '', province: '', address: '', invoice_prefix: '', bank_iban: '', raast_alias: '', geofence: '150', dispute: '24', optin: DEFAULT_OPT_IN }

export function Component() {
  const tid = useTenantId()
  const toast = useToast()
  const refresh = useRefreshAll()
  const canEdit = useCan(['owner'])
  const t = useTenantRow()
  const [f, setF] = useState<F>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const r = t.data
    if (!r) return
    const s = (r.settings ?? {}) as Record<string, Json>
    setF({
      legal_name: r.legal_name ?? '', ntn: r.ntn ?? '', strn: r.strn ?? '', province: r.province ?? '', address: r.address ?? '', invoice_prefix: r.invoice_prefix ?? '',
      bank_iban: r.bank_iban ?? '', raast_alias: r.raast_alias ?? '', geofence: String(s.geofence_radius_m ?? 150), dispute: String(s.dispute_window_hours ?? 24), optin: String(s.wa_opt_in_text ?? DEFAULT_OPT_IN),
    })
  }, [t.data])

  if (!tid) return <NoTenant />
  if (t.isLoading) return <Spinner label="Loading settings…" />
  if (t.isError) return <ErrorState error={t.error} onRetry={() => void t.refetch()} />
  const set = (k: keyof F) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const dis = !canEdit

  async function save() {
    setErr(null)
    if (f.ntn && !/^[0-9]{7,13}$/.test(f.ntn)) return setErr('NTN must be 7 to 13 digits (no dashes)')
    if (f.invoice_prefix && !/^[A-Z0-9]{1,8}$/.test(f.invoice_prefix)) return setErr('Invoice prefix: 1 to 8 capital letters or digits')
    if (f.bank_iban && !/^PK\d{2}[A-Z0-9]{20}$/i.test(f.bank_iban.replace(/\s/g, ''))) return setErr('IBAN should look like PK36SCBL0000001123456702')
    const geo = Number(f.geofence)
    const win = Number(f.dispute)
    if (!Number.isFinite(geo) || geo < 20 || geo > 2000) return setErr('Geofence radius must be 20 to 2000 metres')
    if (!Number.isInteger(win) || win < 0 || win > 168) return setErr('Dispute window must be 0 to 168 hours')
    setBusy(true)
    try {
      const cur = (t.data?.settings ?? {}) as Record<string, Json>
      const { error } = await supabase
        .from('kamai_tenants')
        .update({
          legal_name: f.legal_name.trim() || null, ntn: f.ntn.trim() || null, strn: f.strn.trim() || null, province: f.province || null, address: f.address.trim() || null,
          invoice_prefix: f.invoice_prefix.trim() || null, bank_iban: f.bank_iban.replace(/\s/g, '').toUpperCase() || null, raast_alias: f.raast_alias.trim() || null,
          settings: { ...cur, geofence_radius_m: geo, dispute_window_hours: win, wa_opt_in_text: f.optin.trim() },
        })
        .eq('id', tid as string)
      if (error) throw new Error(error.message)
      toast.success('Settings saved')
      await refresh()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Settings" eyebrow="Distributor" description={canEdit ? 'Legal and tax details appear on every invoice and in FBR submissions.' : 'Only an owner can change these settings.'}
        actions={canEdit ? <Button onClick={save} loading={busy}>Save changes</Button> : null} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Legal and tax</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input className="sm:col-span-2" label="Legal name" value={f.legal_name} onChange={set('legal_name')} disabled={dis} />
            <Input label="NTN" inputMode="numeric" value={f.ntn} onChange={set('ntn')} disabled={dis} />
            <Input label="STRN" value={f.strn} onChange={set('strn')} disabled={dis} />
            <Select label="Province" placeholder="Select province" value={f.province} onChange={set('province')} disabled={dis} options={PROVINCES.map((p) => ({ value: p, label: p }))} />
            <Input label="Invoice prefix" value={f.invoice_prefix} onChange={(e) => setF((p) => ({ ...p, invoice_prefix: e.target.value.toUpperCase() }))} disabled={dis} hint="e.g. APT gives APT-000001" />
            <Textarea className="sm:col-span-2" label="Address" rows={2} value={f.address} onChange={set('address')} disabled={dis} />
          </div>
        </Card>
        <Card>
          <CardTitle>Collections</CardTitle>
          <div className="grid gap-3">
            <Input label="Bank IBAN" value={f.bank_iban} onChange={set('bank_iban')} disabled={dis} />
            <Input label="Raast alias" value={f.raast_alias} onChange={set('raast_alias')} disabled={dis} hint="Mobile number or Raast ID shown on invoices" />
          </div>
        </Card>
        <Card>
          <CardTitle dot="amber">Delivery rules</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Geofence radius (m)" inputMode="numeric" value={f.geofence} onChange={set('geofence')} disabled={dis} hint="How close the rider must be to confirm" />
            <Input label="Dispute window (hours)" inputMode="numeric" value={f.dispute} onChange={set('dispute')} disabled={dis} hint="Store can dispute after delivery" />
          </div>
        </Card>
        <Card>
          <CardTitle dot="none">WhatsApp opt-in text</CardTitle>
          <Textarea label="Shown to stores when they opt in" rows={4} value={f.optin} onChange={set('optin')} disabled={dis} />
        </Card>
      </div>
      {err ? <p className="mt-4 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      {canEdit ? <div className="mt-4"><Button onClick={save} loading={busy}>Save changes</Button></div> : null}
    </>
  )
}
