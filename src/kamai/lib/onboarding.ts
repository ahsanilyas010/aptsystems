import type { Json, OnboardingStatus } from './db-types'

export interface TenantOnboarding {
  status: OnboardingStatus | null
  selfSignup: boolean
}

/** Reads settings.onboarding_status / settings.signup.source from a tenant's settings jsonb. */
export function readOnboarding(settings: Json | undefined | null): TenantOnboarding {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const st = (s as Record<string, Json>).onboarding_status
  const signup = (s as Record<string, Json>).signup
  const src = signup && typeof signup === 'object' && !Array.isArray(signup) ? (signup as Record<string, Json>).source : null
  return {
    status: st === 'pending_review' || st === 'approved' || st === 'rejected' ? st : null,
    selfSignup: src === 'self_signup',
  }
}
