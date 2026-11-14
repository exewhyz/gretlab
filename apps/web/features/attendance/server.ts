import {
  academicTerms,
  academicYears,
  attendance,
  getDb,
  groupMembers,
  organizations,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  ATTENDANCE_STATUSES,
  classesToReach,
  countsAsPresent,
  eligibility,
  readAttendanceSettings,
  enabledModules,
  summarizeAttendance,
  type AttendanceStatus,
} from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { today } from "@/features/catalog/server"
import { classContext, studentsIn } from "@/features/classes/server"
import { subjectsOfGroups } from "@/features/subjects/server"
import {
  canFor,
  groupChain,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { onLeave } from "@/features/leave/server"
import { tellParents } from "@/features/notifications/server"
import { ApiError, notFound } from "@/lib/api/route"

/** The day before a "YYYY-MM-DD" day. */
const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10)

/*
 * The Attendance module: a register per group, day and (optionally) period. A register is a
 * teaching session of kind "register" (no minutes or topics), so the marks share one store
 * with attendance taken while logging a class, and every attendance figure (class summary,
 * early warnings, the low-attendance reminder) counts both. Schools usually take one
 * register a day (period ""); colleges one per period or subject.
 */

const { and, asc, eq, gte, inArray, isNull, isNotNull, lt, lte } = sql

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

export const registerQuerySchema = z.object({
  groupId: z.uuid(),
  day: z.string().regex(DAY, "Choose the day"),
  period: z.string().trim().max(60).default(""),
  /** The course it's for (a college's course-wise attendance); null for none. */
  subjectId: z.uuid().nullable().default(null),
})

export const attendanceSettingsSchema = z.object({
  minPercent: z.number().int().min(0).max(100),
})

export const registerSaveSchema = registerQuerySchema.extend({
  marks: z
    .array(z.object({ userId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES) }))
    .max(5000),
})

function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("attendance")) {
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

const sameCourse = (subjectId: string | null) =>
  subjectId
    ? eq(teachingSessions.subjectId, subjectId)
    : isNull(teachingSessions.subjectId)

async function findRegister(
  groupId: string,
  day: string,
  period: string,
  subjectId: string | null
) {
  const [row] = await getDb()
    .select()
    .from(teachingSessions)
    .where(
      and(
        eq(teachingSessions.groupId, groupId),
        eq(teachingSessions.day, day),
        eq(teachingSessions.period, period),
        sameCourse(subjectId),
        eq(teachingSessions.kind, "register")
      )
    )
  return row ?? null
}

/** The courses a class takes (its own and its grade's), for registers by course. */
async function coursesOf(cc: { ctx: OrgContext; groupId: string }) {
  if (!cc.ctx.modules.has("subjects")) return []
  const rows = await subjectsOfGroups(cc.ctx.org.id, [
    ...groupChain(cc.ctx, cc.groupId),
  ])
  const seen = new Map<string, { id: string; name: string; code: string }>()
  for (const r of rows)
    if (!seen.has(r.subjectId))
      seen.set(r.subjectId, { id: r.subjectId, name: r.name, code: r.code })
  return [...seen.values()].sort((a, b) => byName(a.name, b.name))
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
  const [students, register, courses] = await Promise.all([
    studentsIn(cc),
    findRegister(input.groupId, input.day, input.period, input.subjectId),
    coursesOf(cc),
  ])
  const away = cc.ctx.modules.has("leave")
    ? await onLeave(
        cc.ctx.org.id,
        students.map((s) => s.id),
        input.day
      )
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
    subjectId: input.subjectId,
    /** Courses a register can be for (Subjects module). */
    courses,
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
  if (
    input.subjectId &&
    !(await coursesOf(cc)).some((c) => c.id === input.subjectId)
  )
    throw new ApiError(
      400,
      "not_a_course",
      "That class doesn't take that course."
    )
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
          sameCourse(input.subjectId),
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
            subjectId: input.subjectId,
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
  if (result.newlyAbsent.length && cc.ctx.modules.has("leave")) {
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
/**
 * The whole organization's month at a glance: for each class this person may see, how
 * many days had a register, the share present, and how many students are below the line.
 * Counted from the marks themselves (only students are marked), so it needs no roster.
 */
export async function attendanceOverview(slug: string, user: User, month: string) {
  if (!MONTH.test(month))
    throw new ApiError(400, "bad_month", "Choose a month.")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  // Classes where students sit (no groups inside), that this person may see.
  const leaves = ctx.groups.filter(
    (g) =>
      !ctx.groups.some((c) => c.parentId === g.id) &&
      (canFor(ctx, "attendance.mark", [[g.id]]) ||
        canFor(ctx, "attendance.view", [[g.id]]))
  )
  const ids = leaves.map((g) => g.id)
  const [y, m] = month.split("-").map(Number) as [number, number]
  const next =
    m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
  const db = getDb()
  const sessions = ids.length
    ? await db
        .select({
          id: teachingSessions.id,
          groupId: teachingSessions.groupId,
          day: teachingSessions.day,
        })
        .from(teachingSessions)
        .where(
          and(
            inArray(teachingSessions.groupId, ids),
            gte(teachingSessions.day, `${month}-01`),
            lt(teachingSessions.day, `${next}-01`)
          )
        )
    : []
  const marks = sessions.length
    ? await db
        .select({
          sessionId: attendance.sessionId,
          userId: attendance.userId,
          status: attendance.status,
        })
        .from(attendance)
        .where(inArray(attendance.sessionId, sessions.map((x) => x.id)))
    : []
  const sessionOf = new Map(sessions.map((x) => [x.id, x]))
  const minimum = readAttendanceSettings(ctx.org.moduleSettings).minPercent
  const rows = leaves.map((g) => {
    const own = marks.filter((x) => sessionOf.get(x.sessionId)?.groupId === g.id)
    const days = new Set(own.map((x) => sessionOf.get(x.sessionId)!.day))
    const byStudent = new Map<string, AttendanceStatus[]>()
    for (const x of own)
      byStudent.set(x.userId, [...(byStudent.get(x.userId) ?? []), x.status as AttendanceStatus])
    const below = [...byStudent.values()].filter((list) => {
      const p = summarizeAttendance(list).percent
      return p !== null && p < minimum
    }).length
    return {
      id: g.id,
      path: groupChain(ctx, g.id)
        .reverse()
        .map((id) => ctx.groups.find((x) => x.id === id)?.name ?? "")
        .join(" › "),
      days: days.size,
      students: byStudent.size,
      percent: summarizeAttendance(own.map((x) => x.status as AttendanceStatus)).percent,
      below,
    }
  })
  return { month, minimum, rows }
}

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

/* ---------- course-wise attendance and the minimum to sit exams ---------- */

const settingsOf = (ctx: OrgContext) =>
  readAttendanceSettings(ctx.org.moduleSettings)

/** The span eligibility is counted over: the term (semester) under way, else the current year. */
async function countingSpan(ctx: OrgContext, day: string) {
  const db = getDb()
  const [year] = await db
    .select()
    .from(academicYears)
    .where(
      and(
        eq(academicYears.orgId, ctx.org.id),
        eq(academicYears.isCurrent, true)
      )
    )
  if (year) {
    const [term] = await db
      .select()
      .from(academicTerms)
      .where(
        and(
          eq(academicTerms.yearId, year.id),
          isNotNull(academicTerms.startsOn),
          lte(academicTerms.startsOn, day),
          gte(academicTerms.endsOn, day)
        )
      )
    if (term?.startsOn && term.endsOn)
      return { from: term.startsOn, to: term.endsOn, label: term.name }
    return { from: year.startsOn, to: year.endsOn, label: year.name }
  }
  return { from: "0000-01-01", to: "9999-12-31", label: "All time" }
}

/**
 * Each student's attendance in each course of a class over the term under way, with who is
 * short of the minimum to sit exams (and how many classes would get them there).
 */
export async function courseAttendance(
  slug: string,
  user: User,
  groupId: string
) {
  if (!z.uuid().safeParse(groupId).success) throw notFound("Class not found")
  const { cc, view } = await access(slug, user, groupId)
  if (!view)
    throw new ApiError(
      403,
      "forbidden",
      "Seeing attendance for this group isn't part of your role."
    )
  const day = await today()
  const span = await countingSpan(cc.ctx, day)
  const { minPercent } = settingsOf(cc.ctx)
  const db = getDb()
  const [students, courses, sessions] = await Promise.all([
    studentsIn(cc),
    coursesOf(cc),
    db
      .select({
        id: teachingSessions.id,
        subjectId: teachingSessions.subjectId,
      })
      .from(teachingSessions)
      .where(
        and(
          inArray(teachingSessions.groupId, cc.inside),
          eq(teachingSessions.kind, "register"),
          isNotNull(teachingSessions.subjectId),
          gte(teachingSessions.day, span.from),
          lte(teachingSessions.day, span.to)
        )
      ),
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
  const courseOf = new Map(sessions.map((s) => [s.id, s.subjectId!]))
  const taught = courses.filter((c) =>
    sessions.some((s) => s.subjectId === c.id)
  )
  const rows = students.map((s) => {
    const own = marks.filter((m) => m.userId === s.id)
    const byCourse = Object.fromEntries(
      taught.map((c) => {
        const sum = summarizeAttendance(
          own
            .filter((m) => courseOf.get(m.sessionId) === c.id)
            .map((m) => m.status as AttendanceStatus)
        )
        return [
          c.id,
          {
            percent: sum.percent,
            attended: sum.present + sum.late,
            held: sum.counted,
            status: eligibility(sum.percent, minPercent),
            toReach: classesToReach(
              sum.present + sum.late,
              sum.counted,
              minPercent
            ),
          },
        ]
      })
    )
    return {
      id: s.id,
      name: s.name ?? s.handle ?? s.email,
      courses: byCourse,
      short: Object.values(byCourse).filter((c) => c.status === "short").length,
    }
  })
  return {
    minPercent,
    span,
    courses: taught,
    students: rows.sort(
      (a, b) => b.short - a.short || byName(a.name, b.name)
    ),
    shortStudents: rows.filter((r) => r.short > 0).length,
  }
}

/** A student's own attendance by course in their classes, with how far from the minimum. */
export async function myCourseAttendance(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const seats = await getDb()
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, user.id),
        inArray(
          groupMembers.groupId,
          ctx.groups
            .map((g) => g.id)
            .concat(["00000000-0000-0000-0000-000000000000"])
        )
      )
    )
  const day = await today()
  const span = await countingSpan(ctx, day)
  const { minPercent } = settingsOf(ctx)
  const out: {
    course: string
    code: string
    percent: number | null
    attended: number
    held: number
    status: ReturnType<typeof eligibility>
    toReach: number | null
  }[] = []
  for (const seat of seats) {
    const courses = await coursesOf({ ctx, groupId: seat.groupId })
    const rows = await getDb()
      .select({
        subjectId: teachingSessions.subjectId,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(
        teachingSessions,
        eq(attendance.sessionId, teachingSessions.id)
      )
      .where(
        and(
          eq(attendance.userId, user.id),
          eq(teachingSessions.groupId, seat.groupId),
          eq(teachingSessions.kind, "register"),
          isNotNull(teachingSessions.subjectId),
          gte(teachingSessions.day, span.from),
          lte(teachingSessions.day, span.to)
        )
      )
    for (const c of courses) {
      const own = rows.filter((r) => r.subjectId === c.id)
      if (own.length === 0) continue
      const sum = summarizeAttendance(
        own.map((r) => r.status as AttendanceStatus)
      )
      out.push({
        course: c.name,
        code: c.code,
        percent: sum.percent,
        attended: sum.present + sum.late,
        held: sum.counted,
        status: eligibility(sum.percent, minPercent),
        toReach: classesToReach(
          sum.present + sum.late,
          sum.counted,
          minPercent
        ),
      })
    }
  }
  return { minPercent, span, courses: out }
}

export async function attendanceSettings(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  return { ...settingsOf(ctx), canEdit: canFor(ctx, "org.settings.manage", []) }
}

/** Sets the minimum attendance to sit exams. */
export async function saveAttendanceSettings(
  slug: string,
  user: User,
  input: z.infer<typeof attendanceSettingsSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "org.settings.manage", []))
    throw new ApiError(
      403,
      "forbidden",
      "Only those who manage settings can change this."
    )
  const settings = (ctx.org.moduleSettings ?? {}) as Record<string, unknown>
  await getDb()
    .update(organizations)
    .set({
      moduleSettings: {
        ...settings,
        attendance: {
          ...((settings.attendance as object) ?? {}),
          minPercent: input.minPercent,
        },
      },
    })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "attendance.settings",
    `Set the minimum attendance to sit exams to ${input.minPercent}%`
  )
  return { ...input, canEdit: true }
}
