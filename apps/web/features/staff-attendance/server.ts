import {
  getDb,
  leaveRequests,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sql,
  staffAttendance,
  users,
  type User,
} from "@workspace/db"
import {
  checkInStatus,
  enabledModules,
  readStaffAttendanceSettings,
  readTimetableSettings,
  STAFF_STATUSES,
  summarizeStaff,
  timeIn,
  type StaffStatus,
} from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import { rolePermissions } from "@/features/orgs/access"
import {
  canFor,
  heldAnywhere,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { getSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/errors"

/*
 * Staff attendance (a module): one mark per staff member per day (present, late, half day,
 * absent, on leave), with the time they came in. "Staff" are active members holding a role
 * that grants something (not just Member). Someone with "Take staff attendance" marks the
 * day; staff may also check themselves in, today only, counting as late after the school's
 * time (module settings). Approved staff leave (Leave module) shows on the day and starts
 * them as on leave. Rules in packages/judge/src/staff-attendance.ts.
 */

const { and, asc, eq, gte, inArray, lte } = sql

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const registerSchema = z.object({
  day: z.string().regex(DAY, "Choose the day"),
  marks: z
    .array(
      z.object({
        userId: z.uuid(),
        status: z.enum(STAFF_STATUSES),
        checkIn: z
          .union([z.literal(""), z.string().regex(TIME, "A time like 08:45")])
          .default(""),
        note: z.string().trim().max(200).default(""),
      })
    )
    .max(2000),
})

export const settingsSchema = z.object({
  lateAfter: z.string().regex(TIME, "A time like 09:00"),
  selfCheckIn: z.boolean(),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (!ctx.modules.has("staffAttendance"))
    throw notFound("Staff attendance isn't switched on for this organization.")
  return ctx
}

const canMark = (ctx: OrgContext) => canFor(ctx, "staff_attendance.mark", [])
const canView = (ctx: OrgContext) =>
  canMark(ctx) || canFor(ctx, "staff_attendance.view", [])
const isStaff = (ctx: OrgContext) =>
  ctx.membership?.status === "active" && heldAnywhere(ctx).length > 0
const settingsOf = (ctx: OrgContext) =>
  readStaffAttendanceSettings(ctx.org.moduleSettings)

/** The organization's staff: active members with a role that grants something. */
async function staffOf(ctx: OrgContext) {
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: orgRoles.name,
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .innerJoin(users, eq(roleAssignments.userId, users.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, roleAssignments.orgId),
        eq(orgMembers.userId, roleAssignments.userId)
      )
    )
    .where(
      and(
        eq(roleAssignments.orgId, ctx.org.id),
        eq(orgMembers.status, "active")
      )
    )
  const byId = new Map<string, { id: string; name: string; roles: string[] }>()
  for (const r of rows) {
    if (rolePermissions(r).length === 0) continue
    const s = byId.get(r.id) ?? { id: r.id, name: r.name ?? r.email, roles: [] }
    if (!s.roles.includes(r.role)) s.roles.push(r.role)
    byId.set(r.id, s)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Staff on approved leave each day of a span, with the kind's key. */
async function leaveIn(ctx: OrgContext, from: string, to: string) {
  if (!ctx.modules.has("leave")) return []
  return getDb()
    .select({
      userId: leaveRequests.userId,
      startsOn: leaveRequests.startsOn,
      endsOn: leaveRequests.endsOn,
      halfDay: leaveRequests.halfDay,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.orgId, ctx.org.id),
        eq(leaveRequests.kind, "staff"),
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startsOn, to),
        gte(leaveRequests.endsOn, from)
      )
    )
}

const onLeaveOn = (
  leave: {
    userId: string
    startsOn: string
    endsOn: string
    halfDay: boolean
  }[],
  userId: string,
  day: string
) =>
  leave.find(
    (l) => l.userId === userId && l.startsOn <= day && l.endsOn >= day
  ) ?? null

/** One day's staff register. */
export async function staffRegister(slug: string, user: User, day?: string) {
  const ctx = await context(slug, user)
  if (!canView(ctx))
    throw forbidden("Seeing staff attendance isn't part of your role.")
  const now = await today()
  const on = day && DAY.test(day) ? day : now
  const [staff, marks, leave] = await Promise.all([
    staffOf(ctx),
    getDb()
      .select()
      .from(staffAttendance)
      .where(
        and(eq(staffAttendance.orgId, ctx.org.id), eq(staffAttendance.day, on))
      ),
    leaveIn(ctx, on, on),
  ])
  const markers = [
    ...new Set(marks.map((m) => m.markedBy).filter((x): x is string => !!x)),
  ]
  const names = markers.length
    ? await getDb()
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, markers))
    : []
  const rows = staff.map((s) => {
    const m = marks.find((x) => x.userId === s.id)
    const l = onLeaveOn(leave, s.id, on)
    return {
      ...s,
      status: (m?.status as StaffStatus | undefined) ?? null,
      checkIn: m?.checkIn ?? null,
      note: m?.note ?? "",
      selfCheckIn: !!m && m.markedBy === s.id,
      markedBy: (() => {
        const n = names.find((x) => x.id === m?.markedBy)
        return n ? (n.name ?? n.email) : null
      })(),
      onLeave: l ? (l.halfDay ? "Half day leave" : "On leave") : null,
    }
  })
  return {
    day: on,
    today: now,
    canMark: canMark(ctx) && on <= now,
    settings: settingsOf(ctx),
    schoolDay: readTimetableSettings(ctx.org.moduleSettings).days.includes(
      ((new Date(`${on}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
    ),
    staff: rows,
    counts: summarizeStaff(rows.flatMap((r) => (r.status ? [r.status] : []))),
  }
}

/** Marks some or all staff for a day; those not sent are left as they are. */
export async function saveStaffRegister(
  slug: string,
  user: User,
  input: z.infer<typeof registerSchema>
) {
  const ctx = await context(slug, user)
  if (!canMark(ctx))
    throw forbidden("Taking staff attendance isn't part of your role.")
  if (input.day > (await today()))
    throw new ApiError(
      400,
      "future_day",
      "Attendance can't be taken for a day that hasn't come yet."
    )
  const staff = new Set((await staffOf(ctx)).map((s) => s.id))
  if (input.marks.some((m) => !staff.has(m.userId)))
    throw new ApiError(400, "not_staff", "Only staff can be marked here.")
  const db = getDb()
  const before = await db
    .select()
    .from(staffAttendance)
    .where(
      and(
        eq(staffAttendance.orgId, ctx.org.id),
        eq(staffAttendance.day, input.day)
      )
    )
  const changed = input.marks.filter((m) => {
    const b = before.find((x) => x.userId === m.userId)
    return (
      !b ||
      b.status !== m.status ||
      (b.checkIn ?? "") !== m.checkIn ||
      b.note !== m.note
    )
  })
  if (changed.length) {
    await db
      .insert(staffAttendance)
      .values(
        changed.map((m) => ({
          orgId: ctx.org.id,
          userId: m.userId,
          day: input.day,
          status: m.status,
          checkIn: m.checkIn || null,
          note: m.note,
          markedBy: user.id,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: [
          staffAttendance.orgId,
          staffAttendance.userId,
          staffAttendance.day,
        ],
        set: {
          status: sql.sql`excluded.status`,
          checkIn: sql.sql`excluded.check_in`,
          note: sql.sql`excluded.note`,
          markedBy: user.id,
          updatedAt: new Date(),
        },
      })
    const corrected = changed.filter((m) =>
      before.some((b) => b.userId === m.userId)
    ).length
    await writeAudit(
      ctx,
      corrected ? "staff_attendance.correct" : "staff_attendance.take",
      `${corrected ? "Changed" : "Marked"} staff attendance of ${changed.length} on ${input.day}`,
      { day: input.day, changed: changed.length, corrected }
    )
  }
  return staffRegister(slug, user, input.day)
}

/** Every staff member's month: a mark per day, and totals. */
export async function staffMonth(slug: string, user: User, month?: string) {
  const ctx = await context(slug, user)
  if (!canView(ctx))
    throw forbidden("Seeing staff attendance isn't part of your role.")
  const now = await today()
  const m = month && MONTH.test(month) ? month : now.slice(0, 7)
  const days = daysOf(m)
  const [staff, marks, leave] = await Promise.all([
    staffOf(ctx),
    getDb()
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.orgId, ctx.org.id),
          gte(staffAttendance.day, days[0]!),
          lte(staffAttendance.day, days.at(-1)!)
        )
      )
      .orderBy(asc(staffAttendance.day)),
    leaveIn(ctx, days[0]!, days.at(-1)!),
  ])
  const schoolDays = readTimetableSettings(ctx.org.moduleSettings).days
  return {
    month: m,
    today: now,
    days: days.map((d) => ({
      day: d,
      school: schoolDays.includes(
        ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
      ),
    })),
    staff: staff.map((s) => {
      const mine = marks.filter((x) => x.userId === s.id)
      const cells = Object.fromEntries(
        days.flatMap((d) => {
          const x = mine.find((y) => y.day === d)
          if (x) return [[d, x.status]]
          return onLeaveOn(leave, s.id, d) &&
            schoolDays.includes(
              ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
            )
            ? [[d, "on_leave"]]
            : []
        })
      ) as Record<string, StaffStatus>
      return { ...s, cells, ...summarizeStaff(Object.values(cells)) }
    }),
  }
}

function daysOf(month: string) {
  const [y, mo] = month.split("-").map(Number) as [number, number]
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return Array.from(
    { length: n },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`
  )
}

/** Your own attendance: today, whether you can check in, and the month. */
export async function myAttendance(slug: string, user: User, month?: string) {
  const ctx = await context(slug, user)
  if (!isStaff(ctx)) throw notFound("Staff attendance is for staff.")
  const now = await today()
  const m = month && MONTH.test(month) ? month : now.slice(0, 7)
  const days = daysOf(m)
  const [marks, leave] = await Promise.all([
    getDb()
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.orgId, ctx.org.id),
          eq(staffAttendance.userId, user.id),
          gte(staffAttendance.day, days[0]!),
          lte(staffAttendance.day, days.at(-1)!)
        )
      ),
    leaveIn(ctx, now, now),
  ])
  const [todays] = now.startsWith(m)
    ? marks.filter((x) => x.day === now)
    : await getDb()
        .select()
        .from(staffAttendance)
        .where(
          and(
            eq(staffAttendance.orgId, ctx.org.id),
            eq(staffAttendance.userId, user.id),
            eq(staffAttendance.day, now)
          )
        )
  const settings = settingsOf(ctx)
  const away = onLeaveOn(leave, user.id, now)
  return {
    today: now,
    month: m,
    settings,
    todays: todays
      ? { status: todays.status as StaffStatus, checkIn: todays.checkIn }
      : null,
    onLeave: !!away && !away.halfDay,
    canCheckIn: settings.selfCheckIn && !todays && !(away && !away.halfDay),
    days: marks
      .map((x) => ({
        day: x.day,
        status: x.status as StaffStatus,
        checkIn: x.checkIn,
        note: x.note,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    summary: summarizeStaff(marks.map((x) => x.status as StaffStatus)),
  }
}

/** Checks yourself in for today, late after the school's time. */
export async function checkIn(slug: string, user: User) {
  const ctx = await context(slug, user)
  if (!isStaff(ctx)) throw notFound("Staff attendance is for staff.")
  const settings = settingsOf(ctx)
  if (!settings.selfCheckIn)
    throw forbidden(
      "Checking yourself in is switched off here; the office marks attendance."
    )
  const day = await today()
  const time = timeIn((await getSettings())["site.timezone"])
  const status = checkInStatus(time, settings.lateAfter)
  const [row] = await getDb()
    .insert(staffAttendance)
    .values({
      orgId: ctx.org.id,
      userId: user.id,
      day,
      status,
      checkIn: time,
      markedBy: user.id,
    })
    .onConflictDoNothing()
    .returning()
  if (!row)
    throw new ApiError(
      409,
      "already_marked",
      "You're already marked for today."
    )
  await writeAudit(
    ctx,
    "staff_attendance.check_in",
    `Checked in at ${time}${status === "late" ? " (late)" : ""}`,
    {
      day,
    }
  )
  return { day, time, status }
}

export async function saveStaffSettings(
  slug: string,
  user: User,
  input: z.infer<typeof settingsSchema>
) {
  const ctx = await context(slug, user)
  if (!canMark(ctx))
    throw forbidden("Only those who take staff attendance can change this.")
  const settings = (ctx.org.moduleSettings ?? {}) as Record<string, unknown>
  await getDb()
    .update(organizations)
    .set({ moduleSettings: { ...settings, staffAttendance: input } })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "staff_attendance.settings",
    `Set staff to be late after ${input.lateAfter}; self check-in ${input.selfCheckIn ? "on" : "off"}`
  )
  return input
}

/** Today's staff register in numbers, for a home; null when this person can't see it. Never throws. */
export async function staffToday(ctx: OrgContext) {
  try {
    if (
      !ctx.modules.has("staffAttendance") ||
      !canView(ctx)
    )
      return null
    const day = await today()
    const [staff, marks, leave] = await Promise.all([
      staffOf(ctx),
      getDb()
        .select({
          userId: staffAttendance.userId,
          status: staffAttendance.status,
        })
        .from(staffAttendance)
        .where(
          and(
            eq(staffAttendance.orgId, ctx.org.id),
            eq(staffAttendance.day, day)
          )
        ),
      leaveIn(ctx, day, day),
    ])
    const statuses = staff.flatMap((s) => {
      const m = marks.find((x) => x.userId === s.id)
      if (m) return [m.status as StaffStatus]
      return onLeaveOn(leave, s.id, day) ? (["on_leave"] as StaffStatus[]) : []
    })
    return {
      total: staff.length,
      unmarked: staff.length - statuses.length,
      ...summarizeStaff(statuses),
    }
  } catch {
    return null
  }
}
