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
