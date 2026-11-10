import { SectionTitle } from '../../ui'
import { pct } from '../../lib/format'
import {
  biggerPicture, demandRisks, demandRules, execApp, execDistribution, execFinance, execRider, killRulesText, lanes, platformIntro,
  pricing, scorecard, segments, unitEconomics, unitEconomicsNote, weakTitle, weaknesses,
} from '../content/platform'
import { DataTable, Highlight, Panel, Stack, Warn } from '../components/content-ui'
import { PhaseGates } from '../components/PhaseGates'
import { Rich } from '../lib/rich'
import { useCollectedWithinTerms, usePar } from '../lib/credit'
import { useOsKpiView } from '../lib/kpi'
import type { Cell } from '../content/types'

export function Component() {
  const kpi = useOsKpiView()
  const par = usePar()
  const terms = useCollectedWithinTerms()

  const live: Record<string, string> = {
    cancel: kpi.cancelRate + (kpi.live ? '' : ' (snapshot)'),
    collected: terms.data?.ratio != null ? pct(terms.data.ratio) : '—',
    par30: par.data?.par30 != null ? pct(par.data.par30) : '—',
    activation: kpi.activationRate + (kpi.live ? '' : ' (snapshot)'),
  }
  const scoreRows: Cell[][] = scorecard.map((r) => [r.metric, r.target, live[r.key] ?? '—'])

  return (
    <Stack>
      <Highlight intro={platformIntro} />
      <SectionTitle className="mb-0">The Three Lanes</SectionTitle>
      <Panel><DataTable {...lanes} /></Panel>

      <Warn>
        <div className="mb-2 font-bold">{weakTitle}</div>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          {weaknesses.map((w) => (
            <li key={w.title}><strong>{w.title}</strong> {w.text}</li>
          ))}
        </ol>
      </Warn>

      <SectionTitle className="mb-0">The Bigger Picture: Where Kamai.ai Neighborhood Fits</SectionTitle>
      <Panel>
        <DataTable {...biggerPicture} />
        <p className="mt-3 text-sm leading-relaxed text-k-muted"><Rich text={demandRules} /></p>
        <p className="mt-3 text-sm leading-relaxed text-k-muted"><Rich text={demandRisks} /></p>
      </Panel>

      <SectionTitle className="mb-0">Execution: App Side</SectionTitle>
      <Panel><DataTable {...execApp} /></Panel>
      <SectionTitle className="mb-0">Execution: Distribution Side</SectionTitle>
      <Panel><DataTable {...execDistribution} /></Panel>
      <SectionTitle className="mb-0">Execution: Rider Side (Bykea)</SectionTitle>
      <Panel><DataTable {...execRider} /></Panel>
      <SectionTitle className="mb-0">Execution: Finance Side (Abhi)</SectionTitle>
      <Panel><DataTable {...execFinance} /></Panel>

      <SectionTitle className="mb-0">Go-to-Market: Phases and Gates</SectionTitle>
      <PhaseGates />

      <SectionTitle className="mb-0">Go-to-Market: Segments</SectionTitle>
      <Panel><DataTable {...segments} /></Panel>
      <SectionTitle className="mb-0">Pricing (starting hypotheses, validate with Abhi and distributors)</SectionTitle>
      <Panel><DataTable {...pricing} /></Panel>
      <SectionTitle className="mb-0">Unit Economics Per Order (illustrative, replace with real numbers)</SectionTitle>
      <Panel>
        <DataTable {...unitEconomics} />
        <p className="mt-3 text-sm text-k-muted">{unitEconomicsNote}</p>
      </Panel>
      <SectionTitle className="mb-0">Scorecard</SectionTitle>
      <Panel><DataTable head={['Metric', 'Target', 'Current']} rows={scoreRows} /></Panel>
      <Warn><Rich text={killRulesText} /></Warn>
    </Stack>
  )
}
