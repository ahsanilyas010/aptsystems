import { useCallback, useEffect, useState } from 'react'

const ORDERED_KEY = 'kamai-store-ordered'
const DISMISS_KEY = 'kamai-store-install-dismissed'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
const subs = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    subs.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    subs.forEach((fn) => fn())
  })
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

/** Remember that this device placed an order (the install banner appears after the first one). */
export function markOrdered(): void {
  safeSet(ORDERED_KEY, '1')
}

export function registerStoreServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  void navigator.serviceWorker.register('/store/sw.js', { scope: '/store/' }).catch(() => undefined)
}

/** Adds <link rel=manifest> (+ theme-color) while the store surface is mounted. Returns a cleanup. */
export function injectManifest(): () => void {
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/store/manifest.webmanifest'
  const icon = document.createElement('link')
  icon.rel = 'apple-touch-icon'
  icon.href = '/store/icons/icon-192.png'
  const theme = document.createElement('meta')
  theme.name = 'theme-color'
  theme.content = '#1f8a4c'
  document.head.append(link, icon, theme)
  return () => {
    link.remove()
    icon.remove()
    theme.remove()
  }
}

export function useInstall(hasOrders: boolean): { show: boolean; ios: boolean; canPrompt: boolean; install: () => Promise<void>; dismiss: () => void } {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  }, [])
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)
  const ordered = hasOrders || safeGet(ORDERED_KEY) === '1'
  const dismissed = safeGet(DISMISS_KEY) === '1'
  const canPrompt = deferred !== null
  const show = ordered && !standalone && !dismissed && (canPrompt || ios)
  const install = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice.catch(() => undefined)
    deferred = null
    subs.forEach((fn) => fn())
  }, [])
  const dismiss = useCallback(() => {
    safeSet(DISMISS_KEY, '1')
    subs.forEach((fn) => fn())
  }, [])
  return { show, ios, canPrompt, install, dismiss }
}
