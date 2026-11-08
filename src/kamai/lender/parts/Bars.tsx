import { fromMinor } from '../../lib/money'
import { PKRCompact } from '../../lib/format'

export interface BarDatum {
  label: string
  value: number
  tone?: 'green' | 'amber' | 'red' | 'blue'
}

const FILL = { green: 'bg-k-green', amber: 'bg-k-accent', red: 'bg-k-red', blue: 'bg-[#2563eb]' }

/** Horizontal CSS bars with a money value (minor units) per row. */
export function HBars({ data, money = true }: { data: BarDatum[]; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[64px_1fr_92px] items-center gap-3 text-[13px]">
          <span className="font-semibold text-k-muted">{d.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-k-surface2">
            <span className={`block h-full rounded-full ${FILL[d.tone ?? 'green']}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-bold text-k-dark">{money ? PKRCompact(d.value) : d.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** Vertical bars (one per day) as inline SVG. Values are minor units. */
export function DayBars({ data }: { data: Array<{ day: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const w = 600
  const h = 120
  const bw = w / Math.max(1, data.length)
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label="Collections by day, last 30 days" preserveAspectRatio="none">
        {data.map((d, i) => {
          const bh = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (h - 4))
          return (
            <rect key={d.day} x={i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} rx={2} className="fill-k-green">
              <title>{`${d.day}: Rs ${Math.round(fromMinor(d.value)).toLocaleString('en-PK')}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-k-light">
        <span>{data[0]?.day}</span>
        <span>peak {PKRCompact(max)}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  )
}
