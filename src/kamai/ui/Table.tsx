import type { ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './Spinner'
import { EmptyState } from './EmptyState'

export interface Column<T> {
  key: string
  header: ReactNode
  /** cell renderer; defaults to String(row[key]) */
  render?: (row: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string | number
  /** hide on small screens */
  hideOnMobile?: boolean
  className?: string
}

export interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string | number
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  /** compact row padding */
  dense?: boolean
  /** sticky header inside a scrolling container */
  stickyHeader?: boolean
  className?: string
  footer?: ReactNode
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

export function Table<T>({ columns, rows, rowKey, loading, empty, onRowClick, dense, stickyHeader, className, footer }: TableProps<T>) {
  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead className={cx(stickyHeader && 'sticky top-0 z-10 bg-k-surface')}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width }}
                className={cx(
                  'border-b-2 border-k-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-[1px] text-k-muted',
                  ALIGN[c.align ?? 'left'],
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8">
                <Spinner label="Loading…" />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6">
                {empty ?? <EmptyState title="Nothing here yet" compact />}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx('group', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      'border-b border-k-border align-top text-k-text group-last:border-b-0 group-hover:bg-k-surface2',
                      dense ? 'px-3 py-2' : 'px-4 py-3',
                      ALIGN[c.align ?? 'left'],
                      c.hideOnMobile && 'hidden md:table-cell',
                      c.className,
                    )}
                  >
                    {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  )
}
