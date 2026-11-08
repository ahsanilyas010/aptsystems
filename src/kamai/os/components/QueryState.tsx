import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, EmptyState, Spinner } from '../../ui'

/** Error card shown when a query or RPC fails (e.g. migrations not applied yet). */
export function ErrorState({ error, onRetry, title = 'Could not load this data' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'Unknown error'
  return (
    <EmptyState
      icon={<AlertTriangle size={22} className="text-k-red" />}
      title={title}
      description={msg}
      action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button> : undefined}
    />
  )
}

/** Renders loading / error / empty / content for a TanStack query result. */
export function QueryBoundary<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown }
  isEmpty?: (d: T) => boolean
  empty?: ReactNode
  children: (d: T) => ReactNode
}) {
  if (query.isLoading) return <Spinner label="Loading…" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (query.data === undefined) return null
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>
  return <>{children(query.data)}</>
}
