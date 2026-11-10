import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button, Card, Input, cx } from '../../ui'
import { defaultSurfaceFor, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { friendlyAuthError, safeNext, syntheticEmails } from '../lib/helpers'

type Mode = 'email' | 'mobile'

export function Component() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session, loading, ctx, refresh } = useAuth()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<Mode>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mobile, setMobile] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    params.get('error') === 'no_access' ? 'Is account ko koi access nahi mila. / This account has no access yet. Contact your distributor.' : null,
  )
  const [info, setInfo] = useState<string | null>(null)

  // Already signed in with a usable context: go straight on.
  useEffect(() => {
    if (loading || !session || params.get('error')) return
    const target = next ?? defaultSurfaceFor(ctx)
    if (!target.startsWith('/auth/login')) navigate(target, { replace: true })
  }, [loading, session, ctx, next, params, navigate])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      let err: string | undefined
      if (mode === 'email') {
        const r = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        err = r.error?.message
      } else {
        const candidates = syntheticEmails(mobile)
        if (!candidates) {
          setError('Mobile number sahi nahi. 03XX-XXXXXXX likhein. / Enter a valid mobile number.')
          return
        }
        if (!/^\d{4,8}$/.test(pin)) {
          setError('PIN 4 se 8 ginti ka hona chahiye. / PIN must be 4 to 8 digits.')
          return
        }
        for (const c of candidates) {
          const r = await supabase.auth.signInWithPassword({ email: c, password: pin })
          err = r.error?.message
          if (!r.error) break
          if (!/invalid login|invalid credentials/i.test(r.error.message)) break
        }
      }
      if (err) {
        setError(friendlyAuthError(err, mode))
        return
      }
      const c = await refresh()
      navigate(next ?? defaultSurfaceFor(c), { replace: true })
    } catch (ex) {
      setError(friendlyAuthError(ex instanceof Error ? ex.message : undefined, mode))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    setError(null)
    setInfo(null)
    if (!email.trim()) {
      setError('Pehle apni email likhein. / Enter your email first.')
      return
    }
    setBusy(true)
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/password')}`,
    })
    setBusy(false)
    if (e) setError(friendlyAuthError(e.message))
    else setInfo('Reset link bhej diya gaya. Email check karein. / Reset link sent, check your email.')
  }

  return (
    <Card padding="lg">
      <h1 className="mb-1 text-xl font-bold text-k-dark">Login</h1>
      <p className="mb-5 text-sm text-k-muted">Apne account mein dakhil hon. / Sign in to continue.</p>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-k-surface2 p-1" role="tablist">
        {(['email', 'mobile'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={cx('h-10 rounded-lg text-sm font-semibold', mode === m ? 'bg-k-surface text-k-dark shadow-sm' : 'text-k-muted')}
          >
            {m === 'email' ? 'Email + Password' : 'Mobile + PIN'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {mode === 'email' ? (
          <>
            <Input label="Email" type="email" autoComplete="username" size="lg" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Password" type="password" autoComplete="current-password" size="lg" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </>
        ) : (
          <>
            <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="03XX XXXXXXX" size="lg" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
            <Input label="PIN" type="password" inputMode="numeric" autoComplete="current-password" size="lg" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={8} required />
          </>
        )}
        {error ? (
          <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">
            {error}
          </div>
        ) : null}
        {info ? <div className="rounded-lg bg-k-green-light px-3 py-2 text-sm font-semibold text-k-green">{info}</div> : null}
        <Button type="submit" size="lg" block loading={busy}>
          Login
        </Button>
        {mode === 'email' ? (
          <button type="button" onClick={() => void forgot()} disabled={busy} className="text-center text-sm font-semibold text-k-green">
            Password bhool gaye? / Forgot password?
          </button>
        ) : (
          <p className="text-center text-xs text-k-muted">PIN bhool gaye? Apne distributor se reset karwayein. / Forgot your PIN? Ask your distributor to reset it.</p>
        )}
      </form>
      <div className="mt-4 text-center text-sm">
        <Link to="/auth/signup" className="font-semibold text-k-green">
          Distributor? Apply here
        </Link>
      </div>
      <div className="mt-3 text-center text-xs text-k-light">
        <Link to="/auth/logout" className="underline">
          Logout
        </Link>
      </div>
    </Card>
  )
}
