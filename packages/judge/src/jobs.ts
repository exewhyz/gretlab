/*
 * Background jobs (apps/web/features/jobs): long work, such as an export of a whole
 * organization, done in small steps outside the request that asked for it. The rules here are
 * pure and unit-tested (jobs.test.ts); the queue itself lives in Postgres.
 *
 * A step holds its job for JOB_LEASE_MS; if the process dies, the job is free again after that
 * and the next runner carries on from the last saved step. A step that fails is tried again,
 * waiting longer each time, and after JOB_MAX_ATTEMPTS the job has failed.
 */

export const JOB_LEASE_MS = 60_000
export const JOB_MAX_ATTEMPTS = 5

/** Waits after the 1st, 2nd, 3rd and 4th failure. */
const RETRY_MS = [30_000, 120_000, 600_000, 1_800_000] as const

export function jobAfterFailure(attempts: number) {
  if (attempts >= JOB_MAX_ATTEMPTS) {
    return { status: "failed" as const, retryInMs: null }
  }
  const index = Math.min(Math.max(attempts, 1), RETRY_MS.length) - 1
  return { status: "queued" as const, retryInMs: RETRY_MS[index]! }
}

/** Waiting this long means nothing is running jobs (Dashboard › Monitoring flags it). */
export const JOB_STUCK_MS = 10 * 60_000

export function jobStuck(oldestWaitingSince: Date | null, now: Date) {
  return (
    oldestWaitingSince !== null &&
    now.getTime() - oldestWaitingSince.getTime() >= JOB_STUCK_MS
  )
}

export const JOB_KEEP = { jobsDays: 30, fileHours: 24 } as const
