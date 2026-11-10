import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Card, Input } from '../../ui'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const GENERIC = 'Could not create the account. If you already have one, log in. / Account nahi ban saka. Agar pehle se hai to login karein.'

function validate(f: { company: string; name: string; email: string; mobile: string; city: string; password: string }): string | null {
  if (f.company.trim().length < 2) return 'Company ka naam likhein. / Enter your company name.'
  if (f.name.trim().length < 2) return 'Apna naam likhein. / Enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return 'Email sahi nahi. / Enter a valid email.'
  if (!/^(\+?92|0)?3\d{9}$/.test(f.mobile.replace(/[\s-]/g, ''))) return 'Mobile number sahi nahi. 03XX-XXXXXXX likhein. / Enter a valid mobile number.'
  if (f.city.trim().length < 2) return 'Shehar likhein. / Enter your city.'
  if (f.password.length < 8) return 'Password kam az kam 8 haroof ka ho. / Password must be at least 8 characters.'
  return null
}

export function Component() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [f, setF] = useState({ company: '', name: '', email: '', mobile: '', city: '', password: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const v = validate(f)
    if (v) return setError(v)
    setBusy(true)
    try {
      const res = await fetch('/api/kamai-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: f.company.trim(),
          contact_name: f.name.trim(),
          email: f.email.trim().toLowerCase(),
          mobile: f.mobile.trim(),
          city: f.city.trim(),
          password: f.password,
          website: f.website,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || body.ok === false) {
        setError(res.status === 429 ? 'Bohat zyada koshishein. Thori der baad try karein. / Too many attempts, try again later.' : body.error || GENERIC)
        return
      }
      const r = await supabase.auth.signInWithPassword({ email: f.email.trim().toLowerCase(), password: f.password })
      if (r.error) {
        navigate('/auth/login', { replace: true })
        return
      }
      await refresh()
      navigate('/distributor/catalog', { replace: true })
    } catch {
      setError('Internet masla hai. Connection check karein. / Network problem, check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card padding="lg">
      <h1 className="mb-1 text-xl font-bold text-k-dark">Distributor sign up</h1>
      <p className="mb-5 text-sm text-k-muted">Apne products upload karein, hum review kar ke stores tak pohanchayenge. / Upload your products and we will review and list them for stores.</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input label="Company name" autoComplete="organization" size="lg" value={f.company} onChange={set('company')} maxLength={80} required />
        <Input label="Your name" autoComplete="name" size="lg" value={f.name} onChange={set('name')} maxLength={80} required />
        <Input label="Email" type="email" autoComplete="email" size="lg" value={f.email} onChange={set('email')} maxLength={120} required />
        <Input label="Mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="03XX XXXXXXX" size="lg" value={f.mobile} onChange={set('mobile')} maxLength={20} required />
        <Input label="City" autoComplete="address-level2" size="lg" value={f.city} onChange={set('city')} maxLength={60} required />
        <Input label="Password" type="password" autoComplete="new-password" size="lg" value={f.password} onChange={set('password')} hint="At least 8 characters" required />
        {/* honeypot: real users never see or fill this */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
          </label>
        </div>
        {error ? (
          <div role="alert" className="rounded-lg bg-k-red-light px-3 py-2 text-sm font-semibold text-k-red">
            {error}
          </div>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
      <div className="mt-4 text-center text-sm">
        <Link to="/auth/login" className="font-semibold text-k-green">
          Back to login
        </Link>
      </div>
    </Card>
  )
}
