/*
 * Step-up two-factor (AGENTS.md › Two-factor sign-in): actions that do lasting harm in the wrong
 * hands (roles, grades, exam time, settings, keys, deletions, billing) need a second-factor code
 * from the last few minutes, not just a signed-in browser. A trusted browser skips the code at
 * sign-in only. People without two-factor are let through (the owner's decision, 24 November
 * 2026): "Require two-factor sign-in" is how staff are made to turn it on.
 */

/** How recent the last code must be: 10 minutes (the owner's choice). */
export const STEP_UP_MS = 10 * 60_000

/** How far ahead of this server's clock another server's stamp may be. */
const SKEW_MS = 60_000

/**
 * Whether this action must wait for a fresh code: only for someone with two-factor on whose last
 * code (`mfaAt`, ms, from the signed session) is missing or older than the window. Our servers
 * stamp it, so a time ahead of this one is only their clocks differing: a minute's leeway, and
 * anything further ahead asks again rather than counting as fresh until the clock catches up.
 */
export function stepUpDue(
  twoFactorOn: boolean,
  mfaAt: number | null,
  now: number = Date.now()
) {
  if (!twoFactorOn) return false
  if (mfaAt === null || !Number.isFinite(mfaAt)) return true
  if (mfaAt > now + SKEW_MS) return true
  return now - mfaAt > STEP_UP_MS
}
