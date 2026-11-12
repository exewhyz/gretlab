/*
 * Timetable rules (the Timetable module): which days a week has classes, period times, and
 * the clash a timetable must never have: one teacher in two places at once.
 */

export const WEEKDAYS = [
  { day: 1, short: "Mon", name: "Monday" },
  { day: 2, short: "Tue", name: "Tuesday" },
  { day: 3, short: "Wed", name: "Wednesday" },
  { day: 4, short: "Thu", name: "Thursday" },
  { day: 5, short: "Fri", name: "Friday" },
  { day: 6, short: "Sat", name: "Saturday" },
  { day: 7, short: "Sun", name: "Sunday" },
] as const

export const DEFAULT_SCHOOL_DAYS = [1, 2, 3, 4, 5]

export interface TimetableSettings {
  /** School days, 1 = Monday ... 7 = Sunday, in order. */
  days: number[]
}

/** The timetable's settings from an org's module settings; anything invalid falls back. */
export function readTimetableSettings(moduleSettings: unknown): TimetableSettings {
  const raw = (moduleSettings as { timetable?: { days?: unknown } } | null)?.timetable
  const days = Array.isArray(raw?.days)
    ? [...new Set(raw.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
    : []
  return { days: days.length ? days : DEFAULT_SCHOOL_DAYS }
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** A 24-hour "HH:MM" time. */
export const isTime = (value: string) => TIME.test(value)

/** Minutes since midnight of an "HH:MM" time. */
export const minutesOf = (value: string) => {
  const [h, m] = value.split(":").map(Number)
  return h! * 60 + m!
}

/** A period's times are valid and in order. */
export const validPeriod = (starts: string, ends: string) =>
  isTime(starts) && isTime(ends) && minutesOf(starts) < minutesOf(ends)

export interface PlacedSlot {
  groupId: string
  day: number
  periodId: string
  teacherId: string | null
}

/**
 * Whether putting `candidate` in place clashes with a teacher already teaching elsewhere in
 * the same day and period. The candidate's own cell (same group, day, period) is replaced,
 * so it never clashes with itself. Returns the clashing slot, or null.
 */
export function teacherClash(
  existing: readonly PlacedSlot[],
  candidate: PlacedSlot
): PlacedSlot | null {
  if (!candidate.teacherId) return null
  return (
    existing.find(
      (s) =>
        s.teacherId === candidate.teacherId &&
        s.day === candidate.day &&
        s.periodId === candidate.periodId &&
        s.groupId !== candidate.groupId
    ) ?? null
  )
}
