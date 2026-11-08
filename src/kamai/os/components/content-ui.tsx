import type { ReactNode } from 'react'
import { Badge, Card, CardTitle, Table, cx, type Column } from '../../ui'
import type { Cell, Intro, Prio, Tbl, TimelineItem } from '../content/types'
import { Rich } from '../lib/rich'

/** Dark intro box at the top of every panel. */
export function Highlight({ intro, title, children }: { intro?: Intro; title?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl bg-k-dark p-6 text-[#f5f6f2] md:p-8">
      <h2 className="mb-2 text-xl font-extrabold text-white md:text-2xl">{intro?.title ?? title}</h2>
      {intro ? (
        <p className="max-w-4xl text-sm leading-relaxed text-[#cfdad3] [&_strong]:text-white">
          <Rich text={intro.body} />
        </p>
      ) : null}
      {children}
    </div>
  )
}

/** Amber warning box. */
export function Warn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-[#f0d9a0] border-l-4 border-l-k-accent bg-[#fff8e6] p-4 text-sm leading-relaxed text-[#5c4300]', className)}>
      {children}
    </div>
  )
}

export function Panel({ title, dot, action, children, className }: { title?: ReactNode; dot?: 'green' | 'amber' | 'red'; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      {title ? (
        <CardTitle dot={dot} action={action}>
          {title}
        </CardTitle>
      ) : null}
      {children}
    </Card>
  )
}

const GRID = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
} as const

export function Grid({ cols, children, className }: { cols: keyof typeof GRID; children: ReactNode; className?: string }) {
  return <div className={cx('grid gap-4', GRID[cols], className)}>{children}</div>
}

/** Vertical rhythm wrapper for a page. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}

const PRIO_TONE = { P1: 'red', P2: 'amber', P3: 'muted' } as const
export function PrioTag({ p, label }: { p: Prio; label?: string }) {
  return <Badge tone={PRIO_TONE[p]}>{label ? `${label}` : p}</Badge>
}

function renderCell(c: Cell): ReactNode {
  if (typeof c === 'string') return c
  if ('strong' in c) return <strong className="font-bold text-k-dark">{c.strong}</strong>
  if ('badge' in c) return <Badge tone={c.tone}>{c.badge}</Badge>
  if ('prio' in c) return <PrioTag p={c.prio} label={c.label} />
  return (
    <a href={c.href} target="_blank" rel="noreferrer" className="text-xs font-semibold text-k-green underline">
      {c.link}
    </a>
  )
}

/** Static content table built on the shared Table. */
export function DataTable({ head, rows, className }: Tbl & { className?: string }) {
  const columns: Column<Cell[]>[] = head.map((h, i) => ({
    key: String(i),
    header: h,
    render: (r) => renderCell(r[i] ?? ''),
  }))
  return <Table dense columns={columns} rows={rows} rowKey={(_, i) => i} className={className} />
}

export function Bullets({ items, tone }: { items: string[]; tone?: 'do' | 'dont' }) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-k-muted">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5">
          <span className={cx('mt-2 h-1.5 w-1.5 shrink-0 rounded-full', tone === 'dont' ? 'bg-k-red' : 'bg-k-green')} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

export function Timeline({ items, replace }: { items: TimelineItem[]; replace?: Record<string, string> }) {
  const fill = (s: string) => Object.entries(replace ?? {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s)
  return (
    <ol className="relative flex flex-col gap-5 border-l-2 border-k-border pl-6">
      {items.map((it) => (
        <li key={it.month + it.title} className="relative">
          <span
            className={cx(
              'absolute -left-[33px] top-1 h-3.5 w-3.5 rounded-full border-2 border-k-surface',
              it.state === 'future' ? 'bg-k-light' : it.state === 'pending' ? 'bg-k-accent' : 'bg-k-green',
            )}
          />
          <div className="text-[11px] font-extrabold uppercase tracking-[1.5px] text-k-green">{it.month}</div>
          <div className="mt-0.5 text-[15px] font-bold text-k-dark">{it.title}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-k-muted">{fill(it.desc)}</p>
        </li>
      ))}
    </ol>
  )
}

/** Small "Live" / "Snapshot" badge for pages that blend live and static numbers. */
export function LiveBadge({ live, loading, label }: { live: boolean; loading?: boolean; label?: string }) {
  if (loading) return <Badge tone="muted" dot>Loading</Badge>
  return (
    <Badge tone={live ? 'green' : 'amber'} dot>
      {label ?? (live ? 'Live' : 'Snapshot')}
    </Badge>
  )
}
