import { useState } from 'react'
import { PageHeader, Tabs } from '../../ui'
import { ReviewApplications } from '../parts/ReviewApplications'
import { ReviewNotifications } from '../parts/ReviewNotifications'
import { ReviewProducts } from '../parts/ReviewProducts'
import { pendingCount, useAdminNotifications, useReviewQueue } from '../lib/reviews'

type Tab = 'applications' | 'products' | 'notifications'

export function Component() {
  const [tab, setTab] = useState<Tab>('applications')
  const [tenantId, setTenantId] = useState('')
  const queue = useReviewQueue()
  const notes = useAdminNotifications()
  const apps = (queue.data ?? []).filter((r) => r.onboarding_status === 'pending_review').length
  const submitted = (queue.data ?? []).reduce((n, r) => n + (Number(r.submitted_count) || 0), 0)
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length

  return (
    <>
      <PageHeader
        title="Reviews"
        eyebrow="Kamai OS"
        description={`Distributor applications and product submissions. ${pendingCount(queue.data)} waiting for you.`}
      >
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { key: 'applications', label: 'Applications', badge: apps },
            { key: 'products', label: 'Product reviews', badge: submitted },
            { key: 'notifications', label: 'Notifications', badge: unread },
          ]}
        />
      </PageHeader>
      {tab === 'applications' ? <ReviewApplications onReviewProducts={(id) => { setTenantId(id); setTab('products') }} /> : null}
      {tab === 'products' ? <ReviewProducts tenantId={tenantId} onTenant={setTenantId} /> : null}
      {tab === 'notifications' ? <ReviewNotifications /> : null}
    </>
  )
}
