// IndexedDB backed outbox for orders placed without signal. Jobs are keyed by client_order_id,
// so replaying a job is idempotent on the server (kamai_submit_order returns replayed:true).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const DB_NAME = 'kamai-store-queue'
const STORE = 'jobs'
export const MAX_ATTEMPTS = 10
export const FLUSH_EVERY_MS = 60_000

export interface QueuedOrderPayload {
  tenant_id: string
  store_id: string
  items: Array<{ product_id: string; qty: number }>
  payment_mode: 'credit' | 'cod'
  source: 'store_pwa'
  client_order_id: string
  notes?: string
}

export interface QueueJob {
  client_order_id: string
  payload: QueuedOrderPayload
  attempts: number
  last_error: string | null
  created_at: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'client_order_id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const r = fn(t.objectStore(STORE))
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
    })
  } finally {
    db.close()
  }
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((fn) => fn())
}

export async function listJobs(): Promise<QueueJob[]> {
  try {
    const rows = await tx<QueueJob[]>('readonly', (s) => s.getAll() as IDBRequest<QueueJob[]>)
    return rows.sort((a, b) => a.created_at.localeCompare(b.created_at))
  } catch {
    return []
  }
}

export async function enqueueOrder(payload: QueuedOrderPayload): Promise<void> {
  const job: QueueJob = { client_order_id: payload.client_order_id, payload, attempts: 0, last_error: null, created_at: new Date().toISOString() }
  await tx('readwrite', (s) => s.put(job))
  emit()
}

async function putJob(job: QueueJob): Promise<void> {
  await tx('readwrite', (s) => s.put(job))
  emit()
}

export async function removeJob(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  emit()
}

export async function resetJob(id: string): Promise<void> {
  const rows = await listJobs()
  const j = rows.find((r) => r.client_order_id === id)
  if (j) await putJob({ ...j, attempts: 0, last_error: null })
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const e = err as { message?: string; status?: number; code?: string } | null
  const msg = (e?.message ?? String(err ?? '')).toLowerCase()
  return e?.status === 0 || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/.test(msg)
}

let flushing = false

/** Send queued jobs oldest first. Stops at the first network failure. Returns how many were sent. */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  flushing = true
  let sent = 0
  try {
    const jobs = await listJobs()
    for (const job of jobs) {
      if (job.attempts >= MAX_ATTEMPTS) continue
      const { error } = await supabase.rpc('kamai_submit_order', { p: job.payload })
      if (!error) {
        await removeJob(job.client_order_id)
        sent++
        continue
      }
      if (isNetworkError(error)) break
      await putJob({ ...job, attempts: job.attempts + 1, last_error: error.message })
    }
  } finally {
    flushing = false
  }
  return sent
}

/** Live view of the queue (re-reads on every change). */
export function useQueue(): { jobs: QueueJob[]; pending: number; failed: number } {
  const [jobs, setJobs] = useState<QueueJob[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      void listJobs().then((j) => alive && setJobs(j))
    }
    load()
    listeners.add(load)
    return () => {
      alive = false
      listeners.delete(load)
    }
  }, [])
  const failed = jobs.filter((j) => j.attempts >= MAX_ATTEMPTS).length
  return { jobs, pending: jobs.length - failed, failed }
}

/** Mount once in the store layout: flush on `online` and every 60 s. */
export function useQueueFlusher(onSent: () => void): void {
  useEffect(() => {
    const run = () => {
      void flushQueue().then((n) => {
        if (n > 0) onSent()
      })
    }
    run()
    window.addEventListener('online', run)
    const id = window.setInterval(run, FLUSH_EVERY_MS)
    return () => {
      window.removeEventListener('online', run)
      window.clearInterval(id)
    }
  }, [onSent])
}
