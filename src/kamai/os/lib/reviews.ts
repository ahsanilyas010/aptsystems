import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { KamaiAdminNotificationsRow, KamaiReviewQueueRow } from '../../lib/db-types'

export const REVIEW_KEY = ['os', 'reviews'] as const

export function useReviewQueue() {
  return useQuery({
    queryKey: [...REVIEW_KEY, 'queue'],
    queryFn: async (): Promise<KamaiReviewQueueRow[]> => {
      const { data, error } = await supabase.rpc('kamai_review_queue')
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiReviewQueueRow[]
    },
    staleTime: 20_000,
    retry: false,
  })
}

export function useAdminNotifications() {
  return useQuery({
    queryKey: [...REVIEW_KEY, 'notifications'],
    queryFn: async (): Promise<KamaiAdminNotificationsRow[]> => {
      const { data, error } = await supabase.from('kamai_admin_notifications').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiAdminNotificationsRow[]
    },
    staleTime: 20_000,
    retry: false,
  })
}

/** Applications awaiting a decision + products awaiting review (for the nav badge). */
export function pendingCount(rows: KamaiReviewQueueRow[] | undefined): number {
  let n = 0
  for (const r of rows ?? []) {
    if (r.onboarding_status === 'pending_review') n += 1
    n += Number(r.submitted_count) || 0
  }
  return n
}

export function useReviewPending(): number {
  const q = useReviewQueue()
  return pendingCount(q.data)
}

export function useRefreshReviews(): () => Promise<void> {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: REVIEW_KEY })
}
