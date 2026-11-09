/*
 * Early warnings: which students in a class need attention, and why, from signals worked
 * out from their work. Pure; the caller gathers the signals. Thresholds are the defaults
 * below; a student is "watch" with one reason and "risk" with two or more (or two missed).
 */

export interface WarningRules {
  /** Below this percent on finished work is low. */
  lowPercent: number
  /** Finished assignments needed before marks count as a signal. */
  minFinished: number
  /** Days without a submission, while work is open, before it's a signal. */
  quietDays: number
  /** Attendance below this percent… */
  attendancePercent: number
  /** …once this many classes have been marked. */
  minClasses: number
}

export const WARNING_RULES: WarningRules = {
  lowPercent: 40,
  minFinished: 2,
  quietDays: 7,
  attendancePercent: 75,
  minClasses: 4,
}

export interface StudentSignals {
  /** Assignments whose time is up (due, or closed for late work too). */
  finished: { earned: number; total: number; missed: boolean }[]
  /** Assignments open now that they haven't finished. */
  openUnfinished: number
  /** Their last graded or ungraded submission, if any. */
  lastActive: Date | null
  attendance: { present: number; total: number } | null
}

export type WarningReason =
  | { kind: "missed"; count: number }
  | { kind: "low"; percent: number }
  | { kind: "quiet"; days: number | null }
  | { kind: "attendance"; percent: number }

export interface Warning {
  level: "risk" | "watch" | null
  reasons: WarningReason[]
}

const DAY = 86_400_000

export function warningFor(s: StudentSignals, now: Date, rules: WarningRules = WARNING_RULES): Warning {
  const reasons: WarningReason[] = []
  const missed = s.finished.filter((f) => f.missed).length
  if (missed > 0) reasons.push({ kind: "missed", count: missed })
  if (s.finished.length >= rules.minFinished) {
    const total = s.finished.reduce((n, f) => n + f.total, 0)
    const earned = s.finished.reduce((n, f) => n + f.earned, 0)
    const percent = total > 0 ? Math.round((100 * earned) / total) : 100
    if (percent < rules.lowPercent) reasons.push({ kind: "low", percent })
  }
  if (s.openUnfinished > 0) {
    const idle = s.lastActive ? now.getTime() - s.lastActive.getTime() : null
    if (idle === null || idle >= rules.quietDays * DAY) {
      reasons.push({ kind: "quiet", days: idle === null ? null : Math.floor(idle / DAY) })
    }
  }
  if (s.attendance && s.attendance.total >= rules.minClasses) {
    const percent = Math.round((100 * s.attendance.present) / s.attendance.total)
    if (percent < rules.attendancePercent) reasons.push({ kind: "attendance", percent })
  }
  const level = reasons.length === 0 ? null : reasons.length >= 2 || missed >= 2 ? "risk" : "watch"
  return { level, reasons }
}

/** A reason in words, for teachers. */
export function describeReason(r: WarningReason): string {
  switch (r.kind) {
    case "missed":
      return r.count === 1 ? "Missed an assignment" : `Missed ${r.count} assignments`
    case "low":
      return `${r.percent}% on finished work`
    case "quiet":
      return r.days === null ? "Hasn't submitted anything yet" : `Nothing submitted in ${r.days} days`
    case "attendance":
      return `Attendance ${r.percent}%`
  }
}
