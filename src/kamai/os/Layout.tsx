import { AlertTriangle, Award, Bot, Building2, ClipboardList, Cpu, CreditCard, Layers, LayoutDashboard, Map, Megaphone, Server, Settings, ShieldCheck, ShoppingCart, Store, Truck, Users, Wallet } from 'lucide-react'
import { Shell, TenantSwitcher, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/os', label: 'Command', icon: LayoutDashboard, end: true },
  { to: '/os/agents', label: 'Agents', icon: Bot },
  { to: '/os/model', label: 'Model', icon: Layers },
  { to: '/os/platform', label: 'Platform', icon: Server },
  { to: '/os/finance', label: 'Finance', icon: Wallet },
  { to: '/os/procurement', label: 'Procurement', icon: ShoppingCart },
  { to: '/os/vendors', label: 'Vendors', icon: Truck },
  { to: '/os/stores', label: 'Stores', icon: Store },
  { to: '/os/heroes', label: 'Heroes', icon: Award },
  { to: '/os/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/os/tech', label: 'Tech', icon: Cpu },
  { to: '/os/hr', label: 'HR', icon: Users },
  { to: '/os/roadmap', label: 'Roadmap', icon: Map },
  { to: '/os/gaps', label: 'Gaps', icon: AlertTriangle },
  { to: '/os/tenants', label: 'Tenants', icon: Building2 },
  { to: '/os/orders', label: 'Orders', icon: ClipboardList },
  { to: '/os/credit', label: 'Credit', icon: CreditCard },
  { to: '/os/audit', label: 'Audit', icon: ShieldCheck },
  { to: '/os/settings', label: 'Settings', icon: Settings },
]

export function OsLayout() {
  return <Shell title="Kamai OS" subtitle="Platform" nav={NAV} tenantSlot={<TenantSwitcher />} />
}
