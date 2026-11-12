/*
 * Rules for the Staff attendance module (apps/web/features/staff-attendance): statuses, a
 * self check-in counting as late after the school's time, the module's settings, and a
 * person's month in numbers. Pure, so they're unit-tested here.
 */

export const STAFF_STATUSES = ["present", "late", "half_day", "absent", "on_leave"] as const
export type StaffStatus = (typeof STAFF_STATUSES)[number]

export interface StaffAttendanceSettings {
  /** "HH:MM": checking in after this is late. */
  lateAfter: string
  /** Staff may check themselves in, today only. */
  selfCheckIn: boolean
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const DEFAULT_STAFF_ATTENDANCE: StaffAttendanceSettings = {
  lateAfter: "09:00",
  selfCheckIn: true,
}

/** The module's settings (organizations.module_settings.staffAttendance), with defaults. */
export function readStaffAttendanceSettings(moduleSettings: unknown): StaffAttendanceSettings {
  const raw = (moduleSettings as { staffAttendance?: Partial<StaffAttendanceSettings> } | null)
    ?.staffAttendance
  return {
    lateAfter:
      typeof raw?.lateAfter === "string" && TIME.test(raw.lateAfter)
        ? raw.lateAfter
        : DEFAULT_STAFF_ATTENDANCE.lateAfter,
    selfCheckIn:
      typeof raw?.selfCheckIn === "boolean" ? raw.selfCheckIn : DEFAULT_STAFF_ATTENDANCE.selfCheckIn,
  }
}

export const validTime = (t: string) => TIME.test(t)

/** The time ("HH:MM", 24-hour) in a timezone. */
export function timeIn(timeZone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${get("hour")}:${get("minute")}`
}

/** A check-in's status: late after the school's time (a minute after counts). */
export const checkInStatus = (time: string, lateAfter: string): StaffStatus =>
  time > lateAfter ? "late" : "present"

/** A month in numbers. Leave is left out of the percentage; a half day counts half. */
export function summarizeStaff(statuses: StaffStatus[]) {
  const n = (s: StaffStatus) => statuses.filter((x) => x === s).length
  const present = n("present")
  const late = n("late")
  const half = n("half_day")
  const absent = n("absent")
  const leave = n("on_leave")
  const counted = present + late + half + absent
  return {
    present,
    late,
    half,
    absent,
    leave,
    marked: statuses.length,
    percent: counted ? Math.round((1000 * (present + late + half / 2)) / counted) / 10 : null,
  }
}
