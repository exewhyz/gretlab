/*
 * When a course's modules open for a student. A module opens `openAfterDays` after the
 * class starts the course (on the start day when unset), and, with `afterPrevious`, only
 * once the student has finished the module before it. Pure; dates are YYYY-MM-DD.
 */

export interface ReleaseRule {
  openAfterDays: number | null
  afterPrevious: boolean
  /** Items in the module, and how many this student has finished. */
  total: number
  done: number
}

export interface Release {
  opensOn: string
  open: boolean
  /** Why it's still closed. */
  waiting: "date" | "previous" | null
  complete: boolean
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function releaseModules(
  rules: ReleaseRule[],
  startsOn: string,
  today: string
): Release[] {
  const out: Release[] = []
  for (const [i, rule] of rules.entries()) {
    const opensOn = addDays(startsOn, rule.openAfterDays ?? 0)
    const before = out[i - 1]
    const previousDone =
      !rule.afterPrevious || i === 0 || (before!.open && before!.complete)
    const dateReached = today >= opensOn
    const open = dateReached && previousDone
    out.push({
      opensOn,
      open,
      waiting: open ? null : !dateReached ? "date" : "previous",
      complete: rule.done >= rule.total,
    })
  }
  return out
}

/*
 * Checkpoints: a module's quiz, lab or project, graded toward the course. A quiz or lab is
 * one attempt per student, from starting until they finish or their time runs out (a
 * checkpoint without a time limit runs until they finish). A lab's problems score by the
 * best graded submission made during the attempt; a project by a teacher's mark.
 */

export type CheckpointKind = "quiz" | "lab" | "project"

export const CHECKPOINT_KINDS: readonly CheckpointKind[] = [
  "quiz",
  "lab",
  "project",
]

export interface Attempt {
  startedAt: Date
  endsAt: Date | null
  finishedAt: Date | null
}

/** Work stamped this long after an attempt closes still counts (a last-second press). */
export const ATTEMPT_GRACE_MS = 10_000

/** When an attempt stops taking work; null while an untimed one is still going. */
export function attemptClosesAt(a: Attempt): Date | null {
  if (a.finishedAt && (!a.endsAt || a.finishedAt < a.endsAt))
    return a.finishedAt
  return a.endsAt
}

export type AttemptState = "not_started" | "running" | "finished"

export function attemptState(
  a: Attempt | null | undefined,
  now: Date
): AttemptState {
  if (!a) return "not_started"
  const closes = attemptClosesAt(a)
  return closes && now >= closes ? "finished" : "running"
}

/** Whether work stamped at `at` belongs to the attempt (with the grace after it closes). */
/** Whether the student ended it themselves, before any time limit. */
export const finishedEarly = (a: Attempt) =>
  a.finishedAt !== null && (!a.endsAt || a.finishedAt < a.endsAt)

export function duringAttempt(
  a: Attempt | null | undefined,
  at: Date
): boolean {
  if (!a || at < a.startedAt) return false
  const closes = attemptClosesAt(a)
  if (!closes) return true
  // Time running out allows a last-second press; pressing Finish doesn't.
  return (
    at.getTime() <= closes.getTime() + (finishedEarly(a) ? 0 : ATTEMPT_GRACE_MS)
  )
}

/**
 * A lab problem's points from the student's graded submissions: the best score (IOI
 * scores give partial credit; otherwise accepted is full marks) among those made during
 * the attempt.
 */
export function labPoints(
  points: number,
  submissions: readonly {
    createdAt: Date
    verdict: string | null
    score: number | null
    maxScore: number | null
  }[],
  attempt: Attempt | null | undefined
): number {
  let best = 0
  for (const s of submissions) {
    if (!duringAttempt(attempt, s.createdAt)) continue
    const fraction =
      s.maxScore && s.maxScore > 0 && s.score !== null
        ? Math.min(1, Math.max(0, s.score / s.maxScore))
        : s.verdict === "AC"
          ? 1
          : 0
    best = Math.max(best, fraction)
  }
  return Math.round(points * best * 100) / 100
}

export interface CheckpointScore {
  weight: number
  earned: number
  max: number
  /** Null while it waits (not attempted, still running, or a project not marked yet). */
  final: boolean
}

/**
 * The course grade, as a percentage: each checkpoint's share (earned over max) weighted by
 * its weight. Checkpoints not final yet count as 0 in `grade` and are left out of
 * `sofar`, so a teacher sees both where a student stands and how they're doing.
 */
export function courseGrade(scores: readonly CheckpointScore[]) {
  const usable = scores.filter((s) => s.max > 0 && s.weight > 0)
  const total = usable.reduce((n, s) => n + s.weight, 0)
  const share = (s: CheckpointScore) =>
    (s.weight * Math.min(s.earned, s.max)) / s.max
  const finals = usable.filter((s) => s.final)
  const finalWeight = finals.reduce((n, s) => n + s.weight, 0)
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    grade: total
      ? round(
          (100 *
            usable.filter((s) => s.final).reduce((n, s) => n + share(s), 0)) /
            total
        )
      : null,
    sofar: finalWeight
      ? round((100 * finals.reduce((n, s) => n + share(s), 0)) / finalWeight)
      : null,
    counted: finals.length,
    of: usable.length,
  }
}

/** Each checkpoint's share of the course grade, in percent (the "how is it graded" table). */
export function gradeShares(weights: readonly number[]): number[] {
  const total = weights.reduce((n, w) => n + Math.max(0, w), 0)
  return weights.map((w) =>
    total ? Math.round((10000 * Math.max(0, w)) / total) / 100 : 0
  )
}
