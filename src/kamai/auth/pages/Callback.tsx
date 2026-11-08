import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Card, Spinner } from '../../ui'
import { defaultSurfaceFor } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { loadKamaiContext } from '../../lib/auth'
import { friendlyAuthError, safeNext } from '../lib/helpers'

export function Component() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void (async () => {
      const code = params.get('code')
      const urlErr = params.get('error_description') || params.get('error')
      if (urlErr) {
        setError(friendlyAuthError(urlErr))
        return
      }
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code)
        // detectSessionInUrl may already have consumed the code; accept an existing session.
        if (e) {
          const { data } = await supabase.auth.getSession()
          if (!data.session) {
            setError(friendlyAuthError(e.message))
            return
          }
        }
      }
      let { data } = await supabase.auth.getSession()
      if (!data.session) {
        // hash-based sessions are processed asynchronously
        await new Promise((r) => setTimeout(r, 600))
        data = (await supabase.auth.getSession()).data
      }
      if (!data.session) {
        setError('Session nahi mila. Dobara login karein. / No session found, please sign in again.')
        return
      }
      const next = safeNext(params.get('next'))
      const ctx = await loadKamaiContext()
      navigate(next ?? defaultSurfaceFor(ctx), { replace: true })
    })()
  }, [params, navigate])

  return (
    <Card padding="lg" className="text-center">
      {error ? (
        <>
          <h1 className="mb-2 text-lg font-bold text-k-dark">Login nahi ho saka</h1>
          <p className="mb-4 text-sm text-k-red" role="alert">
            {error}
          </p>
          <Link to="/auth/login" className="text-sm font-semibold text-k-green">
            Login par wapas / Back to login
          </Link>
        </>
      ) : (
        <Spinner label="Sign in ho raha hai… / Signing you in…" />
      )}
    </Card>
  )
}
