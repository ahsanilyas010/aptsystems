import { useCallback, useEffect, useState } from 'react'

export const CART_KEY = 'kamai-store-cart'
export type CartMap = Record<string, number>

interface Stored {
  tenant_id: string | null
  lines: CartMap
}

const listeners = new Set<() => void>()

function read(): Stored {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Stored
      if (v && typeof v === 'object' && v.lines && typeof v.lines === 'object') return v
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { tenant_id: null, lines: {} }
}

function write(s: Stored) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn())
}

/** Cart persisted in localStorage 'kamai-store-cart'; scoped to one tenant (switching tenant clears it). */
export function useCart(tenantId: string | null) {
  const [state, setState] = useState<Stored>(() => read())
  useEffect(() => {
    const on = () => setState(read())
    listeners.add(on)
    window.addEventListener('storage', on)
    return () => {
      listeners.delete(on)
      window.removeEventListener('storage', on)
    }
  }, [])

  const lines: CartMap = tenantId && state.tenant_id === tenantId ? state.lines : {}

  const setQty = useCallback(
    (productId: string, qty: number) => {
      const cur = read()
      const base = cur.tenant_id === tenantId ? { ...cur.lines } : {}
      const q = Math.max(0, Math.min(9999, Math.floor(qty)))
      if (q === 0) delete base[productId]
      else base[productId] = q
      write({ tenant_id: tenantId, lines: base })
    },
    [tenantId],
  )
  const setAll = useCallback((next: CartMap) => write({ tenant_id: tenantId, lines: next }), [tenantId])
  const clear = useCallback(() => write({ tenant_id: tenantId, lines: {} }), [tenantId])
  const count = Object.values(lines).reduce((a, b) => a + b, 0)
  return { lines, setQty, setAll, clear, count, kinds: Object.keys(lines).length }
}
