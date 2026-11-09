import {
  assignmentProblems,
  courseOutcomes,
  assignmentExtensions,
  assignmentQuestions,
  questions as questionBank,
  quizResponses,
  examEvents,
  examSessions,
  rubricMarks,
  submissionComments,
  assignments,
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  problems,
  sql,
  submissions,
  users,
  type Assignment,
  type User,
} from "@workspace/db"
import {
  ancestry,
  gradeProblem,
  inAudience,
  rubricEarned,
  rubricTotal,
  extendedDue,
  markQuestion,
  personalDue,
  type Extension,
  duringSitting,
  sittingClosesAt,
  QUEUE_CHANNEL,
  type Grade,
  type GradedAttempt,
  type RubricCriterion,
} from "@workspace/judge"

import { draftHistory, latestDraft } from "@/features/drafts/server"
import { notify } from "@/features/notifications/server"
import { usableQuestions } from "@/features/questions/server"
import { extendSitting } from "@/features/exams/server"
import {
  dbNow,
  eventsOf,
  presentSitting,
  sittingsOn,
  warningCounts,
  type Sitting,
} from "@/features/exams/sittings"
import { ApiError, notFound } from "@/lib/api/route"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"
import { canVerifyAddresses } from "@/lib/api/client-ip"
import { buildDetail, type ProblemSummary } from "@/features/problems/server"
import {
  accessTo,
  narrowLanguages,
  orgPolicy,
  classLinks,
  rolePermissions,
  viewpoint,
} from "@/features/orgs/access"
import { getSettings, requireFeature } from "@/features/settings/server"

import type { AssignmentInput } from "../problems/schemas"

const { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray } = sql

export type AssignmentPhase = "upcoming" | "open" | "late" | "closed"

function phaseOf(assignment: Assignment, now = new Date()): AssignmentPhase {
  if (now < assignment.opensAt) return "upcoming"
  if (now <= assignment.dueAt) return "open"
  return assignment.allowLate ? "late" : "closed"
}

interface Item {
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

async function itemsOf(assignmentIds: string[]): Promise<Item[]> {
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

type Attempt = GradedAttempt & { userId: string; problemId: string }

/** Graded submissions on these problems since a time, for one student or everyone. */
async function attemptsOn(
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
type Marks = Map<string, Record<string, number>>

/**
 * One student's marks on each problem of one assignment: the tests' marks from their
 * attempts, plus any rubric marks a teacher gave (`marks`; leave it out while feedback is
 * held). A problem is out of its test points plus its rubric's.
 */
function grade(
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
        : { ...rules, dueAt: extendedDue(rules.dueAt, extension, item.problemId) }
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

type Question = Awaited<ReturnType<typeof questionsOf>>[number]
type QuizResponse = typeof quizResponses.$inferSelect

/** A student's quiz marks: each question, the total, and how many wait for the teacher. */
function gradeQuiz(questions: Question[], response?: QuizResponse) {
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
function quizResultsOut(
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
  const byAssignment = new Map<string, Map<string, Extension & { reason: string }>>()
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
const personally = (assignment: Assignment, extension?: Extension) => ({
  ...assignment,
  dueAt: personalDue(assignment.dueAt, extension),
})

/** Rubric marks on these assignments, for one student or everyone, by student then problem. */
async function marksOn(assignmentIds: string[], userId?: string) {
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

const round = (value: number) => Math.round(value * 100) / 100

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

/* ---------- students ---------- */

export async function listAssignments(viewer: User) {
  await requireFeature("assignments.enabled")
  const [all, vp] = await Promise.all([
    getDb()
      .select({
        assignment: assignments,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(assignments)
      .leftJoin(organizations, eq(assignments.orgId, organizations.id))
      .orderBy(asc(assignments.dueAt)),
    viewpoint(viewer),
  ])
  const visible = all.filter(({ assignment }) => {
    const access = accessTo(vp, assignment, "assignments.manage")
    return access !== "none" && (assignment.published || access === "manage")
  })
  const rows = visible.map((v) => v.assignment)
  const orgOf = new Map(
    visible.map((v) => [
      v.assignment.id,
      v.orgName ? { name: v.orgName, slug: v.orgSlug! } : null,
    ])
  )
  const items = await itemsOf(rows.map((a) => a.id))
  const earliest = rows.reduce<Date | null>(
    (min, a) => (!min || a.opensAt < min ? a.opensAt : min),
    null
  )
  const [attempts, marks, sittings] = await Promise.all([
    earliest
      ? attemptsOn(
          [...new Set(items.map((i) => i.problemId))],
          earliest,
          viewer.id
        )
      : [],
    marksOn(
      rows.map((a) => a.id),
      viewer.id
    ),
    sittingsOn(
      rows.filter((a) => a.exam).map((a) => a.id),
      viewer.id
    ),
  ])
  const [extensions, allQuestions, responses] = await Promise.all([
    extensionsOn(
      rows.map((a) => a.id),
      viewer.id
    ),
    questionsOf(rows.map((a) => a.id)),
    responsesOn(
      rows.map((a) => a.id),
      viewer.id
    ),
  ])
  const now = new Date()

  return rows.map((assignment) => {
    const own = items.filter((i) => i.assignmentId === assignment.id)
    const extension = extensions.get(assignment.id)?.get(viewer.id)
    const mine = personally(assignment, extension)
    const { earned, total, solved } = grade(
      assignment,
      own,
      attempts,
      // Held feedback counts once it's released.
      assignment.holdFeedback
        ? undefined
        : marks.get(viewer.id)?.get(assignment.id),
      sittings.get(assignment.id)?.get(viewer.id),
      extension
    )
    const questions = allQuestions.filter((q) => q.assignmentId === assignment.id)
    const quiz = gradeQuiz(questions, responses.get(assignment.id)?.get(viewer.id))
    const quizOut = quizResultsOut(
      assignment,
      now,
      extension,
      sittings.get(assignment.id)?.get(viewer.id)
    )
    return {
      exam: Boolean(assignment.exam),
      questionCount: questions.length,
      slug: assignment.slug,
      title: assignment.title,
      org: orgOf.get(assignment.id) ?? null,
      opensAt: assignment.opensAt,
      dueAt: mine.dueAt,
      extended: Boolean(extension),
      allowLate: assignment.allowLate,
      latePenaltyPercent: assignment.latePenaltyPercent,
      published: assignment.published,
      phase: phaseOf(mine),
      problemCount: own.length,
      solved,
      earned: round(earned + (quizOut ? quiz.earned : 0)),
      total: total + quiz.max,
    }
  })
}

/** Whether a student can still change their answers: open, before their time is up. */
function quizAnswersOpen(
  assignment: Assignment,
  now: Date,
  extension?: Extension,
  sitting?: Sitting
) {
  if (now < assignment.opensAt) return false
  if (assignment.exam) return Boolean(sitting) && now < sittingClosesAt(sitting!)
  return now <= personalDue(assignment.dueAt, extension)
}

/**
 * A student's answers, saved as they type. They can change them until their time is up
 * (an exam: during their sitting); whatever is saved then counts.
 */
export async function saveQuizAnswers(
  slug: string,
  viewer: User,
  answers: Record<string, string[] | string>
) {
  await requireFeature("assignments.enabled")
  const { assignment } = await findAssignment(slug, viewer)
  const now = await dbNow()
  const [extension, sitting, questions] = await Promise.all([
    extensionsOn([assignment.id], viewer.id).then((m) =>
      m.get(assignment.id)?.get(viewer.id)
    ),
    assignment.exam
      ? sittingsOn([assignment.id], viewer.id).then((m) =>
          m.get(assignment.id)?.get(viewer.id)
        )
      : Promise.resolve(undefined),
    questionsOf([assignment.id]),
  ])
  if (!quizAnswersOpen(assignment, now, extension, sitting)) {
    throw new ApiError(
      403,
      "answers_closed",
      assignment.exam && !sitting
        ? "Start the exam to answer."
        : "Answers can't be changed any more."
    )
  }
  const clean: Record<string, string[] | string> = {}
  for (const [questionId, answer] of Object.entries(answers)) {
    const q = questions.find((x) => x.id === questionId)
    if (!q) throw new ApiError(400, "unknown_question", "That question isn't here.")
    if (q.kind === "single" || q.kind === "multiple") {
      const ids = Array.isArray(answer) ? answer : [answer]
      const valid = q.options.map((o) => o.id)
      if (ids.some((id) => !valid.includes(id)) || (q.kind === "single" && ids.length > 1)) {
        throw new ApiError(400, "bad_answer", "Choose from the options.")
      }
      clean[questionId] = [...new Set(ids)]
    } else {
      const text = Array.isArray(answer) ? answer.join("\n") : answer
      if (text.length > 20_000) {
        throw new ApiError(400, "too_long", "That answer is too long.")
      }
      clean[questionId] = text
    }
  }
  await getDb()
    .insert(quizResponses)
    .values({ assignmentId: assignment.id, userId: viewer.id, answers: clean, updatedAt: now })
    .onConflictDoUpdate({
      target: [quizResponses.assignmentId, quizResponses.userId],
      set: { answers: clean, updatedAt: now },
    })
  return { savedAt: now }
}

export async function getAssignment(slug: string, viewer: User) {
  await requireFeature("assignments.enabled")
  const { assignment, access, vp } = await findAssignment(slug, viewer)
  const extension = (await extensionsOn([assignment.id], viewer.id))
    .get(assignment.id)
    ?.get(viewer.id)
  const phase = phaseOf(personally(assignment, extension))
  const classes = await classLinks(vp, assignment, access === "manage")
  const sitting = assignment.exam
    ? (await sittingsOn([assignment.id], viewer.id))
        .get(assignment.id)
        ?.get(viewer.id)
    : undefined
  const examNow = assignment.exam ? await dbNow() : new Date()
  // Before it opens, students learn when, not what; an exam's problems show once started.
  const visible =
    access === "manage" ||
    (phase !== "upcoming" && (!assignment.exam || sitting !== undefined))
  const items = visible ? await itemsOf([assignment.id]) : []
  const [attempts, marks] = await Promise.all([
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt,
      viewer.id
    ),
    marksOn([assignment.id], viewer.id),
  ])
  const own = assignment.holdFeedback
    ? undefined
    : marks.get(viewer.id)?.get(assignment.id)
  const { cells, earned, total, solved } = grade(
    assignment,
    items,
    attempts,
    own,
    sitting,
    extension
  )
  const [questions, response] = visible
    ? await Promise.all([
        questionsOf([assignment.id]),
        responsesOn([assignment.id], viewer.id).then((r) =>
          r.get(assignment.id)?.get(viewer.id)
        ),
      ])
    : [[], undefined]
  const quiz = gradeQuiz(questions, response)
  const quizOut = quizResultsOut(assignment, examNow, extension, sitting)

  return {
    slug: assignment.slug,
    title: assignment.title,
    description: assignment.description,
    opensAt: assignment.opensAt,
    dueAt: personalDue(assignment.dueAt, extension),
    /** This student's extension: until when, and which problems (all when empty). */
    extension: extension
      ? {
          dueAt: extension.dueAt,
          problems: items
            .map((item, index) => ({ item, label: `Q${index + 1}` }))
            .filter(({ item }) =>
              extension.problemIds.length === 0 || extension.problemIds.includes(item.problemId)
            )
            .map(({ item, label }) => `${label} ${item.title}`),
          whole: extension.problemIds.length === 0,
        }
      : null,
    allowLate: assignment.allowLate,
    latePenaltyPercent: assignment.latePenaltyPercent,
    phase,
    earned: round(earned + (quizOut ? quiz.earned : 0)),
    total: total + quiz.max,
    solved,
    /** The classes it's for, linked. */
    classes,
    problems: items.map((item, index) => ({
      slug: item.slug,
      // Solved on the assignment's own pages, numbered by the assignment.
      href: `/assignments/${assignment.slug}/problems/${index + 1}`,
      title: item.title,
      level: item.level,
      points: item.points,
      max: cells[index]!.max,
      earned: cells[index]!.earned,
      tests: cells[index]!.tests,
      status: cells[index]!.status,
      /** Each criterion with the mark given, once feedback is out. */
      rubric: item.rubric.map((c) => ({
        ...c,
        mark: own?.get(item.problemId)?.[c.id] ?? null,
      })),
    })),
    /** Rubric marks and line comments wait until the teacher releases them. */
    feedbackHeld: assignment.holdFeedback,
    /** Quiz questions with this student's answers; marks and right answers once results are out. */
    questions: questions.map((q, index) => {
      const mark = quiz.per[index]!
      return {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options,
        points: q.points,
        answer: response?.answers[q.id] ?? null,
        result: quizOut
          ? {
              earned: mark.earned,
              needsMarking: mark.needsMarking,
              correct: q.correct,
              accepted: q.accepted,
              explanation: q.explanation,
            }
          : null,
      }
    }),
    /** Whether answers can still be changed now. */
    answersOpen: quizAnswersOpen(assignment, examNow, extension, sitting),
    quizResultsOut: quizOut,
    /** How many problems, so an exam can say so before it starts. */
    problemCount: visible ? items.length : await countProblems(assignment.id),
    questionCount: visible ? questions.length : (await questionsOf([assignment.id])).length,
    exam: assignment.exam
      ? {
          minutes: assignment.exam.minutes,
          fullscreen: assignment.exam.fullscreen,
          /** Whether it must be taken from certain networks (which ones stays private). */
          restricted: assignment.exam.networks.length > 0,
          startWithin: assignment.exam.startWithin ?? null,
          opensAt: assignment.opensAt,
          sitting: presentSitting(sitting, examNow),
          /** The server's time, so the page's clock can correct for the device's. */
          now: examNow,
        }
      : null,
  }
}

async function countProblems(assignmentId: string) {
  const [row] = await getDb()
    .select({ n: sql.count() })
    .from(assignmentProblems)
    .where(eq(assignmentProblems.assignmentId, assignmentId))
  return row?.n ?? 0
}

/**
 * One problem of an assignment, solved on the assignment's own page: labelled Q1, Q2 in
 * the assignment's order, with only its problems beside it. Every assignment problem is
 * solved here, including problems kept out of the library. During an exam sitting, hints,
 * notes and the editorial are left out of the data, not just hidden.
 */
export async function getAssignmentProblem(
  slug: string,
  number: string,
  viewer: User
) {
  await requireFeature("assignments.enabled")
  const { assignment, access } = await findAssignment(slug, viewer)
  const now = await dbNow()
  const phase = phaseOf(assignment, now)
  const sitting = assignment.exam
    ? (await sittingsOn([assignment.id], viewer.id)).get(assignment.id)?.get(viewer.id)
    : undefined
  if (access !== "manage") {
    if (phase === "upcoming") {
      throw new ApiError(403, "not_open", "This assignment hasn't opened yet.")
    }
    if (assignment.exam && !sitting) {
      throw new ApiError(403, "exam_not_started", "Start the exam to see its problems.")
    }
  }
  const items = await itemsOf([assignment.id])
  const index = Number(number) - 1
  const item = Number.isInteger(index) ? items[index] : undefined
  if (!item) throw notFound("Problem not found")
  const [problem] = await getDb()
    .select()
    .from(problems)
    .where(eq(problems.id, item.problemId))
  if (!problem) throw notFound("Problem not found")
  const summaries: ProblemSummary[] = items.map((it, i) => ({
    id: it.slug,
    title: it.title,
    level: it.level,
    unit: assignment.title,
    // Assignment problems are numbered by the assignment, not the library.
    unitNo: 0,
    no: i + 1,
    label: `Q${i + 1}`,
  }))
  const [detail, policy, attempts] = await Promise.all([
    buildDetail(problem, summaries[index]!),
    orgPolicy(assignment.orgId),
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt,
      viewer.id
    ),
  ])
  const counted = assignment.exam ? duringSitting(attempts, sitting) : attempts
  const status: Record<string, "solved" | "tried"> = {}
  for (const a of counted) {
    const s = items.find((i) => i.problemId === a.problemId)?.slug
    if (!s) continue
    if (a.verdict === "AC") status[s] = "solved"
    else status[s] ??= "tried"
  }
  const sittingNow = presentSitting(sitting, now)
  const examRunning = sittingNow.status === "in_progress"
  return {
    assignment: {
      slug: assignment.slug,
      title: assignment.title,
      dueAt: assignment.dueAt,
      phase,
      exam: assignment.exam
        ? { fullscreen: assignment.exam.fullscreen, sitting: sittingNow, now }
        : null,
    },
    summaries,
    problem: {
      ...detail,
      // An exam's problems never open their editorial here.
      hasSolution: assignment.exam ? false : detail.hasSolution,
      hints: examRunning ? [] : detail.hints,
      notes: examRunning ? [] : detail.notes,
      tags: examRunning ? [] : detail.tags,
      allowedLanguages: narrowLanguages(detail.allowedLanguages, policy.languages),
      pasteBlocked: !policy.allowPaste,
    },
    status,
  }
}

/** Open assignments for this person that include this problem, for its page. */
export async function assignmentsForProblem(slug: string, viewer: User) {
  const settings = await getSettings()
  if (!settings["assignments.enabled"]) return []
  const now = new Date()
  const [rows, vp] = await Promise.all([
    getDb()
      .select({ assignment: assignments })
      .from(assignmentProblems)
      .innerJoin(
        assignments,
        eq(assignmentProblems.assignmentId, assignments.id)
      )
      .innerJoin(problems, eq(assignmentProblems.problemId, problems.id))
      .where(and(eq(problems.slug, slug), eq(assignments.published, true))),
    viewpoint(viewer),
  ])
  const sittings = await sittingsOn(
    rows.filter((r) => r.assignment.exam).map((r) => r.assignment.id),
    viewer.id
  )
  return rows
    .filter(
      ({ assignment }) =>
        accessTo(vp, assignment, "assignments.manage") !== "none"
    )
    // An exam doesn't say which problems it uses until the student has started it.
    .filter(
      ({ assignment }) =>
        !assignment.exam || sittings.get(assignment.id)?.has(viewer.id)
    )
    .map(({ assignment }) => ({ assignment, phase: phaseOf(assignment, now) }))
    .filter(({ phase }) => phase === "open" || phase === "late")
    .map(({ assignment, phase }) => ({
      slug: assignment.slug,
      title: assignment.title,
      dueAt: assignment.dueAt,
      phase,
      exam: assignment.exam
        ? {
            fullscreen: assignment.exam.fullscreen,
            sitting: presentSitting(
              sittings.get(assignment.id)?.get(viewer.id),
              now
            ),
          }
        : null,
    }))
}

/* ---------- staff ---------- */
// `orgId` is the owner, already authorized by the caller: null for platform assignments,
// or an organization. Every query matches it, so another owner's ids aren't found.

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)

export async function listAssignmentsForStaff(orgId: string | null) {
  const rows = await getDb()
    .select()
    .from(assignments)
    .where(ownedBy(orgId))
    .orderBy(asc(assignments.dueAt))
  const items = await itemsOf(rows.map((a) => a.id))
  return rows.map((assignment) => {
    const own = items.filter((i) => i.assignmentId === assignment.id)
    return {
      ...assignment,
      phase: phaseOf(assignment),
      problemCount: own.length,
      totalPoints: own.reduce((sum, i) => sum + i.points, 0),
    }
  })
}

export async function getAssignmentForStaff(id: string, orgId: string | null) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const [items, questions] = await Promise.all([itemsOf([id]), questionsOf([id])])
  return {
    ...assignment,
    problems: items.map(({ problemId, points, rubric, outcomes }) => ({
      problemId,
      points,
      rubric,
      outcomes,
    })),
    questions: questions.map((q) => ({ questionId: q.id, points: q.points })),
  }
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
    .innerJoin(questionBank, eq(assignmentQuestions.questionId, questionBank.id))
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

export async function saveAssignment(
  id: string | null,
  input: AssignmentInput,
  orgId: string | null
) {
  const { problems: chosen, expectedUpdatedAt, questions, ...fields } = input
  const ids = chosen.map((c) => c.problemId)
  const found = await getDb()
    .select({
      id: problems.id,
      published: problems.published,
      membersOnly: problems.membersOnly,
      listed: problems.listed,
      orgId: problems.orgId,
    })
    .from(problems)
    .where(inArray(problems.id, ids))
  if (found.length !== ids.length) {
    throw new ApiError(
      400,
      "unknown_problem",
      "A chosen problem no longer exists."
    )
  }
  if (found.some((p) => (p.membersOnly || !p.listed) && p.orgId !== orgId)) {
    throw new ApiError(
      400,
      "private_problem",
      "That problem is only for another organization's members."
    )
  }
  if (found.some((p) => !p.published)) {
    throw new ApiError(
      400,
      "draft_problem",
      "Only published problems can be assigned. Publish the drafts first."
    )
  }
  if (fields.exam?.networks.length && !canVerifyAddresses()) {
    throw new ApiError(
      400,
      "addresses_unverifiable",
      "This server can't confirm where students connect from, so an exam can't be limited to a network yet. An administrator sets PROXY_SECRET (see docs/deploy-exams.md)."
    )
  }
  const tagged = [...new Set(chosen.flatMap((c) => c.outcomes))]
  if (tagged.length > 0) {
    // Only the organization's own course outcomes; the platform has none.
    const known = orgId
      ? await getDb()
          .select({ id: courseOutcomes.id })
          .from(courseOutcomes)
          .where(
            and(
              eq(courseOutcomes.orgId, orgId),
              inArray(courseOutcomes.id, tagged)
            )
          )
      : []
    if (known.length !== tagged.length) {
      throw new ApiError(
        400,
        "unknown_outcome",
        "A chosen course outcome no longer exists."
      )
    }
  }
  await usableQuestions(
    questions.map((q) => q.questionId),
    orgId
  )
  if (id) await guardStartedExam(id, input)
  const wasPublished = id
    ? ((
        await getDb()
          .select({ published: assignments.published })
          .from(assignments)
          .where(eq(assignments.id, id))
      )[0]?.published ?? false)
    : false
  const values = { ...fields, orgId, audience: orgId ? fields.audience : [] }

  const saved = await getDb().transaction(async (tx) => {
    const [assignment] = id
      ? await tx
          .update(assignments)
          .set(values)
          .where(
            and(
              eq(assignments.id, id),
              ownedBy(orgId),
              unchangedSince(assignments.updatedAt, expectedUpdatedAt)
            )
          )
          .returning()
      : await tx.insert(assignments).values(values).returning()
    if (!assignment) {
      const [exists] = id
        ? await tx
            .select({ id: assignments.id })
            .from(assignments)
            .where(and(eq(assignments.id, id), ownedBy(orgId)))
        : []
      throw exists ? editedElsewhere() : notFound("Assignment not found")
    }
    await tx
      .delete(assignmentProblems)
      .where(eq(assignmentProblems.assignmentId, assignment.id))
    if (chosen.length) {
      await tx.insert(assignmentProblems).values(
        chosen.map((item, position) => ({
          assignmentId: assignment.id,
          problemId: item.problemId,
          points: item.points,
          rubric: item.rubric,
          outcomes: item.outcomes,
          position,
        }))
      )
    }
    // Answers are kept by bank question, so they stay with a question across edits.
    await tx
      .delete(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignment.id))
    if (questions.length) {
      await tx.insert(assignmentQuestions).values(
        questions.map((q, position) => ({
          assignmentId: assignment.id,
          questionId: q.questionId,
          points: q.points,
          position,
        }))
      )
    }
    return assignment
  })
  // Students hear about it when it's first published.
  if (saved.published && !wasPublished) {
    const students = await studentsOf(saved, "all")
    await notify(
      students.map((s) => s.id),
      {
        kind: saved.exam ? "new_exam" : "new_assignment",
        title: `${saved.exam ? "New exam" : "New assignment"}: ${saved.title}`,
        body: saved.exam
          ? "Read its rules before you start: one sitting, timed."
          : `${[
              chosen.length && `${chosen.length} ${chosen.length === 1 ? "problem" : "problems"}`,
              questions.length && `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
            ]
              .filter(Boolean)
              .join(" and ")}. Open it to see when it's due.`,
        href: `/assignments/${saved.slug}`,
      }
    )
  }
  return saved
}

/**
 * Once students have started an exam, it stays an exam with the same problems: turning it
 * off would count everyone's practice, and swapping problems would change it under them.
 * Time, due time and networks can still change (running sittings keep their end time).
 */
async function guardStartedExam(id: string, input: AssignmentInput) {
  const [current] = await getDb()
    .select({ exam: assignments.exam })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (!current?.exam) return
  const started = await sittingsOn([id])
  if ((started.get(id)?.size ?? 0) === 0) return
  if (!input.exam) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so it can't stop being an exam."
    )
  }
  const before = (await itemsOf([id])).map((i) => i.problemId)
  const after = input.problems.map((p) => p.problemId)
  if (before.length !== after.length || before.some((p, i) => p !== after[i])) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so its problems can't change. Points and rubrics can."
    )
  }
  const asked = (await questionsOf([id])).map((q) => q.id)
  const asking = input.questions.map((q) => q.questionId)
  if (asked.length !== asking.length || asked.some((q, i) => q !== asking[i])) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so its questions can't be added, removed or reordered."
    )
  }
}

/**
 * After a runner outage: every graded submission of this assignment's students on its
 * problems that ended in "System error" is judged again. They keep the time they were
 * submitted, so work done in time (an exam's last submission) counts.
 */
export async function rejudgeSystemErrors(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const [items, students] = await Promise.all([
    itemsOf([id]),
    studentsOf(assignment, scope),
  ])
  if (items.length === 0 || students.length === 0) return { queued: 0 }
  const queued = await getDb().transaction(async (tx) => {
    const rows = await tx
      .update(submissions)
      .set({
        status: "queued",
        verdict: null,
        attempts: 0,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      })
      .where(
        and(
          eq(submissions.kind, "submit"),
          eq(submissions.status, "done"),
          eq(submissions.verdict, "SE"),
          inArray(submissions.problemId, items.map((i) => i.problemId)),
          inArray(submissions.userId, students.map((s) => s.id)),
          gte(submissions.createdAt, assignment.opensAt)
        )
      )
      .returning({ id: submissions.id })
    if (rows.length) await tx.execute(sql.sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`)
    return rows.length
  })
  return { queued }
}

/** Drops the network addresses an exam recorded: where each sitting started, and refused submissions. */
export async function forgetExamAddresses(id: string, orgId: string | null) {
  const [assignment] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  await getDb().transaction(async (tx) => {
    await tx.update(examSessions).set({ ip: null }).where(eq(examSessions.assignmentId, id))
    await tx
      .update(examEvents)
      .set({ detail: "" })
      .where(and(eq(examEvents.assignmentId, id), eq(examEvents.kind, "other_network")))
  })
}

export async function deleteAssignment(id: string, orgId: string | null) {
  const deleted = await getDb()
    .delete(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
    .returning({ id: assignments.id })
  if (deleted.length === 0) throw notFound("Assignment not found")
}

export interface GradebookRow {
  name: string | null
  email: string
  handle: string | null
  cells: (Grade & { problemId: string })[]
  earned: number
  late: number
  exam: (ReturnType<typeof presentSitting> & { warnings: number }) | null
  extension: { dueAt: Date; problemIds: readonly string[]; reason: string } | null
  quiz: { earned: number; max: number; answered: boolean; needsMarking: number } | null
}

/** The people an assignment is for: everyone's students, or an organization's audience. */
async function studentsOf(
  assignment: Assignment,
  /** Which groups the viewer may see grades for; "all" for everyone. */
  scope: "all" | Set<string>
) {
  const db = getDb()
  const fields = {
    id: users.id,
    name: users.name,
    email: users.email,
    handle: users.handle,
  }
  if (assignment.orgId === null) {
    return db
      .select(fields)
      .from(users)
      .where(and(eq(users.role, "student"), ne(users.disabled, true)))
      .orderBy(asc(users.name), asc(users.email))
  }
  const orgId = assignment.orgId
  const [members, groups, memberships, grants] = await Promise.all([
    db
      .select(fields)
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          eq(orgMembers.status, "active"),
          ne(users.disabled, true)
        )
      )
      .orderBy(asc(users.name), asc(users.email)),
    db
      .select({ id: orgGroups.id, parentId: orgGroups.parentId })
      .from(orgGroups)
      .where(eq(orgGroups.orgId, orgId)),
    db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
      .where(eq(orgGroups.orgId, orgId)),
    db
      .select({
        userId: roleAssignments.userId,
        systemKey: orgRoles.systemKey,
        permissions: orgRoles.permissions,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(eq(roleAssignments.orgId, orgId)),
  ])
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]))
  const chain = (id: string) => ancestry(id, (x) => parentOf.get(x))
  const groupsOf = (userId: string) =>
    memberships.filter((m) => m.userId === userId).map((m) => m.groupId)
  // People who can set assignments are teachers here, not students.
  const teachers = new Set(
    grants
      .filter((g) => rolePermissions(g).includes("assignments.manage"))
      .map((g) => g.userId)
  )
  return members.filter(
    (m) =>
      !teachers.has(m.id) &&
      inAudience(groupsOf(m.id), assignment.audience, chain) &&
      (scope === "all" ||
        groupsOf(m.id).some((g) => chain(g).some((id) => scope.has(id))))
  )
}

/** Every student's marks, including those who haven't started. */
export async function getGradebook(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const items = await itemsOf([id])
  const [students, attempts, marks] = await Promise.all([
    studentsOf(assignment, scope),
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt
    ),
    // Teachers see rubric marks whether or not they're released yet.
    marksOn([id]),
  ])
  const [sittings, warnings] = assignment.exam
    ? await Promise.all([sittingsOn([id]), warningCounts(id)])
    : [new Map<string, Map<string, Sitting>>(), new Map<string, number>()]
  const extensions = (await extensionsOn([id])).get(id)
  const [questions, responses] = await Promise.all([
    questionsOf([id]),
    responsesOn([id]).then((r) => r.get(id)),
  ])

  const rows: GradebookRow[] = students.map((student) => {
    const { cells, earned } = grade(
      assignment,
      items,
      attempts.filter((a) => a.userId === student.id),
      marks.get(student.id)?.get(id),
      sittings.get(id)?.get(student.id),
      extensions?.get(student.id)
    )
    const extension = extensions?.get(student.id)
    const response = responses?.get(student.id)
    const quiz = gradeQuiz(questions, response)
    return {
      /** Teachers see quiz marks at once, held or not. */
      quiz: questions.length
        ? {
            earned: quiz.earned,
            max: quiz.max,
            answered: Boolean(response),
            needsMarking: quiz.needsMarking,
          }
        : null,
      extension: extension
        ? {
            dueAt: extension.dueAt,
            problemIds: extension.problemIds,
            reason: extension.reason,
          }
        : null,
      exam: assignment.exam
        ? {
            ...presentSitting(sittings.get(id)?.get(student.id)),
            warnings: warnings.get(student.id) ?? 0,
          }
        : null,
      name: student.name,
      email: student.email,
      handle: student.handle,
      cells,
      earned: round(earned + quiz.earned),
      late: cells.filter((c) => c.status === "late").length,
    }
  })
  const total =
    items.reduce((sum, i) => sum + i.points + rubricTotal(i.rubric), 0) +
    questions.reduce((sum, q) => sum + q.points, 0)
  const started = rows.filter(
    (r) => r.cells.some((c) => c.status !== "missing") || r.quiz?.answered
  )

  return {
    assignment: {
      id: assignment.id,
      slug: assignment.slug,
      title: assignment.title,
      dueAt: assignment.dueAt,
      phase: phaseOf(assignment),
      holdFeedback: assignment.holdFeedback,
      exam: assignment.exam,
      /** The quiz part, when there is one. */
      quiz: questions.length
        ? { questions: questions.length, points: questions.reduce((t, q) => t + q.points, 0) }
        : null,
    },
    problems: items.map(({ problemId, slug, title, points, rubric, outcomes }) => ({
      problemId,
      slug,
      title,
      outcomes,
      // Out of the tests' points and the rubric's.
      points: points + rubricTotal(rubric),
      tests: points,
      rubric,
    })),
    total,
    summary: {
      students: rows.length,
      started: started.length,
      average: rows.length
        ? round(rows.reduce((sum, r) => sum + r.earned, 0) / rows.length)
        : 0,
      fullMarks: rows.filter((r) => r.earned === total && total > 0).length,
    },
    rows,
  }
}

/** An assignment, one of its problems and one of its students, or not found. */
async function gradebookStudent(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string,
  problemId: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const items = await itemsOf([id])
  const item = items.find((i) => i.problemId === problemId)
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === email
  )
  if (!item || !student) throw notFound("Not in this gradebook")
  return { assignment, item, student }
}

/** One student's answers to the quiz, with the automatic marks, for marking. */
export async function studentQuiz(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find((s) => s.email === email)
  if (!student) throw notFound("Not in this gradebook")
  const [questions, response] = await Promise.all([
    questionsOf([id]),
    responsesOn([id], student.id).then((r) => r.get(id)?.get(student.id)),
  ])
  const quiz = gradeQuiz(questions, response)
  return {
    student: { name: student.name, email: student.email },
    savedAt: response?.updatedAt ?? null,
    earned: quiz.earned,
    max: quiz.max,
    held: assignment.holdFeedback,
    questions: questions.map((q, index) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      options: q.options,
      correct: q.correct,
      accepted: q.accepted,
      points: q.points,
      answer: response?.answers[q.id] ?? null,
      ...quiz.per[index]!,
      /** What it would earn without the teacher's mark. */
      automatic: markQuestion(q, response?.answers[q.id]).earned,
    })),
  }
}

/** Teacher marks on a student's answers; null takes a mark back to the automatic one. */
export async function setQuizMarks(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; marks: Record<string, number | null> }
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  const questions = await questionsOf([id])
  const current =
    (await responsesOn([id], student.id)).get(id)?.get(student.id)?.marks ?? {}
  const next = { ...current }
  for (const [questionId, mark] of Object.entries(input.marks)) {
    const q = questions.find((x) => x.id === questionId)
    if (!q) throw new ApiError(400, "unknown_question", "That question isn't here.")
    if (mark === null) {
      delete next[questionId]
      continue
    }
    if (mark < 0 || mark > q.points) {
      throw new ApiError(400, "out_of_range", `Marks for that question are 0 to ${q.points}.`)
    }
    next[questionId] = mark
  }
  await getDb()
    .insert(quizResponses)
    .values({ assignmentId: id, userId: student.id, marks: next })
    .onConflictDoUpdate({
      target: [quizResponses.assignmentId, quizResponses.userId],
      set: { marks: next },
    })
  if (!assignment.holdFeedback) {
    await notify([student.id], {
      kind: "marks",
      title: `Your teacher marked your answers in ${assignment.title}`,
      href: `/assignments/${assignment.slug}`,
    })
  }
  return { marks: next }
}

/**
 * A later due date for one student in this gradebook: for the whole assignment, or only
 * some problems (reopening them after feedback). For an exam it lets them start later.
 */
export async function setExtension(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; dueAt: Date; problemIds: string[]; reason: string },
  grantedBy: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  if (input.dueAt <= assignment.dueAt) {
    throw new ApiError(400, "not_later", "Pick a time after the assignment's due time.")
  }
  const items = await itemsOf([id])
  if (input.problemIds.some((p) => !items.some((i) => i.problemId === p))) {
    throw new ApiError(400, "unknown_problem", "That problem isn't in this assignment.")
  }
  const values = {
    dueAt: input.dueAt,
    problemIds: [...new Set(input.problemIds)],
    reason: input.reason,
    grantedBy,
  }
  await getDb()
    .insert(assignmentExtensions)
    .values({ assignmentId: id, userId: student.id, ...values })
    .onConflictDoUpdate({
      target: [assignmentExtensions.assignmentId, assignmentExtensions.userId],
      set: values,
    })
  await notify([student.id], {
    kind: "extension",
    title: `More time on ${assignment.title}`,
    body: values.problemIds.length
      ? "Some of its problems are open again for you. Open it to see until when."
      : "Your teacher moved your due time. Open it to see the new one.",
    href: `/assignments/${assignment.slug}`,
  })
  return { student: student.email, ...values }
}

export async function removeExtension(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find((s) => s.email === email)
  if (!student) throw notFound("Not in this gradebook")
  await getDb()
    .delete(assignmentExtensions)
    .where(
      and(
        eq(assignmentExtensions.assignmentId, id),
        eq(assignmentExtensions.userId, student.id)
      )
    )
}

/** More time on an exam for one student in this gradebook. */
export async function extendStudentSitting(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; minutes: number }
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment?.exam) throw notFound("Exam not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  return extendSitting(id, student.id, input.minutes)
}

/** Line comments on these submissions, given in this assignment. */
async function commentsOn(assignmentId: string, submissionIds: string[]) {
  if (submissionIds.length === 0) return []
  return getDb()
    .select({
      id: submissionComments.id,
      submissionId: submissionComments.submissionId,
      path: submissionComments.path,
      line: submissionComments.line,
      body: submissionComments.body,
      createdAt: submissionComments.createdAt,
      author: users.name,
      authorEmail: users.email,
    })
    .from(submissionComments)
    .leftJoin(users, eq(submissionComments.authorId, users.id))
    .where(
      and(
        eq(submissionComments.assignmentId, assignmentId),
        inArray(submissionComments.submissionId, submissionIds)
      )
    )
    .orderBy(asc(submissionComments.line), asc(submissionComments.createdAt))
}

/** A teacher's rubric marks for one student on one problem. Unknown criteria are refused. */
export async function setRubricMarks(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; problemId: string; marks: Record<string, number> },
  graderId: string
) {
  const { item, student } = await gradebookStudent(
    id,
    orgId,
    scope,
    input.student,
    input.problemId
  )
  for (const [criterion, mark] of Object.entries(input.marks)) {
    const c = item.rubric.find((r) => r.id === criterion)
    if (!c)
      throw new ApiError(400, "unknown_criterion", "That isn't on this rubric.")
    if (mark < 0 || mark > c.points) {
      throw new ApiError(
        400,
        "out_of_range",
        `"${c.label}" is out of ${c.points}.`
      )
    }
  }
  const now = new Date()
  await getDb()
    .insert(rubricMarks)
    .values({
      assignmentId: id,
      problemId: input.problemId,
      userId: student.id,
      marks: input.marks,
      graderId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        rubricMarks.assignmentId,
        rubricMarks.problemId,
        rubricMarks.userId,
      ],
      set: { marks: input.marks, graderId, updatedAt: now },
    })
  const [assignment] = await getDb()
    .select({ title: assignments.title, slug: assignments.slug, hold: assignments.holdFeedback })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (assignment && !assignment.hold) {
    await notify([student.id], {
      kind: "marks",
      title: `Your teacher marked ${item.title} in ${assignment.title}`,
      href: `/assignments/${assignment.slug}`,
    })
  }
  return { byHand: rubricEarned(item.rubric, input.marks) }
}

/** A comment on one line of a student's submission to this assignment. */
export async function addLineComment(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: {
    student: string
    submissionId: string
    path: string
    line: number
    body: string
  },
  authorId: string
) {
  const [submission] = await getDb()
    .select({
      problemId: submissions.problemId,
      userId: submissions.userId,
      files: submissions.files,
    })
    .from(submissions)
    .where(eq(submissions.id, input.submissionId))
  if (!submission?.problemId) throw notFound("Submission not found")
  const { student } = await gradebookStudent(
    id,
    orgId,
    scope,
    input.student,
    submission.problemId
  )
  if (submission.userId !== student.id) throw notFound("Submission not found")
  const file = submission.files.find((f) => f.path === input.path)
  if (!file || input.line > file.content.split("\n").length) {
    throw new ApiError(
      400,
      "no_such_line",
      "That line isn't in the submission."
    )
  }
  const [comment] = await getDb()
    .insert(submissionComments)
    .values({ ...input, assignmentId: id, authorId })
    .returning()
  const [assignment] = await getDb()
    .select({ title: assignments.title, hold: assignments.holdFeedback })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (assignment && !assignment.hold) {
    await notify([student.id], {
      kind: "comment",
      title: `A comment on your code in ${assignment.title}`,
      body: input.body.slice(0, 300),
      href: `/submissions/${input.submissionId}`,
    })
  }
  return comment
}

/** Removes a line comment from this assignment, for whoever may give its feedback. */
export async function deleteLineComment(
  id: string,
  orgId: string | null,
  commentId: string
) {
  const [assignment] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const removed = await getDb()
    .delete(submissionComments)
    .where(
      and(
        eq(submissionComments.id, commentId),
        eq(submissionComments.assignmentId, id)
      )
    )
    .returning({ id: submissionComments.id })
  if (removed.length === 0) throw notFound("Comment not found")
}

/** Shows held rubric marks and line comments to students. */
export async function releaseFeedback(id: string, orgId: string | null) {
  const updated = await getDb()
    .update(assignments)
    .set({ holdFeedback: false })
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
    .returning({ id: assignments.id, title: assignments.title, slug: assignments.slug })
  if (updated.length === 0) throw notFound("Assignment not found")
  // Everyone who has marks or comments waiting hears that they're out.
  const [marked, commented] = await Promise.all([
    getDb()
      .select({ userId: rubricMarks.userId })
      .from(rubricMarks)
      .where(eq(rubricMarks.assignmentId, id)),
    getDb()
      .select({ userId: submissions.userId })
      .from(submissionComments)
      .innerJoin(submissions, eq(submissionComments.submissionId, submissions.id))
      .where(eq(submissionComments.assignmentId, id)),
  ])
  const answered = await getDb()
    .select({ userId: quizResponses.userId })
    .from(quizResponses)
    .where(eq(quizResponses.assignmentId, id))
  await notify(
    [...marked, ...commented, ...answered].map((r) => r.userId),
    {
      kind: "feedback",
      title: `Results of ${updated[0]!.title} are out`,
      body: "Your marks, the right answers and your teacher's comments.",
      href: `/assignments/${updated[0]!.slug}`,
    }
  )
}

/**
 * One student's graded submissions on one problem of an assignment, with their code, for
 * whoever may see that student's grades. Anyone outside the gradebook isn't found.
 */
export async function studentAttempts(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string,
  problemId: string,
  /** Also every snapshot of the student's code, for playback. */
  withHistory = false
) {
  const { assignment, item, student } = await gradebookStudent(
    id,
    orgId,
    scope,
    email,
    problemId
  )
  const rows = await getDb()
    .select({
      id: submissions.id,
      language: submissions.language,
      files: submissions.files,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, student.id),
        eq(submissions.problemId, problemId),
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        gte(submissions.createdAt, assignment.opensAt)
      )
    )
    .orderBy(desc(submissions.createdAt))
    .limit(50)
  // Who may see the graded work may also see the code being written: live, and as it grew.
  const extensionNow = (await extensionsOn([id], student.id)).get(id)?.get(student.id)
  const [draft, history, marks, comments, events, sittings] = await Promise.all([
    latestDraft(student.id, problemId),
    withHistory ? draftHistory(student.id, problemId) : null,
    marksOn([id], student.id),
    commentsOn(
      id,
      rows.map((r) => r.id)
    ),
    assignment.exam ? eventsOf(id, student.id) : [],
    assignment.exam ? sittingsOn([id], student.id) : null,
  ])
  const sitting = sittings?.get(id)?.get(student.id)
  return {
    extension: extensionNow ?? null,
    exam: assignment.exam
      ? { ...presentSitting(sitting), ip: sitting?.ip ?? null, events }
      : null,
    student: { name: student.name, email: student.email },
    problem: { title: item.title, points: item.points, rubric: item.rubric },
    marks: marks.get(student.id)?.get(id)?.get(problemId) ?? {},
    holdFeedback: assignment.holdFeedback,
    attempts: rows.map((r) => ({
      ...r,
      late:
        r.createdAt >
        extendedDue(assignment.dueAt, extensionNow, problemId),
      /** For an exam: made outside the student's sitting, so it doesn't count. */
      outside:
        assignment.exam !== null && duringSitting([r], sitting).length === 0,
      comments: comments.filter((c) => c.submissionId === r.id),
    })),
    draft,
    ...(history ? { history } : {}),
  }
}

/** Quotes a CSV field, and stops spreadsheets running it as a formula. */
export function csvField(value: string | number | null) {
  let text = value === null ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function gradebookCsv(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const book = await getGradebook(id, orgId, scope)
  const header = [
    "Name",
    "Email",
    "Handle",
    ...book.problems.map((p) => `${p.title} (${p.points})`),
    ...(book.assignment.quiz ? [`Quiz (${book.assignment.quiz.points})`] : []),
    `Total (${book.total})`,
    "Problems late",
    ...(book.assignment.exam ? ["Exam", "Exam warnings"] : []),
  ]
  const lines = [
    header,
    ...book.rows.map((row) => [
      row.name,
      row.email,
      row.handle,
      ...row.cells.map((c) => c.earned),
      ...(book.assignment.quiz ? [row.quiz?.earned ?? 0] : []),
      row.earned,
      row.late,
      ...(row.exam
        ? [
            row.exam.status === "finished"
              ? row.exam.finishedEarly
                ? "Finished"
                : "Time ran out"
              : row.exam.status === "in_progress"
                ? "In progress"
                : "Not started",
            row.exam.warnings,
          ]
        : []),
    ]),
  ].map((fields) => fields.map(csvField).join(","))
  return {
    filename: `${book.assignment.slug}-grades.csv`,
    // A byte-order mark so Excel reads names in any script correctly.
    body: "﻿" + lines.join("\r\n") + "\r\n",
  }
}
