import { LayoutDashboard, Package, Tags } from 'lucide-react'
import { Shell, TenantSwitcher, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/brand', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/brand/products', label: 'Products', icon: Package },
  { to: '/brand/listings', label: 'Listings', icon: Tags },
]

export function BrandLayout() {
  return <Shell title="Brand" subtitle="Kamai" nav={NAV} tenantSlot={<TenantSwitcher />} />
}
