/** Postgres channel that wakes runners as soon as work arrives. */
export const QUEUE_CHANNEL = "gretlab_queue"

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
