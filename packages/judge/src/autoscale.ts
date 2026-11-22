/*
 * Automatic scaling of the shared judges (Dashboard › Judges › Judge settings): when to start
 * another machine, and when to end one the scaler started. Pure, so every rule is unit-tested
 * (autoscale.test.ts); apps/web/features/judges gathers the numbers and does what it says.
 *
 * Only shared judges are scaled: an organization's own judges are what it chose to have.
 * One change at a time: a judge takes minutes to set up, so nothing more starts while one is
 * still coming up, and only one is ended per decision.
 */

export interface ScaleInput {
  /** Automatic scaling switched on (judges.autoscale). */
  on: boolean
  /** Shared judges always kept online, hand-set-up ones included (judges.min_shared). */
  minShared: number
  /** How long shared work may wait before another judge starts (judges.scale_up_seconds). */
  scaleUpSeconds: number
  /** How long a judge the scaler started may sit idle before it's ended (judges.idle_minutes). */
  idleMinutes: number
  /** One judge warmed up per this many students sitting an exam soon (judges.exam_students_per_judge). */
  studentsPerJudge: number
  /** The running limit (judges.max_running), and how many dashboard machines are live now. */
  maxRunning: number
  liveMachines: number
  /** Shared judges reporting in now, and shared machines still setting up. */
  onlineShared: number
  comingShared: number
  /** How long the oldest waiting shared job has waited, in seconds (0 when none waits). */
  oldestSharedWaitSeconds: number
  /** Students sitting shared-pool exams that open within the warm-up time. */
  examStudents: number
  /** Ready judges the scaler started, with how long each has had nothing to do. */
  idle: { id: string; idleMinutes: number }[]
}

export type ScaleDecision =
  | { action: "none" }
  | { action: "start"; reason: string }
  | { action: "drain"; id: string; reason: string }

/** How many shared judges are wanted now: the minimum, or more for an exam about to open. */
export function sharedWanted(
  input: Pick<ScaleInput, "minShared" | "examStudents" | "studentsPerJudge">
) {
  const forExams =
    input.examStudents > 0
      ? Math.ceil(input.examStudents / Math.max(1, input.studentsPerJudge))
      : 0
  return Math.max(input.minShared, forExams)
}

export function scaleDecision(input: ScaleInput): ScaleDecision {
  if (!input.on) return { action: "none" }
  const wanted = sharedWanted(input)
  const have = input.onlineShared + input.comingShared
  const canStart =
    input.comingShared === 0 && input.liveMachines < input.maxRunning

  if (have < wanted) {
    if (!canStart) return { action: "none" }
    return {
      action: "start",
      reason:
        wanted > input.minShared
          ? `An exam opens soon: ${input.examStudents} students, ${wanted} judges wanted`
          : `Below the minimum of ${input.minShared} judge${input.minShared === 1 ? "" : "s"} for everyone`,
    }
  }
  if (input.oldestSharedWaitSeconds >= input.scaleUpSeconds) {
    if (!canStart) return { action: "none" }
    return {
      action: "start",
      reason: `Work has waited ${Math.round(input.oldestSharedWaitSeconds)} s for a judge`,
    }
  }
  // Ending: only when nothing waits, and never below what's wanted.
  if (input.oldestSharedWaitSeconds > 0 || input.onlineShared - 1 < wanted) {
    return { action: "none" }
  }
  const longest = [...input.idle]
    .filter((j) => j.idleMinutes >= input.idleMinutes)
    .sort((a, b) => b.idleMinutes - a.idleMinutes)[0]
  if (!longest) return { action: "none" }
  return {
    action: "drain",
    id: longest.id,
    reason: `Idle for ${Math.round(longest.idleMinutes)} minutes: ended by automatic scaling`,
  }
}
