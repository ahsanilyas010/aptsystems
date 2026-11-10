import { SectionTitle, Stat, cx } from '../../ui'
import { arAging, financeIntro, financeStats, forecast, months } from '../content/finance'
import { DataTable, Grid, Highlight, Panel, Stack, Warn } from '../components/content-ui'
import { useOsKpiView } from '../lib/kpi'

const KIND = { plain: '', cost: 'text-k-red', gain: 'text-k-green', net: 'font-bold' } as const

export function Component() {
  const kpi = useOsKpiView()
  return (
    <Stack>
      <Highlight intro={financeIntro} />
      <SectionTitle>12-Month P&amp;L Forecast (PKR &apos;000)</SectionTitle>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 border-b-2 border-k-border bg-k-surface px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Line</th>
              {months.map((m) => (
                <th key={m} className="border-b-2 border-k-border px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[1px] text-k-muted">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forecast.map((r) => (
              <tr key={r.line} className={cx(r.kind === 'net' && 'bg-k-surface2')}>
                <td className="sticky left-0 border-b border-k-border bg-inherit px-3 py-2.5 font-semibold text-k-dark">{r.line}</td>
                {r.values.map((v, i) => {
                  const neg = v.startsWith('-')
                  return (
                    <td
                      key={i}
                      className={cx(
                        'border-b border-k-border px-3 py-2.5 text-right tabular-nums',
                        r.kind === 'net' ? (neg ? 'font-bold text-k-red' : 'font-bold text-k-green') : KIND[r.kind],
                        i === 11 && 'bg-k-green-light font-bold',
                      )}
                    >
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Grid cols={4}>
        {financeStats.map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
        ))}
      </Grid>
      <SectionTitle>Current APT AR — Chase Priority</SectionTitle>
      <Warn>
        <strong>{kpi.ar}</strong> outstanding AR is blocking your working capital. Every rupee collected now funds Kamai sourcing without needing Ali&apos;s credit line. Chase this first.
        {kpi.live ? null : <span className="ml-1 text-xs">(snapshot figure)</span>}
      </Warn>
      <Panel title="AR Aging Action" dot="red">
        <DataTable {...arAging} />
      </Panel>
    </Stack>
  )
}
