// Kamai stores money as bigint minor units (paisa). The legacy CRM uses
// numeric(12,2) rupees; convert at the boundary with these helpers.

/** Rupees (number or numeric string) -> paisa integer. Rounds half away from zero. */
export function toMinor(major: number | string | null | undefined): number {
  if (major === null || major === undefined || major === '') return 0
  const n = typeof major === 'string' ? Number(major.replace(/[^0-9.-]/g, '')) : major
  if (!Number.isFinite(n)) return 0
  return Math.sign(n) * Math.round(Math.abs(n) * 100)
}

/** Paisa (number, bigint or numeric string from PostgREST) -> rupees number. */
export function fromMinor(minor: number | bigint | string | null | undefined): number {
  if (minor === null || minor === undefined || minor === '') return 0
  const n = typeof minor === 'bigint' ? Number(minor) : Number(minor)
  if (!Number.isFinite(n)) return 0
  return n / 100
}

/** Sum a list of minor amounts, ignoring nulls. */
export function sumMinor(values: Array<number | bigint | string | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v == null || v === '' ? 0 : Number(v)), 0)
}

/** Allocate `amountMinor` across `targets` (minor amounts) oldest-first (FIFO). */
export function allocateFifo(amountMinor: number, targets: number[]): number[] {
  let remaining = Math.max(0, Math.trunc(amountMinor))
  return targets.map((t) => {
    const take = Math.min(remaining, Math.max(0, Math.trunc(t)))
    remaining -= take
    return take
  })
}
