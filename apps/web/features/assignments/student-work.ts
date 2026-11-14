import {
  assignmentProblems,
  assignments,
  getDb,
  organizations,
  problems,
  quizResponses,
  sql,
  type Assignment,
  type User,
} from "@workspace/db"
import {
  duringSitting,
  personalDue,
  sittingClosesAt,
  type Extension,
} from "@workspace/judge"

import {
  dbNow,
  presentSitting,
  sittingsOn,
  type Sitting,
} from "@/features/exams/sittings"
import {
  accessTo,
  classLinks,
  narrowLanguages,
  orgPolicy,
  viewpoint,
} from "@/features/orgs/access"
import { buildDetail, type ProblemSummary } from "@/features/problems/server"
import {
  projectGrades,
  projectsOf,
  projectSubmissionsOn,
} from "@/features/projects/server"
import { getSettings, requireFeature } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"

import {
  attemptsOn,
  countProblems,
  extensionsOn,
  findAssignment,
  grade,
  gradeQuiz,
  itemsOf,
  marksOn,
  personally,
  phaseOf,
  questionsOf,
  quizResultsOut,
  responsesOn,
  round,
} from "./grading"

const { and, asc, eq } = sql

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
  const projectBook = await projectGrades(
    rows.map((a) => a.id),
    viewer.id
  )
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
    const questions = allQuestions.filter(
      (q) => q.assignmentId === assignment.id
    )
    const quiz = gradeQuiz(
      questions,
      responses.get(assignment.id)?.get(viewer.id)
    )
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
      earned: round(
        earned +
          (quizOut ? quiz.earned : 0) +
          // Project marks count once results aren't held.
          (assignment.holdFeedback
            ? 0
            : projectBook.grade(assignment.id, viewer.id).earned)
      ),
      total: total + quiz.max + projectBook.max(assignment.id),
    }
  })
}

/** Whether a student can still change their answers: open, before their time is up. */
export function quizAnswersOpen(
  assignment: Assignment,
  now: Date,
  extension?: Extension,
  sitting?: Sitting
) {
  if (now < assignment.opensAt) return false
  if (assignment.exam)
    return Boolean(sitting) && now < sittingClosesAt(sitting!)
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
    if (!q)
      throw new ApiError(400, "unknown_question", "That question isn't here.")
    if (q.kind === "single" || q.kind === "multiple") {
      const ids = Array.isArray(answer) ? answer : [answer]
      const valid = q.options.map((o) => o.id)
      if (
        ids.some((id) => !valid.includes(id)) ||
        (q.kind === "single" && ids.length > 1)
      ) {
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
    .values({
      assignmentId: assignment.id,
      userId: viewer.id,
      answers: clean,
      updatedAt: now,
    })
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
  const projects = visible ? await projectsOf([assignment.id]) : []
  const mySubmissions = await projectSubmissionsOn(
    projects.map((p) => p.id),
    viewer.id
  )
  const projectsEarned = assignment.holdFeedback
    ? 0
    : mySubmissions.reduce((n, s) => n + (s.mark ?? 0), 0)

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
            .filter(
              ({ item }) =>
                extension.problemIds.length === 0 ||
                extension.problemIds.includes(item.problemId)
            )
            .map(({ item, label }) => `${label} ${item.title}`),
          whole: extension.problemIds.length === 0,
        }
      : null,
    allowLate: assignment.allowLate,
    latePenaltyPercent: assignment.latePenaltyPercent,
    phase,
    earned: round(earned + (quizOut ? quiz.earned : 0) + projectsEarned),
    total: total + quiz.max + projects.reduce((n, p) => n + p.points, 0),
    solved,
    /** Project work: the student's repository and, once results aren't held, the mark. */
    projects: projects.map((p) => {
      const sub = mySubmissions.find((s) => s.projectId === p.id)
      return {
        id: p.id,
        title: p.title,
        instructions: p.instructions,
        points: p.points,
        submission: sub
          ? {
              repoUrl: sub.repoUrl,
              ref: sub.ref,
              commitSha: sub.commitSha,
              note: sub.note,
              submittedAt: sub.submittedAt,
              late: sub.late,
              mark: assignment.holdFeedback ? null : sub.mark,
              feedback: assignment.holdFeedback ? "" : sub.feedback,
            }
          : null,
      }
    }),
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
    questionCount: visible
      ? questions.length
      : (await questionsOf([assignment.id])).length,
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
    ? (await sittingsOn([assignment.id], viewer.id))
        .get(assignment.id)
        ?.get(viewer.id)
    : undefined
  if (access !== "manage") {
    if (phase === "upcoming") {
      throw new ApiError(403, "not_open", "This assignment hasn't opened yet.")
    }
    if (assignment.exam && !sitting) {
      throw new ApiError(
        403,
        "exam_not_started",
        "Start the exam to see its problems."
      )
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
      allowedLanguages: narrowLanguages(
        detail.allowedLanguages,
        policy.languages
      ),
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
  return (
    rows
      .filter(
        ({ assignment }) =>
          accessTo(vp, assignment, "assignments.manage") !== "none"
      )
      // An exam doesn't say which problems it uses until the student has started it.
      .filter(
        ({ assignment }) =>
          !assignment.exam || sittings.get(assignment.id)?.has(viewer.id)
      )
      .map(({ assignment }) => ({
        assignment,
        phase: phaseOf(assignment, now),
      }))
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
  )
}

// `orgId` is the owner, already authorized by the caller: null for platform assignments,
// or an organization. Every query matches it, so another owner's ids aren't found.
