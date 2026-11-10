import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button, Card, Input, Spinner } from '../../ui'
import { defaultSurfaceFor, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { friendlyAuthError } from '../lib/helpers'

export function Component() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void (async () => {
      const tokenHash = params.get('token_hash')
      if (tokenHash) {
        const { error: e } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })
        if (e) {
          setError(friendlyAuthError(e.message))
          return
        }
      } else if (params.get('code')) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(params.get('code') as string)
        if (e && !(await supabase.auth.getSession()).data.session) {
          setError(friendlyAuthError(e.message))
          return
        }
      }
      let { data } = await supabase.auth.getSession()
      if (!data.session) {
        await new Promise((r) => setTimeout(r, 600))
        data = (await supabase.auth.getSession()).data
      }
      if (!data.session) {
        setError(`Invite link (${token ? token.slice(0, 6) + '…' : ''}) expire ho gaya ya ghalat hai. / The invite link is invalid or expired.`)
        return
      }
      setReady(true)
    })()
  }, [params, token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 8) return setError('Password kam az kam 8 characters ka ho. / Password must be at least 8 characters.')
    if (pw !== pw2) return setError('Dono password mel nahi khate. / Passwords do not match.')
    setBusy(true)
    const { error: ue } = await supabase.auth.updateUser({ password: pw })
    if (ue) {
      setBusy(false)
      return setError(friendlyAuthError(ue.message))
    }
    const ctx = await refresh()
    setBusy(false)
    navigate(defaultSurfaceFor(ctx), { replace: true })
  }

  if (error && !ready) {
    return (
      <Card padding="lg" className="text-center">
        <h1 className="mb-2 text-lg font-bold text-k-dark">Invite qabool nahi hui</h1>
        <p className="mb-4 text-sm text-k-red" role="alert">
          {error}
        </p>
        <Link to="/auth/login" className="text-sm font-semibold text-k-green">
          Login / Sign in
        </Link>
      </Card>
    )
  }
  if (!ready) {
    return (
      <Card padding="lg">
        <Spinner label="Invite check ho rahi hai… / Checking your invite…" />
      </Card>
    )
  }
  return (
    <Card padding="lg">
      <h1 className="mb-1 text-xl font-bold text-k-dark">Password set karein</h1>
      <p className="mb-5 text-sm text-k-muted">Account shuru karne ke liye naya password banayein (kam az kam 8 characters). / Set a password to finish setting up your account.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="New password" type="password" autoComplete="new-password" size="lg" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
        <Input label="Confirm password" type="password" autoComplete="new-password" size="lg" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required />
        {error ? (
          <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">
            {error}
          </div>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          Save aur shuru karein
        </Button>
      </form>
    </Card>
  )
}
