export function registerDeliveryServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  void navigator.serviceWorker.register('/delivery/sw.js', { scope: '/delivery/' }).catch(() => undefined)
}

/** Adds <link rel=manifest> and theme-color while the delivery surface is mounted. */
export function injectManifest(): () => void {
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/delivery/manifest.webmanifest'
  const icon = document.createElement('link')
  icon.rel = 'apple-touch-icon'
  icon.href = '/delivery/icons/icon-192.png'
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
