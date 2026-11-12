/*
 * Rules for the Student records module (apps/web/features/records): academic years,
 * admission numbers, enrolment statuses, and the addresses of students who don't sign in.
 * Pure, so they're unit-tested here.
 */

export const ENROLMENT_STATUSES = ["active", "transferred", "graduated", "withdrawn"] as const
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number]

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Why an academic year can't be saved, or null. */
export function yearProblem(input: { name: string; startsOn: string; endsOn: string }) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 40) return "Give the year a name of 2 to 40 characters, like 2026-2027."
  if (!DAY.test(input.startsOn) || !DAY.test(input.endsOn)) return "Give a start and end date."
  if (input.endsOn <= input.startsOn) return "The year must end after it starts."
  return null
}

/** Whether two years' dates overlap (they share at least one day). */
export const yearsOverlap = (
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string }
) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn

/**
 * The next admission number after the ones in use: the highest number with this prefix
 * plus one, four digits at least ("GF-2026-0007" after "GF-2026-0006").
 */
export function nextAdmissionNo(prefix: string, used: readonly string[]) {
  let top = 0
  for (const no of used) {
    if (!no.startsWith(prefix)) continue
    const n = Number(no.slice(prefix.length))
    if (Number.isInteger(n) && n > top) top = n
  }
  return `${prefix}${String(top + 1).padStart(4, "0")}`
}

/** A school's admission prefix: its first letters and the year, "GF-2026-". */
export function admissionPrefix(orgName: string, year: number) {
  const letters = orgName
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 3)
  return `${letters || "S"}-${year}-`
}

/**
 * Students who don't sign in (young children) still have an account so every part of
 * the app works for them; its address is on the reserved .invalid domain, so it can't
 * sign in with Google and is never emailed.
 */
export const NO_LOGIN_DOMAIN = "students.gretlab.invalid"

export const noLoginEmail = (id: string) => `no-login+${id}@${NO_LOGIN_DOMAIN}`

export const isNoLoginEmail = (email: string) => email.toLowerCase().endsWith(".invalid")

/* ---------- promotion ---------- */

export interface TreeGroup {
  id: string
  name: string
  parentId: string | null
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })

/**
 * Where each section's students go next year: the same-named section of the next group
 * at its parent's level ("Grade 3 › A" → "Grade 4 › A", grades in natural order), or
 * "graduate" when there's no next one (the top grade). A section whose next grade has no
 * section of that name goes to that grade's first section. A section without a parent
 * (no grades) stays where it is.
 */
export function suggestPromotion(groups: readonly TreeGroup[], sectionIds: readonly string[]) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const childrenOf = (id: string | null) =>
    groups.filter((g) => g.parentId === id).sort((a, b) => natural(a.name, b.name))
  const out: Record<string, string> = {}
  for (const id of sectionIds) {
    const section = byId.get(id)
    if (!section) continue
    if (!section.parentId) {
      out[id] = id
      continue
    }
    const grade = byId.get(section.parentId)!
    const grades = childrenOf(grade.parentId)
    const next = grades[grades.findIndex((g) => g.id === grade.id) + 1]
    if (!next) {
      out[id] = "graduate"
      continue
    }
    const sections = childrenOf(next.id)
    const same = sections.find((s) => s.name.toLowerCase() === section.name.toLowerCase())
    out[id] = (same ?? sections[0] ?? next).id
  }
  return out
}
