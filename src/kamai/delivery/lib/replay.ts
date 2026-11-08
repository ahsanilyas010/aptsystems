import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isNetworkError, errMsg } from './data'
import { uploadPod } from './media'
import { listQueue, markQueueError, onQueueChange, removeQueued, type QueuedDelivery } from './queue'

export const OTP_MESSAGES: Record<string, string> = {
  OTP_INVALID: 'OTP ghalat hai. / Wrong OTP.',
  OTP_EXPIRED: 'OTP expire ho gaya. Naya bhejein. / OTP expired, send a new one.',
  OTP_LOCKED: 'Bohat ghalat koshishein, OTP lock ho gaya. Override reason likhein. / OTP locked; use an override reason.',
  GEOFENCE: 'Aap store se door hain. Override reason likhein. / You are outside the store radius; add an override reason.',
}

/** Uploads queued media and calls kamai_confirm_delivery. Returns an error message or null on success. */
export async function submitQueued(q: QueuedDelivery): Promise<string | null> {
  let photoUrl: string | null = null
  let sigUrl: string | null = null
  if (q.photo) photoUrl = (await uploadPod(`${q.tenantId}/${q.orderId}/photo.jpg`, q.photo, 'image/jpeg')).url
  if (q.signature) sigUrl = (await uploadPod(`${q.tenantId}/${q.orderId}/signature.png`, q.signature, 'image/png')).url
  const { data, error } = await supabase.rpc('kamai_confirm_delivery', { ...q.args, p_photo_url: photoUrl, p_signature_url: sigUrl })
  if (error) throw error
  const res = data as { ok?: boolean; error?: string } | null
  if (res && res.ok === false) return OTP_MESSAGES[res.error ?? ''] ?? `Delivery reject: ${res.error ?? 'unknown'}`
  return null
}

/** Pending count + replay on reconnect. Mount once (layout). */
export function useDeliveryQueue(): { pending: number; failed: number; syncing: boolean; sync: () => Promise<void> } {
  const qc = useQueryClient()
  const [items, setItems] = useState<QueuedDelivery[]>([])
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)

  const reload = useCallback(() => {
    void listQueue().then(setItems)
  }, [])

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine) return
    busy.current = true
    setSyncing(true)
    try {
      for (const q of await listQueue()) {
        if (q.error) continue
        try {
          const failure = await submitQueued(q)
          if (failure) await markQueueError(q.id, failure)
          else await removeQueued(q.id)
        } catch (e) {
          if (isNetworkError(e)) break
          await markQueueError(q.id, errMsg(e))
        }
      }
    } finally {
      busy.current = false
      setSyncing(false)
      void qc.invalidateQueries({ queryKey: ['delivery'] })
      reload()
    }
  }, [qc, reload])

  useEffect(() => {
    reload()
    const off = onQueueChange(reload)
    const online = () => void sync()
    window.addEventListener('online', online)
    void sync()
    return () => {
      off()
      window.removeEventListener('online', online)
    }
  }, [reload, sync])

  return { pending: items.filter((i) => !i.error).length, failed: items.filter((i) => i.error).length, syncing, sync }
}
