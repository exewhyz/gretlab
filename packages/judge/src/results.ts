/*
 * Rules for the Exams module (apps/web/features/results): grading scales, marks, a
 * student's result in an exam, weighting exams into a year's result, and ranks. Pure, so
 * they're unit-tested here.
 */

/** One band of a grading scale: a percentage from `min` (inclusive) earns `grade`. */
export interface GradeBand {
  min: number
  grade: string
  /** Grade points (e.g. 10 for A1), if the school uses them. */
  points?: number | null
}

/** CBSE's nine-point scale, a common default for Indian schools. */
export const DEFAULT_SCALE: GradeBand[] = [
  { min: 91, grade: "A1", points: 10 },
  { min: 81, grade: "A2", points: 9 },
  { min: 71, grade: "B1", points: 8 },
  { min: 61, grade: "B2", points: 7 },
  { min: 51, grade: "C1", points: 6 },
  { min: 41, grade: "C2", points: 5 },
  { min: 33, grade: "D", points: 4 },
  { min: 0, grade: "E", points: null },
]

export interface ResultsSettings {
  scale: GradeBand[]
}

/** The module's settings (organizations.module_settings.exams), with defaults. */
export function readExamSettings(moduleSettings: unknown): ResultsSettings {
  const raw = (moduleSettings as { exams?: { scale?: unknown } } | null)?.exams
  const scale = Array.isArray(raw?.scale) ? (raw.scale as GradeBand[]) : null
  return { scale: scale && !scaleProblem(scale) ? sortScale(scale) : DEFAULT_SCALE }
}

export const sortScale = (scale: GradeBand[]) => [...scale].sort((a, b) => b.min - a.min)

/** Why a grading scale can't be used, or null. */
export function scaleProblem(scale: GradeBand[]): string | null {
  if (scale.length < 2 || scale.length > 20) return "A scale has 2 to 20 grades."
  const grades = new Set<string>()
  const mins = new Set<number>()
  for (const b of scale) {
    const grade = typeof b.grade === "string" ? b.grade.trim() : ""
    if (!grade || grade.length > 12) return "Name every grade, in at most 12 characters."
    if (typeof b.min !== "number" || !Number.isFinite(b.min) || b.min < 0 || b.min > 100)
      return "Each grade starts at a percentage from 0 to 100."
    if (b.points != null && (typeof b.points !== "number" || b.points < 0 || b.points > 100))
      return "Grade points are a number from 0 to 100."
    if (grades.has(grade.toLowerCase())) return `"${grade}" is in the scale twice.`
    if (mins.has(b.min)) return `Two grades start at ${b.min}%.`
    grades.add(grade.toLowerCase())
    mins.add(b.min)
  }
  if (!mins.has(0)) return "The lowest grade must start at 0%."
  return null
}

/** The band a percentage falls in. */
export function bandFor(scale: GradeBand[], percent: number): GradeBand {
  const sorted = sortScale(scale)
  return sorted.find((b) => percent >= b.min) ?? sorted[sorted.length - 1]!
}

export const gradeFor = (scale: GradeBand[], percent: number) => bandFor(scale, percent).grade

/** Why a paper's full and pass marks don't work, or null. */
export function paperProblem(p: { maxMarks: number; passMarks: number }): string | null {
  if (!Number.isInteger(p.maxMarks) || p.maxMarks < 1 || p.maxMarks > 1000)
    return "Full marks are a whole number from 1 to 1000."
  if (!Number.isFinite(p.passMarks) || p.passMarks < 0 || p.passMarks > p.maxMarks)
    return "Pass marks are from 0 to the full marks."
  return null
}

/** Why a mark can't be saved, or null. Marks go in halves at most (47.5). */
export function markProblem(marks: number, maxMarks: number): string | null {
  if (!Number.isFinite(marks) || marks < 0) return "Marks can't be negative."
  if (marks > maxMarks) return `At most ${maxMarks}.`
  if (Math.round(marks * 2) !== marks * 2) return "Whole or half marks only."
  return null
}

/** One paper as it stands for one student. */
export interface PaperMark {
  maxMarks: number
  passMarks: number
  /** null: not entered yet. */
  marks: number | null
  absent: boolean
}

export type PaperOutcome = "pass" | "fail" | "absent" | "pending"

export function paperOutcome(p: PaperMark): PaperOutcome {
  if (p.absent) return "absent"
  if (p.marks == null) return "pending"
  return p.marks >= p.passMarks ? "pass" : "fail"
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface ExamSummary {
  obtained: number
  maxMarks: number
  /** One decimal; null with no papers. */
  percent: number | null
  grade: string | null
  /** incomplete: some marks aren't in yet. fail: a paper failed or missed. */
  result: "pass" | "fail" | "incomplete" | "none"
  failed: number
}

/** A student's result over their papers in one exam. An absence counts as 0 and a fail. */
export function summarize(papers: PaperMark[], scale: GradeBand[]): ExamSummary {
  if (papers.length === 0)
    return { obtained: 0, maxMarks: 0, percent: null, grade: null, result: "none", failed: 0 }
  const outcomes = papers.map(paperOutcome)
  const obtained = papers.reduce((s, p) => s + (p.absent ? 0 : (p.marks ?? 0)), 0)
  const maxMarks = papers.reduce((s, p) => s + p.maxMarks, 0)
  const percent = round1((100 * obtained) / maxMarks)
  const failed = outcomes.filter((o) => o === "fail" || o === "absent").length
  const result = outcomes.includes("pending") ? "incomplete" : failed ? "fail" : "pass"
  return { obtained, maxMarks, percent, grade: gradeFor(scale, percent), result, failed }
}

/**
 * A weighted percentage over several exams (the year's result): each exam that counts
 * (weight > 0) and that the student has a percentage in. Weights are relative, so 30 and
 * 70 work as well as 3 and 7; an exam the student has no papers in drops out and the rest
 * are scaled up. null when nothing counts.
 */
export function weighted(parts: { weight: number; percent: number | null }[]): number | null {
  const counted = parts.filter((p) => p.weight > 0 && p.percent != null)
  const total = counted.reduce((s, p) => s + p.weight, 0)
  if (total === 0) return null
  return round1(counted.reduce((s, p) => s + p.weight * p.percent!, 0) / total)
}

/** Competition ranks (1, 2, 2, 4) by score, highest first; those without a score get none. */
export function ranks(scores: { id: string; score: number | null }[]): Map<string, number> {
  const scored = scores
    .filter((s): s is { id: string; score: number } => s.score != null)
    .sort((a, b) => b.score - a.score)
  const out = new Map<string, number>()
  scored.forEach((s, i) => {
    const prev = scored[i - 1]
    out.set(s.id, prev && prev.score === s.score ? out.get(prev.id)! : i + 1)
  })
  return out
}

/** Why an exam can't be saved, or null. */
export function examProblem(e: {
  name: string
  startsOn: string | null
  endsOn: string | null
  weight: number
}): string | null {
  const name = e.name.trim()
  if (name.length < 2 || name.length > 60) return "Name the exam in 2 to 60 characters."
  if (!Number.isInteger(e.weight) || e.weight < 0 || e.weight > 100)
    return "The weight is a whole number from 0 to 100."
  if (e.startsOn && e.endsOn && e.endsOn < e.startsOn) return "The exam can't end before it starts."
  return null
}
