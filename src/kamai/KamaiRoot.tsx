import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles/kamai.css'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './ui/Toast'

const FONT_LINK_ID = 'kamai-inter-font'

/** Pathless layout route element: mounts providers once for every Kamai surface. */
export default function KamaiRoot() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }),
  )

  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return
    const link = document.createElement('link')
    link.id = FONT_LINK_ID
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(link)
  }, [])

  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ToastProvider>
          <div className="kamai-root">
            <Outlet />
          </div>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
export { KamaiRoot as Component }
export { default as ErrorBoundary, HydrateFallback } from './pages/ErrorPage'
