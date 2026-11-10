import { useState } from 'react'
import { Check, PackageSearch, X } from 'lucide-react'
import { Badge, Button, EmptyState, Modal, Table, Textarea, useToast, type Column } from '../../ui'
import { Card } from '../../ui'
import { fmtDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { KamaiReviewQueueRow } from '../../lib/db-types'
import { ErrorState } from '../components/QueryState'
import { errMsg } from '../lib/tenants'
import { useRefreshReviews, useReviewQueue } from '../lib/reviews'

const TONE = { pending_review: 'amber', approved: 'green', rejected: 'red' } as const

export function ReviewApplications({ onReviewProducts }: { onReviewProducts: (tenantId: string) => void }) {
  const q = useReviewQueue()
  const toast = useToast()
  const refresh = useRefreshReviews()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<KamaiReviewQueueRow | null>(null)
  const [note, setNote] = useState('')

  async function decide(r: KamaiReviewQueueRow, action: 'approve' | 'reject', n?: string) {
    setBusy(r.tenant_id)
    try {
      const { error } = await supabase.rpc('kamai_review_distributor', { p_tenant_id: r.tenant_id, p_action: action, p_note: n?.trim() || null })
      if (error) throw new Error(error.message)
      toast.success(`${r.tenant_name} ${action === 'approve' ? 'approved' : 'rejected'}`)
      setRejecting(null)
      setNote('')
      await refresh()
    } catch (e) {
      toast.error(errMsg(e), { title: 'Could not update the account' })
    } finally {
      setBusy(null)
    }
  }

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load applications" />

  const cols: Column<KamaiReviewQueueRow>[] = [
    {
      key: 'name',
      header: 'Distributor',
      render: (r) => (
        <div>
          <div className="font-semibold text-k-dark">{r.tenant_name}</div>
          <div className="text-xs text-k-muted">{r.slug} · applied {fmtDate(r.created_at)}</div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      render: (r) => (
        <div className="text-xs">
          <div className="font-semibold text-k-dark">{r.contact?.contact_name ?? '—'}</div>
          <div className="text-k-muted">{[r.contact?.mobile, r.contact?.city].filter(Boolean).join(' · ') || '—'}</div>
          <div className="text-k-muted">{r.contact?.email ?? ''}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Account', render: (r) => <Badge tone={TONE[r.onboarding_status as keyof typeof TONE] ?? 'muted'} size="sm">{String(r.onboarding_status).replace('_', ' ')}</Badge> },
    {
      key: 'counts',
      header: 'Products',
      align: 'right',
      render: (r) => (
        <div className="text-xs">
          <span className="font-bold text-[#2563eb]">{r.submitted_count}</span> in review · {r.draft_count} draft · {r.approved_count} live
        </div>
      ),
    },
    {
      key: 'act',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" variant="secondary" icon={<PackageSearch size={14} />} onClick={() => onReviewProducts(r.tenant_id)}>Products</Button>
          {r.onboarding_status !== 'approved' ? <Button size="sm" icon={<Check size={14} />} loading={busy === r.tenant_id} onClick={() => void decide(r, 'approve')}>Approve</Button> : null}
          {r.onboarding_status !== 'rejected' ? <Button size="sm" variant="danger" icon={<X size={14} />} onClick={() => setRejecting(r)}>Reject</Button> : null}
        </div>
      ),
    },
  ]

  return (
    <>
      <Card padding="none">
        <Table columns={cols} rows={q.data ?? []} rowKey={(r) => r.tenant_id} loading={q.isLoading} empty={<EmptyState title="No distributor applications yet" description="New sign-ups from /auth/signup appear here." compact />} />
      </Card>
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.tenant_name ?? ''}?`}
        description="The distributor sees a rejected banner. Their products stay hidden from stores."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === rejecting?.tenant_id} onClick={() => rejecting && void decide(rejecting, 'reject', note)}>Reject account</Button>
          </>
        }
      >
        <Textarea label="Internal note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  )
}
