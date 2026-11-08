/* Kamai Delivery service worker. Vanilla, no CDN. Scope: /delivery/ only.
 * - cache-first: same-origin /delivery/ static files and /assets/*
 * - network-first: navigations under /delivery/, falling back to the cached /delivery/ shell
 * - never touches /api, other origins (supabase) or non-GET requests */
const VERSION = 'kamai-delivery-v1'
const SHELL = '/delivery/'
const PRECACHE = [SHELL, '/delivery/manifest.webmanifest', '/delivery/icons/icon-192.png', '/delivery/icons/icon-512.png']

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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kamai-delivery-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function inScope(p) {
  return p === '/delivery' || p.startsWith('/delivery/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (p.startsWith('/api/') || p === '/api') return
  if (p === '/delivery/sw.js') return

  if (req.mode === 'navigate') {
    if (!inScope(p)) return
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

  if (inScope(p) || p.startsWith('/assets/')) {
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
