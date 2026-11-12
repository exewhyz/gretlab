/*
 * Rules for the Leave module (apps/web/features/leave): leave types and allowances, how
 * many school days a request takes, what a request may ask for, and balances. Pure, so
 * they're unit-tested here.
 */

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]

/** Why a student is away. */
export const STUDENT_LEAVE_TYPES = [
  { key: "sick", name: "Sick" },
  { key: "family", name: "Family" },
  { key: "event", name: "Competition or event" },
  { key: "other", name: "Other" },
] as const

/** A kind of staff leave; `days` a year, or null for no limit. */
export interface LeaveType {
  key: string
  name: string
  days: number | null
}

export const DEFAULT_STAFF_LEAVE_TYPES: LeaveType[] = [
  { key: "casual", name: "Casual leave", days: 12 },
  { key: "sick", name: "Sick leave", days: 10 },
  { key: "earned", name: "Earned leave", days: 15 },
  { key: "unpaid", name: "Unpaid leave", days: null },
]

/** The module's settings (organizations.module_settings.leave), with defaults. */
export function readLeaveSettings(moduleSettings: unknown): { types: LeaveType[] } {
  const raw = (moduleSettings as { leave?: { types?: unknown } } | null)?.leave
  const types = Array.isArray(raw?.types) ? (raw.types as LeaveType[]) : null
  return { types: types && !leaveTypesProblem(types) ? types : DEFAULT_STAFF_LEAVE_TYPES }
}

/** A short key from a name: "Maternity leave" → "maternity-leave". */
export const leaveKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)

/** Why a list of staff leave types can't be used, or null. */
export function leaveTypesProblem(types: LeaveType[]): string | null {
  if (types.length < 1 || types.length > 20) return "Have 1 to 20 kinds of leave."
  const keys = new Set<string>()
  for (const t of types) {
    const name = typeof t.name === "string" ? t.name.trim() : ""
    if (!name || name.length > 40) return "Name every kind of leave, in at most 40 characters."
    if (!t.key || !/^[a-z0-9-]{1,30}$/.test(t.key)) return `"${name}" needs a short key.`
    if (keys.has(t.key)) return `"${name}" is there twice.`
    if (t.days != null && (!Number.isInteger(t.days) || t.days < 0 || t.days > 365))
      return `Days for "${name}" are a whole number up to 365, or blank for no limit.`
    keys.add(t.key)
  }
  return null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MS = 86_400_000
const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const isoWeekday = (ms: number) => ((new Date(ms).getUTCDay() + 6) % 7) + 1

/** The school days (ISO weekdays, 1 = Monday) from start to end, as "YYYY-MM-DD". */
export function schoolDaysBetween(startsOn: string, endsOn: string, schoolDays: number[]) {
  const out: string[] = []
  for (let t = toMs(startsOn); t <= toMs(endsOn); t += MS) {
    if (schoolDays.includes(isoWeekday(t))) out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** How many school days a request takes: a half day is 0.5. */
export function leaveDays(
  r: { startsOn: string; endsOn: string; halfDay: boolean },
  schoolDays: number[]
) {
  const n = schoolDaysBetween(r.startsOn, r.endsOn, schoolDays).length
  return r.halfDay ? Math.min(n, 1) / 2 : n
}

/** Why a request can't be made, or null. Leave may be asked for up to 30 days afterwards. */
export function leaveProblem(
  r: { startsOn: string; endsOn: string; halfDay: boolean; reason: string },
  today: string,
  schoolDays: number[]
): string | null {
  if (!DAY.test(r.startsOn) || !DAY.test(r.endsOn)) return "Give the first and last day."
  if (r.endsOn < r.startsOn) return "The last day can't be before the first."
  if ((toMs(r.endsOn) - toMs(r.startsOn)) / MS >= 90) return "Ask for at most 90 days at once."
  if (r.halfDay && r.startsOn !== r.endsOn) return "A half day is a single day."
  if ((toMs(today) - toMs(r.startsOn)) / MS > 30) return "Leave can be asked for at most 30 days afterwards."
  if (r.reason.trim().length > 500) return "Keep the reason to 500 characters."
  if (leaveDays(r, schoolDays) === 0) return "Those are all days off."
  return null
}

/** Whether two requests share a day. */
export const leaveOverlaps = (
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string }
) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn

/** Each kind of leave with what's been used (approved and waiting) and what's left. */
export function leaveBalances(types: LeaveType[], used: Map<string, number>) {
  return types.map((t) => {
    const u = used.get(t.key) ?? 0
    return { ...t, used: u, left: t.days == null ? null : Math.max(0, t.days - u) }
  })
}
