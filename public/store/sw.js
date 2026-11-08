/* Kamai Store service worker. Vanilla, no CDN. Scope: /store/ only.
 * - cache-first: same-origin /store/ static files and /assets/*
 * - network-first: navigations under /store/, falling back to the cached /store/ shell
 * - never touches /api, other origins (supabase) or non-GET requests */
const VERSION = 'kamai-store-v1'
const SHELL = '/store/'
const PRECACHE = [SHELL, '/store/manifest.webmanifest', '/store/icons/icon-192.png', '/store/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kamai-store-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function inStoreScope(p) {
  return p === '/store' || p.startsWith('/store/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (p.startsWith('/api/') || p === '/api') return
  if (p === '/store/sw.js') return

  if (req.mode === 'navigate') {
    if (!inStoreScope(p)) return
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(SHELL, copy)).catch(() => undefined)
          }
          return res
        })
        .catch(() => caches.match(SHELL).then((r) => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))),
    )
    return
  }

  if (inStoreScope(p) || p.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined)
            }
            return res
          }),
      ),
    )
  }
})
