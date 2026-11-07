import { examEvents, examSessions, getDb, sql } from "@workspace/db"
import { sittingClosesAt, type ExamSitting } from "@workspace/judge"

const { and, asc, count, eq, inArray } = sql

export type Sitting = ExamSitting & { ip: string | null }

/** Sittings of these exams, by assignment then student; for one student or everyone. */
export async function sittingsOn(assignmentIds: string[], userId?: string) {
  const byAssignment = new Map<string, Map<string, Sitting>>()
  if (assignmentIds.length === 0) return byAssignment
  const rows = await getDb()
    .select()
    .from(examSessions)
    .where(
      and(
        inArray(examSessions.assignmentId, assignmentIds),
        userId ? eq(examSessions.userId, userId) : undefined
      )
    )
  for (const row of rows) {
    const own = byAssignment.get(row.assignmentId) ?? new Map<string, Sitting>()
    own.set(row.userId, row)
    byAssignment.set(row.assignmentId, own)
  }
  return byAssignment
}

export type SittingStatus = "not_started" | "in_progress" | "finished"

export function sittingStatus(
  sitting: Sitting | undefined,
  now = new Date()
): SittingStatus {
  if (!sitting) return "not_started"
  return now < sittingClosesAt(sitting) ? "in_progress" : "finished"
}

/** A sitting as students and teachers see it. */
export function presentSitting(sitting: Sitting | undefined, now = new Date()) {
  return {
    status: sittingStatus(sitting, now),
    startedAt: sitting?.startedAt ?? null,
    endsAt: sitting ? sittingClosesAt(sitting) : null,
    /** Whether the student pressed Finish (rather than running out of time). */
    finishedEarly: Boolean(
      sitting?.finishedAt && sitting.finishedAt < sitting.endsAt
    ),
  }
}

/** How many warnings each student has on an exam. */
export async function warningCounts(assignmentId: string) {
  const rows = await getDb()
    .select({ userId: examEvents.userId, n: count() })
    .from(examEvents)
    .where(eq(examEvents.assignmentId, assignmentId))
    .groupBy(examEvents.userId)
  return new Map(rows.map((r) => [r.userId, r.n]))
}

export function eventsOf(assignmentId: string, userId: string) {
  return getDb()
    .select({
      kind: examEvents.kind,
      detail: examEvents.detail,
      at: examEvents.at,
    })
    .from(examEvents)
    .where(
      and(
        eq(examEvents.assignmentId, assignmentId),
        eq(examEvents.userId, userId)
      )
    )
    .orderBy(asc(examEvents.at))
    .limit(500)
}
