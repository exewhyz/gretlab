import {
  assignmentExtensions,
  assignmentProblems,
  assignmentQuestions,
  assignments,
  getDb,
  organizations,
  problems,
  questions as questionBank,
  quizResponses,
  rubricMarks,
  sql,
  submissions,
  type Assignment,
  type User,
} from "@workspace/db"
import {
  duringSitting,
  extendedDue,
  gradeProblem,
  markQuestion,
  personalDue,
  rubricEarned,
  rubricTotal,
  sittingClosesAt,
  type Extension,
  type GradedAttempt,
  type RubricCriterion,
} from "@workspace/judge"

import { type Sitting } from "@/features/exams/sittings"
import { accessTo, viewpoint } from "@/features/orgs/access"
import { notFound } from "@/lib/api/route"

const { and, asc, eq, gte, inArray, isNull } = sql

export type AssignmentPhase = "upcoming" | "open" | "late" | "closed"

export function phaseOf(
  assignment: Assignment,
  now = new Date()
): AssignmentPhase {
  if (now < assignment.opensAt) return "upcoming"
  if (now <= assignment.dueAt) return "open"
  return assignment.allowLate ? "late" : "closed"
}

export interface Item {
  assignmentId: string
  problemId: string
  slug: string
  title: string
  level: string
  points: number
  rubric: RubricCriterion[]
  outcomes: string[]
  membersOnly: boolean
  orgSlug: string | null
}

export async function itemsOf(assignmentIds: string[]): Promise<Item[]> {
  if (assignmentIds.length === 0) return []
  return getDb()
    .select({
      assignmentId: assignmentProblems.assignmentId,
      problemId: assignmentProblems.problemId,
      slug: problems.slug,
      title: problems.title,
      level: problems.level,
      points: assignmentProblems.points,
      rubric: assignmentProblems.rubric,
      outcomes: assignmentProblems.outcomes,
      membersOnly: problems.membersOnly,
      orgSlug: organizations.slug,
    })
    .from(assignmentProblems)
    .innerJoin(problems, eq(assignmentProblems.problemId, problems.id))
    .leftJoin(organizations, eq(problems.orgId, organizations.id))
    .where(inArray(assignmentProblems.assignmentId, assignmentIds))
    .orderBy(asc(assignmentProblems.position))
}

export type Attempt = GradedAttempt & { userId: string; problemId: string }

/** Graded submissions on these problems since a time, for one student or everyone. */
export async function attemptsOn(
  problemIds: string[],
  since: Date,
  userId?: string
): Promise<Attempt[]> {
  if (problemIds.length === 0) return []
  const rows = await getDb()
    .select({
      userId: submissions.userId,
      problemId: submissions.problemId,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        inArray(submissions.problemId, problemIds),
        gte(submissions.createdAt, since),
        userId ? eq(submissions.userId, userId) : undefined
      )
    )
  return rows.filter((row): row is Attempt => row.problemId !== null)
}

/** Hand marks by problem, for one student on one assignment. */
export type Marks = Map<string, Record<string, number>>

/**
 * One student's marks on each problem of one assignment: the tests' marks from their
 * attempts, plus any rubric marks a teacher gave (`marks`; leave it out while feedback is
 * held). A problem is out of its test points plus its rubric's.
 */
export function grade(
  assignment: Assignment,
  items: Item[],
  attempts: Attempt[],
  marks?: Marks,
  /** For an exam, the student's sitting: only work during it counts, none without one. */
  sitting?: Sitting,
  /** A later due date for this student, for some or all problems. */
  extension?: Extension
) {
  const counted = assignment.exam ? duringSitting(attempts, sitting) : attempts
  // A sitting can run past the due time when a teacher gives more time.
  const rules =
    assignment.exam && sitting
      ? { ...assignment, dueAt: sittingClosesAt(sitting), allowLate: false }
      : assignment
  const cells = items.map((item) => {
    const tests = gradeProblem(
      item.points,
      counted.filter((a) => a.problemId === item.problemId),
      // An exam's time is its sitting; elsewhere an extension moves the due time.
      assignment.exam
        ? rules
        : {
            ...rules,
            dueAt: extendedDue(rules.dueAt, extension, item.problemId),
          }
    )
    // An exam nobody sat earns nothing, hand marks included.
    const byHand =
      assignment.exam && !sitting
        ? null
        : rubricEarned(item.rubric, marks?.get(item.problemId))
    return {
      problemId: item.problemId,
      ...tests,
      tests: tests.earned,
      byHand,
      earned: round(tests.earned + (byHand ?? 0)),
      max: item.points + rubricTotal(item.rubric),
    }
  })
  return {
    cells,
    earned: round(cells.reduce((sum, cell) => sum + cell.earned, 0)),
    total: cells.reduce((sum, cell) => sum + cell.max, 0),
    solved: cells.filter((cell) => cell.status === "solved").length,
  }
}

export type Question = Awaited<ReturnType<typeof questionsOf>>[number]

export type QuizResponse = typeof quizResponses.$inferSelect

/** A student's quiz marks: each question, the total, and how many wait for the teacher. */
export function gradeQuiz(questions: Question[], response?: QuizResponse) {
  const per = questions.map((q) => ({
    questionId: q.id,
    ...markQuestion(q, response?.answers[q.id], response?.marks[q.id]),
  }))
  return {
    per,
    earned: round(per.reduce((t, m) => t + (m.earned ?? 0), 0)),
    max: questions.reduce((t, q) => t + q.points, 0),
    needsMarking: per.filter((m) => m.needsMarking).length,
  }
}

/**
 * When a student sees their quiz marks and the right answers: once their time is up (an
 * exam: their sitting ended), unless the teacher holds results to release them later.
 */
export function quizResultsOut(
  assignment: Assignment,
  now: Date,
  extension?: Extension,
  sitting?: Sitting
) {
  if (assignment.holdFeedback) return false
  if (assignment.exam && sitting) return now >= sittingClosesAt(sitting)
  return now > personalDue(assignment.dueAt, extension)
}

/** Extensions on these assignments, for one student or everyone, by assignment then student. */
export async function extensionsOn(assignmentIds: string[], userId?: string) {
  const byAssignment = new Map<
    string,
    Map<string, Extension & { reason: string }>
  >()
  if (assignmentIds.length === 0) return byAssignment
  const rows = await getDb()
    .select()
    .from(assignmentExtensions)
    .where(
      and(
        inArray(assignmentExtensions.assignmentId, assignmentIds),
        userId ? eq(assignmentExtensions.userId, userId) : undefined
      )
    )
  for (const row of rows) {
    const own = byAssignment.get(row.assignmentId) ?? new Map()
    own.set(row.userId, row)
    byAssignment.set(row.assignmentId, own)
  }
  return byAssignment
}

/** The assignment as one student sees it: closing at their extended due time. */
export const personally = (assignment: Assignment, extension?: Extension) => ({
  ...assignment,
  dueAt: personalDue(assignment.dueAt, extension),
})

/** Rubric marks on these assignments, for one student or everyone, by student then problem. */
export async function marksOn(assignmentIds: string[], userId?: string) {
  const byUser = new Map<string, Map<string, Marks>>()
  if (assignmentIds.length === 0) return byUser
  const rows = await getDb()
    .select()
    .from(rubricMarks)
    .where(
      and(
        inArray(rubricMarks.assignmentId, assignmentIds),
        userId ? eq(rubricMarks.userId, userId) : undefined
      )
    )
  for (const row of rows) {
    const byAssignment = byUser.get(row.userId) ?? new Map<string, Marks>()
    const marks = byAssignment.get(row.assignmentId) ?? new Map()
    marks.set(row.problemId, row.marks)
    byAssignment.set(row.assignmentId, marks)
    byUser.set(row.userId, byAssignment)
  }
  return byUser
}

export const round = (value: number) => Math.round(value * 100) / 100

/** The assignment and what this person may do with it; one they can't take is not found. */
export async function findAssignment(slug: string, viewer: User) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(eq(assignments.slug, slug))
  const vp = await viewpoint(viewer)
  const access = assignment
    ? accessTo(vp, assignment, "assignments.manage")
    : "none"
  if (
    !assignment ||
    access === "none" ||
    (!assignment.published && access !== "manage")
  ) {
    throw notFound("Assignment not found")
  }
  return { assignment, access, vp }
}

export async function countProblems(assignmentId: string) {
  const [row] = await getDb()
    .select({ n: sql.count() })
    .from(assignmentProblems)
    .where(eq(assignmentProblems.assignmentId, assignmentId))
  return row?.n ?? 0
}

export const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)

/**
 * The chosen problems as the form's picker lists them, so problems it can't pick any more
 * (a template's shared ones, or sharing taken back) still show their titles.
 */
export async function chosenProblems(ids: string[]) {
  if (ids.length === 0) return []
  return getDb()
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      level: problems.level,
      position: problems.position,
      unitId: problems.unitId,
      published: problems.published,
      listed: problems.listed,
    })
    .from(problems)
    .where(inArray(problems.id, ids))
}

/** Quiz questions of these assignments, in order, with their points there. */
export function questionsOf(assignmentIds: string[]) {
  if (assignmentIds.length === 0) return Promise.resolve([])
  return getDb()
    .select({
      assignmentId: assignmentQuestions.assignmentId,
      id: questionBank.id,
      title: questionBank.title,
      kind: questionBank.kind,
      prompt: questionBank.prompt,
      options: questionBank.options,
      correct: questionBank.correct,
      accepted: questionBank.accepted,
      explanation: questionBank.explanation,
      points: assignmentQuestions.points,
    })
    .from(assignmentQuestions)
    .innerJoin(
      questionBank,
      eq(assignmentQuestions.questionId, questionBank.id)
    )
    .where(inArray(assignmentQuestions.assignmentId, assignmentIds))
    .orderBy(asc(assignmentQuestions.position))
}

/** Students' answers on these assignments, for one student or everyone, by assignment then student. */
export async function responsesOn(assignmentIds: string[], userId?: string) {
  const out = new Map<string, Map<string, typeof quizResponses.$inferSelect>>()
  if (assignmentIds.length === 0) return out
  const rows = await getDb()
    .select()
    .from(quizResponses)
    .where(
      and(
        inArray(quizResponses.assignmentId, assignmentIds),
        userId ? eq(quizResponses.userId, userId) : undefined
      )
    )
  for (const row of rows) {
    const own = out.get(row.assignmentId) ?? new Map()
    own.set(row.userId, row)
    out.set(row.assignmentId, own)
  }
  return out
}
