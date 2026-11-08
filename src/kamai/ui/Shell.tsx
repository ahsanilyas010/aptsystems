import { useState, type ComponentType, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { cx } from './cx'

export interface NavItem {
  /** absolute path, e.g. '/os/agents' */
  to: string
  label: string
  icon?: ComponentType<{ size?: number | string; className?: string }>
  /** exact match (use for index routes) */
  end?: boolean
}

export interface ShellProps {
  /** product / surface name shown in the sidebar header, e.g. "Kamai OS" */
  title: string
  /** small uppercase subtitle under the title */
  subtitle?: string
  nav: NavItem[]
  /** slot in the top bar (tenant switcher) */
  tenantSlot?: ReactNode
  /** explicit content; defaults to <Outlet/> */
  children?: ReactNode
}

function NavList({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((n) => {
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
            {Icon ? <Icon size={16} className="shrink-0" /> : null}
            <span className="truncate">{n.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

function UserMenu() {
  const { user, signOut } = useAuth()
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[180px] truncate text-xs text-k-muted sm:inline">{user?.email}</span>
      <button
        onClick={() => void signOut()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-k-border bg-k-surface px-2.5 py-1.5 text-xs font-semibold text-k-dark"
        aria-label="Sign out"
      >
        <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  )
}

/**
 * Desktop shell: dark-green left sidebar, top bar with tenant switcher slot and
 * user menu, content area. On mobile the sidebar collapses behind a menu button.
 */
export function Shell({ title, subtitle, nav, tenantSlot, children }: ShellProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-screen bg-k-bg text-k-text">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto bg-k-dark p-4 md:flex">
        <div className="px-1 pt-1">
          <div className="text-lg font-extrabold tracking-tight text-white">{title}</div>
          {subtitle ? <div className="text-[10px] font-bold uppercase tracking-[2px] text-k-green-mid">{subtitle}</div> : null}
        </div>
        <NavList nav={nav} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col gap-5 overflow-y-auto bg-k-dark p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-extrabold text-white">{title}</div>
                {subtitle ? <div className="text-[10px] font-bold uppercase tracking-[2px] text-k-green-mid">{subtitle}</div> : null}
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70" aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            <NavList nav={nav} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-k-border bg-k-surface/95 px-4 py-2.5 backdrop-blur md:px-6">
          <button onClick={() => setOpen(true)} className="text-k-dark md:hidden" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="text-sm font-bold text-k-dark md:hidden">{title}</div>
          <div className="min-w-0 flex-1">{tenantSlot}</div>
          <UserMenu />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}
