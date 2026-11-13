/*
 * Attendance rules (the Attendance module; marks live in `attendance`, one row per student
 * per register or logged class). Late counts as there; excused is left out of percentages
 * so a sick note never lowers anyone's figure.
 */

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "excused",
] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const isAttendanceStatus = (value: string): value is AttendanceStatus =>
  (ATTENDANCE_STATUSES as readonly string[]).includes(value)

/** Whether a mark counts as being there. */
export const countsAsPresent = (status: AttendanceStatus) =>
  status === "present" || status === "late"

export interface AttendanceSummary {
  present: number
  late: number
  absent: number
  excused: number
  /** Marks that count toward the percentage (all but excused). */
  counted: number
  /** Present or late out of counted, rounded; null with nothing counted. */
  percent: number | null
}

export function summarizeAttendance(
  statuses: readonly AttendanceStatus[]
): AttendanceSummary {
  const n = (s: AttendanceStatus) => statuses.filter((x) => x === s).length
  const present = n("present")
  const late = n("late")
  const absent = n("absent")
  const excused = n("excused")
  const counted = present + late + absent
  return {
    present,
    late,
    absent,
    excused,
    counted,
    percent: counted ? Math.round((100 * (present + late)) / counted) : null,
  }
}

/* ---------- the minimum to sit exams (colleges' 75% rule) ---------- */

export interface AttendanceSettings {
  /** The least attendance, in percent, to be eligible for the end-of-term exams. */
  minPercent: number
}

/** The module's settings (organizations.module_settings.attendance), with defaults. */
export function readAttendanceSettings(
  moduleSettings: unknown
): AttendanceSettings {
  const raw = (
    moduleSettings as { attendance?: { minPercent?: unknown } } | null
  )?.attendance
  const min = raw?.minPercent
  return {
    minPercent:
      typeof min === "number" && Number.isInteger(min) && min >= 0 && min <= 100
        ? min
        : 75,
  }
}

export type Eligibility = "eligible" | "at_risk" | "short" | "none"

/** Eligible, at risk (within five points above the minimum), short of it, or nothing taken yet. */
export function eligibility(
  percent: number | null,
  minPercent: number
): Eligibility {
  if (percent == null) return "none"
  if (percent < minPercent) return "short"
  return percent < minPercent + 5 ? "at_risk" : "eligible"
}

/**
 * How many classes in a row someone must attend to reach the minimum from here: the least
 * k with (present + k) / (counted + k) ≥ min. 0 when already there; null when it can't be
 * reached (a minimum of 100% after missing one).
 */
export function classesToReach(
  present: number,
  counted: number,
  minPercent: number
) {
  if (counted === 0 || 100 * present >= minPercent * counted) return 0
  if (minPercent >= 100) return null
  return Math.ceil((minPercent * counted - 100 * present) / (100 - minPercent))
}
