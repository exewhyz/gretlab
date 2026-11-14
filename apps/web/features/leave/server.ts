import {
  academicYears,
  attendance,
  classTeachers,
  getDb,
  groupMembers,
  guardians,
  leaveRequests,
  organizations,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  enabledModules,
  leaveBalances,
  leaveDays,
  leaveKey,
  leaveOverlaps,
  leaveProblem,
  leaveTypesProblem,
  readLeaveSettings,
  readTimetableSettings,
  STUDENT_LEAVE_TYPES,
  type LeaveType,
} from "@workspace/judge"
import { z } from "zod"

import { covers, pathName } from "@/features/campus/people"
import { today } from "@/features/catalog/server"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  heldAnywhere,
  membersWhoCan,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { orgPages } from "@/lib/paths"

/*
 * Leave (a module). A request is for a student (asked by them or a parent) or for a staff
 * member (asked by themselves). Student leave is decided by the class teacher of the
 * student's section this year (Student records) or "Approve student leave" covering it;
 * staff leave by "Approve staff leave", which also sets the kinds of staff leave and how
 * many days a year each allows. Balances count approved and waiting days in the current
 * academic year (else the calendar year). Approving a student's leave turns their absences
 * in those days into "excused", and registers start them as excused. School days come
 * from the timetable's days (Mon–Fri by default). Rules in packages/judge/src/leave.ts.
 */

const { and, asc, desc, eq, gte, inArray, lte, ne, or } = sql

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")

export const requestSchema = z.object({
  /** A student (yourself or your child); omitted: your own staff leave. */
  studentId: z.uuid().optional(),
  type: z.string().trim().min(1).max(30),
  startsOn: day,
  endsOn: day,
  halfDay: z.boolean().default(false),
  reason: z.string().trim().max(500).default(""),
})

export const decisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(300).default(""),
})

export const typesSchema = z.object({
  types: z
    .array(
      z.object({
        key: z.string().trim().max(30).optional(),
        name: z.string().trim().min(1).max(40),
        days: z.number().int().min(0).max(365).nullable(),
      })
    )
    .min(1)
    .max(20),
})

export const listSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  kind: z.enum(["student", "staff"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)
const conflict = (code: string, message: string) => new ApiError(409, code, message)

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (!ctx.modules.has("leave"))
    throw notFound("Leave isn't switched on for this organization.")
  // Its members, parents linked to a student here, and platform staff who may look inside.
  if (ctx.membership?.status !== "active" && !ctx.platformViewer) {
    const [child] = await getDb()
      .select({ id: guardians.id })
      .from(guardians)
      .where(and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, user.id)))
      .limit(1)
    if (!child) throw notFound("Not found")
  }
  return ctx
}

const schoolDays = (ctx: OrgContext) => readTimetableSettings(ctx.org.moduleSettings).days
const settingsOf = (ctx: OrgContext) => readLeaveSettings(ctx.org.moduleSettings)
/** On the staff here: asks for their own leave, has balances. Members only. */
const isStaff = (ctx: OrgContext) =>
  ctx.membership?.status === "active" && heldAnywhere(ctx).length > 0
/**
 * May see others' leave: staff, and platform staff who may act in or look inside every
 * organization (joined or not). Deciding still needs a permission that decides it.
 */
const seesOthers = (ctx: OrgContext) => ctx.platformViewer || isStaff(ctx)
const decidesStaff = (ctx: OrgContext) => canFor(ctx, "leave.staff", [])

const isLeaf = (ctx: OrgContext, groupId: string) =>
  ctx.groups.some((g) => g.id === groupId) &&
  !ctx.groups.some((g) => g.parentId === groupId)

async function currentYear(orgId: string) {
  const [y] = await getDb()
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true)))
  return y ?? null
}

/** The window balances count in: the current academic year, else this calendar year. */
async function balanceWindow(ctx: OrgContext) {
  const y = await currentYear(ctx.org.id)
  if (y) return { from: y.startsOn, to: y.endsOn, name: y.name }
  const year = (await today()).slice(0, 4)
  return { from: `${year}-01-01`, to: `${year}-12-31`, name: year }
}

/** Each student's section now (their place), among these students. */
async function sectionsOf(ctx: OrgContext, userIds: string[]) {
  const leaves = ctx.groups.filter((g) => isLeaf(ctx, g.id)).map((g) => g.id)
  const rows =
    userIds.length && leaves.length
      ? await getDb()
          .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(and(inArray(groupMembers.userId, userIds), inArray(groupMembers.groupId, leaves)))
      : []
  return new Map(rows.map((r) => [r.userId, r.groupId]))
}

/** The current year's class teacher of each of these sections. */
async function leadsOf(orgId: string, groupIds: string[]) {
  const year = await currentYear(orgId)
  if (!year || groupIds.length === 0) return new Map<string, string>()
  const rows = await getDb()
    .select()
    .from(classTeachers)
    .where(and(eq(classTeachers.yearId, year.id), inArray(classTeachers.groupId, groupIds)))
  return new Map(rows.map((r) => [r.groupId, r.teacherId]))
}

/** Whether this person decides a student's leave, given their section and its class teacher. */
const decidesStudent = (
  ctx: OrgContext,
  groupId: string | null | undefined,
  lead: string | undefined
) =>
  canFor(ctx, "leave.students", []) ||
  (!!groupId && (covers(ctx, "leave.students", [groupId]) || lead === ctx.user.id))

/** Students this person may ask leave for: themselves (if they sit in a class) and their children. */
async function studentsFor(ctx: OrgContext) {
  const db = getDb()
  const children = ctx.modules.has("parents")
    ? await db
        .select({ id: guardians.studentId, name: users.name, email: users.email })
        .from(guardians)
        .innerJoin(users, eq(guardians.studentId, users.id))
        .where(and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, ctx.user.id)))
    : []
  const out = children.map((c) => ({ id: c.id, name: c.name ?? c.email, self: false }))
  if (ctx.membership?.status === "active" && !isStaff(ctx)) {
    const seat = (await sectionsOf(ctx, [ctx.user.id])).get(ctx.user.id)
    if (seat) out.unshift({ id: ctx.user.id, name: ctx.user.name ?? ctx.user.email, self: true })
  }
  return out
}

const nameOf = (u: { name: string | null; email: string } | undefined) =>
  u ? (u.name ?? u.email) : null

type Row = typeof leaveRequests.$inferSelect

/** Requests as the pages show them: names, the class, the type's name. */
async function present(ctx: OrgContext, rows: Row[]) {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.userId, r.requestedBy, r.decidedBy]).filter((x): x is string => !!x)
    ),
  ]
  const people = ids.length
    ? await getDb()
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ids))
    : []
  const person = (id: string | null) => nameOf(people.find((p) => p.id === id))
  const sections = await sectionsOf(
    ctx,
    rows.filter((r) => r.kind === "student").map((r) => r.userId)
  )
  const types = settingsOf(ctx).types
  const typeName = (r: Row) =>
    r.kind === "student"
      ? (STUDENT_LEAVE_TYPES.find((t) => t.key === r.type)?.name ?? r.type)
      : (types.find((t) => t.key === r.type)?.name ?? r.type)
  return rows.map((r) => {
    const section = sections.get(r.userId)
    return {
      id: r.id,
      kind: r.kind,
      userId: r.userId,
      name: person(r.userId) ?? "Someone",
      class: section ? pathName(ctx, section) : null,
      type: r.type,
      typeName: typeName(r),
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      halfDay: r.halfDay,
      days: r.days,
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy === r.userId ? null : person(r.requestedBy),
      decidedBy: person(r.decidedBy),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }
  })
}

/** Approved and waiting staff days of each type in the balance window. */
async function usedDays(ctx: OrgContext, userId: string) {
  const w = await balanceWindow(ctx)
  const rows = await getDb()
    .select({ type: leaveRequests.type, days: leaveRequests.days })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.orgId, ctx.org.id),
        eq(leaveRequests.userId, userId),
        eq(leaveRequests.kind, "staff"),
        inArray(leaveRequests.status, ["pending", "approved"]),
        gte(leaveRequests.startsOn, w.from),
        lte(leaveRequests.startsOn, w.to)
      )
    )
  const used = new Map<string, number>()
  for (const r of rows) used.set(r.type, (used.get(r.type) ?? 0) + r.days)
  return { used, window: w }
}

/** The pending requests this person may decide (a page at most). */
async function decidable(ctx: OrgContext, limit = 200) {
  const db = getDb()
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.orgId, ctx.org.id), eq(leaveRequests.status, "pending")))
    .orderBy(asc(leaveRequests.startsOn))
    .limit(2000)
  return (await filterDecidable(ctx, rows)).slice(0, limit)
}

/** Those of these requests this person may decide. */
async function filterDecidable(ctx: OrgContext, rows: Row[]) {
  const staff = decidesStaff(ctx)
  const students = rows.filter((r) => r.kind === "student")
  const sections = await sectionsOf(ctx, students.map((r) => r.userId))
  const leads = await leadsOf(ctx.org.id, [...new Set(sections.values())])
  return rows.filter((r) =>
    r.userId === ctx.user.id
      ? false
      : r.kind === "staff"
        ? staff
        : decidesStudent(ctx, sections.get(r.userId), leads.get(sections.get(r.userId) ?? ""))
  )
}

/** How many requests wait for this person (for the sidebar). Never throws. */
export async function pendingLeaveCount(ctx: OrgContext) {
  try {
    if (!ctx.modules.has("leave")) return 0
    if (!seesOthers(ctx)) return 0
    return (await decidable(ctx)).length
  } catch {
    return 0
  }
}

/** The Leave page: what you can ask for, your requests, and what waits for you. */
export async function leaveHome(slug: string, user: User) {
  const ctx = await context(slug, user)
  const db = getDb()
  const students = await studentsFor(ctx)
  const staff = isStaff(ctx)
  const subjects = [...students.map((s) => s.id), ...(staff ? [user.id] : [])]
  const mine = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.orgId, ctx.org.id),
        or(
          eq(leaveRequests.requestedBy, user.id),
          subjects.length ? inArray(leaveRequests.userId, subjects) : undefined
        )
      )
    )
    .orderBy(desc(leaveRequests.startsOn))
    .limit(100)
  const balance = staff ? await usedDays(ctx, user.id) : null
  const waiting = seesOthers(ctx) ? await decidable(ctx) : []
  return {
    today: await today(),
    schoolDays: schoolDays(ctx),
    students,
    staff,
    studentTypes: STUDENT_LEAVE_TYPES,
    staffTypes: settingsOf(ctx).types,
    balances: balance
      ? { year: balance.window.name, types: leaveBalances(settingsOf(ctx).types, balance.used) }
      : null,
    mine: await present(ctx, mine),
    waiting: await present(ctx, waiting),
    canDecideStaff: decidesStaff(ctx),
    /** Sees others' requests without deciding them (platform staff who only look). */
    canSeeAll: seesOthers(ctx),
    canDecide:
      waiting.length > 0 ||
      decidesStaff(ctx) ||
      ctx.groups.some((g) => covers(ctx, "leave.students", [g.id])) ||
      (staff && (await isAnyClassTeacher(ctx))),
  }
}

async function isAnyClassTeacher(ctx: OrgContext) {
  const year = await currentYear(ctx.org.id)
  if (!year) return false
  const [row] = await getDb()
    .select({ g: classTeachers.groupId })
    .from(classTeachers)
    .where(and(eq(classTeachers.yearId, year.id), eq(classTeachers.teacherId, ctx.user.id)))
    .limit(1)
  return !!row
}

/** Decided (or any) requests this person may decide, newest first, 50 a page. */
export async function listRequests(
  slug: string,
  user: User,
  filters: z.infer<typeof listSchema>
) {
  const ctx = await context(slug, user)
  if (!seesOthers(ctx)) throw forbidden("Only staff can see others' leave.")
  const where = [eq(leaveRequests.orgId, ctx.org.id), ne(leaveRequests.userId, user.id)]
  if (filters.status) where.push(eq(leaveRequests.status, filters.status))
  if (filters.kind) where.push(eq(leaveRequests.kind, filters.kind))
  const rows = await getDb()
    .select()
    .from(leaveRequests)
    .where(and(...where))
    .orderBy(desc(leaveRequests.startsOn), desc(leaveRequests.createdAt))
    .limit(2000)
  // Platform staff who only look inside organizations see every request, deciding none.
  const mine = ctx.platformViewer && !ctx.platformAdmin ? rows : await filterDecidable(ctx, rows)
  const page = filters.page ?? 1
  return {
    total: mine.length,
    page,
    requests: await present(ctx, mine.slice((page - 1) * 50, page * 50)),
  }
}

/** Asks for leave: a student's (yourself or your child) or your own as staff. */
export async function requestLeave(
  slug: string,
  user: User,
  input: z.infer<typeof requestSchema>
) {
  const ctx = await context(slug, user)
  let kind: "student" | "staff"
  let userId: string
  // A student asking without saying whom it's for means themselves.
  if (!input.studentId && !isStaff(ctx)) {
    const self = (await studentsFor(ctx)).find((s) => s.self)
    if (self) input = { ...input, studentId: self.id }
  }
  if (input.studentId) {
    const allowed = await studentsFor(ctx)
    if (!allowed.some((s) => s.id === input.studentId))
      throw notFound("Student not found")
    kind = "student"
    userId = input.studentId
    if (!STUDENT_LEAVE_TYPES.some((t) => t.key === input.type))
      throw new ApiError(400, "bad_type", "Choose why they'll be away.")
  } else {
    if (!isStaff(ctx)) throw forbidden("Only staff ask for their own leave here.")
    kind = "staff"
    userId = user.id
    if (!settingsOf(ctx).types.some((t) => t.key === input.type))
      throw new ApiError(400, "bad_type", "Choose a kind of leave.")
  }
  const now = await today()
  const days = schoolDays(ctx)
  const problem = leaveProblem(input, now, days)
  if (problem) throw new ApiError(400, "bad_leave", problem)
  const n = leaveDays(input, days)
  const db = getDb()
  const open = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.orgId, ctx.org.id),
        eq(leaveRequests.userId, userId),
        inArray(leaveRequests.status, ["pending", "approved"])
      )
    )
  const clash = open.find((r) => leaveOverlaps(r, input))
  if (clash)
    throw conflict(
      "overlaps",
      `There's already leave ${clash.status === "approved" ? "approved" : "asked for"} from ${clash.startsOn} to ${clash.endsOn}.`
    )
  if (kind === "staff") {
    const type = settingsOf(ctx).types.find((t) => t.key === input.type)!
    if (type.days != null) {
      const { used } = await usedDays(ctx, userId)
      const left = type.days - (used.get(type.key) ?? 0)
      if (n > left)
        throw conflict(
          "not_enough",
          `Only ${Math.max(0, left)} days of ${type.name.toLowerCase()} are left this year.`
        )
    }
  }
  const [row] = await db
    .insert(leaveRequests)
    .values({
      orgId: ctx.org.id,
      userId,
      kind,
      type: input.type,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      halfDay: input.halfDay,
      days: n,
      reason: input.reason,
      requestedBy: user.id,
    })
    .returning()
  const [who] = await db.select().from(users).where(eq(users.id, userId))
  const whoName = nameOf(who) ?? "Someone"
  const span =
    input.startsOn === input.endsOn ? input.startsOn : `${input.startsOn} to ${input.endsOn}`
  await writeAudit(
    ctx,
    "leave.request",
    `Asked for ${n} ${n === 1 ? "day" : "days"} of leave for ${userId === user.id ? "themselves" : whoName} (${span})`,
    { requestId: row!.id, kind }
  )
  // Tell whoever decides: the class teacher, else those who decide across the school.
  let deciders: string[]
  if (kind === "student") {
    const section = (await sectionsOf(ctx, [userId])).get(userId)
    const lead = section ? (await leadsOf(ctx.org.id, [section])).get(section) : undefined
    deciders = lead ? [lead] : await membersWhoCan(ctx.org.id, "leave.students")
  } else {
    deciders = await membersWhoCan(ctx.org.id, "leave.staff")
  }
  await notify(
    deciders.filter((d) => d !== user.id && d !== userId),
    {
      kind: "leave_request",
      title: `${whoName} asks for leave: ${span}`,
      body: input.reason || undefined,
      href: orgPages(ctx.org.slug).leave,
      orgId: ctx.org.id,
    }
  )
  return (await present(ctx, [row!]))[0]!
}

async function ownRequest(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Request not found")
  const [row] = await getDb()
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.orgId, ctx.org.id)))
  if (!row) throw notFound("Request not found")
  return row
}

/** Approves or refuses a request. Approving a student's turns their absences then into excused. */
export async function decideLeave(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof decisionSchema>
) {
  const ctx = await context(slug, user)
  const row = await ownRequest(ctx, id)
  const [allowed] = await filterDecidable(ctx, [row])
  if (!allowed) {
    if (row.userId === user.id) throw forbidden("You can't decide your own leave.")
    throw notFound("Request not found")
  }
  if (row.status !== "pending")
    throw conflict("decided", `This request is already ${row.status}.`)
  const db = getDb()
  let excused = 0
  await db.transaction(async (tx) => {
    await tx
      .update(leaveRequests)
      .set({ status: input.status, note: input.note, decidedBy: user.id, decidedAt: new Date() })
      .where(eq(leaveRequests.id, id))
    if (input.status === "approved" && row.kind === "student") {
      const sessions = tx
        .select({ id: teachingSessions.id })
        .from(teachingSessions)
        .where(
          and(
            eq(teachingSessions.orgId, ctx.org.id),
            gte(teachingSessions.day, row.startsOn),
            lte(teachingSessions.day, row.endsOn)
          )
        )
      const changed = await tx
        .update(attendance)
        .set({ status: "excused", present: false })
        .where(
          and(
            eq(attendance.userId, row.userId),
            eq(attendance.status, "absent"),
            inArray(attendance.sessionId, sessions)
          )
        )
        .returning({ id: attendance.sessionId })
      excused = changed.length
    }
  })
  const [shown] = await present(ctx, [{ ...row, status: input.status }])
  await writeAudit(
    ctx,
    input.status === "approved" ? "leave.approve" : "leave.reject",
    `${input.status === "approved" ? "Approved" : "Refused"} ${shown!.name}'s leave (${row.startsOn}${row.endsOn !== row.startsOn ? ` to ${row.endsOn}` : ""})${excused ? `; ${excused} absences excused` : ""}`,
    { requestId: id, excused }
  )
  await notify(
    [...new Set([row.userId, row.requestedBy].filter((x): x is string => !!x))],
    {
      kind: "leave_decision",
      title: `Leave ${input.status === "approved" ? "approved" : "refused"}: ${shown!.name}, ${row.startsOn}${row.endsOn !== row.startsOn ? ` to ${row.endsOn}` : ""}`,
      body: input.note || undefined,
      href: orgPages(ctx.org.slug).leave,
      orgId: ctx.org.id,
    }
  )
  return { ...(await present(ctx, [{ ...row, status: input.status, note: input.note, decidedBy: user.id, decidedAt: new Date() }]))[0]!, excused }
}

/** Takes back a request that's waiting, or approved leave that hasn't started. */
export async function cancelLeave(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  const row = await ownRequest(ctx, id)
  const own =
    row.requestedBy === user.id ||
    row.userId === user.id ||
    (await studentsFor(ctx)).some((s) => s.id === row.userId)
  if (!own) throw notFound("Request not found")
  const now = await today()
  if (!(row.status === "pending" || (row.status === "approved" && row.startsOn > now)))
    throw conflict("cannot_cancel", "Only waiting requests, or leave that hasn't started, can be taken back.")
  await getDb()
    .update(leaveRequests)
    .set({ status: "cancelled" })
    .where(eq(leaveRequests.id, id))
  await writeAudit(ctx, "leave.cancel", `Took back leave from ${row.startsOn} to ${row.endsOn}`, {
    requestId: id,
  })
  return { ok: true }
}

/** The kinds of staff leave. */
export async function leaveTypes(slug: string, user: User) {
  const ctx = await context(slug, user)
  return { types: settingsOf(ctx).types, canEdit: decidesStaff(ctx) }
}

export async function saveLeaveTypes(
  slug: string,
  user: User,
  input: z.infer<typeof typesSchema>
) {
  const ctx = await context(slug, user)
  if (!decidesStaff(ctx)) throw forbidden("Only those who approve staff leave can change these.")
  const types: LeaveType[] = input.types.map((t) => ({
    key: t.key || leaveKey(t.name),
    name: t.name,
    days: t.days,
  }))
  const problem = leaveTypesProblem(types)
  if (problem) throw new ApiError(400, "bad_types", problem)
  const settings = (ctx.org.moduleSettings ?? {}) as Record<string, unknown>
  await getDb()
    .update(organizations)
    .set({ moduleSettings: { ...settings, leave: { ...((settings.leave as object) ?? {}), types } } })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "leave.types",
    `Set the kinds of staff leave: ${types.map((t) => `${t.name} ${t.days ?? "no limit"}`).join(", ")}`
  )
  return { types, canEdit: true }
}

/** Students of these on approved leave on a day, with the reason's name (for registers). */
export async function onLeave(orgId: string, userIds: string[], on: string) {
  if (userIds.length === 0) return new Map<string, string>()
  const rows = await getDb()
    .select({ userId: leaveRequests.userId, type: leaveRequests.type })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.orgId, orgId),
        eq(leaveRequests.status, "approved"),
        inArray(leaveRequests.userId, userIds),
        lte(leaveRequests.startsOn, on),
        gte(leaveRequests.endsOn, on)
      )
    )
  return new Map(
    rows.map((r) => [
      r.userId,
      STUDENT_LEAVE_TYPES.find((t) => t.key === r.type)?.name ?? "Leave",
    ])
  )
}
