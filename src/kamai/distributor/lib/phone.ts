/** Normalise a Pakistani mobile to E.164 (+92...). Returns null if invalid. */
export function normMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/[^\d+]/g, '')
  const plus = d.startsWith('+')
  d = d.replace(/\D/g, '')
  if (!d) return null
  if (!plus) {
    if (d.startsWith('00')) d = d.slice(2)
    else if (d.startsWith('0')) d = '92' + d.slice(1)
    else if (d.length === 10 && d.startsWith('3')) d = '92' + d
  }
  const e = '+' + d
  return /^\+[1-9][0-9]{7,14}$/.test(e) ? e : null
}

export function digitsOnly(m: string): string {
  return m.replace(/\D/g, '')
}

export function waLink(mobile: string, text: string): string {
  return `https://wa.me/${digitsOnly(mobile)}?text=${encodeURIComponent(text)}`
}

export function randomPin(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}

/** Store payment reference code: KM-<SLUG>-<counter>, matches ^[A-Z0-9-]{4,24}$. */
export function refCodePrefix(slug: string): string {
  const s = slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'STORE'
  return `KM-${s}-`
}

export function nextRefCodes(slug: string, existing: string[], n: number, offset = 0): string[] {
  const prefix = refCodePrefix(slug)
  let max = 0
  for (const c of existing) {
    if (c.startsWith(prefix)) {
      const v = parseInt(c.slice(prefix.length), 10)
      if (Number.isFinite(v) && v > max) max = v
    }
  }
  return Array.from({ length: n }, (_, i) => `${prefix}${String(max + offset + i + 1).padStart(4, '0')}`)
}
