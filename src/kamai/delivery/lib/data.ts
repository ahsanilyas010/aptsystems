import { useMemo } from 'react'
import { useAuth, isActiveMembership } from '../../lib/auth'
import type { KamaiOrdersRow, KamaiStoresRow } from '../../lib/db-types'

export type OrderRow = KamaiOrdersRow
export type StoreRow = Pick<KamaiStoresRow, 'id' | 'name' | 'mobile' | 'address' | 'area' | 'latitude' | 'longitude' | 'owner_name'>

export const STORE_COLS = 'id,name,mobile,address,area,latitude,longitude,owner_name'

/** Default geofence radius; the server reads tenant.settings.geofence_radius_m and is authoritative. */
export const DEFAULT_GEOFENCE_M = 150
export const CASH_CAP_MINOR = 5_000_000 // Rs 50,000
export { POD_BUCKET } from '../../lib/pod'

/** Rider's tenant: active tenant if it is a rider membership, else the first rider membership. */
export function useRiderTenant(): { tenantId: string | null; userId: string | null } {
  const { ctx, activeTenantId, user } = useAuth()
  const tenantId = useMemo(() => {
    const riders = ctx.memberships.filter((m) => isActiveMembership(m) && m.role === 'rider')
    return riders.find((m) => m.tenant_id === activeTenantId)?.tenant_id ?? riders[0]?.tenant_id ?? null
  }, [ctx, activeTenantId])
  return { tenantId, userId: user?.id ?? null }
}

/** YYYY-MM-DD in Asia/Karachi. */
export function karachiDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function startOfKarachiDay(date: string = karachiDate()): string {
  return new Date(`${date}T00:00:00+05:00`).toISOString()
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Kuch ghalat ho gaya. / Something went wrong.'
}

export function isNetworkError(e: unknown): boolean {
  const m = errMsg(e).toLowerCase()
  return !navigator.onLine || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request failed')
}
