import type { RouteObject } from 'react-router'
import { RequireTenantRole } from '../lib/auth'
import { LenderLayout } from './Layout'

const TYPES = ['lender']
const ROLES = ['owner', 'manager', 'finance', 'viewer']

export const lenderRoutes: RouteObject = {
  path: 'lender',
  element: <RequireTenantRole types={TYPES} roles={ROLES} />,
  children: [
    {
      element: <LenderLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Portfolio') },
      { path: 'facilities', lazy: () => import('./pages/Facilities') },
      { path: 'exposures', lazy: () => import('./pages/Exposures') },
      { path: 'export', lazy: () => import('./pages/Export') },
      ],
    },
  ],
}
