import type { Verdict } from "./verdicts.ts"

/** How one student stands on one assignment problem. */
export type GradeStatus =
  | "solved" // full marks before the due time
  | "late" // the marks counted came from after the due time
  | "partial" // some marks, not all
  | "attempted" // submitted, earned nothing
  | "missing" // never submitted

export interface GradedAttempt {
  verdict: Verdict | null
  score: number | null
  maxScore: number | null
  createdAt: Date
}

export interface GradePolicy {
  /** Only work from this time on counts. */
  opensAt: Date
  dueAt: Date
  allowLate: boolean
  /** Percent taken off marks earned late, 0-100. */
  latePenaltyPercent: number
}

export interface Grade {
  earned: number
  status: GradeStatus
}

/** The share of a problem's marks one graded submission earned, 0 to 1. */
function fractionOf(attempt: GradedAttempt): number {
  if (attempt.verdict === "AC") return 1
  if (!attempt.maxScore || attempt.maxScore <= 0) return 0
  return Math.min(1, Math.max(0, (attempt.score ?? 0) / attempt.maxScore))
}

/**
 * Marks for one problem: the best on-time result, or a better late one minus the penalty.
 * Points are rounded to 2 decimals so the gradebook adds up as shown.
 */
export function gradeProblem(
  points: number,
  attempts: GradedAttempt[],
  policy: GradePolicy
): Grade {
  const counted = attempts.filter((a) => a.createdAt >= policy.opensAt)
  if (counted.length === 0) return { earned: 0, status: "missing" }

  let onTime = 0
  let late = 0
  for (const attempt of counted) {
    const fraction = fractionOf(attempt)
    if (attempt.createdAt <= policy.dueAt) onTime = Math.max(onTime, fraction)
    else if (policy.allowLate) late = Math.max(late, fraction)
  }
  const lateValue = late * (1 - policy.latePenaltyPercent / 100)
  const usedLate = lateValue > onTime
  const best = usedLate ? lateValue : onTime
  const earned = Math.round(points * best * 100) / 100

  if (earned === 0) return { earned, status: "attempted" }
  if (usedLate) return { earned, status: "late" }
  return { earned, status: onTime === 1 ? "solved" : "partial" }
}

/** One thing a teacher marks by hand on an assignment problem. */
export interface RubricCriterion {
  id: string
  label: string
  points: number
}

/** Hand marks for one problem: each criterion's mark, kept between 0 and its points. */
export function rubricEarned(
  rubric: readonly RubricCriterion[],
  marks: Readonly<Record<string, number>> | undefined
): number | null {
  if (!marks || rubric.length === 0) return null
  const given = rubric.filter((c) => typeof marks[c.id] === "number")
  if (given.length === 0) return null
  const sum = given.reduce(
    (total, c) => total + Math.min(c.points, Math.max(0, marks[c.id]!)),
    0
  )
  return Math.round(sum * 100) / 100
}

export const rubricTotal = (rubric: readonly RubricCriterion[]) =>
  rubric.reduce((total, c) => total + c.points, 0)

/** A later due date for one student: the whole assignment, or only the listed problems. */
export interface Extension {
  dueAt: Date
  /** Empty for the whole assignment. */
  problemIds: readonly string[]
}

/** A problem's due time for this student. An extension never makes it earlier. */
export function extendedDue(
  dueAt: Date,
  extension: Extension | null | undefined,
  problemId: string
): Date {
  if (!extension || extension.dueAt <= dueAt) return dueAt
  const covers =
    extension.problemIds.length === 0 ||
    extension.problemIds.includes(problemId)
  return covers ? extension.dueAt : dueAt
}

/** The latest due time of any of this student's problems: when their assignment closes. */
export const personalDue = (
  dueAt: Date,
  extension: Extension | null | undefined
) => (extension && extension.dueAt > dueAt ? extension.dueAt : dueAt)
