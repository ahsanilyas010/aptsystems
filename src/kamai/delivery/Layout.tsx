import { useEffect } from 'react'
import { Link } from 'react-router'
import { Banknote, CloudOff, LogOut, Truck } from 'lucide-react'
import { MobileShell, type NavItem } from '../ui'
import { injectManifest, registerDeliveryServiceWorker } from './lib/pwa'
import { useDeliveryQueue } from './lib/replay'

const NAV: NavItem[] = [
  { to: '/delivery', label: 'Runs', icon: Truck, end: true },
  { to: '/delivery/cash', label: 'Cash', icon: Banknote },
]

export function DeliveryLayout() {
  const { pending, failed, syncing, sync } = useDeliveryQueue()

  useEffect(() => {
    registerDeliveryServiceWorker()
    return injectManifest()
  }, [])

  const right = (
    <>
      {pending + failed > 0 ? (
        <button
          type="button"
          onClick={() => void sync()}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-k-accent px-3 text-[11px] font-bold text-k-dark"
          aria-label="Pending deliveries, tap to sync"
        >
          <CloudOff size={14} />
          {syncing ? 'Sync…' : `${pending} pending${failed ? ` · ${failed} failed` : ''}`}
        </button>
      ) : null}
      <Link to="/auth/logout" aria-label="Logout" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white">
        <LogOut size={16} />
      </Link>
    </>
  )
  return <MobileShell title="Kamai Delivery" nav={NAV} headerRight={right} />
}
