import type { RouteObject } from 'react-router'
import { RequireTenantRole } from '../lib/auth'
import { BrandLayout } from './Layout'

const TYPES = ['brand']
const ROLES = ['owner', 'manager', 'viewer']

export const brandRoutes: RouteObject = {
  path: 'brand',
  element: <RequireTenantRole types={TYPES} roles={ROLES} />,
  children: [
    {
      element: <BrandLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Dashboard') },
      { path: 'products', lazy: () => import('./pages/Products') },
      { path: 'listings', lazy: () => import('./pages/Listings') },
      ],
    },
  ],
}
