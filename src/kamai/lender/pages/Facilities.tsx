import { useState } from 'react'
import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Spinner, Table, statusTone, type Column } from '../../ui'
import { PKR, PKRCompact, fmtDate, fmtInt, humanize, pct } from '../../lib/format'
import type { KamaiFacilitiesRow, KamaiFinancingsRow } from '../../lib/db-types'
import { ComplianceBanner } from '../parts/ComplianceBanner'
import { SettleModal, useCanAct } from '../parts/ActionModals'
import { computeGate, errMsg, sum, useFacilities, useFinancings, usePar, usePositions } from '../lib/data'

const TRANCHES = [
  { label: 'Pilot tranche', amount: 2_000_000_00, rule: 'Available at pilot start (Phase 1).' },
  { label: 'Scale tranche', amount: 10_000_000_00, rule: 'Unlocks when the 50-order cohort gate passes (Phase 2).' },
  { label: 'Growth tranche', amount: 25_000_000_00, rule: 'Unlocks after the scale tranche is deployed with PAR30 held under 8%.' },
]

function Progress({ value, max, tone = 'bg-k-green' }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-k-surface2" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  )
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const Icon = ok === null ? Circle : ok ? CheckCircle2 : XCircle
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <Icon size={20} className={ok === null ? 'text-k-light' : ok ? 'text-k-green' : 'text-k-red'} />
      <div>
        <div className="font-semibold text-k-dark">{label}</div>
        <div className="text-[13px] text-k-muted">{detail}</div>
      </div>
    </li>
  )
}

function FacilityCard({ f, used }: { f: KamaiFacilitiesRow; used: number }) {
  return (
    <Card>
      <CardTitle action={<Badge tone={statusTone(f.status)}>{humanize(f.status)}</Badge>}>{humanize(f.technique)}</CardTitle>
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-[13px]"><span className="text-k-muted">Limit used</span><b>{PKR(used)} of {PKR(f.limit_minor)}</b></div>
          <Progress value={used} max={f.limit_minor} />
        </div>
        {f.tranche_minor ? (
          <div>
            <div className="mb-1 flex justify-between text-[13px]"><span className="text-k-muted">Current tranche</span><b>{PKR(used)} of {PKR(f.tranche_minor)}</b></div>
            <Progress value={used} max={f.tranche_minor} tone="bg-[#2563eb]" />
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-k-muted">Advance rate</dt><dd className="text-right font-bold">{f.advance_rate_pct}%</dd>
          <dt className="text-k-muted">First-loss</dt><dd className="text-right font-bold">{f.first_loss_pct}%</dd>
          <dt className="text-k-muted">Tenor</dt><dd className="text-right font-bold">{f.tenor_days} days</dd>
          <dt className="text-k-muted">Debtor of record</dt><dd className="text-right font-bold capitalize">{f.debtor_of_record}</dd>
        </dl>
      </div>
    </Card>
  )
}

export function Component() {
  const fac = useFacilities()
  const fin = useFinancings()
  const pos = usePositions()
  const par = usePar()
  const canAct = useCanAct()
  const [settle, setSettle] = useState<KamaiFinancingsRow | null>(null)

  const facilities = fac.data ?? []
  const fins = fin.data ?? []
  const gate = computeGate(pos.data ?? [])
  const parRows = par.data ?? []
  const outAll = sum(parRows.map((r) => r.outstanding_minor))
  const par30 = outAll > 0 ? sum(parRows.map((r) => r.par30_minor)) / outAll : null
  const gatePass = gate.rate !== null && gate.cohortSize >= gate.target && gate.rate >= 0.9
  const deployed = sum(fins.filter((x) => x.status === 'disbursed' || x.status === 'partially_repaid').map((x) => x.disbursed_minor - x.repaid_minor))
  const used = (id: string) => sum(fins.filter((x) => x.facility_id === id && (x.status === 'disbursed' || x.status === 'partially_repaid')).map((x) => x.disbursed_minor - x.repaid_minor))

  const cols: Column<KamaiFinancingsRow>[] = [
    { key: 'd', header: 'Disbursed', render: (r) => fmtDate(r.disbursed_at) },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (r) => fmtDate(r.due_date) },
    { key: 'amt', header: 'Advance', align: 'right', render: (r) => PKR(r.disbursed_minor) },
    { key: 'rep', header: 'Repaid', align: 'right', hideOnMobile: true, render: (r) => PKR(r.repaid_minor) },
    { key: 'st', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
    { key: 'a', header: '', align: 'right', render: (r) => canAct && r.disbursed_minor > r.repaid_minor ? <Button size="sm" variant="secondary" onClick={() => setSettle(r)}>Record settlement</Button> : null },
  ]

  const failed = fac.error ?? fin.error
  return (
    <>
      <PageHeader title="Facilities" eyebrow="Lender" description="Credit lines, tranche progress, the pilot gate and your advances." />
      <ComplianceBanner />
      {failed ? (
        <Card><EmptyState title="Could not load facilities" description={errMsg(failed)} /></Card>
      ) : fac.isLoading ? (
        <Spinner label="Loading facilities…" />
      ) : (
        <div className="space-y-6">
          {facilities.length === 0 ? (
            <Card><EmptyState title="No facilities yet" description="No facilities yet - ask Kamai to link your tenant. A platform admin creates the facility with its limit, advance rate and debtor of record." /></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">{facilities.map((f) => <FacilityCard key={f.id} f={f} used={used(f.id)} />)}</div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle dot={gatePass ? 'green' : 'amber'} action={<Badge tone={gatePass ? 'green' : 'amber'}>{gatePass ? 'Gate passed' : 'Gate open'}</Badge>}>Scale gate checklist</CardTitle>
              <ul className="divide-y divide-k-border">
                <Check
                  ok={gate.cohortSize >= gate.target ? gate.rate !== null && gate.rate >= 0.9 : null}
                  label="50-order cohort collecting 90%+ within terms"
                  detail={gate.cohortSize === 0 ? 'No matured orders yet.' : `${gate.onTime} of ${gate.cohortSize} cohort orders paid by due date = ${pct(gate.rate)} (target 90%)`}
                />
                <Check ok={gate.cohortSize >= gate.target} label="Cohort of 50 matured orders reached" detail={`${gate.cohortSize} of ${gate.target} (${gate.matured} matured in total)`} />
                <Check ok={par30 === null ? null : par30 <= 0.08} label="PAR30 at or under 8%" detail={par30 === null ? 'No PAR snapshot yet.' : `Portfolio PAR30 is ${pct(par30)}`} />
                <Check ok={null} label="Legal gates cleared (confirmed offline)" detail="SECP perimeter opinion, data residency check, KFS template approved." />
              </ul>
              <div className="mt-3"><Progress value={gate.cohortSize} max={gate.target} /></div>
            </Card>
            <Card>
              <CardTitle>Tranches (Platform Plan)</CardTitle>
              <ul className="space-y-4">
                {TRANCHES.map((t, i) => {
                  const unlocked = i === 0 || (i === 1 && gatePass) || (i === 2 && gatePass && deployed >= TRANCHES[1].amount * 0.8 && (par30 ?? 1) <= 0.08)
                  return (
                    <li key={t.label}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="font-semibold text-k-dark">{t.label} · {PKRCompact(t.amount)}</span>
                        <Badge tone={unlocked ? 'green' : 'muted'}>{unlocked ? 'Unlocked' : 'Locked'}</Badge>
                      </div>
                      <Progress value={unlocked ? deployed : 0} max={t.amount} tone={unlocked ? 'bg-k-green' : 'bg-k-light'} />
                      <div className="mt-1 text-xs text-k-muted">{t.rule}</div>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-5 rounded-xl bg-k-surface2 p-3 text-[13px] text-k-text">
                <div className="mb-1 font-bold text-k-dark">Pause rules</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>New credit pauses automatically when portfolio PAR30 is above 8%.</li>
                  <li>A distributor pauses when its dispute rate is above 10%.</li>
                  <li>Stores stop at their DPD pause limit; written off after the write-off DPD.</li>
                </ul>
              </div>
            </Card>
          </div>

          <Card padding="none">
            <div className="p-5 pb-0"><CardTitle>Advances ({fmtInt(fins.length)})</CardTitle></div>
            <Table columns={cols} rows={fins} rowKey={(r) => r.id} loading={fin.isLoading} empty={<EmptyState compact title="No advances yet" description="Finance an eligible order from the Exposures page and it will show here." />} />
          </Card>
        </div>
      )}
      <SettleModal financing={settle} onClose={() => setSettle(null)} />
    </>
  )
}
