/*
 * Rules for the Admissions module (apps/web/features/admissions): an application's path,
 * the module's settings, what an application must say, and application numbers. Pure, so
 * they're unit-tested here.
 */

export const APPLICATION_STATUSES = [
  "submitted",
  "reviewing",
  "waitlisted",
  "rejected",
  "admitted",
  "withdrawn",
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/** Still being decided: the office can move it, the applicant can withdraw it. */
export const OPEN_STATUSES: ApplicationStatus[] = ["submitted", "reviewing", "waitlisted"]

/** Where the office may move an application (admitting is its own step). */
export function canMoveTo(from: ApplicationStatus, to: ApplicationStatus) {
  if (!OPEN_STATUSES.includes(from)) return false
  return to === "reviewing" || to === "waitlisted" || to === "rejected"
    ? to !== from
    : false
}

export interface AdmissionSettings {
  open: boolean
  /** The academic year applications are for. */
  yearId: string | null
  /** Grades (top-level groups) taking applications; empty: all. */
  gradeIds: string[]
  /** Shown above the form: documents to bring, dates, fees. */
  instructions: string
}

export const DEFAULT_ADMISSIONS: AdmissionSettings = {
  open: false,
  yearId: null,
  gradeIds: [],
  instructions: "",
}

/** The module's settings (organizations.module_settings.admissions), with defaults. */
export function readAdmissionSettings(moduleSettings: unknown): AdmissionSettings {
  const raw = (moduleSettings as { admissions?: Partial<AdmissionSettings> } | null)?.admissions
  return {
    open: raw?.open === true,
    yearId: typeof raw?.yearId === "string" ? raw.yearId : null,
    gradeIds: Array.isArray(raw?.gradeIds)
      ? raw.gradeIds.filter((g): g is string => typeof g === "string")
      : [],
    instructions: typeof raw?.instructions === "string" ? raw.instructions.slice(0, 2000) : "",
  }
}

/** Whole years old on a day. */
export function ageOn(birthDate: string, day: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number]
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const PHONE = /^[+\d][\d\s()-]{6,19}$/

/** Why an application can't be sent, or null. */
export function applicationProblem(
  a: { studentName: string; birthDate: string; phone: string; parentName: string },
  today: string
): string | null {
  if (a.studentName.trim().length < 2) return "Give the student's full name."
  if (!DAY.test(a.birthDate) || Number.isNaN(Date.parse(a.birthDate))) return "Give the date of birth."
  if (a.birthDate >= today) return "The date of birth must be in the past."
  const age = ageOn(a.birthDate, today)
  if (age < 2 || age > 60) return "Check the date of birth."
  if (a.parentName.trim().length < 2) return "Give the parent's or guardian's name."
  if (!PHONE.test(a.phone.trim())) return "Give a phone number to reach you on."
  return null
}

/** "APP-2026-0007": the year's prefix and the next number after the highest used. */
export function nextApplicationNo(year: number, used: string[]) {
  const prefix = `APP-${year}-`
  const top = used
    .filter((u) => u.startsWith(prefix))
    .map((u) => Number(u.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}${String(top + 1).padStart(4, "0")}`
}
