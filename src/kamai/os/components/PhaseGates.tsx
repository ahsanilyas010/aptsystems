import { Badge, type BadgeTone } from '../../ui'
import { PKR, pct } from '../../lib/format'
import { phases } from '../content/platform'
import { usePar, useCollectedWithinTerms } from '../lib/credit'
import { useAllTenants } from '../lib/tenants'
import { useOsKpiView } from '../lib/kpi'
import { LiveBadge, Panel } from './content-ui'

type GateState = 'pass' | 'fail' | 'nodata'
interface Gate {
  label: string
  target: string
  value: string | null
  state: GateState
}

const TONE: Record<GateState, BadgeTone> = { pass: 'green', fail: 'red', nodata: 'muted' }
const TEXT: Record<GateState, string> = { pass: 'On track', fail: 'Not met', nodata: 'No data yet' }

function gate(label: string, target: string, value: number | null, ok: (v: number) => boolean, fmt: (v: number) => string): Gate {
  if (value === null || !Number.isFinite(value)) return { label, target, value: null, state: 'nodata' }
  return { label, target, value: fmt(value), state: ok(value) ? 'pass' : 'fail' }
}

/** Phase timeline with each exit gate checked against live metrics where available. */
export function PhaseGates() {
  const kpi = useOsKpiView()
  const par = usePar()
  const terms = useCollectedWithinTerms()
  const tenants = useAllTenants()
  const k = kpi.k

  const p0: Gate[] = [
    gate('Cancelled orders', 'under 15%', k.orders_all > 0 ? kpi.cancelPct : null, (v) => v < 15, (v) => v + '%'),
    gate('Hero activation', '25% or more', k.heroes_registered > 0 ? kpi.activationPct : null, (v) => v >= 25, (v) => v + '%'),
    gate('AR over 60 days', 'under Rs 0.4M', k.ar_60plus, (v) => v < 400_000, (v) => 'Rs ' + (v / 1e6).toFixed(2) + 'M'),
  ]
  const p1: Gate[] = [
    gate('Collected within terms', '90% or more', terms.data?.ratio ?? null, (v) => v >= 0.9, (v) => pct(v)),
    gate('PAR 30', 'under 5%', par.data?.par30 ?? null, (v) => v < 0.05, (v) => pct(v)),
    gate('Repeat order rate (60 days)', '50% or more', null, () => true, String),
    gate('Cost per drop', 'under Rs 350', null, () => true, String),
  ]
  const distributorsBrands = tenants.data ? tenants.data.filter((t) => t.type === 'distributor' || t.type === 'brand').length : null
  const p2: Gate[] = [
    gate('Kamai stores', '150 to 250', kpi.live ? k.kamai_stores : null, (v) => v >= 150, (v) => String(v)),
    gate('Distributors and brands', '10', distributorsBrands, (v) => v >= 10, (v) => String(v)),
    gate('Outstanding credit', 'Rs 10M tranche', par.data ? par.data.outstanding : null, (v) => v > 0, (v) => PKR(v)),
  ]
  const p3: Gate[] = [gate('Collected GMV and PAR history', 'Raise on data', null, () => true, String)]
  const byKey = { p0, p1, p2, p3 }

  return (
    <div className="flex flex-col gap-4">
      {phases.map((ph) => (
        <Panel key={ph.key} title={`${ph.month} · ${ph.title}`} action={ph.key === 'p0' ? <LiveBadge live={kpi.live} loading={kpi.loading} /> : undefined}>
          <p className="text-[13px] leading-relaxed text-k-muted">{ph.desc}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr>
                  {['Exit gate', 'Target', 'Current', 'Status'].map((h) => (
                    <th key={h} className="border-b-2 border-k-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[1px] text-k-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byKey[ph.key].map((g) => (
                  <tr key={g.label}>
                    <td className="border-b border-k-border px-3 py-2.5 font-semibold text-k-dark">{g.label}</td>
                    <td className="border-b border-k-border px-3 py-2.5 text-k-muted">{g.target}</td>
                    <td className="border-b border-k-border px-3 py-2.5 font-bold tabular-nums">{g.value ?? '—'}</td>
                    <td className="border-b border-k-border px-3 py-2.5"><Badge tone={TONE[g.state]} dot>{TEXT[g.state]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  )
}
