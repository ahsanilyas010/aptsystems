import type { RouteObject } from 'react-router'
import { RequirePlatformAdmin } from '../lib/auth'
import { OsLayout } from './Layout'

export const osRoutes: RouteObject = {
  path: 'os',
  element: <RequirePlatformAdmin />,
  children: [
    {
      element: <OsLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Command') },
      { path: 'agents', lazy: () => import('./pages/Agents') },
      { path: 'model', lazy: () => import('./pages/Model') },
      { path: 'platform', lazy: () => import('./pages/Platform') },
      { path: 'finance', lazy: () => import('./pages/Finance') },
      { path: 'procurement', lazy: () => import('./pages/Procurement') },
      { path: 'vendors', lazy: () => import('./pages/Vendors') },
      { path: 'stores', lazy: () => import('./pages/Stores') },
      { path: 'heroes', lazy: () => import('./pages/Heroes') },
      { path: 'marketing', lazy: () => import('./pages/Marketing') },
      { path: 'tech', lazy: () => import('./pages/Tech') },
      { path: 'hr', lazy: () => import('./pages/Hr') },
      { path: 'roadmap', lazy: () => import('./pages/Roadmap') },
      { path: 'gaps', lazy: () => import('./pages/Gaps') },
      { path: 'tenants', lazy: () => import('./pages/Tenants') },
      { path: 'reviews', lazy: () => import('./pages/Reviews') },
      { path: 'orders', lazy: () => import('./pages/Orders') },
      { path: 'credit', lazy: () => import('./pages/Credit') },
      { path: 'audit', lazy: () => import('./pages/Audit') },
      { path: 'settings', lazy: () => import('./pages/Settings') },
      ],
    },
  ],
}
