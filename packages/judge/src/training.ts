/*
 * Assigned training: where a person is with a course assigned to them, from when they
 * finished it, its due date and how often it must be renewed. Pure, so it's unit-tested.
 */

/** Days before a due date (or an expiry) when it shows as coming up. */
export const TRAINING_SOON_DAYS = { due: 7, expiry: 30 } as const

export type TrainingStatus =
  /** Finished, and still valid. */
  | "done"
  /** Finished, but it expires within 30 days: time to renew. */
  | "expiring"
  /** Finished once, but it's expired: to be done again. */
  | "expired"
  /** Not finished, and its due date has passed. */
  | "overdue"
  /** Not finished, due within a week. */
  | "due"
  /** Not finished, with time left (or no due date). */
  | "todo"

export interface TrainingState {
  status: TrainingStatus
  /** Until when a finished training holds (with renewal), YYYY-MM-DD. */
  validUntil: string | null
  /** When it's needed by: the due date, or the expiry once it has to be renewed. */
  needBy: string | null
}

const DAY = 86_400_000
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** A date some months on, kept to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)))
}

/**
 * Where someone is with a training. `doneSince` is when the oldest of its items was last
 * done (null when some item isn't done): with renewal, a training holds until that plus
 * `renewMonths`, so renewing means doing every item again.
 */
export function trainingState(input: {
  doneSince: string | null
  dueOn: string | null
  renewMonths: number | null
  today: string
}): TrainingState {
  const { doneSince, dueOn, renewMonths, today } = input
  const now = ms(today)
  if (doneSince) {
    const validUntil = renewMonths ? addMonths(doneSince, renewMonths) : null
    if (validUntil && ms(validUntil) < now) return { status: "expired", validUntil, needBy: validUntil }
    if (validUntil && ms(validUntil) - now <= TRAINING_SOON_DAYS.expiry * DAY)
      return { status: "expiring", validUntil, needBy: validUntil }
    return { status: "done", validUntil, needBy: null }
  }
  if (dueOn && ms(dueOn) < now) return { status: "overdue", validUntil: null, needBy: dueOn }
  if (dueOn && ms(dueOn) - now <= TRAINING_SOON_DAYS.due * DAY) return { status: "due", validUntil: null, needBy: dueOn }
  return { status: "todo", validUntil: null, needBy: dueOn }
}

/** Statuses that count as compliant (finished and still valid). */
export const COMPLIANT: readonly TrainingStatus[] = ["done", "expiring"]
