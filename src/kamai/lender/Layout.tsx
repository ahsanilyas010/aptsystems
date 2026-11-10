import { BarChart3, Download, Landmark, PieChart } from 'lucide-react'
import { Shell, TenantSwitcher, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/lender', label: 'Portfolio', icon: PieChart, end: true },
  { to: '/lender/facilities', label: 'Facilities', icon: Landmark },
  { to: '/lender/exposures', label: 'Exposures', icon: BarChart3 },
  { to: '/lender/export', label: 'Export', icon: Download },
]

export function LenderLayout() {
  return <Shell title="Lender" subtitle="Kamai" nav={NAV} tenantSlot={<TenantSwitcher />} />
}
