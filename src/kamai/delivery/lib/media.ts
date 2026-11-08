import { supabase } from '../../lib/supabase'
import { POD_BUCKET } from './data'

/** Downscale an image file to max 1280px on the long edge, JPEG q0.75. */
export async function resizeImage(file: Blob, maxEdge = 1280, quality = 0.75): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) {
    // fall back to <img> decoding
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('Photo load nahi hui. / Could not read the photo.'))
        i.src = url
      })
      return draw(img, img.naturalWidth, img.naturalHeight, maxEdge, quality)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  try {
    return await draw(bmp, bmp.width, bmp.height, maxEdge, quality)
  } finally {
    bmp.close?.()
  }
}

function draw(src: CanvasImageSource, w: number, h: number, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas not available'))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Resize failed'))), 'image/jpeg', quality))
}

export interface UploadResult {
  url: string | null
  error: string | null
}

/** Upload to the kamai-pod bucket; never throws. A missing bucket yields a friendly error. */
export async function uploadPod(path: string, blob: Blob, contentType: string): Promise<UploadResult> {
  try {
    const { error } = await supabase.storage.from(POD_BUCKET).upload(path, blob, { contentType, upsert: true })
    if (error) {
      const m = error.message || ''
      if (/bucket not found|not found/i.test(m))
        return { url: null, error: 'Photo upload ka storage tayyar nahi (kamai-pod). Override reason ke saath aage barhein. / Proof storage is not set up yet (kamai-pod bucket); continue with an override reason.' }
      return { url: null, error: `Upload fail: ${m}` }
    }
    return { url: supabase.storage.from(POD_BUCKET).getPublicUrl(path).data.publicUrl, error: null }
  } catch (e) {
    return { url: null, error: `Upload fail: ${e instanceof Error ? e.message : 'network'}` }
  }
}
