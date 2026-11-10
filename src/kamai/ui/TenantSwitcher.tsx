import { useAuth, isActiveMembership } from '../lib/auth'

/** Dropdown of the user's active tenants; renders nothing when there is only one. */
export function TenantSwitcher({ types }: { types?: string[] }) {
  const { ctx, activeTenantId, setActiveTenantId } = useAuth()
  const seen = new Set<string>()
  const tenants = ctx.memberships
    .filter((m) => isActiveMembership(m) && (!types || types.includes(m.tenant.type)))
    .map((m) => m.tenant)
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
  if (tenants.length < 2) {
    return tenants[0] ? <span className="text-xs font-bold uppercase tracking-[1.5px] text-k-muted">{tenants[0].name}</span> : null
  }
  return (
    <select
      value={activeTenantId ?? ''}
      onChange={(e) => setActiveTenantId(e.target.value || null)}
      className="max-w-[220px] rounded-lg border border-k-border bg-k-surface px-2.5 py-1.5 text-xs font-semibold text-k-dark"
      aria-label="Switch tenant"
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  )
}
