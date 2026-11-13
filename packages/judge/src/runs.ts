/*
 * Groups that run between dates (a cohort, a coaching batch): where a run is on a given day.
 * Pure, so it's unit-tested here.
 */

const DAY = 86_400_000
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)

export interface RunState {
  status: "upcoming" | "running" | "finished"
  /** Week of the run (1-based) while it's running; null otherwise. */
  week: number | null
  /** Weeks in the run, counting a part week. */
  weeks: number
  /** Days until it starts (upcoming) or ends (running); 0 once finished. */
  days: number
}

/** Where a run from `startsOn` to `endsOn` (inclusive) is on `today`. */
export function runState(startsOn: string, endsOn: string, today: string): RunState {
  const start = ms(startsOn)
  const end = ms(endsOn)
  const now = ms(today)
  const weeks = Math.max(1, Math.ceil((end - start + DAY) / (7 * DAY)))
  if (now < start) return { status: "upcoming", week: null, weeks, days: Math.round((start - now) / DAY) }
  if (now > end) return { status: "finished", week: null, weeks, days: 0 }
  return {
    status: "running",
    week: Math.floor((now - start) / (7 * DAY)) + 1,
    weeks,
    days: Math.round((end - now) / DAY),
  }
}

/** Why run dates can't be saved, or null. */
export function runProblem(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return null
  if (!startsOn || !endsOn) return "Give both the start and the end."
  if (endsOn < startsOn) return "A run can't end before it starts."
  if ((ms(endsOn) - ms(startsOn)) / DAY > 3 * 366) return "Keep a run under three years."
  return null
}
