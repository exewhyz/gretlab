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
