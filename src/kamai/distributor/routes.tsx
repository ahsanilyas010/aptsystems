import type { RouteObject } from 'react-router'
import { RequireTenantRole } from '../lib/auth'
import { DistributorLayout } from './Layout'

const TYPES = ['distributor', 'vertical']
const ROLES = ['owner', 'manager', 'booker', 'finance', 'viewer']

export const distributorRoutes: RouteObject = {
  path: 'distributor',
  element: <RequireTenantRole types={TYPES} roles={ROLES} />,
  children: [
    {
      element: <DistributorLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Dashboard') },
      { path: 'stores', lazy: () => import('./pages/Stores') },
      { path: 'catalog', lazy: () => import('./pages/Catalog') },
      { path: 'orders', lazy: () => import('./pages/Orders') },
      { path: 'orders/:id', lazy: () => import('./pages/OrderDetail') },
      { path: 'credit', lazy: () => import('./pages/Credit') },
      { path: 'invoices', lazy: () => import('./pages/Invoices') },
      { path: 'payments', lazy: () => import('./pages/Payments') },
      { path: 'ledger', lazy: () => import('./pages/Ledger') },
      { path: 'team', lazy: () => import('./pages/Team') },
      { path: 'settings', lazy: () => import('./pages/Settings') },
      ],
    },
  ],
}
