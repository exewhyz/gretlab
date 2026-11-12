import {
  attendance,
  getDb,
  groupMembers,
  guardians,
  orgMembers,
  organizations,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import { enabledModules, type Permission } from "@workspace/judge"
import { z } from "zod"

import { listAssignments } from "@/features/assignments/server"
import { classAttendance, classStream } from "@/features/classes/server"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  groupChain,
  orgContext,
  userByEmail,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { classTimetable } from "@/features/timetable/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * Parent accounts (a module). A parent is linked to a student in one organization
 * (`guardians`); the link is all they have there: they aren't a member, hold no role, and
 * see only that student, read only, through the same functions the student's own pages use
 * (called as the student), so a parent never sees more than their child does. Staff with
 * "Link and unlink parents" link them, for the students of the groups the permission
 * covers; "See parents" shows who's linked. Parents get copies of their child's
 * notifications (features/notifications/server.ts) and a note when the child is absent.
 */

const { and, asc, desc, eq, inArray, or, ilike } = sql

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const linkSchema = z.object({
  studentId: z.uuid(),
  email: z.string().trim().toLowerCase().regex(EMAIL, "Not an email address"),
  name: z.string().trim().max(120).default(""),
  relation: z.string().trim().max(40).default(""),
})

export const importSchema = z.object({
  rows: z
    .array(
      z.object({
        studentEmail: z.string().trim().toLowerCase(),
        parentEmail: z.string().trim().toLowerCase(),
        parentName: z.string().trim().max(120).default(""),
        relation: z.string().trim().max(40).default(""),
      })
    )
    .min(1)
    .max(2000),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

export function parentsOn(ctx: { org: OrgContext["org"] }) {
  return enabledModules(ctx.org.type, ctx.org.modules).has("parents")
}

function needModule(ctx: OrgContext) {
  if (!parentsOn(ctx)) {
    throw notFound("Parent accounts aren't switched on for this organization.")
  }
}

/** Active members, with the groups each sits in directly. */
async function studentsWithGroups(ctx: OrgContext, userIds?: string[]) {
  const db = getDb()
  const where = [
    eq(orgMembers.orgId, ctx.org.id),
    eq(orgMembers.status, "active"),
  ]
  if (userIds) {
    if (userIds.length === 0) return []
    where.push(inArray(orgMembers.userId, userIds))
  }
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(...where))
  const groupIds = ctx.groups.map((g) => g.id)
  const seats =
    people.length && groupIds.length
      ? await db
          .select()
          .from(groupMembers)
          .where(
            and(
              inArray(groupMembers.groupId, groupIds),
              inArray(
                groupMembers.userId,
                people.map((p) => p.id)
              )
            )
          )
      : []
  return people.map((p) => ({
    ...p,
    groupIds: seats.filter((s) => s.userId === p.id).map((s) => s.groupId),
  }))
}

/** Whether this permission covers a student: across the organization, or in a group they sit in. */
const covers = (ctx: OrgContext, permission: Permission, groupIds: string[]) =>
  canFor(ctx, permission, []) ||
  groupIds.some((g) => canFor(ctx, permission, [[g]]))

const pathName = (ctx: OrgContext, groupId: string) =>
  [...groupChain(ctx, groupId)]
    .reverse()
    .map((id) => ctx.groups.find((g) => g.id === id)?.name ?? "")
    .join(" › ")

const anyGroupGrant = (ctx: OrgContext, permission: Permission) =>
  canFor(ctx, permission, []) ||
  ctx.groups.some((g) => canFor(ctx, permission, [[g.id]]))

/* ---------- managing links (staff) ---------- */

/** Manage › Parents: every link for the students this person may see, and what they may do. */
export async function listLinks(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    view: anyGroupGrant(ctx, "parents.view"),
    link: anyGroupGrant(ctx, "parents.link"),
  }
  if (!can.view && !can.link) {
    throw forbidden("Parent accounts aren't part of your role.")
  }
  const rows = await getDb()
    .select({
      id: guardians.id,
      studentId: guardians.studentId,
      relation: guardians.relation,
      parentName: users.name,
      parentEmail: users.email,
      createdAt: guardians.createdAt,
    })
    .from(guardians)
    .innerJoin(users, eq(guardians.parentId, users.id))
    .where(eq(guardians.orgId, ctx.org.id))
    .orderBy(asc(users.email))
  const students = new Map(
    (
      await studentsWithGroups(ctx, [...new Set(rows.map((r) => r.studentId))])
    ).map((s) => [s.id, s])
  )
  const links = rows.flatMap((r) => {
    const student = students.get(r.studentId)
    if (!student) return []
    const view = covers(ctx, "parents.view", student.groupIds)
    const link = covers(ctx, "parents.link", student.groupIds)
    if (!view && !link) return []
    return [
      {
        id: r.id,
        relation: r.relation,
        parent: { name: r.parentName, email: r.parentEmail },
        student: {
          id: student.id,
          name: student.name ?? student.email,
          email: student.email,
          classes: student.groupIds.map((g) => pathName(ctx, g)),
        },
        canRemove: link,
      },
    ]
  })
  return { can, links }
}

/** Students this person may link parents to, matching a search (for the Add parent dialog). */
export async function searchStudents(slug: string, user: User, q: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const term = q.trim()
  if (term.length < 2) return []
  const matches = await getDb()
    .select({ id: users.id })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.status, "active"),
        or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`))
      )
    )
    .limit(200)
  const people = await studentsWithGroups(
    ctx,
    matches.map((m) => m.id)
  )
  return people
    .filter((p) => covers(ctx, "parents.link", p.groupIds))
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      name: p.name ?? p.email,
      email: p.email,
      classes: p.groupIds.map((g) => pathName(ctx, g)),
    }))
}

/** Links one parent (found or created by email) to one student; returns false when it existed. */
async function link(
  ctx: OrgContext,
  student: { id: string; name: string | null; email: string },
  parent: { email: string; name: string; relation: string }
) {
  const db = getDb()
  if (parent.email === student.email) {
    throw new ApiError(
      400,
      "same_person",
      "A student can't be their own parent."
    )
  }
  const person = await userByEmail(db, parent.email)
  if (parent.name && !person.name) {
    await db
      .update(users)
      .set({ name: parent.name })
      .where(eq(users.id, person.id))
  }
  const [before] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(
      and(
        eq(guardians.orgId, ctx.org.id),
        eq(guardians.parentId, person.id),
        eq(guardians.studentId, student.id)
      )
    )
  await db
    .insert(guardians)
    .values({
      orgId: ctx.org.id,
      parentId: person.id,
      studentId: student.id,
      relation: parent.relation,
      createdBy: ctx.user.id,
    })
    .onConflictDoUpdate({
      target: [guardians.orgId, guardians.parentId, guardians.studentId],
      set: { relation: parent.relation },
    })
  return { personId: person.id, isNew: !before }
}

function welcome(ctx: OrgContext, parentId: string, childName: string) {
  return notify([parentId], {
    kind: "parent_linked",
    title: `You can now follow ${childName} at ${ctx.org.name}`,
    body: "See their attendance, timetable, work and marks, and their class notices.",
    href: "/children",
    orgId: ctx.org.id,
  })
}

export async function linkParent(
  slug: string,
  user: User,
  input: z.infer<typeof linkSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const [student] = await studentsWithGroups(ctx, [input.studentId])
  if (!student) throw notFound("Student not found")
  if (!covers(ctx, "parents.link", student.groupIds)) {
    throw forbidden("Linking parents to this student isn't part of your role.")
  }
  const done = await link(ctx, student, input)
  const childName = student.name ?? student.email
  await writeAudit(
    ctx,
    "parent.link",
    `Linked ${input.email} to ${childName}`,
    { relation: input.relation }
  )
  if (done.isNew) await welcome(ctx, done.personId, childName)
  return { linked: true }
}

export async function unlinkParent(slug: string, user: User, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Link not found")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const db = getDb()
  const [row] = await db
    .select({
      id: guardians.id,
      studentId: guardians.studentId,
      email: users.email,
    })
    .from(guardians)
    .innerJoin(users, eq(guardians.parentId, users.id))
    .where(and(eq(guardians.id, id), eq(guardians.orgId, ctx.org.id)))
  if (!row) throw notFound("Link not found")
  const [student] = await studentsWithGroups(ctx, [row.studentId])
  if (!covers(ctx, "parents.link", student?.groupIds ?? [])) {
    throw forbidden(
      "Unlinking parents from this student isn't part of your role."
    )
  }
  await db.delete(guardians).where(eq(guardians.id, id))
  await writeAudit(
    ctx,
    "parent.unlink",
    `Unlinked ${row.email} from ${student?.name ?? student?.email ?? "a student"}`
  )
  return { removed: true }
}

/** Links from a pasted list: student email, parent email, parent name, relation. A report per line. */
export async function importLinks(
  slug: string,
  user: User,
  input: z.infer<typeof importSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!anyGroupGrant(ctx, "parents.link")) {
    throw forbidden("Linking parents isn't part of your role.")
  }
  const emails = [...new Set(input.rows.map((r) => r.studentEmail))]
  const found = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, emails))
  const members = new Map(
    (
      await studentsWithGroups(
        ctx,
        found.map((f) => f.id)
      )
    ).map((s) => [s.email, s])
  )
  const report: { line: number; result: "linked" | "error"; note: string }[] =
    []
  let linked = 0
  for (const [i, row] of input.rows.entries()) {
    const line = i + 1
    const student = members.get(row.studentEmail)
    const fail = (note: string) => report.push({ line, result: "error", note })
    if (!student) {
      fail(`${row.studentEmail || "(blank)"} isn't a member here`)
      continue
    }
    if (!EMAIL.test(row.parentEmail)) {
      fail(`${row.parentEmail || "(blank)"} isn't an email address`)
      continue
    }
    if (!covers(ctx, "parents.link", student.groupIds)) {
      fail(`You can't link parents to ${row.studentEmail}`)
      continue
    }
    try {
      const done = await link(ctx, student, {
        email: row.parentEmail,
        name: row.parentName,
        relation: row.relation,
      })
      if (done.isNew)
        await welcome(ctx, done.personId, student.name ?? student.email)
      linked++
      report.push({ line, result: "linked", note: "" })
    } catch (error) {
      fail(error instanceof ApiError ? error.message : "Couldn't link")
    }
  }
  if (linked) {
    await writeAudit(
      ctx,
      "parent.import",
      `Linked ${linked} parents from a list`
    )
  }
  return {
    linked,
    failed: report.filter((r) => r.result === "error").length,
    report,
  }
}

/* ---------- a parent's view ---------- */

/** Every child this person is linked to, in organizations where the module is on. */
export async function myChildren(user: User) {
  const rows = await getDb()
    .select({
      studentId: guardians.studentId,
      relation: guardians.relation,
      name: users.name,
      email: users.email,
      org: organizations,
    })
    .from(guardians)
    .innerJoin(organizations, eq(guardians.orgId, organizations.id))
    .innerJoin(users, eq(guardians.studentId, users.id))
    .where(and(eq(guardians.parentId, user.id), eq(organizations.active, true)))
    .orderBy(asc(users.name))
  return rows
    .filter((r) => parentsOn(r))
    .map((r) => ({
      id: r.studentId,
      name: r.name ?? r.email,
      relation: r.relation,
      org: { slug: r.org.slug, name: r.org.name },
    }))
}

export async function isParent(userId: string) {
  const [row] = await getDb()
    .select({ id: guardians.id })
    .from(guardians)
    .where(eq(guardians.parentId, userId))
    .limit(1)
  return Boolean(row)
}

/** One child, as their parent sees them: their classes' attendance, timetable, notices and work. */
export async function childOverview(
  slug: string,
  user: User,
  studentId: string
) {
  if (!z.uuid().safeParse(studentId).success) throw notFound("Not found")
  const ctx = await orgContext(slug, user)
  // Same answer for "not switched on" and "not your child", so nothing leaks.
  if (!parentsOn(ctx)) throw notFound("Not found")
  const db = getDb()
  const [linkRow] = await db
    .select({ relation: guardians.relation })
    .from(guardians)
    .where(
      and(
        eq(guardians.orgId, ctx.org.id),
        eq(guardians.parentId, user.id),
        eq(guardians.studentId, studentId)
      )
    )
  if (!linkRow) throw notFound("Not found")
  const [child] = await db.select().from(users).where(eq(users.id, studentId))
  const [seat] = await studentsWithGroups(ctx, [studentId])
  if (!child || !seat) {
    return {
      child: { name: child?.name ?? child?.email ?? "Your child" },
      org: { name: ctx.org.name },
      active: false,
      classes: [],
      absences: [],
      work: [],
    }
  }
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
  const quiet = <T>(p: Promise<T>) => p.catch(() => null)
  const classes = await Promise.all(
    seat.groupIds.map(async (groupId) => {
      const [att, week, stream] = await Promise.all([
        modules.has("attendance")
          ? quiet(classAttendance(slug, child, groupId))
          : null,
        modules.has("timetable")
          ? quiet(classTimetable(slug, child, groupId))
          : null,
        quiet(classStream(slug, child, groupId)),
      ])
      return {
        id: groupId,
        name: pathName(ctx, groupId),
        attendance: att?.mine ?? null,
        timetable:
          week && week.periods.length
            ? { days: week.days, periods: week.periods, slots: week.slots }
            : null,
        notices: (stream ?? [])
          .filter((s) => s.kind === "notice")
          .slice(0, 10)
          .map((s) => ({
            id: s.id,
            at: s.at,
            text: "text" in s ? s.text : "",
            by: "by" in s ? s.by : null,
          })),
      }
    })
  )
  const absences = modules.has("attendance")
    ? await db
        .select({
          day: teachingSessions.day,
          period: teachingSessions.period,
          groupId: teachingSessions.groupId,
          status: attendance.status,
        })
        .from(attendance)
        .innerJoin(
          teachingSessions,
          eq(attendance.sessionId, teachingSessions.id)
        )
        .where(
          and(
            eq(attendance.userId, studentId),
            eq(teachingSessions.orgId, ctx.org.id),
            inArray(attendance.status, ["absent", "late"])
          )
        )
        .orderBy(desc(teachingSessions.day))
        .limit(15)
    : []
  const work = (await listAssignments(child).catch(() => []))
    .filter((a) => a.org?.slug === slug && a.published)
    .map((a) => ({
      slug: a.slug,
      title: a.title,
      exam: a.exam,
      dueAt: a.dueAt,
      phase: a.phase,
      earned: a.earned,
      total: a.total,
    }))
  return {
    child: { name: child.name ?? child.email },
    org: { name: ctx.org.name },
    relation: linkRow.relation,
    active: true,
    classes,
    absences: absences.map((a) => ({ ...a, group: pathName(ctx, a.groupId) })),
    work,
  }
}
