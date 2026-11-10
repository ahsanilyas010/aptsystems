import { useMemo, useState, type ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router'
import {
  AlertTriangle, Award, Bot, Building2, ClipboardCheck, ClipboardList, Cpu, CreditCard, Layers, LayoutDashboard, LogOut, Map, Megaphone,
  Menu, Server, Settings, ShieldCheck, ShoppingCart, Store, Truck, Users, Wallet, X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { TenantSwitcher, cx } from '../ui'
import { useReviewPending } from './lib/reviews'

interface Item {
  to: string
  label: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  end?: boolean
  /** show the pending-reviews count */
  badge?: boolean
}
interface Group {
  label: string
  hint?: string
  items: Item[]
}

/** Navigation grouped by lane / phase of the Platform Plan. */
export const OS_NAV: Group[] = [
  {
    label: 'Command',
    hint: 'Live',
    items: [
      { to: '/os', label: 'Command', icon: LayoutDashboard, end: true },
      { to: '/os/orders', label: 'Orders', icon: ClipboardList },
      { to: '/os/credit', label: 'Credit', icon: CreditCard },
      { to: '/os/tenants', label: 'Tenants', icon: Building2 },
      { to: '/os/reviews', label: 'Reviews', icon: ClipboardCheck, badge: true },
    ],
  },
  {
    label: 'Platform plan',
    hint: 'Phases 0-3',
    items: [
      { to: '/os/model', label: 'Business Model', icon: Layers },
      { to: '/os/platform', label: 'Platform Plan', icon: Server },
      { to: '/os/roadmap', label: 'Roadmap', icon: Map },
      { to: '/os/gaps', label: 'Gaps', icon: AlertTriangle },
    ],
  },
  {
    label: 'Lane C · Own JIT',
    hint: 'APT, capped',
    items: [
      { to: '/os/procurement', label: 'Procurement', icon: ShoppingCart },
      { to: '/os/vendors', label: 'Vendors', icon: Truck },
      { to: '/os/stores', label: 'Target Stores', icon: Store },
      { to: '/os/heroes', label: 'Hero Network', icon: Award },
    ],
  },
  {
    label: 'Lanes A + B · Rail',
    hint: 'Finance and tech',
    items: [
      { to: '/os/finance', label: 'Finance', icon: Wallet },
      { to: '/os/tech', label: 'Tech', icon: Cpu },
    ],
  },
  {
    label: 'Company',
    items: [
      { to: '/os/agents', label: 'AI Agents', icon: Bot },
      { to: '/os/marketing', label: 'Marketing', icon: Megaphone },
      { to: '/os/hr', label: 'HR', icon: Users },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/os/audit', label: 'Audit log', icon: ShieldCheck },
      { to: '/os/settings', label: 'Settings', icon: Settings },
    ],
  },
]

function NavGroups({ onNavigate }: { onNavigate?: () => void }) {
  const pending = useReviewPending()
  return (
    <nav className="flex flex-col gap-4">
      {OS_NAV.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <div className="mb-1 flex items-baseline justify-between px-3 text-[10px] font-bold uppercase tracking-[1.5px] text-k-green-mid">
            <span>{g.label}</span>
            {g.hint ? <span className="font-semibold normal-case tracking-normal text-white/40">{g.hint}</span> : null}
          </div>
          {g.items.map((n) => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
                    isActive ? 'bg-k-green text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
                  )
                }
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{n.label}</span>
                {n.badge && pending > 0 ? <span className="ml-auto rounded-full bg-[#d9822b] px-1.5 py-px text-[10px] font-bold text-white">{pending}</span> : null}
              </NavLink>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="px-1 pt-1">
      <div className="text-lg font-extrabold tracking-tight text-white">Kamai OS</div>
      <div className="text-[10px] font-bold uppercase tracking-[2px] text-k-green-mid">Company operating system</div>
    </div>
  )
}

/** True when the page is shown inside another page (the APT CRM embeds Kamai sections in a same-origin frame). */
function useEmbedded(): boolean {
  return useMemo(() => {
    try {
      return window.self !== window.top
    } catch {
      return true
    }
  }, [])
}

export function OsLayout() {
  const [open, setOpen] = useState(false)
  const { user, signOut } = useAuth()
  const embedded = useEmbedded()
  // Embedded in the CRM: the CRM provides the navigation, so show only the page content.
  if (embedded) {
    return (
      <div className="min-h-screen bg-k-bg text-k-text">
        <main className="min-w-0 p-4">
          <Outlet />
        </main>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen bg-k-bg text-k-text">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto bg-k-dark p-4 md:flex">
        <Brand />
        <NavGroups />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col gap-5 overflow-y-auto bg-k-dark p-4">
            <div className="flex items-start justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="text-white/70" aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            <NavGroups onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-k-border bg-k-surface/95 px-4 py-2.5 backdrop-blur md:px-6">
          <button onClick={() => setOpen(true)} className="text-k-dark md:hidden" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="text-sm font-bold text-k-dark md:hidden">Kamai OS</div>
          <div className="min-w-0 flex-1">
            <TenantSwitcher />
          </div>
          <span className="hidden max-w-[180px] truncate text-xs text-k-muted sm:inline">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-k-border bg-k-surface px-2.5 py-1.5 text-xs font-semibold text-k-dark"
            aria-label="Sign out"
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
