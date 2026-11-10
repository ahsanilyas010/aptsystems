import { createBrowserRouter, type RouteObject } from 'react-router'
import { authRoutes } from './kamai/auth/routes'
import { osRoutes } from './kamai/os/routes'
import { distributorRoutes } from './kamai/distributor/routes'
import { storeRoutes } from './kamai/store/routes'
import { lenderRoutes } from './kamai/lender/routes'
import { brandRoutes } from './kamai/brand/routes'
import { deliveryRoutes } from './kamai/delivery/routes'
import NotFound from './kamai/pages/NotFound'

function LegacyFallback() {
  return <div style={{ minHeight: '100vh', background: '#F4FAF4' }} aria-busy="true" />
}

const routes: RouteObject[] = [
  {
    // Legacy CRM: lazily loaded so Firebase never initialises on Kamai routes.
    path: '/',
    lazy: () => import('./App.jsx').then((m) => ({ Component: m.default })),
    HydrateFallback: LegacyFallback,
  },
  {
    // Pathless layout: Kamai providers (query client, auth, toasts) + kamai.css mount once.
    lazy: () => import('./kamai/KamaiRoot'),
    children: [authRoutes, osRoutes, distributorRoutes, storeRoutes, lenderRoutes, brandRoutes, deliveryRoutes, { path: '*', Component: NotFound }],
  },
]

export const router = createBrowserRouter(routes)
