import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Crosshair, Minus, Plus, Send } from 'lucide-react'
import { Badge, Button, Card, CardTitle, Input, Textarea, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { callKamaiApi } from '../../lib/api'
import { geofenceCheck, getPosition, type PositionFix } from '../../lib/geo'
import type { KamaiOrderItemsRow } from '../../lib/db-types'
import { DEFAULT_GEOFENCE_M, errMsg, isNetworkError, type OrderRow, type StoreRow } from '../lib/data'
import { resizeImage, uploadPod } from '../lib/media'
import { enqueueDelivery } from '../lib/queue'
import { OTP_MESSAGES } from '../lib/replay'
import { SignaturePad, type SignaturePadHandle } from './SignaturePad'

const OTP_FALLBACK = 'Store se kahein /store kholkar code dekhein. / Ask the store to open /store to see the code.'

interface Props {
  tenantId: string
  order: OrderRow
  items: KamaiOrderItemsRow[]
  store: StoreRow | null
  onDone: () => void
}

export function ConfirmForm({ tenantId, order, items, store, onDone }: Props) {
  const toast = useToast()
  const dispatched = order.fulfilment_status === 'dispatched'
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(items.map((i) => [i.id, i.qty])))
  const [otp, setOtp] = useState('')
  const [otpMsg, setOtpMsg] = useState<string | null>(null)
  const [otpBusy, setOtpBusy] = useState(false)
  const [fix, setFix] = useState<PositionFix | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsErr, setGpsErr] = useState<string | null>(null)
  const [override, setOverride] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [receiver, setReceiver] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sig = useRef<SignaturePadHandle>(null)
  const [sigEmpty, setSigEmpty] = useState(true)

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  const total = items.reduce((a, i) => a + i.qty, 0)
  const delivering = items.reduce((a, i) => a + (qty[i.id] ?? 0), 0)
  const refused = delivering === 0
  const hasCoords = store?.latitude != null && store?.longitude != null

  const geo = useMemo(() => {
    if (!fix || !hasCoords) return null
    const r = geofenceCheck(fix, { lat: store!.latitude as number, lng: store!.longitude as number }, Math.max(DEFAULT_GEOFENCE_M, fix.accuracyM))
    return r
  }, [fix, hasCoords, store])

  const otpOk = /^\d{6}$/.test(otp)
  const needOverride = !otpOk || refused || geo?.ok !== true
  const reasons: string[] = []
  if (!otpOk) reasons.push('OTP nahi')
  if (!fix) reasons.push('location capture nahi')
  else if (!hasCoords) reasons.push('store ki location maloom nahi')
  else if (geo && !geo.ok) reasons.push('store ke radius se bahar')
  if (refused) reasons.push('poora order wapas')

  function step(id: string, max: number, d: number) {
    setQty((q) => ({ ...q, [id]: Math.min(max, Math.max(0, (q[id] ?? 0) + d)) }))
  }

  async function sendOtp() {
    setOtpBusy(true)
    setOtpMsg(null)
    try {
      const r = await callKamaiApi<{ delivered?: boolean; note?: string }>('send_delivery_otp', { order_id: order.id })
      setOtpMsg(r?.delivered ? 'OTP store ko WhatsApp par bhej diya gaya. / OTP sent to the store on WhatsApp.' : OTP_FALLBACK)
    } catch {
      setOtpMsg(OTP_FALLBACK)
    } finally {
      setOtpBusy(false)
    }
  }

  async function capture() {
    setGpsBusy(true)
    setGpsErr(null)
    try {
      setFix(await getPosition({ timeoutMs: 20_000, maximumAgeMs: 0 }))
    } catch (e) {
      setGpsErr(errMsg(e))
    } finally {
      setGpsBusy(false)
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    try {
      const b = await resizeImage(file)
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      setPhoto(b)
      setPhotoUrl(URL.createObjectURL(b))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function queueIt(args: Parameters<typeof enqueueDelivery>[0]['args'], sigBlob: Blob | null) {
    await enqueueDelivery({
      id: `${order.id}:${Date.now()}`, orderId: order.id, tenantId, orderNo: order.order_no, createdAt: Date.now(),
      args, photo, signature: sigBlob, error: null,
    })
    toast.info('Offline: delivery phone mein save, online hote hi sync hogi. / Saved offline, will sync automatically.')
    onDone()
  }

  async function submit() {
    setError(null)
    if (needOverride && override.trim().length < 3) {
      setError(`Override reason likhna zaroori hai (${reasons.join(', ')}). / An override reason is required.`)
      return
    }
    const args = {
      p_order_id: order.id,
      p_otp: otpOk ? otp : null,
      p_lat: fix?.lat ?? null,
      p_lng: fix?.lng ?? null,
      p_accuracy_m: fix?.accuracyM ?? null,
      p_items: items.map((i) => ({ item_id: i.id, delivered_qty: qty[i.id] ?? 0 })),
      p_receiver_name: receiver.trim() || null,
      p_override_reason: override.trim() || null,
    }
    setBusy(true)
    try {
      const sigBlob = sig.current && !sig.current.isEmpty() ? await sig.current.toBlob() : null
      if (!navigator.onLine) return await queueIt(args, sigBlob)

      let photoPath: string | null = null
      let sigPath: string | null = null
      if (photo) {
        const r = await uploadPod(`${tenantId}/${order.id}/photo.jpg`, photo, 'image/jpeg')
        photoPath = r.url
        if (r.error && !args.p_override_reason) {
          setError(r.error)
          return
        }
      }
      if (sigBlob) sigPath = (await uploadPod(`${tenantId}/${order.id}/signature.png`, sigBlob, 'image/png')).url

      try {
        const { data, error: e } = await supabase.rpc('kamai_confirm_delivery', { ...args, p_photo_url: photoPath, p_signature_url: sigPath })
        if (e) throw e
        const res = data as { ok?: boolean; error?: string; attempts_left?: number; distance_m?: number | null; radius_m?: number } | null
        if (res && res.ok === false) {
          const base = OTP_MESSAGES[res.error ?? ''] ?? `Delivery reject: ${res.error}`
          const extra = res.error === 'OTP_INVALID' && res.attempts_left != null ? ` (${res.attempts_left} koshishein baqi)` : res.error === 'GEOFENCE' && res.distance_m != null ? ` (${Math.round(res.distance_m)}m door, radius ${res.radius_m}m)` : ''
          setError(base + extra)
          return
        }
        toast.success(refused ? 'Order wapas darj ho gaya. / Refusal recorded.' : 'Delivery confirm ho gayi. / Delivery confirmed.')
        onDone()
      } catch (e) {
        if (isNetworkError(e)) return await queueIt(args, sigBlob)
        throw e
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (!dispatched) {
    return (
      <Card padding="sm" tone="muted">
        <p className="text-sm text-k-muted">Order abhi "packed" hai. Dispatch hone ke baad delivery confirm hogi. / The order is packed; you can confirm delivery once it is dispatched.</p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm">
        <CardTitle action={<Badge tone={refused ? 'red' : delivering === total ? 'green' : 'amber'}>{delivering}/{total}</Badge>}>Items</CardTitle>
        <ul className="flex flex-col divide-y divide-k-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-k-dark">{i.name}</div>
                <div className="text-xs text-k-muted">{i.sku} · ordered {i.qty}</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Decrease" onClick={() => step(i.id, i.qty, -1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-k-border bg-k-surface"><Minus size={18} /></button>
                <span className="w-8 text-center text-lg font-extrabold tabular-nums">{qty[i.id] ?? 0}</span>
                <button type="button" aria-label="Increase" onClick={() => step(i.id, i.qty, 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-k-border bg-k-surface"><Plus size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card padding="sm">
        <CardTitle>Store OTP</CardTitle>
        <div className="flex flex-col gap-3">
          <Button variant="secondary" size="lg" icon={<Send size={16} />} loading={otpBusy} onClick={() => void sendOtp()}>Store ko OTP bhejein</Button>
          {otpMsg ? <p className="text-sm text-k-muted">{otpMsg}</p> : null}
          <Input label="6-digit OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={6} size="lg" className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.4em]" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
        </div>
      </Card>

      <Card padding="sm">
        <CardTitle>Location</CardTitle>
        <div className="flex flex-col gap-3">
          <Button variant="secondary" size="lg" icon={<Crosshair size={16} />} loading={gpsBusy} onClick={() => void capture()}>{fix ? 'Dobara capture' : 'Meri location lein'}</Button>
          {gpsErr ? <p role="alert" className="text-sm font-semibold text-k-red">{gpsErr}</p> : null}
          {fix ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={fix.accuracyM <= 50 ? 'green' : 'amber'}>Accuracy ±{Math.round(fix.accuracyM)}m</Badge>
              {geo ? <Badge tone={geo.ok ? 'green' : 'red'}>{Math.round(geo.distanceM)}m from store {geo.ok ? '(inside)' : '(outside)'}</Badge> : <Badge tone="amber">Store location unknown</Badge>}
            </div>
          ) : null}
        </div>
      </Card>

      <Card padding="sm">
        <CardTitle>Proof</CardTitle>
        <div className="flex flex-col gap-3">
          <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-k-border bg-k-surface text-sm font-semibold text-k-dark">
            <Camera size={18} />{photo ? 'Photo badlein' : 'Photo lein'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          {photoUrl ? <img src={photoUrl} alt="Delivery proof" className="max-h-56 w-full rounded-xl object-cover" /> : null}
          <Input label="Receiver ka naam" size="lg" value={receiver} onChange={(e) => setReceiver(e.target.value)} />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[1px] text-k-muted">Signature (optional)</span>
              {!sigEmpty ? <button type="button" className="text-xs font-semibold text-k-green" onClick={() => sig.current?.clear()}>Clear</button> : null}
            </div>
            <SignaturePad ref={sig} onChange={setSigEmpty} />
          </div>
        </div>
      </Card>

      {needOverride ? (
        <Card padding="sm" className="border-k-accent">
          <CardTitle dot="amber">Override reason</CardTitle>
          <p className="mb-2 text-xs text-k-muted">Zaroori: {reasons.join(', ')}. Ye delivery flag ho jayegi. / Required; this delivery will be flagged for review.</p>
          <Textarea value={override} onChange={(e) => setOverride(e.target.value)} rows={3} placeholder="Wajah likhein / Reason" />
        </Card>
      ) : null}

      {error ? <div role="alert" className="rounded-xl bg-k-red-light px-4 py-3 text-sm font-semibold text-k-red">{error}</div> : null}
      <Button size="lg" block variant={refused ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
        {refused ? 'Order wapas (refused)' : delivering < total ? 'Partial delivery confirm' : 'Delivery confirm karein'}
      </Button>
    </div>
  )
}
