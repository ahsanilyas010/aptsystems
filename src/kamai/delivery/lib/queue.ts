// IndexedDB queue for delivery confirmations made while offline.
import { currentUserId } from '../../lib/supabase'

export interface QueuedDelivery {
  id: string
  orderId: string
  tenantId: string
  /** owner of the item; only this user's items are listed or replayed */
  userId?: string | null
  orderNo: number | null
  createdAt: number
  args: {
    p_order_id: string
    p_otp: string | null
    p_lat: number | null
    p_lng: number | null
    p_accuracy_m: number | null
    p_items: Array<{ item_id: string; delivered_qty: number }>
    p_receiver_name: string | null
    p_override_reason: string | null
  }
  photo: Blob | null
  signature: Blob | null
  error: string | null
}

const DB = 'kamai-delivery-queue'
const STORE = 'deliveries'
const EVT = 'kamai-delivery-queue-changed'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB error'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error ?? new Error('IndexedDB error'))
      t.onabort = () => reject(t.error ?? new Error('IndexedDB aborted'))
    })
  } finally {
    db.close()
  }
}

function notify() {
  window.dispatchEvent(new Event(EVT))
}

export async function enqueueDelivery(item: QueuedDelivery): Promise<void> {
  const userId = item.userId ?? (await currentUserId())
  await tx('readwrite', (s) => s.put({ ...item, userId }))
  notify()
}

export async function listQueue(): Promise<QueuedDelivery[]> {
  try {
    const uid = await currentUserId()
    const all = (await tx<QueuedDelivery[]>('readonly', (s) => s.getAll())).filter((q) => !!uid && q.userId === uid)
    return all.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function removeQueued(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  notify()
}

export async function markQueueError(id: string, error: string): Promise<void> {
  const cur = await tx<QueuedDelivery | undefined>('readonly', (s) => s.get(id))
  if (!cur) return
  await tx('readwrite', (s) => s.put({ ...cur, error }))
  notify()
}

export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(EVT, fn)
  return () => window.removeEventListener(EVT, fn)
}
