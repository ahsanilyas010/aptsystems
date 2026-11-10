import { Info } from 'lucide-react'
import { Badge, Card, type BadgeTone } from '../../ui'
import type { ListingStatus } from '../../lib/db-types'
import { readOnboarding } from '../../lib/onboarding'
import { useAuth } from '../../lib/auth'
import { useTenantRow } from './data'

export const LISTING_META: Record<ListingStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  submitted: { label: 'In review', tone: 'blue' },
  changes_requested: { label: 'Changes requested', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export function ListingBadge({ status }: { status: ListingStatus | null | undefined }) {
  const m = LISTING_META[status ?? 'approved'] ?? LISTING_META.approved
  return <Badge tone={m.tone} size="sm">{m.label}</Badge>
}

/** Onboarding state of the active distributor tenant (plus whether it is a self-signup tenant). */
export function useOnboarding() {
  const q = useTenantRow()
  const { ctx } = useAuth()
  const o = readOnboarding(q.data?.settings)
  // Self-signup distributors never see price lists: the default list holds the marked-up price.
  return { ...o, hidePriceLists: o.selfSignup && !ctx.platformAdmin, loading: q.isLoading }
}

export function OnboardingBanner() {
  const { status } = useOnboarding()
  if (status === 'pending_review')
    return (
      <Card tone="muted" className="mb-4 border-[#b07800]/40">
        <div className="flex items-start gap-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-[#b07800]" />
          <div>
            <div className="font-bold text-k-dark">Your account is under review. You can upload products now.</div>
            <p className="text-[13px] text-k-muted">Add your products, then press “Submit for review”. We check each product and publish it to stores once approved.</p>
          </div>
        </div>
      </Card>
    )
  if (status === 'rejected')
    return (
      <Card tone="muted" className="mb-4 border-k-red/40">
        <div className="flex items-start gap-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-k-red" />
          <div>
            <div className="font-bold text-k-red">Your application was not approved.</div>
            <p className="text-[13px] text-k-muted">Your products will not be published. Please contact Kamai support if you think this is a mistake.</p>
          </div>
        </div>
      </Card>
    )
  return null
}
