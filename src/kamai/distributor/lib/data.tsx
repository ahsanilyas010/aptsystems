import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useActiveMembership, useAuth } from '../../lib/auth'
import type { KamaiStoresRow, KamaiProductsRow, KamaiTenantsRow } from '../../lib/db-types'
import { Button, Card, EmptyState, Spinner } from '../../ui'

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function useTenantId(): string | null {
  return useAuth().activeTenantId
}

/** Role of the signed-in user in the active tenant (null for a pure platform admin). */
export function useRole(): string | null {
  return useActiveMembership()?.role ?? null
}

/** Roles that may write finance / ops data. */
export function useCan(roles: string[]): boolean {
  const { ctx } = useAuth()
  const r = useRole()
  return ctx.platformAdmin || (r !== null && roles.includes(r))
}

interface PgResult<T> {
  data: T | null
  error: { message: string } | null
}

/** TanStack Query wrapper: key is scoped by the active tenant id. */
export function useTq<T>(key: unknown[], fn: (tid: string) => PromiseLike<PgResult<T>>, opts?: { enabled?: boolean; staleTime?: number }) {
  const tid = useTenantId()
  return useQuery<T, Error>({
    queryKey: ['kd', tid, ...key],
    enabled: !!tid && (opts?.enabled ?? true),
    staleTime: opts?.staleTime ?? 15_000,
    queryFn: async () => {
      const r = await fn(tid as string)
      if (r.error) throw new Error(r.error.message)
      return r.data as T
    },
  })
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Invalidate every distributor query (after a mutation). */
export function useRefreshAll(): () => Promise<void> {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['kd'] })
}

export function useTenantRow() {
  return useTq<KamaiTenantsRow | null>(['tenant'], (tid) => supabase.from('kamai_tenants').select('*').eq('id', tid).maybeSingle(), { staleTime: 60_000 })
}

export function useStores() {
  const q = useTq<KamaiStoresRow[]>(['stores'], (tid) => supabase.from('kamai_stores').select('*').eq('tenant_id', tid).order('name').limit(5000))
  const map = new Map<string, KamaiStoresRow>()
  for (const s of q.data ?? []) map.set(s.id, s)
  return { ...q, rows: q.data ?? [], map }
}

export function useProducts() {
  const q = useTq<KamaiProductsRow[]>(['products'], (tid) => supabase.from('kamai_products').select('*').eq('tenant_id', tid).order('name').limit(5000))
  return { ...q, rows: q.data ?? [] }
}

export function ErrorState({ error, onRetry, title = 'Could not load data' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Card tone="muted" className="border-k-red/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-k-red" size={20} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-k-dark">{title}</div>
          <p className="mt-1 break-words text-[13px] text-k-muted">{errMsg(error)}</p>
          <p className="mt-1 text-xs text-k-light">If the Kamai database migrations have not been applied yet this is expected.</p>
        </div>
        {onRetry ? (
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

/** Renders spinner / error / empty / children for a query. */
export function Gate({
  q,
  empty,
  isEmpty,
  children,
}: {
  q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  empty?: ReactNode
  isEmpty?: boolean
  children: ReactNode
}) {
  if (q.isLoading) return <Spinner label="Loading…" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (isEmpty) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>
  return <>{children}</>
}

export function NoTenant() {
  return <EmptyState title="No active tenant" description="Pick a tenant from the switcher to continue." />
}

/** Start of today in Asia/Karachi (UTC+5) as ISO. */
export function startOfTodayPkt(): string {
  const pk = new Date(Date.now() + 5 * 3600_000)
  pk.setUTCHours(0, 0, 0, 0)
  return new Date(pk.getTime() - 5 * 3600_000).toISOString()
}

export function todayPktDate(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
}

/** Whole days from date-string a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}
