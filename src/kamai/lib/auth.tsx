import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Navigate, Outlet, useLocation } from 'react-router'
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Types (mirror the JSON returned by the `kamai_my_context` RPC)
// ---------------------------------------------------------------------------

export type TenantType = 'platform' | 'distributor' | 'brand' | 'lender' | 'vertical'
export type MembershipRole = 'owner' | 'manager' | 'booker' | 'finance' | 'viewer' | 'rider' | 'store'

export interface TenantSummary {
  id: string
  slug: string
  name: string
  type: TenantType
}

export interface Membership {
  tenant_id: string
  role: MembershipRole
  store_id: string | null
  status: string
  tenant: TenantSummary
}

export interface AuthCtx {
  platformAdmin: boolean
  legacyRoles: string[]
  memberships: Membership[]
}

export const EMPTY_CTX: AuthCtx = { platformAdmin: false, legacyRoles: [], memberships: [] }

export interface AuthState {
  session: Session | null
  user: User | null
  /** true until the initial session AND context have been resolved */
  loading: boolean
  ctx: AuthCtx
  activeTenantId: string | null
  setActiveTenantId: (id: string | null) => void
  signOut: () => Promise<void>
  /** re-fetch kamai_my_context (e.g. after accepting an invite) */
  refresh: () => Promise<AuthCtx>
}

export const ACTIVE_TENANT_STORAGE_KEY = 'kamai-active-tenant'

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

interface RawCtx {
  platform_admin?: boolean
  legacy_roles?: string[] | null
  memberships?: Array<Partial<Membership> & { tenant?: Partial<TenantSummary> | null }> | null
}

function normalizeCtx(raw: unknown): AuthCtx {
  if (!raw || typeof raw !== 'object') return EMPTY_CTX
  const r = raw as RawCtx
  const memberships: Membership[] = (r.memberships ?? [])
    .filter((m) => m && m.tenant_id && m.role)
    .map((m) => ({
      tenant_id: String(m.tenant_id),
      role: m.role as MembershipRole,
      store_id: m.store_id ?? null,
      status: m.status ?? 'active',
      tenant: {
        id: String(m.tenant?.id ?? m.tenant_id),
        slug: String(m.tenant?.slug ?? ''),
        name: String(m.tenant?.name ?? ''),
        type: (m.tenant?.type ?? 'distributor') as TenantType,
      },
    }))
  return {
    platformAdmin: Boolean(r.platform_admin),
    legacyRoles: Array.isArray(r.legacy_roles) ? r.legacy_roles.map(String) : [],
    memberships,
  }
}

/** Calls the `kamai_my_context` RPC. Any error (including a missing function) yields EMPTY_CTX. */
export async function loadKamaiContext(): Promise<AuthCtx> {
  try {
    const { data, error } = await supabase.rpc('kamai_my_context')
    if (error) {
      if (import.meta.env.DEV) console.warn('[kamai] kamai_my_context failed:', error.message)
      return EMPTY_CTX
    }
    return normalizeCtx(data)
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[kamai] kamai_my_context threw:', e)
    return EMPTY_CTX
  }
}

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredTenant(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, id)
    else localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ctx, setCtx] = useState<AuthCtx>(EMPTY_CTX)
  const [loading, setLoading] = useState(true)
  const [activeTenantId, setActiveTenantState] = useState<string | null>(() => readStoredTenant())
  const userIdRef = useRef<string | null>(null)

  const applySession = useCallback(async (s: Session | null) => {
    setSession(s)
    const uid = s?.user?.id ?? null
    if (!uid) {
      userIdRef.current = null
      setCtx(EMPTY_CTX)
      setLoading(false)
      return
    }
    const changedUser = userIdRef.current !== uid
    userIdRef.current = uid
    if (changedUser) {
      const c = await loadKamaiContext()
      // guard against a sign-out that happened while the RPC was in flight
      if (userIdRef.current === uid) setCtx(c)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) void applySession(data.session)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return
      if (event === 'TOKEN_REFRESHED') {
        setSession(s)
        return
      }
      void applySession(s)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [applySession])

  // Drop a persisted active tenant that the user is no longer a member of.
  useEffect(() => {
    if (loading || !activeTenantId) return
    if (ctx.platformAdmin) return
    if (!ctx.memberships.some((m) => m.tenant_id === activeTenantId)) {
      setActiveTenantState(null)
      writeStoredTenant(null)
    }
  }, [loading, ctx, activeTenantId])

  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantState(id)
    writeStoredTenant(id)
  }, [])

  const signOut = useCallback(async () => {
    userIdRef.current = null
    setCtx(EMPTY_CTX)
    setActiveTenantState(null)
    writeStoredTenant(null)
    try {
      await supabase.auth.signOut()
    } finally {
      setSession(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    const c = await loadKamaiContext()
    setCtx(c)
    return c
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      ctx,
      activeTenantId,
      setActiveTenantId,
      signOut,
      refresh,
    }),
    [session, loading, ctx, activeTenantId, setActiveTenantId, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider> (mounted by KamaiRoot)')
  return v
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(['active'])

export function isActiveMembership(m: Membership): boolean {
  return ACTIVE_STATUSES.has(m.status)
}

/** Active (status='active') memberships only. */
export function useMemberships(): Membership[] {
  const { ctx } = useAuth()
  return useMemo(() => ctx.memberships.filter(isActiveMembership), [ctx])
}

/**
 * The membership for the active tenant (first active membership on that
 * tenant, preferring the highest-privilege role), or null.
 */
export function useActiveMembership(): Membership | null {
  const { ctx, activeTenantId } = useAuth()
  return useMemo(() => {
    const active = ctx.memberships.filter(isActiveMembership)
    const pool = activeTenantId ? active.filter((m) => m.tenant_id === activeTenantId) : active
    if (pool.length === 0) return null
    return [...pool].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role])[0]
  }, [ctx, activeTenantId])
}

/** Active tenant summary (from memberships), or null. */
export function useActiveTenant(): TenantSummary | null {
  const m = useActiveMembership()
  return m?.tenant ?? null
}

export const ROLE_RANK: Record<MembershipRole, number> = {
  owner: 0,
  manager: 1,
  finance: 2,
  booker: 3,
  viewer: 4,
  rider: 5,
  store: 6,
}

export function matchMemberships(ctx: AuthCtx, types: readonly string[], roles: readonly string[]): Membership[] {
  return ctx.memberships.filter(
    (m) =>
      isActiveMembership(m) &&
      (types.length === 0 || types.includes(m.tenant.type)) &&
      (roles.length === 0 || roles.includes(m.role)),
  )
}

/** Where to send a signed-in user who lands on /auth/login or /. */
export function defaultSurfaceFor(ctx: AuthCtx): string {
  if (ctx.platformAdmin) return '/os'
  const act = ctx.memberships.filter(isActiveMembership)
  if (act.some((m) => m.role === 'store' && m.store_id)) return '/store'
  if (act.some((m) => m.tenant.type === 'distributor' && m.role !== 'rider' && m.role !== 'store')) return '/distributor'
  if (act.some((m) => m.tenant.type === 'lender')) return '/lender'
  if (act.some((m) => m.tenant.type === 'brand')) return '/brand'
  if (act.some((m) => m.role === 'rider') || ctx.legacyRoles.includes('rider')) return '/delivery'
  if (act.some((m) => m.tenant.type === 'vertical')) return '/distributor'
  return '/auth/login?error=no_access'
}

// ---------------------------------------------------------------------------
// Guards (render <Outlet/>)
// ---------------------------------------------------------------------------

function GuardLoading() {
  return (
    <div className="kamai-root flex min-h-screen items-center justify-center bg-k-bg">
      <div
        className="h-8 w-8 rounded-full border-[3px] border-k-border border-t-k-green"
        style={{ animation: 'kamai-spin 0.8s linear infinite' }}
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}

export function NoAccess({ title = 'No access', message }: { title?: string; message?: string }) {
  const { signOut, user } = useAuth()
  return (
    <div className="kamai-root flex min-h-screen items-center justify-center bg-k-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-k-border bg-k-surface p-8 text-center">
        <div className="mb-2 text-xs font-bold uppercase tracking-[2px] text-k-muted">Kamai</div>
        <h1 className="mb-2 text-xl font-bold text-k-dark">{title}</h1>
        <p className="mb-6 text-sm text-k-muted">
          {message ?? 'Your account does not have permission to open this area.'}
          {user?.email ? ` Signed in as ${user.email}.` : ''}
        </p>
        <div className="flex justify-center gap-2">
          <a href="/auth/login" className="rounded-lg border border-k-border bg-k-surface px-4 py-2 text-sm font-semibold text-k-dark">
            Switch account
          </a>
          <button onClick={() => void signOut()} className="rounded-lg bg-k-green px-4 py-2 text-sm font-semibold text-white">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

function useNextPath(): string {
  const loc = useLocation()
  return `${loc.pathname}${loc.search}${loc.hash}`
}

/** Requires a Supabase session; otherwise redirects to /auth/login?next=<path>. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const next = useNextPath()
  if (loading) return <GuardLoading />
  if (!session) return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />
  return <Outlet />
}

/** Requires ctx.platformAdmin. */
export function RequirePlatformAdmin() {
  const { session, loading, ctx } = useAuth()
  const next = useNextPath()
  if (loading) return <GuardLoading />
  if (!session) return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />
  if (!ctx.platformAdmin) return <NoAccess message="This area is for Kamai platform admins." />
  return <Outlet />
}

export interface RequireTenantRoleProps {
  /** tenant types allowed, e.g. ['distributor','vertical']; empty = any */
  types: string[]
  /** membership roles allowed, e.g. ['owner','manager']; empty = any */
  roles: string[]
  /** platform admins pass regardless of membership (default true) */
  allowPlatformAdmin?: boolean
}

/**
 * Requires an active membership matching types x roles. Auto-selects the
 * first matching membership as the active tenant when none is selected or
 * the selected one does not match.
 */
export function RequireTenantRole({ types, roles, allowPlatformAdmin = true }: RequireTenantRoleProps) {
  const { session, loading, ctx, activeTenantId, setActiveTenantId } = useAuth()
  const next = useNextPath()
  const matches = useMemo(() => matchMemberships(ctx, types, roles), [ctx, types, roles])
  const selectedOk = Boolean(activeTenantId && matches.some((m) => m.tenant_id === activeTenantId))
  const adminPass = allowPlatformAdmin && ctx.platformAdmin

  useEffect(() => {
    if (loading || !session) return
    if (!selectedOk && matches.length > 0) setActiveTenantId(matches[0].tenant_id)
  }, [loading, session, selectedOk, matches, setActiveTenantId])

  if (loading) return <GuardLoading />
  if (!session) return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />
  if (matches.length === 0 && !adminPass) {
    return <NoAccess message={`You need a ${roles.length ? roles.join('/') : 'tenant'} role on a ${types.length ? types.join('/') : ''} tenant.`} />
  }
  if (matches.length > 0 && !selectedOk) return <GuardLoading />
  return <Outlet />
}

/** Requires a membership with role 'store' and a store_id (auto-selects it as active tenant). */
export function RequireStore() {
  const { session, loading, ctx, activeTenantId, setActiveTenantId } = useAuth()
  const next = useNextPath()
  const stores = useMemo(() => ctx.memberships.filter((m) => isActiveMembership(m) && m.role === 'store' && m.store_id), [ctx])
  const selectedOk = Boolean(activeTenantId && stores.some((m) => m.tenant_id === activeTenantId))

  useEffect(() => {
    if (loading || !session) return
    if (!selectedOk && stores.length > 0) setActiveTenantId(stores[0].tenant_id)
  }, [loading, session, selectedOk, stores, setActiveTenantId])

  if (loading) return <GuardLoading />
  if (!session) return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />
  if (stores.length === 0) return <NoAccess title="Store login required" message="Ask your distributor to register your store and share your PIN." />
  if (!selectedOk) return <GuardLoading />
  return <Outlet />
}

/** Requires membership role 'rider', OR legacy role 'rider', OR platform admin. */
export function RequireRider() {
  const { session, loading, ctx } = useAuth()
  const next = useNextPath()
  if (loading) return <GuardLoading />
  if (!session) return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />
  const ok = ctx.platformAdmin || ctx.legacyRoles.includes('rider') || ctx.memberships.some((m) => isActiveMembership(m) && m.role === 'rider')
  if (!ok) return <NoAccess title="Rider access required" message="This area is for delivery riders." />
  return <Outlet />
}

/** Convenience: the store membership for the active tenant (role 'store'). */
export function useStoreMembership(): Membership | null {
  const { ctx, activeTenantId } = useAuth()
  return useMemo(() => {
    const stores = ctx.memberships.filter((m) => isActiveMembership(m) && m.role === 'store' && m.store_id)
    return stores.find((m) => m.tenant_id === activeTenantId) ?? stores[0] ?? null
  }, [ctx, activeTenantId])
}
