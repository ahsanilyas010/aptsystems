# Kamai OS frontend contracts

Stack: Vite 5, React 18, React Router 7 (`react-router`, `react-router/dom`), TanStack Query 5, Zod 4, Tailwind v4 (no preflight, scoped to `.kamai-root`), Supabase JS (`flowType: 'pkce'`, storage key `kamai-auth`).

The legacy CRM at `/` is untouched and lazily loaded. `src/kamai/styles/kamai.css` is imported ONLY by `KamaiRoot.tsx` (a lazy pathless layout route), so it never loads on `/`. Tailwind scans only `src/kamai`. Tokens: `bg-k-dark`, `text-k-muted`, `border-k-border`, `bg-k-green`, ... (see the `@theme` block).

## Route module contract

Each surface file `src/kamai/<surface>/routes.tsx` exports `export const <surface>Routes: RouteObject` (`os`, `distributor`, `store`, `lender`, `brand`, `delivery`, `auth`), `path: '<surface>'`.

Guarded surfaces use two levels so the guard (which renders `<Outlet/>`) wraps the layout:

```tsx
export const osRoutes: RouteObject = {
  path: 'os',
  element: <RequirePlatformAdmin />,            // guard
  children: [{ element: <OsLayout />,           // ./Layout.tsx
    children: [{ index: true, lazy: () => import('./pages/Command') },
               { path: 'agents', lazy: () => import('./pages/Agents') }] }],
}
```

`auth` has no guard: `element: <AuthLayout/>` directly. Page modules in `<surface>/pages/*.tsx` export `Component` (named export; route.lazy). Builders replace page files wholesale; add routes by editing the surface `routes.tsx` and the nav array in `Layout.tsx`. Routes registered in `src/router.tsx`; `*` renders `pages/NotFound`.

Guards per surface: os = RequirePlatformAdmin; distributor = RequireTenantRole(types distributor|vertical, roles owner|manager|booker|finance|viewer); store = RequireStore; lender = RequireTenantRole(lender); brand = RequireTenantRole(brand); delivery = RequireRider.

## Data/API
- `lib/supabase.ts`: `supabase` (SupabaseClient<any>).
- `lib/auth.tsx`: `useAuth()` -> `{ session, user, loading, ctx, activeTenantId, setActiveTenantId, signOut, refresh }`; context comes from RPC `kamai_my_context` (empty ctx on error).
- `lib/api.ts`: `callKamaiApi(action, payload)` -> POST `/api/kamai-admin` with Bearer token.
- `lib/db-types.ts`: generated DB types (written by the migration track).
- UI kit: import from `@kamai/ui` (or relative `../ui`).
