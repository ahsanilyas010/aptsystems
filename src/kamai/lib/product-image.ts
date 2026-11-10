import { supabase } from './supabase'

export const PRODUCT_IMAGE_BUCKET = 'kamai-product-images'
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image'))
    }
    img.src = url
  })
}

/** Downscale to max 1200px on the long edge and re-encode as JPEG until it is <= 2 MB. */
export async function prepareProductImage(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  if (!OK_TYPES.includes(file.type)) throw new Error('Use a JPG, PNG or WebP image')
  if (file.size <= MAX_IMAGE_BYTES && file.size <= 600 * 1024) {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    return { blob: file, ext, type: file.type }
  }
  const img = await loadImage(file)
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing is not available in this browser')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q))
    if (blob && blob.size <= MAX_IMAGE_BYTES) return { blob, ext: 'jpg', type: 'image/jpeg' }
  }
  throw new Error('Image is too large (max 2 MB). Try a smaller photo.')
}

/** Uploads to '<tenantId>/<uuid>.<ext>' and returns the public URL. */
export async function uploadProductImage(tenantId: string, file: File): Promise<string> {
  const { blob, ext, type } = await prepareProductImage(file)
  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, blob, { contentType: type, upsert: false })
  if (error) throw new Error(error.message)
  return supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
