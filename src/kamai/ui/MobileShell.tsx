import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cx } from './cx'
import type { NavItem } from './Shell'

export interface MobileShellProps {
  title: string
  /** right side of the sticky header (cart badge, user menu) */
  headerRight?: ReactNode
  /** bottom navigation (3-5 items) */
  nav: NavItem[]
  children?: ReactNode
}

/** Mobile-first shell: sticky dark header, bottom nav, safe-area padding. */
export function MobileShell({ title, headerRight, nav, children }: MobileShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-k-bg text-k-text">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-k-dark px-4 pb-3 text-white"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <div className="text-base font-extrabold tracking-tight">{title}</div>
        <div className="flex items-center gap-2">{headerRight}</div>
      </header>
      <main className="flex-1 p-4" style={{ paddingBottom: 'calc(76px + env(safe-area-inset-bottom))' }}>
        {children ?? <Outlet />}
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl border-t border-k-border bg-k-surface"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {nav.map((n) => {
          const Icon = n.icon
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-k-green' : 'text-k-light')
              }
            >
              {Icon ? <Icon size={20} /> : null}
              <span>{n.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
