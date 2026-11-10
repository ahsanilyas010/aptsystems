import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Home, Package, ShoppingCart, User } from 'lucide-react'
import { MobileShell, type NavItem } from '../ui'
import { useLang } from '../lib/i18n'
import { ensureStoreDefaultLang } from './lib/strings'
import { useQueueFlusher } from './lib/offline-queue'
import { injectManifest, registerStoreServiceWorker } from './lib/pwa'
import { useCart } from './lib/cart'
import { useStoreCtx } from './lib/data'
import { PendingPill } from './lib/parts'

export function StoreLayout() {
  // Roman Urdu by default; runs before children render so the first paint is already translated.
  useState(() => {
    ensureStoreDefaultLang()
    return null
  })
  const { t, dir } = useLang()
  const qc = useQueryClient()
  const ctx = useStoreCtx()
  const cart = useCart(ctx?.tenantId ?? null)

  useEffect(() => {
    const cleanup = injectManifest()
    registerStoreServiceWorker()
    return cleanup
  }, [])

  const onSent = useCallback(() => void qc.invalidateQueries({ queryKey: ['kamai-store'] }), [qc])
  useQueueFlusher(onSent)

  const nav = useMemo<NavItem[]>(
    () => [
      { to: '/store', label: t('home'), icon: Home, end: true },
      { to: '/store/catalog', label: t('catalog'), icon: Package },
      { to: '/store/cart', label: t('cart'), icon: ShoppingCart },
      { to: '/store/orders', label: t('orders'), icon: ClipboardList },
      { to: '/store/account', label: t('account'), icon: User },
    ],
    [t],
  )

  return (
    <div dir={dir}>
      <MobileShell
        title={t('st_title')}
        nav={nav}
        headerRight={
          <>
            <PendingPill />
            <Link to="/store/cart" aria-label={t('cart')} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
              <ShoppingCart size={20} />
              {cart.kinds > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-k-accent px-1 text-[11px] font-extrabold text-k-dark">
                  {cart.kinds}
                </span>
              ) : null}
            </Link>
          </>
        }
      />
    </div>
  )
}
