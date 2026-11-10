import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Table, useToast, type BadgeTone, type Column } from '../../ui'
import { fmtDateTime } from '../../lib/format'
import { notifyAdmin } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import type { EmailStatus, KamaiAdminNotificationsRow } from '../../lib/db-types'
import { ErrorState } from '../components/QueryState'
import { errMsg } from '../lib/tenants'
import { useAdminNotifications, useRefreshReviews } from '../lib/reviews'

const TONE: Record<EmailStatus, BadgeTone> = { pending: 'amber', sent: 'green', failed: 'red', skipped: 'muted' }

function summary(n: KamaiAdminNotificationsRow): string {
  const p = n.payload ?? {}
  if (n.kind === 'distributor_signup') {
    return `${String(p.company ?? p.tenant_name ?? 'New distributor')} · ${[p.contact_name, p.mobile, p.city].filter(Boolean).join(' · ')}`
  }
  const names = Array.isArray(p.product_names) ? (p.product_names as unknown[]).slice(0, 3).join(', ') : ''
  return `${String(p.tenant_name ?? 'Distributor')} submitted ${String(p.count ?? '?')} product(s)${names ? `: ${names}` : ''}`
}

export function ReviewNotifications() {
  const q = useAdminNotifications()
  const toast = useToast()
  const refresh = useRefreshReviews()
  const [busy, setBusy] = useState(false)

  async function markRead(ids: string[]) {
    if (!ids.length) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('kamai_mark_notifications_read', { p_ids: ids })
      if (error) throw new Error(error.message)
      await refresh()
    } catch (e) {
      toast.error(errMsg(e), { title: 'Could not mark read' })
    } finally {
      setBusy(false)
    }
  }

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load notifications" />
  const rows = q.data ?? []
  const unread = rows.filter((r) => !r.read_at).map((r) => r.id)

  const cols: Column<KamaiAdminNotificationsRow>[] = [
    { key: 'when', header: 'When', render: (n) => <span className={n.read_at ? 'text-k-muted' : 'font-bold text-k-dark'}>{fmtDateTime(n.created_at)}</span> },
    { key: 'kind', header: 'Type', render: (n) => <Badge tone={n.kind === 'distributor_signup' ? 'blue' : 'dark'} size="sm">{n.kind === 'distributor_signup' ? 'Sign-up' : 'Products'}</Badge> },
    { key: 'what', header: 'Details', className: 'min-w-[240px]', render: (n) => <span className="whitespace-normal">{summary(n)}</span> },
    {
      key: 'email',
      header: 'Email',
      render: (n) => (
        <div>
          <Badge tone={TONE[n.email_status]} size="sm">{n.email_status}</Badge>
          {n.email_attempts ? <span className="ml-1 text-[11px] text-k-muted">x{n.email_attempts}</span> : null}
          {n.email_error ? <div className="mt-0.5 max-w-[220px] whitespace-normal text-[11px] text-k-red">{n.email_error}</div> : null}
        </div>
      ),
    },
    { key: 'act', header: '', align: 'right', render: (n) => (n.read_at ? <span className="text-xs text-k-light">Read</span> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => void markRead([n.id])}>Mark read</Button>) },
  ]

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !unread.length} onClick={() => void markRead(unread)}>Mark all read ({unread.length})</Button>
        <Button size="sm" variant="secondary" icon={<Mail size={14} />} onClick={() => { notifyAdmin(); toast.info('Retrying pending emails…'); setTimeout(() => void refresh(), 2500) }}>Retry pending emails</Button>
      </div>
      <Card padding="none">
        <Table columns={cols} rows={rows} rowKey={(n) => n.id} loading={q.isLoading} empty={<EmptyState title="No notifications yet" compact />} />
      </Card>
    </>
  )
}
