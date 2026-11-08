import { Outlet } from 'react-router'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="text-2xl font-extrabold tracking-tight text-k-dark">Kamai</div>
          <div className="text-[11px] font-bold uppercase tracking-[2px] text-k-muted">Distribution OS</div>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
