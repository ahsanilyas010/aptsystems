import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { KamaiTenantsRow } from '../../lib/db-types'

/** All tenants (platform admins can read every row). Shared by Tenants, Orders, Credit, Audit. */
export function useAllTenants() {
  return useQuery({
    queryKey: ['os', 'tenants'],
    queryFn: async (): Promise<KamaiTenantsRow[]> => {
      const { data, error } = await supabase.from('kamai_tenants').select('*').order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiTenantsRow[]
    },
    staleTime: 30_000,
    retry: false,
  })
}

export function tenantNameMap(rows: KamaiTenantsRow[] | undefined): Map<string, string> {
  return new Map((rows ?? []).map((t) => [t.id, t.name]))
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
