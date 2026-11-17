import {
  courseAttempts,
  courseProjectSubmissions,
  courseQuizAnswers,
  getDb,
  questions,
  sql,
  type User,
} from "@workspace/db"
import {
  ATTEMPT_GRACE_MS,
  attemptClosesAt,
  finishedEarly,
  courseGrade,
  gradeShares,
  markQuestion,
} from "@workspace/judge"

import { classContext, studentsIn } from "@/features/classes/server"
import { dbNow } from "@/features/exams/sittings"
import { canFor, writeAudit } from "@/features/orgs/server"
import { checkRepository } from "@/features/projects/server"
import { ApiError, notFound } from "@/lib/api/route"

import { checkpointResults } from "./checkpoint-results"
import { classCourses } from "./classes"
import { outlineOf, type OutlineItem } from "./server"

/*
 * A class's course checkpoints, as students take them and teachers grade them. A student
 * reaches a checkpoint once its module opens for them (the Course tab's rules). Quizzes and
 * labs are one attempt each; answers save until the attempt is over, and lab problems are
 * solved on their own pages, counting what's submitted during the attempt. Projects are
 * handed in as GitHub repositories and marked by whoever may grade the class's work.
 */

const { and, eq, inArray } = sql

const TIMED = new Set(["quiz", "lab"])

/** The checkpoint, its course and module, if this person can reach it in this class. */
async function locate(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string
) {
  const view = await classCourses(slug, user, groupId)
  const course = view.courses.find((c) => c.id === courseId)
  const module = course?.modules.find((m) =>
    m.checkpoints.some((c) => c.id === checkpointId)
  )
  if (!course || !module) throw notFound("Not open for you here")
  const outline = (await outlineOf([courseId])).get(courseId) ?? []
  const checkpoint = outline
    .flatMap((m) => m.checkpoints)
    .find((c) => c.id === checkpointId)
  if (!checkpoint) throw notFound("Not open for you here")
  const cc = await classContext(slug, user, groupId)
  return { view, course, module, checkpoint, cc, teacher: view.teacher }
}

const problemHref = (slug: string, item: OutlineItem) =>
  item.slug
    ? item.membersOnly
      ? `/orgs/${slug}/practice/${item.slug}`
      : `/problems/${item.slug}`
    : null

/** One checkpoint for its page: what it asks, and where this person stands. */
export async function checkpointView(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string
) {
  const {
    course,
    module,
    checkpoint: c,
    teacher,
    cc,
  } = await locate(slug, user, groupId, courseId, checkpointId)
  const now = await dbNow()
  const r = (await checkpointResults([user.id], [c], now))
    .get(user.id)!
    .get(c.id)!
  const started = r.state !== "not_started"
  const over = r.state === "finished"
  // Teachers see the questions and problems at any time; students once they've started.
  const showWork = teacher || started

  let quiz = null
  if (c.kind === "quiz" && showWork) {
    const ids = c.items.map((i) => i.id)
    const [qs, saved] = await Promise.all([
      getDb().select().from(questions).where(inArray(questions.id, ids)),
      getDb()
        .select()
        .from(courseQuizAnswers)
        .where(
          and(
            eq(courseQuizAnswers.checkpointId, c.id),
            eq(courseQuizAnswers.userId, user.id)
          )
        ),
    ])
    quiz = c.items.flatMap((item) => {
      const q = qs.find((x) => x.id === item.id)
      if (!q) return []
      const answer = saved.find((a) => a.questionId === q.id)?.answer ?? null
      const earned =
        q.points > 0
          ? ((markQuestion(q, answer ?? undefined).earned ?? 0) * item.points) /
            q.points
          : 0
      return [
        {
          id: q.id,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options,
          points: item.points,
          answer,
          // Right answers only once the attempt is over (teachers always).
          result:
            over || teacher
              ? {
                  earned: over ? Math.round(earned * 100) / 100 : null,
                  needsMarking: false,
                  correct: q.correct,
                  accepted: q.accepted,
                  explanation: q.explanation,
                }
              : null,
        },
      ]
    })
  }

  let lab = null
  if (c.kind === "lab" && showWork) {
    lab = c.items.map((item) => ({
      id: item.id,
      title: item.title,
      level: item.detail,
      points: item.points,
      href: problemHref(slug, item),
    }))
  }

  let project = null
  if (c.kind === "project") {
    const [s] = await getDb()
      .select()
      .from(courseProjectSubmissions)
      .where(
        and(
          eq(courseProjectSubmissions.checkpointId, c.id),
          eq(courseProjectSubmissions.userId, user.id)
        )
      )
    project = s
      ? {
          repoUrl: s.repoUrl,
          ref: s.ref,
          commitSha: s.commitSha,
          note: s.note,
          submittedAt: s.submittedAt,
          mark: s.mark,
          feedback: s.feedback,
        }
      : null
  }

  return {
    course: { id: course.id, title: course.title },
    module: { id: module.id, title: module.title },
    checkpoint: {
      id: c.id,
      kind: c.kind,
      title: c.title,
      instructions: c.instructions,
      timeLimit: c.timeLimit,
      weight: c.weight,
      max: c.max,
      count: c.items.length,
    },
    teacher,
    canGrade: teacher && canFor(cc.ctx, "assignments.grade", [[groupId]]),
    now,
    state: r.state,
    attempt: r.attempt
      ? { ...r.attempt, closesAt: attemptClosesAt(r.attempt) }
      : null,
    earned: r.final ? r.earned : null,
    quiz,
    lab,
    project,
  }
}

async function ownAttempt(checkpointId: string, userId: string) {
  const [row] = await getDb()
    .select()
    .from(courseAttempts)
    .where(
      and(
        eq(courseAttempts.checkpointId, checkpointId),
        eq(courseAttempts.userId, userId)
      )
    )
  return row ?? null
}

/** Starts the one attempt; starting again returns the same one. */
export async function startAttempt(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string
) {
  const { checkpoint: c } = await locate(
    slug,
    user,
    groupId,
    courseId,
    checkpointId
  )
  if (!TIMED.has(c.kind))
    throw new ApiError(
      400,
      "not_timed",
      "A project has nothing to start: hand it in."
    )
  const now = await dbNow()
  await getDb()
    .insert(courseAttempts)
    .values({
      checkpointId: c.id,
      userId: user.id,
      startedAt: now,
      endsAt: c.timeLimit
        ? new Date(now.getTime() + c.timeLimit * 60_000)
        : null,
    })
    .onConflictDoNothing()
  return { ok: true }
}

/** Saves quiz answers while the attempt is going (a few seconds' grace after it closes). */
export async function saveQuizAnswers(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string,
  answers: Record<string, string[] | string>
) {
  const { checkpoint: c } = await locate(
    slug,
    user,
    groupId,
    courseId,
    checkpointId
  )
  if (c.kind !== "quiz") throw notFound("Not a quiz")
  const attempt = await ownAttempt(c.id, user.id)
  if (!attempt) throw new ApiError(409, "not_started", "Start the quiz first.")
  const now = await dbNow()
  const closes = attemptClosesAt(attempt)
  const grace = finishedEarly(attempt) ? 0 : ATTEMPT_GRACE_MS
  if (closes && now.getTime() > closes.getTime() + grace) {
    throw new ApiError(
      409,
      "attempt_over",
      "Your time on this quiz is over; your saved answers count."
    )
  }
  const known = new Set(c.items.map((i) => i.id))
  const rows = Object.entries(answers)
    .filter(([id]) => known.has(id))
    .map(([questionId, answer]) => ({
      checkpointId: c.id,
      userId: user.id,
      questionId,
      answer,
      answeredAt: now,
    }))
  if (rows.length === 0) return { saved: 0 }
  await getDb()
    .insert(courseQuizAnswers)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        courseQuizAnswers.checkpointId,
        courseQuizAnswers.userId,
        courseQuizAnswers.questionId,
      ],
      set: { answer: sql.sql`excluded.answer`, answeredAt: now },
    })
  return { saved: rows.length }
}

/** Ends an attempt early. */
export async function finishAttempt(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string
) {
  const { checkpoint: c } = await locate(
    slug,
    user,
    groupId,
    courseId,
    checkpointId
  )
  const attempt = await ownAttempt(c.id, user.id)
  if (!attempt)
    throw new ApiError(
      409,
      "not_started",
      "Nothing to finish: it hasn't started."
    )
  const now = await dbNow()
  const closes = attemptClosesAt(attempt)
  if (!closes || closes > now) {
    await getDb()
      .update(courseAttempts)
      .set({ finishedAt: now })
      .where(
        and(
          eq(courseAttempts.checkpointId, c.id),
          eq(courseAttempts.userId, user.id)
        )
      )
  }
  return { ok: true }
}

/** Hands in (or replaces) a project; a replaced one waits to be marked again. */
export async function handInProject(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string,
  input: { repoUrl: string; note: string }
) {
  const { checkpoint: c, teacher } = await locate(
    slug,
    user,
    groupId,
    courseId,
    checkpointId
  )
  if (c.kind !== "project") throw notFound("Not a project")
  if (teacher)
    throw new ApiError(
      403,
      "teachers_mark",
      "Teachers mark projects; students hand them in."
    )
  const repo = await checkRepository(input.repoUrl)
  const values = {
    repoUrl: `https://github.com/${repo.owner}/${repo.repo}`,
    ref: repo.ref,
    commitSha: repo.sha,
    note: input.note,
    submittedAt: await dbNow(),
    mark: null,
    feedback: "",
    markedBy: null,
    markedAt: null,
  }
  await getDb()
    .insert(courseProjectSubmissions)
    .values({ ...values, checkpointId: c.id, userId: user.id })
    .onConflictDoUpdate({
      target: [
        courseProjectSubmissions.checkpointId,
        courseProjectSubmissions.userId,
      ],
      set: values,
    })
  return { ok: true, pinned: Boolean(repo.sha) }
}

/** The course and its checkpoints, for a teacher of this class. */
async function teacherCourse(
  slug: string,
  user: User,
  groupId: string,
  courseId: string
) {
  const view = await classCourses(slug, user, groupId)
  if (!view.teacher) throw notFound("Class not found")
  const course = view.courses.find((c) => c.id === courseId)
  if (!course) throw notFound("This class doesn't have that course")
  const modules = (await outlineOf([courseId])).get(courseId) ?? []
  const cc = await classContext(slug, user, groupId)
  return { course, modules, cc }
}

/**
 * The class's grade sheet for a course: every student, each checkpoint's score and state,
 * and the course grade (counting only what's final, and so far).
 */
export async function courseGrades(
  slug: string,
  user: User,
  groupId: string,
  courseId: string
) {
  const { course, modules, cc } = await teacherCourse(
    slug,
    user,
    groupId,
    courseId
  )
  const checkpoints = modules.flatMap((m) =>
    m.checkpoints.map((c) => ({ ...c, module: m.title }))
  )
  const students = await studentsIn(cc)
  const results = await checkpointResults(
    students.map((s) => s.id),
    checkpoints,
    await dbNow()
  )
  const projects = checkpoints.filter((c) => c.kind === "project")
  const handedIn = projects.length
    ? await getDb()
        .select()
        .from(courseProjectSubmissions)
        .where(
          inArray(
            courseProjectSubmissions.checkpointId,
            projects.map((c) => c.id)
          )
        )
    : []
  const shares = gradeShares(checkpoints.map((c) => (c.max > 0 ? c.weight : 0)))
  return {
    course: { id: course.id, title: course.title },
    canGrade: canFor(cc.ctx, "assignments.grade", [[groupId]]),
    checkpoints: checkpoints.map((c, i) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      module: c.module,
      weight: c.weight,
      max: c.max,
      share: shares[i]!,
    })),
    students: students.map((s) => {
      const mine = results.get(s.id)!
      const scores = checkpoints.map((c) => {
        const r = mine.get(c.id)!
        const sub = handedIn.find(
          (h) => h.userId === s.id && h.checkpointId === c.id
        )
        return {
          checkpointId: c.id,
          state: r.state,
          earned: r.final ? r.earned : null,
          /** Live score of a running attempt, for the teacher. */
          sofar: r.state === "running" ? r.earned : null,
          project: sub
            ? {
                repoUrl: sub.repoUrl,
                ref: sub.ref,
                commitSha: sub.commitSha,
                note: sub.note,
                submittedAt: sub.submittedAt,
                mark: sub.mark,
                feedback: sub.feedback,
              }
            : null,
        }
      })
      const g = courseGrade(
        checkpoints.map((c) => {
          const r = mine.get(c.id)!
          return {
            weight: c.weight,
            earned: r.earned,
            max: c.max,
            final: r.final,
          }
        })
      )
      return { id: s.id, name: s.name, email: s.email, scores, ...g }
    }),
  }
}

async function gradable(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string,
  studentId: string
) {
  const { modules, cc } = await teacherCourse(slug, user, groupId, courseId)
  if (!canFor(cc.ctx, "assignments.grade", [[groupId]])) {
    throw new ApiError(
      403,
      "forbidden",
      "Your role can't grade this class's work."
    )
  }
  const checkpoint = modules
    .flatMap((m) => m.checkpoints)
    .find((c) => c.id === checkpointId)
  if (!checkpoint) throw notFound("Not in this course")
  const student = (await studentsIn(cc)).find((s) => s.id === studentId)
  if (!student) throw notFound("Not a student of this class")
  return { checkpoint, student, cc }
}

/** A teacher's mark and feedback on a handed-in project; null takes the mark away. */
export async function markProject(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string,
  studentId: string,
  input: { mark: number | null; feedback: string }
) {
  const { checkpoint, student, cc } = await gradable(
    slug,
    user,
    groupId,
    courseId,
    checkpointId,
    studentId
  )
  if (checkpoint.kind !== "project") throw notFound("Not a project")
  if (input.mark !== null && input.mark > checkpoint.points) {
    throw new ApiError(
      400,
      "too_many_points",
      `The mark is out of ${checkpoint.points}.`
    )
  }
  const [row] = await getDb()
    .update(courseProjectSubmissions)
    .set({
      mark: input.mark,
      feedback: input.feedback,
      markedBy: input.mark === null ? null : user.id,
      markedAt: input.mark === null ? null : new Date(),
    })
    .where(
      and(
        eq(courseProjectSubmissions.checkpointId, checkpointId),
        eq(courseProjectSubmissions.userId, studentId)
      )
    )
    .returning()
  if (!row)
    throw new ApiError(409, "not_handed_in", "Nothing handed in yet to mark.")
  await writeAudit(
    cc.ctx,
    "course.project_mark",
    `Marked ${student.name}'s ${checkpoint.title}`,
    {
      checkpoint: checkpoint.title,
      student: student.name,
      mark: input.mark,
    }
  )
  return { ok: true }
}

/** Lets a student take a quiz or lab again: their attempt and answers go. */
export async function resetAttempt(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  checkpointId: string,
  studentId: string
) {
  const { checkpoint, student, cc } = await gradable(
    slug,
    user,
    groupId,
    courseId,
    checkpointId,
    studentId
  )
  if (!TIMED.has(checkpoint.kind))
    throw notFound("Only quizzes and labs have attempts")
  await getDb().transaction(async (tx) => {
    await tx
      .delete(courseQuizAnswers)
      .where(
        and(
          eq(courseQuizAnswers.checkpointId, checkpointId),
          eq(courseQuizAnswers.userId, studentId)
        )
      )
    await tx
      .delete(courseAttempts)
      .where(
        and(
          eq(courseAttempts.checkpointId, checkpointId),
          eq(courseAttempts.userId, studentId)
        )
      )
  })
  await writeAudit(
    cc.ctx,
    "course.attempt_reset",
    `Let ${student.name} take ${checkpoint.title} again`,
    {
      checkpoint: checkpoint.title,
      student: student.name,
    }
  )
  return { ok: true }
}
