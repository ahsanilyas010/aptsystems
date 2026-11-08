import { ClipboardList, Home, Package, ShoppingCart, User } from 'lucide-react'
import { MobileShell, type NavItem } from '../ui'

const NAV: NavItem[] = [
  { to: '/store', label: 'Home', icon: Home, end: true },
  { to: '/store/catalog', label: 'Catalog', icon: Package },
  { to: '/store/cart', label: 'Cart', icon: ShoppingCart },
  { to: '/store/orders', label: 'Orders', icon: ClipboardList },
  { to: '/store/account', label: 'Account', icon: User },
]

export function StoreLayout() {
  return <MobileShell title="Kamai Store" nav={NAV} />
}
