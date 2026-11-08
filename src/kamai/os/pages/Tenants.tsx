import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseZap, Plus, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { callKamaiApi } from '../../lib/api'
import type { KamaiTenantsRow, MembershipRole, TenantType } from '../../lib/db-types'
import { fmtDate, humanize } from '../../lib/format'
import { Badge, Button, Input, Modal, PageHeader, Select, Stat, Table, statusTone, useToast, type Column } from '../../ui'
import { Grid, Stack } from '../components/content-ui'
import { ErrorState } from '../components/QueryState'
import { errMsg, useAllTenants } from '../lib/tenants'

const TYPES: TenantType[] = ['distributor', 'brand', 'lender', 'vertical', 'platform']
const ROLES: MembershipRole[] = ['owner', 'manager', 'booker', 'finance', 'viewer', 'rider']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

function useMemberCounts() {
  return useQuery({
    queryKey: ['os', 'tenants', 'members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('kamai_memberships').select('tenant_id, status').limit(20000)
      if (error) throw new Error(error.message)
      const m: Record<string, { active: number; invited: number }> = {}
      for (const r of (data ?? []) as Array<{ tenant_id: string; status: string }>) {
        const e = (m[r.tenant_id] ??= { active: 0, invited: 0 })
        if (r.status === 'active') e.active += 1
        else if (r.status === 'invited') e.invited += 1
      }
      return m
    },
    staleTime: 30_000,
    retry: false,
  })
}

function CreateTenantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<TenantType>('distributor')
  const slugErr = slug && !SLUG_RE.test(slug) ? 'Lowercase letters, digits and dashes, 3 to 40 characters' : undefined
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('kamai_create_tenant', { p_slug: slug, p_name: name.trim(), p_type: type })
      if (error) throw new Error(error.message)
      return data as string
    },
    onSuccess: () => {
      toast.success(`Tenant "${name.trim()}" created`)
      void qc.invalidateQueries({ queryKey: ['os', 'tenants'] })
      setSlug('')
      setName('')
      onClose()
    },
    onError: (e) => toast.error(errMsg(e), { title: 'Could not create tenant' }),
  })
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create tenant"
      description="Seeds the chart of accounts, counters and default policy for the new tenant."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!name.trim() || !SLUG_RE.test(slug)} onClick={() => create.mutate()}>Create tenant</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rawalpindi Traders" />
        <Input label="Slug" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="rwp-traders" error={slugErr} hint="Used in URLs and invoice prefixes. Cannot be changed later." />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as TenantType)} options={TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
      </div>
    </Modal>
  )
}

function AddPersonModal({ tenant, onClose }: { tenant: KamaiTenantsRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<MembershipRole>('owner')
  const [link, setLink] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: async () =>
      callKamaiApi<{ action_link?: string; actionLink?: string; user_id?: string }>('provision_user', {
        tenant_id: tenant?.id,
        role,
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
      }),
    onSuccess: (res) => {
      toast.success(`${email.trim()} added to ${tenant?.name}`)
      void qc.invalidateQueries({ queryKey: ['os', 'tenants', 'members'] })
      const l = res?.action_link ?? res?.actionLink ?? null
      if (l) setLink(l)
      else close()
    },
    onError: (e) => toast.error(errMsg(e), { title: 'Could not add person' }),
  })
  const close = () => {
    setEmail('')
    setFullName('')
    setLink(null)
    onClose()
  }
  return (
    <Modal
      open={!!tenant}
      onClose={close}
      title={`Add person to ${tenant?.name ?? ''}`}
      description="Sends an email invite. The user accepts at /auth/accept and is attached to this tenant with the chosen role."
      footer={
        link ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button loading={add.isPending} disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || !fullName.trim()} onClick={() => add.mutate()} icon={<UserPlus size={14} />}>Add person</Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>The email invite could not be delivered automatically. Share this one-time link with the user:</p>
          <textarea readOnly rows={3} value={link} className="w-full rounded-lg border border-k-border bg-k-surface2 p-2 text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input label="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as MembershipRole)} options={ROLES.map((r) => ({ value: r, label: humanize(r) }))} />
        </div>
      )}
    </Modal>
  )
}

function ImportLegacyModal({ tenant, onClose }: { tenant: KamaiTenantsRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('kamai_import_legacy', { p_tenant_id: tenant?.id })
      if (error) throw new Error(error.message)
      return data as { stores_created: number; products_created: number; credit_accounts_created: number }
    },
    onSuccess: (r) => {
      toast.success(`Imported ${r.stores_created} stores, ${r.products_created} products, ${r.credit_accounts_created} credit accounts`)
      void qc.invalidateQueries({ queryKey: ['os'] })
      onClose()
    },
    onError: (e) => toast.error(errMsg(e), { title: 'Import failed' }),
  })
  return (
    <Modal
      open={!!tenant}
      onClose={onClose}
      title="Import legacy APT data"
      description="Copies stores and products from the legacy CRM tables into this tenant. The legacy tables are only read. Safe to run again: existing rows are skipped."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={run.isPending} onClick={() => run.mutate()} icon={<DatabaseZap size={14} />}>Import now</Button>
        </>
      }
    >
      <p className="text-sm text-k-muted">Target tenant: <strong className="text-k-dark">{tenant?.name}</strong> ({tenant?.slug})</p>
    </Modal>
  )
}

export function Component() {
  const tenants = useAllTenants()
  const members = useMemberCounts()
  const [creating, setCreating] = useState(false)
  const [adding, setAdding] = useState<KamaiTenantsRow | null>(null)
  const [importing, setImporting] = useState<KamaiTenantsRow | null>(null)

  const rows = tenants.data ?? []
  const count = (f: (t: KamaiTenantsRow) => boolean) => rows.filter(f).length

  const columns: Column<KamaiTenantsRow>[] = [
    { key: 'name', header: 'Tenant', render: (t) => (<div><div className="font-semibold text-k-dark">{t.name}</div><div className="text-xs text-k-muted">{t.slug}</div></div>) },
    { key: 'type', header: 'Type', render: (t) => <Badge tone="blue">{humanize(t.type)}</Badge> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)} dot>{humanize(t.status)}</Badge> },
    {
      key: 'members', header: 'People', hideOnMobile: true,
      render: (t) => {
        const m = members.data?.[t.id]
        return m ? `${m.active} active${m.invited ? `, ${m.invited} invited` : ''}` : members.isLoading ? '…' : '0'
      },
    },
    { key: 'flags', header: 'Flags', hideOnMobile: true, render: (t) => ((t.settings as { credit_paused?: boolean } | null)?.credit_paused ? <Badge tone="red">Credit paused</Badge> : <span className="text-k-light">—</span>) },
    { key: 'created', header: 'Created', hideOnMobile: true, render: (t) => fmtDate(t.created_at) },
    {
      key: 'actions', header: '', align: 'right',
      render: (t) => (
        <div className="flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" icon={<UserPlus size={13} />} onClick={() => setAdding(t)}>Add person</Button>
          {t.slug === 'apt' ? <Button size="sm" variant="secondary" icon={<DatabaseZap size={13} />} onClick={() => setImporting(t)}>Import legacy</Button> : null}
        </div>
      ),
    },
  ]

  return (
    <Stack>
      <PageHeader
        eyebrow="Kamai OS"
        title="Tenants"
        description="Distributors, brands, lenders and verticals on the rail. Create a tenant, then invite its owner by email."
        actions={<Button icon={<Plus size={14} />} onClick={() => setCreating(true)}>Create tenant</Button>}
      />
      <Grid cols={4}>
        <Stat label="Tenants" value={rows.length} sub={`${count((t) => t.status === 'active')} active · ${count((t) => t.status !== 'active')} other`} />
        <Stat label="Distributors" value={count((t) => t.type === 'distributor')} sub="Lane B" tone="green" />
        <Stat label="Brands + lenders" value={`${count((t) => t.type === 'brand')} + ${count((t) => t.type === 'lender')}`} sub="Lane A, Abhi" />
        <Stat label="Platform + vertical" value={`${count((t) => t.type === 'platform')} + ${count((t) => t.type === 'vertical')}`} sub="Kamai, APT" tone="dark" />
      </Grid>
      {tenants.error ? (
        <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
      ) : (
        <div className="rounded-2xl border border-k-border bg-k-surface p-2">
          <Table columns={columns} rows={rows} rowKey={(t) => t.id} loading={tenants.isLoading} />
        </div>
      )}
      <CreateTenantModal open={creating} onClose={() => setCreating(false)} />
      <AddPersonModal tenant={adding} onClose={() => setAdding(null)} />
      <ImportLegacyModal tenant={importing} onClose={() => setImporting(null)} />
    </Stack>
  )
}
