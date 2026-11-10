import { supabase } from './supabase'

export class KamaiApiError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'KamaiApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type KamaiAdminAction =
  | 'provision_user'
  | 'reset_pin'
  | 'disable_user'
  | 'send_otp'
  | 'send_whatsapp'
  | (string & {})

/**
 * POST /api/kamai-admin with `Authorization: Bearer <session access token>`.
 * Body: { action, ...payload }. Returns parsed JSON (the `data` field when the
 * server wraps it as { ok, data }, otherwise the whole body). Throws
 * KamaiApiError on a non-2xx response or when the body reports ok:false.
 */
export async function callKamaiApi<TResult = unknown, TPayload extends Record<string, unknown> = Record<string, unknown>>(
  action: KamaiAdminAction,
  payload: TPayload = {} as TPayload,
  opts?: { signal?: AbortSignal; endpoint?: string },
): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new KamaiApiError('Not signed in', 401, 'no_session')

  const res = await fetch(opts?.endpoint ?? '/api/kamai-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
    signal: opts?.signal,
  })

  const text = await res.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { error: text }
    }
  }
  const b = (body ?? {}) as { ok?: boolean; success?: boolean; error?: string; message?: string; code?: string; data?: unknown }

  if (!res.ok || b.ok === false || b.success === false) {
    throw new KamaiApiError(b.error || b.message || `Request failed (${res.status})`, res.status, b.code, body)
  }
  return (b.data !== undefined ? b.data : body) as TResult
}
