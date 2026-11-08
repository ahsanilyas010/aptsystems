import type { RouteObject } from 'react-router'
import { AuthLayout } from './Layout'

export const authRoutes: RouteObject = {
  path: 'auth',
  element: <AuthLayout />,
  children: [
    { path: 'login', lazy: () => import('./pages/Login') },
    { path: 'callback', lazy: () => import('./pages/Callback') },
    { path: 'accept/:token', lazy: () => import('./pages/AcceptToken') },
    { path: 'logout', lazy: () => import('./pages/Logout') },
  ],
}
