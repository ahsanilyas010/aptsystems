// Kamai Supabase client. Uses its own storageKey so it never shares the
// default `sb-<ref>-auth-token` session with the /apt-finance static page.
// Typed as SupabaseClient<any> on purpose: hand-written row types live in
// ./db-types.ts (owned by another builder); import them where you need them.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://aliegtwlfphpeyvesyvi.supabase.co'

// Public publishable (anon) key; identical to the one in public/apt-finance/index.html.
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsaWVndHdsZnBocGV5dmVzeXZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MjMyNzQsImV4cCI6MjEwMzM5OTI3NH0.Or9loizbKYyB2AsoloIFxeg8jMmw3Pw-ZuHn5GsXxvU'

export const KAMAI_AUTH_STORAGE_KEY = 'kamai-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any> = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: KAMAI_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

/** Current signed-in user id (from the local session), or null. Used to scope offline queues. */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

export default supabase
