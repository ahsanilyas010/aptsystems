/** GTIN check digit (GS1 mod-10) for 8/12/13/14 digit codes. */
export function gtinCheckOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop() as number
  let sum = 0
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1)
  })
  return (10 - (sum % 10)) % 10 === check
}

/** Zero pad to 14 digits; returns null when empty. */
export function padGtin14(code: string): string | null {
  const c = code.replace(/\D/g, '')
  return c ? c.padStart(14, '0') : null
}

export function validateGtin(code: string): string | null {
  const c = code.replace(/\D/g, '')
  if (!c) return null
  if (![8, 12, 13, 14].includes(c.length)) return 'GTIN must be 8, 12, 13 or 14 digits'
  if (!gtinCheckOk(c)) return 'GTIN check digit is wrong'
  return null
}
