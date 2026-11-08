import { useEffect, useState } from 'react'
import { Button, Card, CardTitle, Input, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { fromMinor, toMinor } from '../../lib/money'
import { fmtDate } from '../../lib/format'
import type { CreditPolicyRules, KamaiCreditPoliciesRow } from '../../lib/db-types'
import { Gate, errMsg, useCan, useRefreshAll, useTq } from '../lib/data'

export const DEFAULT_RULES: CreditPolicyRules = {
  tiers: { '0': { limit_minor: 0, tenor_days: 0 }, '1': { limit_minor: 2500000, tenor_days: 7 }, '2': { limit_minor: 7500000, tenor_days: 14 }, '3': { limit_minor: 15000000, tenor_days: 25 } },
  tier_requirements: { '1': { orders: 4, days: 30 }, '2': { orders: 12, days: 90, on_time: 0.9, max_dpd_180: 7, closed: 2 }, '3': { orders: 26, days: 180, on_time: 0.95, max_dpd_180: 3, closed: 2 } },
  grace_days: 2, pause_dpd: 7, freeze_dpd: 30, writeoff_dpd: 90, max_store_exposure_pct_of_tenant: 25, tenant_exposure_cap_minor: null, par30_pause_pct: 8,
}

type S = Record<string, string>
const TIER_KEYS = ['0', '1', '2', '3'] as const
const REQ_KEYS = ['1', '2', '3'] as const

function toForm(r: CreditPolicyRules): S {
  const s: S = {}
  for (const k of TIER_KEYS) {
    s[`lim${k}`] = String(fromMinor(r.tiers?.[k]?.limit_minor ?? 0))
    s[`ten${k}`] = String(r.tiers?.[k]?.tenor_days ?? 0)
  }
  for (const k of REQ_KEYS) {
    const q = r.tier_requirements?.[k]
    s[`ord${k}`] = String(q?.orders ?? '')
    s[`day${k}`] = String(q?.days ?? '')
    s[`ont${k}`] = q?.on_time != null ? String(q.on_time) : ''
    s[`dpd${k}`] = q?.max_dpd_180 != null ? String(q.max_dpd_180) : ''
    s[`clo${k}`] = q?.closed != null ? String(q.closed) : ''
  }
  s.grace = String(r.grace_days); s.pause = String(r.pause_dpd); s.freeze = String(r.freeze_dpd); s.wo = String(r.writeoff_dpd)
  s.storePct = String(r.max_store_exposure_pct_of_tenant); s.cap = r.tenant_exposure_cap_minor != null ? String(fromMinor(r.tenant_exposure_cap_minor)) : ''; s.par = String(r.par30_pause_pct)
  return s
}

const optN = (v: string) => (v.trim() === '' ? undefined : Number(v))

function toRules(s: S): CreditPolicyRules {
  const tiers = {} as CreditPolicyRules['tiers']
  for (const k of TIER_KEYS) tiers[k] = { limit_minor: toMinor(s[`lim${k}`]), tenor_days: Number(s[`ten${k}`] || 0) }
  const req = {} as NonNullable<CreditPolicyRules['tier_requirements']>
  for (const k of REQ_KEYS) {
    const o: Record<string, number> = { orders: Number(s[`ord${k}`] || 0), days: Number(s[`day${k}`] || 0) }
    const on = optN(s[`ont${k}`]); if (on !== undefined) o.on_time = on
    const dp = optN(s[`dpd${k}`]); if (dp !== undefined) o.max_dpd_180 = dp
    const cl = optN(s[`clo${k}`]); if (cl !== undefined) o.closed = cl
    req[k] = o as NonNullable<CreditPolicyRules['tier_requirements']>[typeof k]
  }
  return {
    tiers, tier_requirements: req, grace_days: Number(s.grace), pause_dpd: Number(s.pause), freeze_dpd: Number(s.freeze), writeoff_dpd: Number(s.wo),
    max_store_exposure_pct_of_tenant: Number(s.storePct), tenant_exposure_cap_minor: s.cap.trim() === '' ? null : toMinor(s.cap), par30_pause_pct: Number(s.par),
  }
}

function validate(r: CreditPolicyRules): string | null {
  const nums = [r.grace_days, r.pause_dpd, r.freeze_dpd, r.writeoff_dpd, r.max_store_exposure_pct_of_tenant, r.par30_pause_pct]
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return 'All thresholds must be non-negative numbers'
  if (!(r.pause_dpd < r.freeze_dpd && r.freeze_dpd < r.writeoff_dpd)) return 'Expected pause DPD < freeze DPD < write-off DPD'
  if (r.max_store_exposure_pct_of_tenant > 100 || r.par30_pause_pct > 100) return 'Percentages cannot exceed 100'
  const lims = TIER_KEYS.map((k) => r.tiers[k].limit_minor)
  if (lims.some((l, i) => i > 0 && l < lims[i - 1])) return 'Tier limits must not decrease with tier'
  return null
}

export function PolicyForm({ tenantId }: { tenantId: string }) {
  const toast = useToast()
  const refresh = useRefreshAll()
  const canEdit = useCan(['owner'])
  const q = useTq<KamaiCreditPoliciesRow[]>(['policies'], (t) => supabase.from('kamai_credit_policies').select('*').eq('tenant_id', t).order('version', { ascending: false }).limit(10))
  const latest = q.data?.[0]
  const [s, setS] = useState<S>(() => toForm(DEFAULT_RULES))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (latest) setS(toForm({ ...DEFAULT_RULES, ...(latest.rules as unknown as Partial<CreditPolicyRules>) }))
  }, [latest])
  const f = (k: string) => ({ value: s[k] ?? '', onChange: (e: { target: { value: string } }) => setS((p) => ({ ...p, [k]: e.target.value })), disabled: !canEdit, inputMode: 'decimal' as const })

  async function save() {
    setErr(null)
    const rules = toRules(s)
    const bad = validate(rules)
    if (bad) return setErr(bad)
    setBusy(true)
    try {
      const { error } = await supabase.from('kamai_credit_policies').insert({ tenant_id: tenantId, name: `Policy v${(latest?.version ?? 0) + 1}`, version: (latest?.version ?? 0) + 1, rules })
      if (error) throw new Error(error.message)
      toast.success('New policy version saved')
      await refresh()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Gate q={q}>
      <p className="mb-3 text-[13px] text-k-muted">
        {latest ? `Active: ${latest.name} (version ${latest.version}, from ${fmtDate(latest.effective_from)}).` : 'No policy saved, the built-in defaults apply.'}
        {canEdit ? ' Saving creates a new version; the previous one is kept.' : ' Only an owner can change the policy.'}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Tier limits (Rs) and tenor</CardTitle>
          <div className="space-y-3">
            {TIER_KEYS.map((k) => (
              <div key={k} className="grid grid-cols-2 gap-3">
                <Input label={`Tier ${k} limit`} {...f(`lim${k}`)} />
                <Input label="Tenor (days)" {...f(`ten${k}`)} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Promotion requirements</CardTitle>
          <div className="space-y-4">
            {REQ_KEYS.map((k) => (
              <div key={k}>
                <div className="mb-1 text-xs font-bold text-k-dark">To tier {k}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Input label="Orders" {...f(`ord${k}`)} />
                  <Input label="Days" {...f(`day${k}`)} />
                  <Input label="On-time" {...f(`ont${k}`)} />
                  <Input label="Max DPD 180" {...f(`dpd${k}`)} />
                  <Input label="Closed" {...f(`clo${k}`)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle dot="amber">Risk thresholds</CardTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Input label="Grace days" {...f('grace')} />
            <Input label="Pause at DPD" {...f('pause')} />
            <Input label="Freeze at DPD" {...f('freeze')} />
            <Input label="Write-off at DPD" {...f('wo')} />
            <Input label="Max store share of tenant exposure (%)" {...f('storePct')} />
            <Input label="Tenant exposure cap (Rs)" placeholder="No cap" {...f('cap')} />
            <Input label="PAR30 pause line (%)" {...f('par')} />
          </div>
        </Card>
      </div>
      {err ? <p className="mt-3 text-sm font-semibold text-k-red" role="alert">{err}</p> : null}
      {canEdit ? <div className="mt-4"><Button onClick={save} loading={busy}>Save as new version</Button></div> : null}
    </Gate>
  )
}
