import { Banknote, BookOpen, ClipboardList, CreditCard, FileText, LayoutDashboard, Package, Settings, Store, Users } from 'lucide-react'
import { Shell, TenantSwitcher, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/distributor', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/distributor/stores', label: 'Stores', icon: Store },
  { to: '/distributor/catalog', label: 'Catalog', icon: Package },
  { to: '/distributor/orders', label: 'Orders', icon: ClipboardList },
  { to: '/distributor/credit', label: 'Credit', icon: CreditCard },
  { to: '/distributor/invoices', label: 'Invoices', icon: FileText },
  { to: '/distributor/payments', label: 'Payments', icon: Banknote },
  { to: '/distributor/ledger', label: 'Ledger', icon: BookOpen },
  { to: '/distributor/team', label: 'Team', icon: Users },
  { to: '/distributor/settings', label: 'Settings', icon: Settings },
]

export function DistributorLayout() {
  return <Shell title="Distributor" subtitle="Kamai" nav={NAV} tenantSlot={<TenantSwitcher />} />
}
