import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

export function HydrateFallback() {
  return (
    <div className="kamai-root flex items-center justify-center">
      <div
        className="h-8 w-8 rounded-full border-[3px] border-k-border border-t-k-green"
        style={{ animation: 'kamai-spin 0.8s linear infinite' }}
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}

export default function ErrorPage() {
  const err = useRouteError()
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : 'Something went wrong.'
  return (
    <div className="kamai-root flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-k-border bg-k-surface p-8 text-center">
        <div className="mb-2 text-xs font-bold uppercase tracking-[2px] text-k-muted">Kamai</div>
        <h1 className="mb-2 text-xl font-bold text-k-dark">Something went wrong</h1>
        <p className="mb-6 break-words text-sm text-k-muted">{message}</p>
        <Link to="/os" className="rounded-lg bg-k-green px-4 py-2 text-sm font-semibold text-white">Back to Kamai OS</Link>
      </div>
    </div>
  )
}
