import { normMobile } from '../../distributor/lib/phone'

/** Only same-origin absolute paths are allowed as redirect targets. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

/** Synthetic login emails for a mobile number: store- first, then user-. */
export function syntheticEmails(rawMobile: string): string[] | null {
  const e164 = normMobile(rawMobile)
  if (!e164) return null
  const digits = e164.replace(/\D/g, '')
  return [`store-${digits}@kamai.assorted.group`, `user-${digits}@kamai.assorted.group`]
}

export function friendlyAuthError(message: string | undefined, mode: 'email' | 'mobile' = 'email'): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return mode === 'mobile'
      ? 'Mobile number ya PIN ghalat hai. / Wrong mobile number or PIN.'
      : 'Email ya password ghalat hai. / Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Email abhi confirm nahi hui. / Email is not confirmed yet.'
  if (m.includes('rate') || m.includes('too many')) return 'Bohat zyada koshishein. Thori der baad try karein. / Too many attempts, try again later.'
  if (m.includes('network') || m.includes('fetch')) return 'Internet masla hai. Connection check karein. / Network problem, check your connection.'
  if (m.includes('expired') || m.includes('invalid') && m.includes('token')) return 'Link expire ho gaya ya ghalat hai. / The link has expired or is invalid.'
  if (m.includes('same password') || m.includes('different from the old')) return 'Naya password purane se different hona chahiye. / New password must differ from the old one.'
  return message || 'Kuch ghalat ho gaya. / Something went wrong.'
}
