import { Banknote, Truck } from 'lucide-react'
import { MobileShell, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/delivery', label: 'Runs', icon: Truck, end: true },
  { to: '/delivery/cash', label: 'Cash', icon: Banknote },
]

export function DeliveryLayout() {
  return <MobileShell title="Kamai Delivery" nav={NAV} />
}
