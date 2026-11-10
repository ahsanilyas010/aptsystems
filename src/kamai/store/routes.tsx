import type { RouteObject } from 'react-router'
import { RequireStore } from '../lib/auth'
import { StoreLayout } from './Layout'

export const storeRoutes: RouteObject = {
  path: 'store',
  element: <RequireStore />,
  children: [
    {
      element: <StoreLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Home') },
      { path: 'catalog', lazy: () => import('./pages/Catalog') },
      { path: 'cart', lazy: () => import('./pages/Cart') },
      { path: 'orders', lazy: () => import('./pages/Orders') },
      { path: 'orders/:id', lazy: () => import('./pages/OrderDetail') },
      { path: 'pay', lazy: () => import('./pages/Pay') },
      { path: 'account', lazy: () => import('./pages/Account') },
      ],
    },
  ],
}
