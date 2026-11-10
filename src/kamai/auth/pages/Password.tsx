import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { Button, Card, Input, Spinner } from '../../ui'
import { defaultSurfaceFor, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { friendlyAuthError } from '../lib/helpers'

export function Component() {
  const { session, loading, ctx } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  if (loading) return <Card padding="lg"><Spinner label="Loading…" /></Card>
  if (!session) return <Navigate to="/auth/login?next=%2Fauth%2Fpassword" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    if (pw.length < 8) return setError('Password kam az kam 8 characters ka ho. / Password must be at least 8 characters.')
    if (pw !== pw2) return setError('Dono password mel nahi khate. / Passwords do not match.')
    setBusy(true)
    const { error: ue } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (ue) return setError(friendlyAuthError(ue.message))
    setOk(true)
    setPw('')
    setPw2('')
  }

  return (
    <Card padding="lg">
      <h1 className="mb-1 text-xl font-bold text-k-dark">Password badlein</h1>
      <p className="mb-5 text-sm text-k-muted">Signed in as {session.user.email ?? session.user.phone ?? 'user'}. / Change your password.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="New password" type="password" autoComplete="new-password" size="lg" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
        <Input label="Confirm password" type="password" autoComplete="new-password" size="lg" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required />
        {error ? <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">{error}</div> : null}
        {ok ? <div className="rounded-lg bg-k-green-light px-3 py-2 text-sm font-semibold text-k-green">Password badal diya gaya. / Password updated.</div> : null}
        <Button type="submit" size="lg" block loading={busy}>Save</Button>
        <Link to={defaultSurfaceFor(ctx)} className="text-center text-sm font-semibold text-k-green">Wapas / Back</Link>
      </form>
    </Card>
  )
}
