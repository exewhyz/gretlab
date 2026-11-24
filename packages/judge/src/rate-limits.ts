/*
 * Limits on how often one network address (or one organization) may do something that
 * strangers could hammer: trying passwords across accounts, signing up, asking for links by
 * email, launching from an LMS, starting payments. Counted per fixed window in Postgres
 * (rate_limits; apps/web/lib/api/rate-limit.ts). These are on top of the rules each feature
 * already has (five wrong passwords pause one account, one email a minute per address).
 *
 * A college lab, a school or a company sits behind one network address, so a whole class
 * acting together must fit: sign-in counts only failures, and the rest leave room for a
 * hundreds-strong cohort arriving at once.
 */

export interface RateLimit {
  /** How many in one window. */
  max: number
  /** The window, in seconds. */
  seconds: number
}

export const RATE_LIMITS = {
  /** Failed password sign-ins from one address, whichever accounts (right ones don't count). */
  sign_in: { max: 100, seconds: 15 * 60 },
  /** New accounts from one address: a cohort signing up in one session fits. */
  sign_up: { max: 200, seconds: 60 * 60 },
  /** "Forgot password" and "resend confirmation" from one address. */
  email_link: { max: 50, seconds: 60 * 60 },
  /** LMS launches (login initiation) from one address: a large lab launching together fits. */
  lti_login: { max: 600, seconds: 60 },
  /** Payment orders an organization starts (each makes a Razorpay order). */
  checkout: { max: 20, seconds: 60 * 60 },
} as const satisfies Record<string, RateLimit>

export type RateLimitAction = keyof typeof RATE_LIMITS

/** The start of the window `now` falls in: windows are aligned to the epoch, so all servers agree. */
export function windowStart(now: Date, seconds: number) {
  const ms = seconds * 1000
  return new Date(Math.floor(now.getTime() / ms) * ms)
}

/** When the window `now` falls in ends, for a Retry-After answer (whole seconds, at least 1). */
export function retryAfter(now: Date, seconds: number) {
  const end = windowStart(now, seconds).getTime() + seconds * 1000
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000))
}
