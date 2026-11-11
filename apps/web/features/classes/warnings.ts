import {
  attendance,
  getDb,
  sql,
  submissions,
  teachingSessions,
  type User,
} from "@workspace/db"
import { describeReason, warningFor, WARNING_RULES } from "@workspace/judge"

import { getGradebook } from "@/features/assignments/server"
import { notify } from "@/features/notifications/server"
import { groupsFor, needFor, writeAudit } from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import { classContext, classwork, studentsIn } from "./server"

/*
 * Early warnings for a class: students who need attention and why (packages/judge
 * warnings.ts has the rules). Worked out on each request from their work, attendance and
 * last submission, so they're always current; teachers who see the class's grades only.
 */

const { and, eq, inArray, max } = sql

export async function classWarnings(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  needFor(ctx, "gradebook.view", [[groupId]])
  const [students, work] = await Promise.all([studentsIn(cc), classwork(slug, user, groupId)])
  const published = work.assignments.filter((a) => a.published && a.phase !== "upcoming")
  const scope = groupsFor(ctx, "gradebook.view")
  const ids = students.map((s) => s.id)
  const [books, active, present] = await Promise.all([
    Promise.all(published.map((a) => getGradebook(a.id, ctx.org.id, scope))),
    ids.length
      ? getDb()
          .select({ userId: submissions.userId, last: max(submissions.createdAt) })
          .from(submissions)
          .where(inArray(submissions.userId, ids))
          .groupBy(submissions.userId)
      : [],
    ids.length
      ? getDb()
          .select({
            userId: attendance.userId,
            total: sql.count(),
            present: sql.sql<number>`count(*) filter (where ${attendance.present})`,
          })
          .from(attendance)
          .innerJoin(teachingSessions, eq(attendance.sessionId, teachingSessions.id))
          .where(and(inArray(attendance.userId, ids), inArray(teachingSessions.groupId, cc.inside)))
          .groupBy(attendance.userId)
      : [],
  ])
  const now = new Date()
  const list = students.map((s) => {
    const finished: { earned: number; total: number; missed: boolean }[] = []
    let openUnfinished = 0
    for (const [i, a] of published.entries()) {
      const book = books[i]!
      // Only work set for them: not being in an assignment's audience isn't missing it.
      const row = book.rows.find((r) => r.email === s.email)
      if (!row) continue
      const due = new Date(row.extension?.dueAt ?? a.dueAt)
      if (due > now) {
        if (row.earned < book.total) openUnfinished += 1
        continue
      }
      finished.push({
        earned: row.earned,
        total: book.total,
        missed:
          row.cells.every((c) => c.status === "missing") &&
          !row.quiz?.answered &&
          !(row.projects?.submitted ?? 0),
      })
    }
    const seen = active.find((x) => x.userId === s.id)?.last
    const att = present.find((x) => x.userId === s.id)
    const warning = warningFor(
      {
        finished,
        openUnfinished,
        lastActive: seen ? new Date(seen) : null,
        attendance: att ? { present: Number(att.present), total: att.total } : null,
      },
      now
    )
    return {
      id: s.id,
      name: s.name ?? s.handle ?? s.email,
      email: s.email,
      level: warning.level,
      reasons: warning.reasons.map(describeReason),
    }
  })
  const rank = { risk: 0, watch: 1 } as const
  return {
    rules: WARNING_RULES,
    students: list
      .filter((s) => s.level !== null)
      .sort((a, b) => rank[a.level!] - rank[b.level!] || a.name.localeCompare(b.name)),
    total: students.length,
  }
}

/** A teacher's note to some of the class's students, to their bell (and email). */
export async function nudgeStudents(
  slug: string,
  user: User,
  groupId: string,
  input: { userIds: string[]; message: string }
) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "gradebook.view", [[groupId]])
  const students = new Set((await studentsIn(cc)).map((s) => s.id))
  if (input.userIds.some((id) => !students.has(id))) {
    throw new ApiError(400, "not_in_class", "Notes go only to students in this class.")
  }
  const name = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "your class"
  await notify(input.userIds, {
    kind: "teacher_note",
    title: `A note from ${user.name ?? "your teacher"} (${name})`,
    body: input.message,
    href: `/orgs/${slug}/classes/${groupId}`,
    orgId: cc.ctx.org.id,
  })
  // The note's words stay between them; the log records that one was sent.
  await writeAudit(cc.ctx, "class.note", `Sent a note to ${input.userIds.length} students in ${name}`)
  return { sent: input.userIds.length }
}
