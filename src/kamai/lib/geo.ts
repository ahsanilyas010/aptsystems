export interface LatLng {
  lat: number
  lng: number
}

export interface PositionFix extends LatLng {
  accuracyM: number
  timestamp: number
}

const EARTH_RADIUS_M = 6_371_008.8

/** Great-circle distance in metres between two WGS84 points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export class GeoError extends Error {
  code: 'unsupported' | 'denied' | 'unavailable' | 'timeout'
  constructor(code: GeoError['code'], message: string) {
    super(message)
    this.name = 'GeoError'
    this.code = code
  }
}

/**
 * One high-accuracy position fix. Rejects with GeoError. Defaults: 15 s
 * timeout, no cached fix older than 10 s.
 */
export function getPosition(opts?: { timeoutMs?: number; maximumAgeMs?: number }): Promise<PositionFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported', 'Geolocation is not supported on this device'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
      (err) => {
        const code = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'
        const msg =
          code === 'denied'
            ? 'Location permission denied. Allow location access and try again.'
            : code === 'timeout'
              ? 'Could not get a location fix in time. Move to open sky and retry.'
              : 'Location unavailable right now.'
        reject(new GeoError(code, msg))
      },
      {
        enableHighAccuracy: true,
        timeout: opts?.timeoutMs ?? 15_000,
        maximumAge: opts?.maximumAgeMs ?? 10_000,
      },
    )
  })
}

/** Whether `fix` is within `radiusM` of `target`, with the measured distance. */
export function geofenceCheck(fix: LatLng, target: LatLng, radiusM: number): { ok: boolean; distanceM: number } {
  const distanceM = haversineMeters(fix, target)
  return { ok: distanceM <= radiusM, distanceM }
}

/** Google Maps link for a point. */
export function mapsUrl(p: LatLng): string {
  return `https://maps.google.com/?q=${p.lat},${p.lng}`
}
