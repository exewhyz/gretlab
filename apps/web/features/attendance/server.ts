import {
  attendance,
  getDb,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  ATTENDANCE_STATUSES,
  countsAsPresent,
  enabledModules,
  summarizeAttendance,
  type AttendanceStatus,
} from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import { classContext, studentsIn } from "@/features/classes/server"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { onLeave } from "@/features/leave/server"
import { tellParents } from "@/features/notifications/server"
import { ApiError, notFound } from "@/lib/api/route"

/** The day before a "YYYY-MM-DD" day. */
const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/*
 * The Attendance module: a register per group, day and (optionally) period. A register is a
 * teaching session of kind "register" (no minutes or topics), so the marks share one store
 * with attendance taken while logging a class, and every attendance figure (class summary,
 * early warnings, the low-attendance reminder) counts both. Schools usually take one
 * register a day (period ""); colleges one per period or subject.
 */

const { and, asc, eq, gte, inArray, lt } = sql

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

export const registerQuerySchema = z.object({
  groupId: z.uuid(),
  day: z.string().regex(DAY, "Choose the day"),
  period: z.string().trim().max(60).default(""),
})

export const registerSaveSchema = registerQuerySchema.extend({
  marks: z
    .array(z.object({ userId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES) }))
    .max(5000),
})

function needModule(ctx: OrgContext) {
  if (!enabledModules(ctx.org.type, ctx.org.modules).has("attendance")) {
    throw notFound("Attendance isn't switched on for this organization.")
  }
}

async function access(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  needModule(cc.ctx)
  const mark = canFor(cc.ctx, "attendance.mark", [[groupId]])
  const view = mark || canFor(cc.ctx, "attendance.view", [[groupId]])
  return { cc, mark, view }
}

async function findRegister(groupId: string, day: string, period: string) {
  const [row] = await getDb()
    .select()
    .from(teachingSessions)
    .where(
      and(
        eq(teachingSessions.groupId, groupId),
        eq(teachingSessions.day, day),
        eq(teachingSessions.period, period),
        eq(teachingSessions.kind, "register")
      )
    )
  return row ?? null
}

/** One day's register for a group: its students and their marks so far. */
export async function getRegister(
  slug: string,
  user: User,
  input: z.infer<typeof registerQuerySchema>
) {
  const { cc, mark, view } = await access(slug, user, input.groupId)
  if (!view)
    throw new ApiError(
      403,
      "forbidden",
      "Seeing attendance for this group isn't part of your role."
    )
  const [students, register] = await Promise.all([
    studentsIn(cc),
    findRegister(input.groupId, input.day, input.period),
  ])
  const away = enabledModules(cc.ctx.org.type, cc.ctx.org.modules).has("leave")
    ? await onLeave(cc.ctx.org.id, students.map((s) => s.id), input.day)
    : new Map<string, string>()
  const marks = register
    ? await getDb()
        .select({ userId: attendance.userId, status: attendance.status })
        .from(attendance)
        .where(eq(attendance.sessionId, register.id))
    : []
  const takenBy = register?.teacherId
    ? (
        await getDb()
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, register.teacherId))
      )[0]
    : null
  return {
    groupId: input.groupId,
    day: input.day,
    period: input.period,
    canMark: mark,
    taken: register !== null,
    takenBy: takenBy ? (takenBy.name ?? takenBy.email) : null,
    students: students.map((s) => ({
      id: s.id,
      name: s.name ?? s.handle ?? s.email,
      status:
        (marks.find((m) => m.userId === s.id)?.status as
          AttendanceStatus | undefined) ?? null,
      /** On approved leave that day (Leave module): the reason's name. */
      onLeave: away.get(s.id) ?? null,
    })),
  }
}

/** Takes (or corrects) a register; the marks sent replace any before. */
export async function saveRegister(
  slug: string,
  user: User,
  input: z.infer<typeof registerSaveSchema>
) {
  const { cc, mark } = await access(slug, user, input.groupId)
  if (!mark)
    throw new ApiError(
      403,
      "forbidden",
      "Taking attendance for this group isn't part of your role."
    )
  if (input.day > (await today())) {
    throw new ApiError(
      400,
      "future_day",
      "Attendance can't be taken for a day that hasn't come yet."
    )
  }
  const students = new Set((await studentsIn(cc)).map((s) => s.id))
  if (input.marks.some((m) => !students.has(m.userId))) {
    throw new ApiError(
      400,
      "not_in_class",
      "Attendance can only be taken for students of this group."
    )
  }
  const group =
    cc.ctx.groups.find((g) => g.id === input.groupId)?.name ?? "a group"
  const result = await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: teachingSessions.id })
      .from(teachingSessions)
      .where(
        and(
          eq(teachingSessions.groupId, input.groupId),
          eq(teachingSessions.day, input.day),
          eq(teachingSessions.period, input.period),
          eq(teachingSessions.kind, "register")
        )
      )
    const id =
      existing?.id ??
      (
        await tx
          .insert(teachingSessions)
          .values({
            orgId: cc.ctx.org.id,
            groupId: input.groupId,
            teacherId: user.id,
            day: input.day,
            period: input.period,
            kind: "register",
            minutes: 0,
          })
          .returning({ id: teachingSessions.id })
      )[0]!.id
    const before = await tx
      .select({ userId: attendance.userId, status: attendance.status })
      .from(attendance)
      .where(eq(attendance.sessionId, id))
    await tx.delete(attendance).where(eq(attendance.sessionId, id))
    if (input.marks.length) {
      await tx.insert(attendance).values(
        input.marks.map((m) => ({
          sessionId: id,
          userId: m.userId,
          status: m.status,
          present: countsAsPresent(m.status),
        }))
      )
    }
    const wasAbsent = new Set(
      before.filter((b) => b.status === "absent").map((b) => b.userId)
    )
    const newlyAbsent = input.marks
      .filter((m) => m.status === "absent" && !wasAbsent.has(m.userId))
      .map((m) => m.userId)
    return { id, corrected: Boolean(existing), newlyAbsent }
  })
  // Parents hear about an absence the same day (or the next, for a late register), once;
  // not for a child on leave they already know about.
  if (result.newlyAbsent.length && enabledModules(cc.ctx.org.type, cc.ctx.org.modules).has("leave")) {
    const away = await onLeave(cc.ctx.org.id, result.newlyAbsent, input.day)
    result.newlyAbsent = result.newlyAbsent.filter((id) => !away.has(id))
  }
  if (result.newlyAbsent.length && input.day >= dayBefore(await today())) {
    const when = input.day === (await today()) ? "today" : `on ${input.day}`
    await tellParents(cc.ctx.org.id, result.newlyAbsent, (child) => ({
      kind: "child_absent",
      title: `${child} was marked absent ${when}`,
      body: `${group}${input.period ? `, ${input.period}` : ""}. Contact the school if this isn't right.`,
    }))
  }
  await writeAudit(
    cc.ctx,
    result.corrected ? "attendance.correct" : "attendance.take",
    `${result.corrected ? "Corrected" : "Took"} attendance for ${group} on ${input.day}${input.period ? ` (${input.period})` : ""}`,
    { marked: input.marks.length }
  )
  return { saved: input.marks.length }
}

/** A group's month: each register as a column, each student's marks and totals. */
export async function attendanceMonth(
  slug: string,
  user: User,
  groupId: string,
  month: string
) {
  if (!MONTH.test(month))
    throw new ApiError(400, "bad_month", "Choose a month.")
  if (!z.uuid().safeParse(groupId).success) throw notFound("Class not found")
  const { cc, view } = await access(slug, user, groupId)
  if (!view)
    throw new ApiError(
      403,
      "forbidden",
      "Seeing attendance for this group isn't part of your role."
    )
  const [y, m] = month.split("-").map(Number) as [number, number]
  const next =
    m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  const db = getDb()
  const [students, sessions] = await Promise.all([
    studentsIn(cc),
    db
      .select({
        id: teachingSessions.id,
        day: teachingSessions.day,
        period: teachingSessions.period,
        kind: teachingSessions.kind,
      })
      .from(teachingSessions)
      .where(
        and(
          inArray(teachingSessions.groupId, cc.inside),
          gte(teachingSessions.day, `${month}-01`),
          lt(teachingSessions.day, `${next}-01`)
        )
      )
      .orderBy(asc(teachingSessions.day), asc(teachingSessions.period)),
  ])
  const marks = sessions.length
    ? await db
        .select({
          sessionId: attendance.sessionId,
          userId: attendance.userId,
          status: attendance.status,
        })
        .from(attendance)
        .where(
          inArray(
            attendance.sessionId,
            sessions.map((s) => s.id)
          )
        )
    : []
  // Only sessions where attendance was taken become columns.
  const taken = sessions.filter((s) => marks.some((x) => x.sessionId === s.id))
  return {
    month,
    columns: taken.map((s) => ({
      id: s.id,
      day: s.day,
      period: s.period,
      kind: s.kind,
    })),
    students: students.map((s) => {
      const own = marks.filter((x) => x.userId === s.id)
      return {
        id: s.id,
        name: s.name ?? s.handle ?? s.email,
        marks: Object.fromEntries(own.map((x) => [x.sessionId, x.status])),
        summary: summarizeAttendance(own.map((x) => x.status)),
      }
    }),
  }
}

/** The groups this person may take or see attendance for, to choose a register. */
export async function attendanceGroups(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const groups = ctx.groups
    .filter(
      (g) =>
        canFor(ctx, "attendance.mark", [[g.id]]) ||
        canFor(ctx, "attendance.view", [[g.id]])
    )
    .map((g) => ({ id: g.id, name: g.name, parentId: g.parentId }))
  // Keep the tree whole: a reachable group's ancestors are shown (not chosen) above it.
  const byId = new Map(ctx.groups.map((g) => [g.id, g]))
  const shown = new Map(groups.map((g) => [g.id, g]))
  for (const g of groups) {
    for (
      let p = g.parentId;
      p && !shown.has(p);
      p = byId.get(p)?.parentId ?? null
    ) {
      const parent = byId.get(p)!
      shown.set(p, {
        id: parent.id,
        name: parent.name,
        parentId: parent.parentId,
      })
    }
  }
  return {
    levels: ctx.org.groupLevels,
    choosable: groups.map((g) => g.id),
    groups: [...shown.values()],
    today: await today(),
  }
}
