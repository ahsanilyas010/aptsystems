import type { RouteObject } from 'react-router'
import { RequireRider } from '../lib/auth'
import { DeliveryLayout } from './Layout'

export const deliveryRoutes: RouteObject = {
  path: 'delivery',
  element: <RequireRider />,
  children: [
    {
      element: <DeliveryLayout />,
      children: [
      { index: true, lazy: () => import('./pages/Runs') },
      { path: 'orders/:id', lazy: () => import('./pages/OrderDetail') },
      { path: 'cash', lazy: () => import('./pages/Cash') },
      ],
    },
  ],
}
