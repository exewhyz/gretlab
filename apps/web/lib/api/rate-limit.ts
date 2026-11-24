import { getDb, sql } from "@workspace/db"
import {
  RATE_LIMITS,
  retryAfter,
  windowStart,
  type RateLimitAction,
} from "@workspace/judge"

import { ApiError } from "./errors"

/*
 * Rate limits (rules: packages/judge/src/rate-limits.ts): one statement counts this attempt in
 * its window and answers how many there have been, so servers never disagree and nothing is
 * read and then written. The subject is a network address (from lib/api/client-ip.ts, only
 * what can't be forged) or an organization's id. When the address can't be told, nothing is
 * limited by it: each feature's own rules still hold.
 */

const q = sql.sql

const MESSAGES: Record<RateLimitAction, string> = {
  sign_in:
    "Too many sign-in attempts from your network. Wait a few minutes and try again.",
  sign_up: "Too many new accounts from your network. Try again in an hour.",
  email_link:
    "Too many emails asked for from your network. Try again in an hour.",
  lti_login:
    "Too many launches from your network. Wait a minute and try again.",
  checkout:
    "Too many payments started for this organization. Try again in an hour.",
}

/** Counts one attempt; false when it's past the limit. */
export async function withinLimit(
  action: RateLimitAction,
  subject: string | null
) {
  if (!subject) return true
  const rule = RATE_LIMITS[action]
  const start = windowStart(new Date(), rule.seconds)
  const rows = (await getDb().execute(q`
    insert into rate_limits (key, window_start, n) values (${`${action}:${subject}`}, ${start.toISOString()}, 1)
    on conflict (key, window_start) do update set n = rate_limits.n + 1
    returning n`)) as unknown as { n: number }[]
  return Number(rows[0]?.n ?? 0) <= rule.max
}

/** Whether a subject is already past the limit, without counting anything (failures-only limits). */
export async function pastLimit(
  action: RateLimitAction,
  subject: string | null
) {
  if (!subject) return false
  const rule = RATE_LIMITS[action]
  const start = windowStart(new Date(), rule.seconds)
  const rows = (await getDb().execute(q`
    select n from rate_limits where key = ${`${action}:${subject}`} and window_start = ${start.toISOString()}`)) as unknown as {
    n: number
  }[]
  return Number(rows[0]?.n ?? 0) >= rule.max
}

/** Throws 429 (`too_many_requests`, with Retry-After) past the limit. */
export async function needWithinLimit(
  action: RateLimitAction,
  subject: string | null
) {
  if (await withinLimit(action, subject)) return
  throw new ApiError(
    429,
    "too_many_requests",
    MESSAGES[action],
    retryAfter(new Date(), RATE_LIMITS[action].seconds)
  )
}

/** Windows over a day old: nothing reads them. Run by the cron. */
export async function tidyRateLimits() {
  await getDb().execute(
    q`delete from rate_limits where window_start < now() - interval '1 day'`
  )
}
