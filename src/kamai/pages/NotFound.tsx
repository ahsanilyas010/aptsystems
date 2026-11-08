import { Link } from 'react-router'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-k-border bg-k-surface p-8 text-center">
        <div className="mb-2 text-xs font-bold uppercase tracking-[2px] text-k-muted">404</div>
        <h1 className="mb-2 text-xl font-bold text-k-dark">Page not found</h1>
        <p className="mb-6 text-sm text-k-muted">That address does not exist in Kamai.</p>
        <div className="flex justify-center gap-2">
          <Link to="/" className="rounded-lg border border-k-border px-4 py-2 text-sm font-semibold text-k-dark">CRM</Link>
          <Link to="/os" className="rounded-lg bg-k-green px-4 py-2 text-sm font-semibold text-white">Kamai OS</Link>
        </div>
      </div>
    </div>
  )
}
