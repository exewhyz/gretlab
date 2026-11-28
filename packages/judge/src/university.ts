/**
 * Universities and their affiliated colleges (the owner's decisions, 27 November 2026;
 * apps/web/features/university). A college asks to affiliate; the university approves it with
 * a college code, or refuses; an active affiliation can end. While it's active, the university
 * sets the college's syllabus, registers its students, holds the university exams and sees
 * its academics, never its fees, parents or staff. Pure and unit-tested.
 */

export const AFFILIATION_STATUSES = [
  "requested",
  "active",
  "refused",
  "withdrawn",
  "ended",
] as const
export type AffiliationStatus = (typeof AFFILIATION_STATUSES)[number]
export type AffiliationAction = "request" | "approve" | "refuse" | "withdraw" | "end"

const MOVES: Record<AffiliationAction, [AffiliationStatus | null, AffiliationStatus][]> = {
  request: [
    [null, "requested"],
    ["refused", "requested"],
    ["withdrawn", "requested"],
    ["ended", "requested"],
  ],
  approve: [["requested", "active"]],
  refuse: [["requested", "refused"]],
  withdraw: [["requested", "withdrawn"]],
  end: [["active", "ended"]],
}

/** Where an affiliation goes on an action, from where it is (null: never asked). */
export function affiliationNext(
  from: AffiliationStatus | null,
  action: AffiliationAction
): { ok: true; status: AffiliationStatus } | { ok: false; problem: string } {
  const move = MOVES[action].find(([a]) => a === from)
  if (move) return { ok: true, status: move[1] }
  if (action === "request" && from === "active")
    return { ok: false, problem: "This college is already affiliated to a university." }
  if (action === "request" && from === "requested")
    return { ok: false, problem: "This college has already asked to affiliate." }
  return { ok: false, problem: "That can't be done to this affiliation now." }
}

export function normalizeCollegeCode(text: string) {
  return text.trim().toUpperCase()
}

/** Why a college code can't be used, or null. */
export function collegeCodeProblem(code: string): string | null {
  return /^[A-Z0-9]{2,10}$/.test(code)
    ? null
    : "A college code is 2 to 10 letters and digits."
}

/** A course in a university program's semester: how it's marked. */
export interface SyllabusMarks {
  /** Marked by the college (sessionals, assignments, labs). */
  internalMax: number
  /** Marked by the university (the end-semester exam). */
  externalMax: number
  /** The least in the university's exam to pass. */
  passExternal: number
  /** The least in all to pass. */
  passTotal: number
}

/** Why a syllabus course's marks can't be used, or null. */
export function syllabusCourseProblem(m: SyllabusMarks): string | null {
  const all = [m.internalMax, m.externalMax, m.passExternal, m.passTotal]
  if (all.some((n) => !Number.isInteger(n) || n < 0)) return "Marks are whole numbers."
  if (m.internalMax + m.externalMax === 0) return "A course is out of more than 0 marks."
  if (m.internalMax > 1000 || m.externalMax > 1000) return "A course is out of at most 1,000 marks."
  if (m.passExternal > m.externalMax)
    return "The external pass mark can't be more than the external marks."
  if (m.passTotal > m.internalMax + m.externalMax)
    return "The pass mark can't be more than the course's total."
  return null
}

export const MAX_SEMESTERS = 12

/** Why a semester number can't be used, or null. */
export function semesterProblem(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= MAX_SEMESTERS ? null : "A semester is 1 to 12."
}
