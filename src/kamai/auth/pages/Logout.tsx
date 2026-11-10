import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Card, Spinner } from '../../ui'
import { useAuth } from '../../lib/auth'

export function Component() {
  const { signOut } = useAuth()
  const [done, setDone] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void signOut()
      .catch(() => undefined)
      .finally(() => setDone(true))
  }, [signOut])

  return (
    <Card padding="lg" className="text-center">
      {done ? (
        <>
          <h1 className="mb-2 text-lg font-bold text-k-dark">Logout ho gaye</h1>
          <p className="mb-4 text-sm text-k-muted">You have been signed out.</p>
          <Link to="/auth/login" className="text-sm font-semibold text-k-green">
            Dobara login / Sign in again
          </Link>
        </>
      ) : (
        <Spinner label="Logout ho raha hai…" />
      )}
    </Card>
  )
}
