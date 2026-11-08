import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Private bucket for proof-of-delivery media. Objects live at <tenant_id>/... and the DB stores the PATH. */
export const POD_BUCKET = 'kamai-pod'

/** Returns the URL only when it is http(s); anything else (javascript:, data:, ...) becomes null. */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const p = new URL(u.trim())
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null
  } catch {
    return null
  }
}

/**
 * Resolve a stored proof value for display. A storage path in kamai-pod becomes a short-lived signed URL;
 * a legacy http(s) value is passed through; anything else yields null.
 */
export function useSignedUrl(value: string | null | undefined): string | null {
  const isPath = !!value && !/^[a-z][a-z0-9+.-]*:/i.test(value)
  const q = useQuery({
    queryKey: ['kamai-pod-url', value],
    enabled: isPath,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(POD_BUCKET).createSignedUrl(value as string, 600)
      if (error) throw error
      return data.signedUrl
    },
  })
  if (!value) return null
  return isPath ? (q.data ?? null) : safeHttpUrl(value)
}

/** Thumbnail that links to the full proof image. Renders nothing for an empty or unsafe value. */
export function ProofImage({ value, alt, className = '' }: { value: string | null | undefined; alt: string; className?: string }) {
  const url = useSignedUrl(value)
  if (!value) return null
  if (!url) return <span className="text-xs text-k-muted">{alt}: loading</span>
  return (
    <a href={url} target="_blank" rel="noreferrer noopener">
      <img src={url} alt={alt} className={`h-24 w-24 rounded-lg border border-k-border ${className}`} />
    </a>
  )
}
