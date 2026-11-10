/*
 * Rules for the email outbox (apps/web/features/notifications/outbox.ts): whether a failed
 * send is worth retrying, and when. Pure, so they're unit-tested here.
 */

/** Waits before each retry, in seconds: 1 min, 5 min, 30 min, 2 h, 6 h; then it fails. */
export const OUTBOX_RETRY_SECONDS = [60, 300, 1800, 7200, 21600] as const

/** A send still marked "sending" this long after it was claimed was cut off; retry it. */
export const OUTBOX_STUCK_SECONDS = 600

/**
 * An HTTP email API's answer. Temporary: rate limited (429), timed out (408), server errors
 * (5xx), no answer at all, and a missing or wrong API key (401, 403), which is the
 * operator's to fix, not the email's fault, so mail queued meanwhile still goes once it's
 * fixed. Any other 4xx (a bad address, a refused sender) won't change on retry.
 */
const TEMPORARY_4XX = new Set([401, 403, 408, 429])

export function permanentHttp(status: number | null | undefined) {
  if (status == null) return false
  return status >= 400 && status < 500 && !TEMPORARY_4XX.has(status)
}

/** An SMTP reply: 4xx is temporary (busy, greylisted), 5xx permanent (no such mailbox). */
export function permanentSmtp(code: number | null | undefined) {
  return code != null && code >= 500 && code < 600
}

export type OutboxOutcome =
  | { retry: true; inSeconds: number }
  | { retry: false; reason: "permanent" | "attempts" }

/** `attempts` counts tries so far, including the one that just failed. */
export function afterFailure(
  attempts: number,
  permanent: boolean
): OutboxOutcome {
  if (permanent) return { retry: false, reason: "permanent" }
  const wait = OUTBOX_RETRY_SECONDS[attempts - 1]
  return wait === undefined
    ? { retry: false, reason: "attempts" }
    : { retry: true, inSeconds: wait }
}
