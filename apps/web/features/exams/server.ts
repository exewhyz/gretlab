import {
  assignmentProblems,
  assignments,
  examEvents,
  examSessions,
  getDb,
  sql,
  type User,
} from "@workspace/db"
import {
  examEndsAt,
  ipAllowed,
  sittingClosesAt,
  type ExamEventKind,
} from "@workspace/judge"

import { findAssignment } from "@/features/assignments/server"
import { requireFeature } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"

import { dbNow, presentSitting, sittingsOn } from "./sittings"

const { and, eq, gt, isNotNull } = sql

/** At most this many recorded events of each kind per sitting. */
const MAX_EVENTS = 200

async function examFor(slug: string, user: User) {
  await requireFeature("assignments.enabled")
  const { assignment, access } = await findAssignment(slug, user)
  if (!assignment.exam || !assignment.published) {
    throw notFound("Exam not found")
  }
  return { assignment, exam: assignment.exam, access }
}

/**
 * Starts a student's one sitting. Pressing Start again (another tab, a double click) gives
 * back the same sitting; once it's over there is no second one.
 */
export async function startExam(slug: string, user: User, ip: string | null) {
  const { assignment, exam } = await examFor(slug, user)
  const now = await dbNow()
  if (now < assignment.opensAt) {
    throw new ApiError(409, "exam_not_open", "The exam hasn't opened yet.")
  }
  if (now >= assignment.dueAt) {
    throw new ApiError(409, "exam_over", "The exam has closed.")
  }
  const existing = (await sittingsOn([assignment.id], user.id))
    .get(assignment.id)
    ?.get(user.id)
  if (existing) {
    if (now >= sittingClosesAt(existing)) {
      throw new ApiError(
        409,
        "exam_over",
        "You've already taken this exam. Ask your teacher if you need another attempt."
      )
    }
    return presentSitting(existing, now)
  }
  // Everyone starts within a window, so nobody can brief a late starter.
  if (
    exam.startWithin &&
    now.getTime() > assignment.opensAt.getTime() + exam.startWithin * 60_000
  ) {
    throw new ApiError(
      409,
      "exam_start_closed",
      "The time to start this exam has passed. Ask your teacher."
    )
  }
  if (!ipAllowed(ip, exam.networks)) {
    throw new ApiError(
      403,
      "exam_network",
      "This exam can only be started from the lab's network."
    )
  }
  const [created] = await getDb()
    .insert(examSessions)
    .values({
      assignmentId: assignment.id,
      userId: user.id,
      startedAt: now,
      endsAt: examEndsAt(now, assignment.dueAt, exam.minutes),
      ip,
    })
    // Two tabs pressing Start at once both get the one sitting.
    .onConflictDoNothing()
    .returning()
  const sitting =
    created ??
    (await sittingsOn([assignment.id], user.id)).get(assignment.id)?.get(user.id)
  return presentSitting(sitting, now)
}

/** Hands in early: nothing submitted afterwards counts. */
export async function finishExam(slug: string, user: User) {
  const { assignment } = await examFor(slug, user)
  const now = await dbNow()
  const sitting = (await sittingsOn([assignment.id], user.id))
    .get(assignment.id)
    ?.get(user.id)
  if (!sitting) throw new ApiError(409, "exam_not_started", "Start the exam first.")
  if (now < sittingClosesAt(sitting)) {
    await getDb()
      .update(examSessions)
      .set({ finishedAt: now })
      .where(
        and(
          eq(examSessions.assignmentId, assignment.id),
          eq(examSessions.userId, user.id)
        )
      )
    return presentSitting({ ...sitting, finishedAt: now }, now)
  }
  return presentSitting(sitting, now)
}

/**
 * Records an event, at most MAX_EVENTS of each kind per sitting, so a student who floods
 * one kind can't push out the others (the count and the insert are one statement).
 */
async function record(
  assignmentId: string,
  userId: string,
  kind: ExamEventKind,
  detail = ""
) {
  await getDb().execute(sql.sql`
    insert into ${examEvents} (assignment_id, user_id, kind, detail)
    select ${assignmentId}, ${userId}, ${kind}, ${detail.slice(0, 200)}
    where (
      select count(*) from ${examEvents}
      where assignment_id = ${assignmentId} and user_id = ${userId} and kind = ${kind}
    ) < ${MAX_EVENTS}
  `)
}

/** What the student's browser noticed: leaving the tab or fullscreen, pasting. */
export async function recordExamEvent(
  slug: string,
  user: User,
  kind: ExamEventKind,
  detail?: string
) {
  const { assignment } = await examFor(slug, user)
  const sitting = (await sittingsOn([assignment.id], user.id))
    .get(assignment.id)
    ?.get(user.id)
  // Only during the sitting; afterwards the student is free to do anything.
  if (!sitting || (await dbNow()) >= sittingClosesAt(sitting)) {
    return { recorded: false }
  }
  await record(assignment.id, user.id, kind, detail)
  return { recorded: true }
}

/** The exam this student is sitting right now, if any, with its problems. */
export async function activeExam(userId: string) {
  const now = await dbNow()
  const rows = await getDb()
    .select({ assignment: assignments, sitting: examSessions })
    .from(examSessions)
    .innerJoin(assignments, eq(examSessions.assignmentId, assignments.id))
    .where(
      and(
        eq(examSessions.userId, userId),
        gt(examSessions.endsAt, now),
        isNotNull(assignments.exam)
      )
    )
  const live = rows.find((r) => now < sittingClosesAt(r.sitting))
  if (!live) return null
  const problemIds = (
    await getDb()
      .select({ id: assignmentProblems.problemId })
      .from(assignmentProblems)
      .where(eq(assignmentProblems.assignmentId, live.assignment.id))
  ).map((r) => r.id)
  return {
    assignment: live.assignment,
    sitting: live.sitting,
    problemIds,
    closesAt: sittingClosesAt(live.sitting),
    now,
  }
}

const locked = (message: string) => new ApiError(403, "exam_locked", message)

/**
 * During a sitting, only the exam's problems can be run or submitted (no playground, no
 * other problems, contests included), and only from the exam's networks.
 */
export async function guardExamSubmission(
  user: User,
  problemId: string | null,
  ip: string | null
) {
  const exam = await activeExam(user.id)
  if (!exam) return false
  if (!problemId || !exam.problemIds.includes(problemId)) {
    throw locked("During your exam, only the exam's problems can be run.")
  }
  if (!ipAllowed(ip, exam.assignment.exam?.networks ?? [])) {
    await record(exam.assignment.id, user.id, "other_network", ip ?? "unknown")
    throw new ApiError(
      403,
      "exam_network",
      "During the exam, submit from the lab's network."
    )
  }
  return true
}

/** Editorials and solutions, of any problem, are closed during a sitting. */
export async function guardExamSolutions(userId: string) {
  if (await activeExam(userId)) {
    throw new ApiError(
      403,
      "exam_running",
      "Editorials and solutions are closed during your exam."
    )
  }
}

/**
 * What a student may read of their own work during a sitting: the exam's problems, and
 * only from when the sitting began (earlier code and notes would carry answers in). null
 * when they aren't sitting an exam.
 */
export async function examScope(userId: string) {
  const exam = await activeExam(userId)
  return exam
    ? { problemIds: exam.problemIds, since: exam.sitting.startedAt, exam }
    : null
}

/** The exam the student is sitting, for the site-wide lock. */
export async function myActiveExam(user: User) {
  const exam = await activeExam(user.id)
  if (!exam) return null
  const items = await getDb()
    .select({ position: assignmentProblems.position })
    .from(assignmentProblems)
    .where(eq(assignmentProblems.assignmentId, exam.assignment.id))
  return {
    slug: exam.assignment.slug,
    title: exam.assignment.title,
    fullscreen: exam.assignment.exam?.fullscreen ?? false,
    endsAt: exam.closesAt,
    now: exam.now,
    problems: items.length,
  }
}

/** A network check for writes that carry code in (saved drafts). */
export async function guardExamNetwork(user: User, problemId: string, ip: string | null) {
  const exam = await activeExam(user.id)
  if (!exam) return
  if (!exam.problemIds.includes(problemId)) {
    throw locked("During your exam, only the exam's problems can be worked on.")
  }
  if (!ipAllowed(ip, exam.assignment.exam?.networks ?? [])) {
    throw new ApiError(403, "exam_network", "During the exam, work from the lab's network.")
  }
}

/**
 * More time for one student (a crash, a power cut): the sitting reopens if it had ended and
 * runs this many minutes longer, past the due time if need be. Their work so far still counts.
 */
export async function extendSitting(
  assignmentId: string,
  userId: string,
  minutes: number
) {
  const sitting = (await sittingsOn([assignmentId], userId))
    .get(assignmentId)
    ?.get(userId)
  if (!sitting) {
    throw new ApiError(409, "exam_not_started", "They haven't started the exam.")
  }
  const now = await dbNow()
  const from = sittingClosesAt(sitting) > now ? sittingClosesAt(sitting) : now
  const endsAt = new Date(from.getTime() + minutes * 60_000)
  await getDb()
    .update(examSessions)
    .set({ endsAt, finishedAt: null })
    .where(
      and(
        eq(examSessions.assignmentId, assignmentId),
        eq(examSessions.userId, userId)
      )
    )
  return presentSitting({ ...sitting, endsAt, finishedAt: null }, now)
}
