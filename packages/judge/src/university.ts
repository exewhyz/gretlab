/**
 * Universities and their affiliated colleges (the owner's decisions, 27 November 2026;
 * apps/web/features/university). A college asks to affiliate; the university approves it with
 * a college code, or refuses; an active affiliation can end. While it's active, the university
 * sets the college's syllabus, registers its students, holds the university exams and sees
 * its academics, never its fees, parents or staff. Pure and unit-tested.
 */

import { bandFor, sgpa, sortScale, type GradeBand } from "./results.ts"

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

/** A student's registration with the university, asked for by their college. */
export const REGISTRATION_STATUSES = ["requested", "approved", "rejected", "cancelled"] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]
export type RegistrationAction = "approve" | "reject" | "cancel"

const REGISTRATION_MOVES: Record<RegistrationAction, RegistrationStatus> = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
}

/** Where a registration goes: only a waiting one is decided or cancelled. */
export function registrationNext(
  from: RegistrationStatus,
  action: RegistrationAction
): { ok: true; status: RegistrationStatus } | { ok: false; problem: string } {
  if (from === "requested") return { ok: true, status: REGISTRATION_MOVES[action] }
  return { ok: false, problem: "Only a registration still waiting can be decided or cancelled." }
}

/** "FC1" + 2026 + 0007: the college code, the admission year, a sequence of at least 4 digits. */
export function registrationNumber(collegeCode: string, year: number, sequence: number) {
  return `${collegeCode}${year}${String(sequence).padStart(4, "0")}`
}

/** Why an admission year can't be used, or null. */
export function admissionYearProblem(year: number): string | null {
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? null
    : "An admission year is from 2000 to 2100."
}

/* ---------- university exams and results ---------- */

/** One student's marks in one course of a university exam (null: not entered yet). */
export interface UniversityMarks {
  internal: number | null
  external: number | null
  /** Absent from the university's exam. */
  absent: boolean
}

export type CourseOutcome = "pass" | "fail" | "absent" | "pending"

/**
 * A course's result: internal plus external out of both maximums, graded on the university's
 * scale. It passes only with the external pass mark and the total pass mark; otherwise (or
 * absent) it takes the scale's lowest grade and 0 points, a backlog. Missing marks wait.
 */
export function courseResult(
  course: SyllabusMarks,
  marks: UniversityMarks,
  scale: GradeBand[]
): { total: number | null; percent: number | null; outcome: CourseOutcome; grade: string | null; points: number | null } {
  const lowest = sortScale(scale).at(-1)!
  if (marks.absent)
    return { total: marks.internal ?? 0, percent: null, outcome: "absent", grade: lowest.grade, points: 0 }
  const internal = course.internalMax === 0 ? 0 : marks.internal
  if (internal == null || marks.external == null)
    return { total: null, percent: null, outcome: "pending", grade: null, points: null }
  const total = internal + marks.external
  const percent = Math.round((total / (course.internalMax + course.externalMax)) * 10000) / 100
  const passed = marks.external >= course.passExternal && total >= course.passTotal
  if (!passed) return { total, percent, outcome: "fail", grade: lowest.grade, points: 0 }
  const band = bandFor(scale, percent)
  return { total, percent, outcome: "pass", grade: band.grade, points: band.points ?? 0 }
}

/** A semester's result once every course has one: SGPA, credits, earned, backlogs. */
export function semesterResult(courses: { credits: number; points: number | null; outcome: CourseOutcome }[]) {
  if (courses.length === 0 || courses.some((c) => c.outcome === "pending"))
    return { complete: false as const, sgpa: null, credits: 0, earned: 0, backlogs: 0 }
  const s = sgpa(courses)
  return {
    complete: true as const,
    sgpa: s?.sgpa ?? null,
    credits: s?.credits ?? 0,
    earned: s?.earned ?? 0,
    backlogs: s?.backlogs ?? 0,
  }
}

/** One line of an external marks file. */
export interface ExternalMarkRow {
  line: number
  regNo: string
  code: string
  marks: number | null
  absent: boolean
}

/**
 * External marks from CSV text: registration number, course code, marks (or AB for absent),
 * one per line; a header line is skipped. Codes and numbers are matched in capitals.
 */
export function parseExternalMarks(text: string) {
  const rows: ExternalMarkRow[] = []
  const problems: { line: number; problem: string }[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim()) return
    const cells = raw.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    if (line === 1 && /registration/i.test(cells[0] ?? "")) return
    const [regNo, code, mark] = cells
    if (!regNo || !code || !mark) {
      problems.push({ line, problem: "Each line needs a registration number, a course code and marks." })
      return
    }
    const absent = /^ab$/i.test(mark)
    const marks = absent ? null : Number(mark)
    if (!absent && (mark === "" || !Number.isFinite(marks))) {
      problems.push({ line, problem: "Marks are a number or AB." })
      return
    }
    rows.push({ line, regNo: regNo.toUpperCase(), code: code.toUpperCase(), marks, absent })
  })
  return { rows, problems }
}
