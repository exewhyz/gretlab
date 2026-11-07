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

import { presentSitting, sittingsOn } from "./sittings"

const { and, count, eq, isNotNull } = sql

/**
 * The database's clock. Submissions are stamped by it, so sittings must be too: the web
 * server's clock can differ (a container VM drifts after a laptop sleeps), and a sitting
 * started by one clock and judged by another would drop work done in it.
 */
async function dbNow(): Promise<Date> {
  const [row] = (await getDb().execute(sql.sql`select now() as now`)) as unknown as {
    now: Date | string
  }[]
  return new Date(row!.now)
}

/** At most this many recorded events per sitting, so a looping page can't fill the table. */
const MAX_EVENTS = 500

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

async function record(
  assignmentId: string,
  userId: string,
  kind: ExamEventKind,
  detail = ""
) {
  const [{ n }] = (await getDb()
    .select({ n: count() })
    .from(examEvents)
    .where(
      and(eq(examEvents.assignmentId, assignmentId), eq(examEvents.userId, userId))
    )) as [{ n: number }]
  if (n >= MAX_EVENTS) return
  await getDb()
    .insert(examEvents)
    .values({ assignmentId, userId, kind, detail: detail.slice(0, 200) })
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

/** Exams this student is sitting right now that include this problem. */
async function sittingNow(userId: string, problemId: string) {
  const rows = await getDb()
    .select({ assignment: assignments, sitting: examSessions })
    .from(examSessions)
    .innerJoin(assignments, eq(examSessions.assignmentId, assignments.id))
    .innerJoin(
      assignmentProblems,
      eq(assignmentProblems.assignmentId, assignments.id)
    )
    .where(
      and(
        eq(examSessions.userId, userId),
        eq(assignmentProblems.problemId, problemId),
        isNotNull(assignments.exam)
      )
    )
  const now = await dbNow()
  return rows.filter((r) => now < sittingClosesAt(r.sitting))
}

/** During a sitting, its problems can only be submitted from the exam's networks. */
export async function guardExamSubmission(
  user: User,
  problemId: string,
  ip: string | null
) {
  for (const { assignment } of await sittingNow(user.id, problemId)) {
    if (!ipAllowed(ip, assignment.exam?.networks ?? [])) {
      await record(assignment.id, user.id, "other_network", ip ?? "unknown")
      throw new ApiError(
        403,
        "exam_network",
        "During the exam, submit from the lab's network."
      )
    }
  }
}

/** Editorials, solutions and hints stay closed while a sitting uses the problem. */
export async function guardExamSolutions(userId: string, problemId: string) {
  if ((await sittingNow(userId, problemId)).length > 0) {
    throw new ApiError(
      403,
      "exam_running",
      "Hidden while you're taking an exam with this problem."
    )
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
