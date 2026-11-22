/** Postgres channel that wakes runners as soon as work arrives. */
export const QUEUE_CHANNEL = "gretlab_queue"

/**
 * A judge silent for longer than this is down: the dashboard says so, and an organization
 * whose own judges are all down has its work run by the shared judges (claimNext).
 */
export const RUNNER_ONLINE_MS = 60_000

/**
 * The queue orders by a due time, not raw arrival. Contest work goes first under load, but
 * because this is only a head start, a plain run can never starve: it waits at most this
 * long behind later arrivals. With no backlog everything starts immediately regardless.
 */
export function queueHeadStartMs(job: {
  kind: "run" | "submit"
  inContest: boolean
}): number {
  if (job.kind === "submit") return job.inContest ? 0 : 5_000
  return 10_000
}

/** How long a browser should wait before asking again. Longer queues get polled less. */
export function nextPollMs(position: number | null): number {
  return position === null ? 300 : Math.min(3000, 400 + position * 40)
}
