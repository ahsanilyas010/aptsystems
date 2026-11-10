import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { KamaiPlatformAdminsRow, KamaiWaTemplatesRow } from '../../lib/db-types'
import { fmtDate, humanize } from '../../lib/format'
import { Badge, PageHeader, Stat, Table, statusTone, type Column } from '../../ui'
import { Grid, Panel, Stack } from '../components/content-ui'
import { ErrorState } from '../components/QueryState'
import { useOsKpiView } from '../lib/kpi'

const REPO = 'https://github.com/ahsanilyas010/aptsystems/blob/main'
const DOCS = [
  { path: 'docs/KAMAI_OS_PLAN.md', title: 'Build plan', desc: 'Scope, tenancy model, data model, phases and gates.' },
  { path: 'docs/KAMAI_DB.md', title: 'Database reference', desc: 'Tables, views, RPCs, who may call what, apply procedure.' },
  { path: 'docs/KAMAI_RUNBOOK.md', title: 'Operator runbook', desc: 'Vercel environment variables, WhatsApp setup, cron.' },
  { path: 'src/kamai/README.md', title: 'Frontend contracts', desc: 'Route modules, guards, UI kit and data conventions.' },
]
const WA_ENV = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN']

function useAdmins() {
  return useQuery({
    queryKey: ['os', 'settings', 'admins'],
    queryFn: async (): Promise<KamaiPlatformAdminsRow[]> => {
      const { data, error } = await supabase.from('kamai_platform_admins').select('*').order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as KamaiPlatformAdminsRow[]
    },
    retry: false,
    staleTime: 60_000,
  })
}

function useWhatsApp() {
  return useQuery({
    queryKey: ['os', 'settings', 'whatsapp'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const [tpl, msgs] = await Promise.all([
        supabase.from('kamai_wa_templates').select('id, name, status, category').limit(500),
        supabase.from('kamai_wa_messages').select('status').gte('created_at', since).limit(5000),
      ])
      if (tpl.error) throw new Error(tpl.error.message)
      if (msgs.error) throw new Error(msgs.error.message)
      const templates = (tpl.data ?? []) as Array<Pick<KamaiWaTemplatesRow, 'id' | 'name' | 'status' | 'category'>>
      const counts: Record<string, number> = {}
      for (const m of (msgs.data ?? []) as Array<{ status: string }>) counts[m.status] = (counts[m.status] ?? 0) + 1
      return { templates, counts }
    },
    retry: false,
    staleTime: 60_000,
  })
}

export function Component() {
  const { user } = useAuth()
  const kpi = useOsKpiView()
  const admins = useAdmins()
  const wa = useWhatsApp()

  const cols: Column<KamaiPlatformAdminsRow>[] = [
    { key: 'u', header: 'User id', render: (a) => (<span className="font-mono text-xs">{a.user_id}{a.user_id === user?.id ? <Badge tone="green" size="sm" className="ml-2">You</Badge> : null}</span>) },
    { key: 'n', header: 'Note', render: (a) => a.note || <span className="text-k-light">—</span> },
    { key: 'c', header: 'Added', hideOnMobile: true, render: (a) => fmtDate(a.created_at) },
  ]

  const sent = (wa.data?.counts.sent ?? 0) + (wa.data?.counts.delivered ?? 0) + (wa.data?.counts.read ?? 0)
  const queued = wa.data?.counts.queued ?? kpi.k.kamai_wa_queued
  const tplApproved = wa.data?.templates.filter((t) => t.status === 'approved').length ?? 0

  return (
    <Stack>
      <PageHeader eyebrow="Kamai OS" title="Settings" description="Platform administrators, messaging channel status and reference documents." />

      <Panel title="Signed in as">
        <p className="text-sm text-k-dark">{user?.email ?? '—'}</p>
        <p className="mt-1 break-all font-mono text-xs text-k-muted">{user?.id}</p>
      </Panel>

      <Panel title="Platform admins" action={<Badge tone="muted">{admins.data?.length ?? 0}</Badge>}>
        {admins.error ? <ErrorState error={admins.error} onRetry={() => void admins.refetch()} /> : (
          <>
            <Table dense columns={cols} rows={admins.data ?? []} rowKey={(a) => a.user_id} loading={admins.isLoading} />
            <p className="mt-3 text-xs text-k-muted">Admins are rows in kamai_platform_admins, plus any user with the legacy user_roles admin role. Add or remove admins with SQL through the Supabase connector so the change is reviewed.</p>
          </>
        )}
      </Panel>

      <Panel title="WhatsApp" action={<Badge tone={sent > 0 ? 'green' : 'amber'} dot>{sent > 0 ? 'Sending' : 'wa.me fallback'}</Badge>}>
        <Grid cols={4}>
          <Stat label="Queued" value={queued} sub="kamai_wa_messages outbox" />
          <Stat label="Sent, 7 days" value={sent} sub="sent, delivered or read" tone="green" />
          <Stat label="Templates" value={wa.data?.templates.length ?? 0} sub={`${tplApproved} approved`} />
          <Stat label="Failed, 7 days" value={wa.data?.counts.failed ?? 0} sub="Check the access token" tone="dark" />
        </Grid>
        {wa.error ? <div className="mt-3"><ErrorState error={wa.error} title="WhatsApp tables unavailable" onRetry={() => void wa.refetch()} /></div> : null}
        <div className="mt-4 rounded-xl bg-k-surface2 p-4 text-[13px] text-k-muted">
          <p className="mb-2">The Meta Cloud API credentials are server-side Vercel variables and cannot be read from the browser. When they are missing, messages stay queued and the app offers wa.me links. Variables to set:</p>
          <div className="flex flex-wrap gap-1.5">
            {WA_ENV.map((v) => <code key={v} className="rounded bg-k-surface px-1.5 py-0.5 text-[11px] text-k-dark">{v}</code>)}
          </div>
          <p className="mt-2">Webhook URL: <code className="rounded bg-k-surface px-1.5 py-0.5 text-[11px] text-k-dark">https://apt.assorted.group/api/kamai-whatsapp</code></p>
        </div>
        {wa.data && wa.data.templates.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {wa.data.templates.map((t) => <Badge key={t.id} tone={statusTone(t.status)}>{t.name} · {humanize(t.status)}</Badge>)}
          </div>
        ) : null}
      </Panel>

      <Panel title="Documents">
        <ul className="divide-y divide-k-border">
          {DOCS.map((d) => (
            <li key={d.path}>
              <a href={`${REPO}/${d.path}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 py-3 hover:text-k-green">
                <div>
                  <div className="text-sm font-semibold text-k-dark">{d.title}</div>
                  <div className="text-xs text-k-muted">{d.desc} <span className="font-mono text-k-light">{d.path}</span></div>
                </div>
                <ExternalLink size={15} className="shrink-0 text-k-muted" />
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </Stack>
  )
}
