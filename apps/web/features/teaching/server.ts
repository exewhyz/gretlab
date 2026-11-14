import {
  assignmentProblems,
  assignments,
  attendance,
  contests,
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sessionFeedback,
  sql,
  submissions,
  syllabi,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import { syllabusProgress, type Permission } from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { ApiError, notFound } from "@/lib/api/route"
import { likeTerm, paged } from "@/lib/api/paging"
import { getGradebook } from "@/features/assignments/server"
import { today } from "@/features/catalog/server"
import { rolePermissions } from "@/features/orgs/access"
import {
  canAnywhere,
  canFor,
  groupChain,
  groupsFor,
  needFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"

const {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lte,
  not,
  notExists,
  or,
} = sql
const raw = sql.sql

const NOBODY = "00000000-0000-0000-0000-000000000000"

export const syllabusSchema = z.object({
  topics: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().trim().min(1, "Every topic needs a title").max(200),
        plannedFor: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .default(null),
      })
    )
    .max(300),
})

export const sessionSchema = z.object({
  groupId: z.uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day"),
  minutes: z.number().int().min(5, "At least 5 minutes").max(600),
  topicIds: z.array(z.string().max(40)).max(50).default([]),
  note: z.string().max(2000).default(""),
  /** Who was there; leave empty to not take attendance. */
  attendance: z
    .array(z.object({ userId: z.uuid(), present: z.boolean() }))
    .max(5000)
    .default([]),
})

/** Groups a permission reaches, as tree-ordered ids. */
function reach(ctx: OrgContext, permission: Permission) {
  const scope = groupsFor(ctx, permission)
  return ctx.groups
    .filter((g) => scope === "all" || scope.has(g.id))
    .map((g) => g.id)
}

const daysAgo = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

async function syllabusOf(groupId: string) {
  const [row] = await getDb()
    .select()
    .from(syllabi)
    .where(eq(syllabi.groupId, groupId))
  return row?.topics ?? []
}

/* ---------- syllabus and teaching log ---------- */

export async function getGroupTeaching(
  slug: string,
  user: User,
  groupId: string
) {
  const ctx = await orgContext(slug, user)
  if (!ctx.groups.some((g) => g.id === groupId))
    throw notFound("Group not found")
  if (
    !canFor(ctx, "teaching.log", [[groupId]]) &&
    !canFor(ctx, "reports.view", [[groupId]])
  ) {
    throw new ApiError(403, "forbidden", "You don't teach this group.")
  }
  const db = getDb()
  const [topics, sessions] = await Promise.all([
    syllabusOf(groupId),
    db
      .select({
        session: teachingSessions,
        teacher: users.name,
        email: users.email,
      })
      .from(teachingSessions)
      .leftJoin(users, eq(teachingSessions.teacherId, users.id))
      .where(
        and(
          eq(teachingSessions.groupId, groupId),
          eq(teachingSessions.kind, "class")
        )
      )
      .orderBy(desc(teachingSessions.day), desc(teachingSessions.createdAt))
      .limit(500),
  ])
  const day = await today()
  const feedback = await feedbackFor(sessions.map((s) => s.session.id))
  return {
    group: ctx.groups.find((g) => g.id === groupId)!.name,
    canEdit: canFor(ctx, "teaching.log", [[groupId]]),
    today: day,
    topics,
    progress: syllabusProgress(
      topics,
      sessions.map((s) => s.session),
      day
    ),
    sessions: sessions.map(({ session, teacher, email }) => ({
      id: session.id,
      day: session.day,
      minutes: session.minutes,
      topics: session.topicIds
        .map((id) => topics.find((t) => t.id === id)?.title)
        .filter(Boolean),
      note: session.note,
      teacher: teacher ?? email ?? "Someone removed",
      mine: session.teacherId === user.id,
      rating: feedback.get(session.id) ?? null,
    })),
  }
}

export async function saveSyllabus(
  slug: string,
  user: User,
  groupId: string,
  input: z.infer<typeof syllabusSchema>
) {
  const ctx = await orgContext(slug, user)
  if (!ctx.groups.some((g) => g.id === groupId))
    throw notFound("Group not found")
  needFor(ctx, "teaching.log", [[groupId]])
  await getDb()
    .insert(syllabi)
    .values({ groupId, orgId: ctx.org.id, topics: input.topics })
    .onConflictDoUpdate({
      target: syllabi.groupId,
      set: { topics: input.topics },
    })
  await writeAudit(
    ctx,
    "syllabus.update",
    `Updated the syllabus of ${ctx.groups.find((g) => g.id === groupId)!.name}`
  )
}

export async function logSession(
  slug: string,
  user: User,
  input: z.infer<typeof sessionSchema>
) {
  const ctx = await orgContext(slug, user)
  if (!ctx.groups.some((g) => g.id === input.groupId))
    throw notFound("Group not found")
  needFor(ctx, "teaching.log", [[input.groupId]])
  const day = await today()
  if (input.day > day) {
    throw new ApiError(
      400,
      "future_day",
      "Log classes on or after the day they happen."
    )
  }
  const topics = await syllabusOf(input.groupId)
  if (input.topicIds.some((id) => !topics.some((t) => t.id === id))) {
    throw new ApiError(
      400,
      "unknown_topic",
      "A topic isn't in this group's syllabus."
    )
  }
  const { attendance: marks, ...fields } = input
  const db = getDb()
  if (marks.length) {
    // Only people sitting in the class (or a group inside it) can be marked.
    const inside = ctx.groups
      .filter((g) => groupChain(ctx, g.id).includes(input.groupId))
      .map((g) => g.id)
    const members = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          inArray(groupMembers.groupId, inside),
          inArray(
            groupMembers.userId,
            marks.map((m) => m.userId)
          )
        )
      )
    const known = new Set(members.map((m) => m.userId))
    if (marks.some((m) => !known.has(m.userId))) {
      throw new ApiError(
        400,
        "not_in_class",
        "Attendance can only be marked for people in this class."
      )
    }
  }
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(teachingSessions)
      .values({ ...fields, orgId: ctx.org.id, teacherId: user.id })
      .returning()
    if (marks.length) {
      await tx
        .insert(attendance)
        .values(
          marks.map((m) => ({
            ...m,
            status: m.present ? ("present" as const) : ("absent" as const),
            sessionId: session!.id,
          }))
        )
        .onConflictDoNothing()
    }
    return session
  })
}

export async function deleteSession(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const [session] = await getDb()
    .select()
    .from(teachingSessions)
    .where(
      and(eq(teachingSessions.id, id), eq(teachingSessions.orgId, ctx.org.id))
    )
  if (!session) throw notFound("Class not found")
  // Your own, or anyone's if you look after teaching across the organization.
  if (session.teacherId !== user.id) needFor(ctx, "teaching.log", [])
  await getDb().delete(teachingSessions).where(eq(teachingSessions.id, id))
}

/* ---------- the teacher's home, across organizations ---------- */

const TEACHING: Permission[] = [
  "teaching.log",
  "assignments.manage",
  "contests.manage",
  "gradebook.view",
  "reports.view",
]

export async function teacherHome(user: User) {
  const db = getDb()
  const mine = await db
    .select({ slug: organizations.slug })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.userId, user.id),
        eq(orgMembers.status, "active"),
        eq(organizations.active, true)
      )
    )
  const day = await today()
  const weekAgo = daysAgo(day, 7)
  const result = []
  for (const { slug } of mine) {
    const ctx = await orgContext(slug, user)
    if (!TEACHING.some((p) => canAnywhere(ctx, p))) continue
    const ids = [
      ...new Set([
        ...reach(ctx, "teaching.log"),
        ...reach(ctx, "assignments.manage"),
      ]),
    ]
    const [sizes, plans, sessions] = ids.length
      ? await Promise.all([
          db
            .select({
              groupId: groupMembers.groupId,
              userId: groupMembers.userId,
            })
            .from(groupMembers)
            .where(
              inArray(
                groupMembers.groupId,
                ctx.groups.map((g) => g.id)
              )
            ),
          db.select().from(syllabi).where(inArray(syllabi.groupId, ids)),
          db
            .select({
              groupId: teachingSessions.groupId,
              topicIds: teachingSessions.topicIds,
              day: teachingSessions.day,
              teacherId: teachingSessions.teacherId,
            })
            .from(teachingSessions)
            .where(
              and(
                inArray(teachingSessions.groupId, ids),
                eq(teachingSessions.kind, "class")
              )
            ),
        ])
      : [[], [], []]
    const groups = ctx.groups
      .filter((g) => ids.includes(g.id))
      .map((g) => {
        // Students in this group or any group inside it.
        const inside = new Set(
          sizes
            .filter((m) => groupChain(ctx, m.groupId).includes(g.id))
            .map((m) => m.userId)
        )
        const own = sessions.filter((s) => s.groupId === g.id)
        return {
          id: g.id,
          name: g.name,
          parentId: g.parentId,
          level: ctx.org.groupLevels[groupChain(ctx, g.id).length - 1] ?? null,
          path: groupChain(ctx, g.id)
            .reverse()
            .map((id) => ctx.groups.find((x) => x.id === id)!.name)
            .join(" › "),
          members: inside.size,
          progress: syllabusProgress(
            plans.find((p) => p.groupId === g.id)?.topics ?? [],
            own,
            day
          ),
          classesThisWeek: own.filter((s) => s.day >= weekAgo).length,
          canLog: canFor(ctx, "teaching.log", [[g.id]]),
        }
      })
      .sort((a, b) => byName(a.path, b.path))
    // Published work this person runs, due in the coming week.
    const now = new Date()
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const dueSoon = (
      await db
        .select({
          id: assignments.id,
          slug: assignments.slug,
          title: assignments.title,
          dueAt: assignments.dueAt,
          audience: assignments.audience,
        })
        .from(assignments)
        .where(
          and(
            eq(assignments.orgId, ctx.org.id),
            eq(assignments.published, true),
            gte(assignments.dueAt, now),
            lte(assignments.dueAt, weekAhead)
          )
        )
    )
      .filter((a) => canFor(ctx, "assignments.manage", a.audience))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map(({ audience: _, ...a }) => a)
    result.push({
      slug,
      name: ctx.org.name,
      type: ctx.org.type,
      dueSoon,
      groups,
      myClassesThisWeek: sessions.filter(
        (s) => s.teacherId === user.id && s.day >= weekAgo
      ).length,
      can: {
        assignments:
          ctx.modules.has("coding") && canAnywhere(ctx, "assignments.manage"),
        contests:
          ctx.modules.has("coding") && canAnywhere(ctx, "contests.manage"),
        grades: canAnywhere(ctx, "gradebook.view"),
        reports: canAnywhere(ctx, "reports.view"),
      },
    })
  }
  return { today: day, orgs: result }
}

/** Whether this person teaches anywhere, for showing Teach in the navigation. */
export async function teachesAnywhere(user: User) {
  const rows = await getDb()
    .select({
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, roleAssignments.orgId),
        eq(orgMembers.userId, roleAssignments.userId),
        eq(orgMembers.status, "active")
      )
    )
    .where(eq(roleAssignments.userId, user.id))
  return rows.some((r) =>
    rolePermissions(r).some((p) => TEACHING.includes(p as Permission))
  )
}

/* ---------- organization reports ---------- */

/*
 * Reports come in two parts, so the screen never rebuilds every student's figures to show
 * a page of them:
 * - the figures (`orgReportFigures`): the summary, assignments and teaching, worked out once
 *   for the group chosen;
 * - the student table (`orgReportStudents`), paged in SQL: the page's students are chosen in
 *   the database (search and "no work this week" in the query), then figures are worked out
 *   for those students only.
 * `orgReport` is both at once, every student (the CSV and older callers).
 */

/** Who may see what: the person's reach, and the groups this report covers. */
async function reportBase(slug: string, user: User, groupId: string | null) {
  const ctx = await orgContext(slug, user)
  if (!canAnywhere(ctx, "reports.view")) {
    throw new ApiError(
      403,
      "forbidden",
      'This needs the "See reports" permission.'
    )
  }
  const scope = groupsFor(ctx, "reports.view")
  if (groupId) {
    if (!ctx.groups.some((g) => g.id === groupId))
      throw notFound("Group not found")
    if (scope !== "all" && !scope.has(groupId)) {
      throw new ApiError(
        403,
        "forbidden",
        "You don't have reports for that group."
      )
    }
  }
  // Report on one group if chosen; otherwise on everything this person may see.
  const reportScope: "all" | Set<string> = groupId
    ? new Set(
        ctx.groups
          .filter((g) => groupChain(ctx, g.id).includes(groupId))
          .map((g) => g.id)
      )
    : scope
  const db = getDb()
  const [roles, orgAssignments, orgContestIds] = await Promise.all([
    db
      .select({
        id: orgRoles.id,
        systemKey: orgRoles.systemKey,
        permissions: orgRoles.permissions,
      })
      .from(orgRoles)
      .where(eq(orgRoles.orgId, ctx.org.id)),
    // The organization always sees work on its own assignments and contests.
    db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.orgId, ctx.org.id), eq(assignments.published, true))
      ),
    db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.orgId, ctx.org.id)),
  ])
  const orgProblemIds = orgAssignments.length
    ? [
        ...new Set(
          (
            await db
              .select({ problemId: assignmentProblems.problemId })
              .from(assignmentProblems)
              .where(
                inArray(
                  assignmentProblems.assignmentId,
                  orgAssignments.map((a) => a.id)
                )
              )
          ).map((r) => r.problemId)
        ),
      ]
    : []
  const contestIds = orgContestIds.map((c) => c.id)
  const since7 = new Date(Date.now() - 7 * 86_400_000)
  const FALSE = raw`false`

  // Students, as the organization's home counts them: active members seated in a group
  // (here, one this report covers) who hold no role that grants anything. Parents,
  // librarians and office staff are members too, but not students.
  const granting = roles
    .filter((r) => rolePermissions(r).length > 0)
    .map((r) => r.id)
  const coveredGroups = ctx.groups
    .filter((g) => reportScope === "all" || reportScope.has(g.id))
    .map((g) => g.id)
  const isStudent = and(
    eq(orgMembers.orgId, ctx.org.id),
    eq(orgMembers.status, "active"),
    coveredGroups.length
      ? exists(
          db
            .select({ x: raw`1` })
            .from(groupMembers)
            .where(
              and(
                eq(groupMembers.userId, users.id),
                inArray(groupMembers.groupId, coveredGroups)
              )
            )
        )
      : FALSE,
    granting.length
      ? notExists(
          db
            .select({ x: raw`1` })
            .from(roleAssignments)
            .where(
              and(
                eq(roleAssignments.orgId, ctx.org.id),
                eq(roleAssignments.userId, users.id),
                inArray(roleAssignments.roleId, granting)
              )
            )
        )
      : undefined
  )!
  // Work in the last week that the organization may see: practice from those who share
  // it, and anyone's work on the organization's own assignments and contests.
  const activeThisWeek = exists(
    db
      .select({ x: raw`1` })
      .from(submissions)
      .where(
        and(
          eq(submissions.userId, users.id),
          gte(submissions.createdAt, since7),
          or(
            eq(orgMembers.shareProgress, true),
            orgProblemIds.length
              ? inArray(submissions.problemId, orgProblemIds)
              : undefined,
            contestIds.length
              ? inArray(submissions.contestId, contestIds)
              : undefined
          )
        )
      )
  )
  const pathOf = (id: string) =>
    groupChain(ctx, id)
      .reverse()
      .map((x) => ctx.groups.find((g) => g.id === x)!.name)
      .join(" › ")
  return {
    ctx,
    scope,
    reportScope,
    coveredGroups,
    orgAssignments,
    orgProblemIds: new Set(orgProblemIds),
    contestIds: new Set(contestIds),
    since7,
    isStudent,
    activeThisWeek,
    pathOf,
  }
}

type ReportBase = Awaited<ReturnType<typeof reportBase>>
type ReportStudent = {
  id: string
  name: string | null
  email: string
  share: boolean
}

const studentFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  share: orgMembers.shareProgress,
}

/** Every student in the report (who they are, not their figures). */
function allStudents(base: ReportBase) {
  return getDb()
    .select(studentFields)
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(base.isStudent)
}

/** Assignment results through the gradebook, so the same people and rules apply. */
function gradebooks(base: ReportBase, only?: readonly string[]) {
  return Promise.all(
    base.orgAssignments
      .filter((a) => a.opensAt <= new Date())
      .map(async (a) => ({
        a,
        book: await getGradebook(a.id, base.ctx.org.id, base.reportScope, only),
      }))
  )
}
type Books = Awaited<ReturnType<typeof gradebooks>>

/** A student's share of the marks across the assignments they're graded on. */
function assignmentPercent(books: Books, email: string) {
  let earned = 0
  let total = 0
  for (const { book } of books) {
    const row = book.rows.find((r) => r.email === email)
    if (row) {
      earned += row.earned
      total += book.total
    }
  }
  return total ? Math.round((100 * earned) / total) : null
}

/** The student table's rows, for these students only. */
async function studentRows(
  base: ReportBase,
  students: ReportStudent[],
  books: Books
) {
  const db = getDb()
  const ids = students.map((s) => s.id)
  if (ids.length === 0) return []
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const sharing = new Set(students.filter((s) => s.share).map((s) => s.id))
  const [seats, recent, solved] = await Promise.all([
    db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
      .where(
        and(
          eq(orgGroups.orgId, base.ctx.org.id),
          inArray(groupMembers.userId, ids)
        )
      ),
    db
      .select({
        userId: submissions.userId,
        problemId: submissions.problemId,
        contestId: submissions.contestId,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(
        and(
          inArray(submissions.userId, ids),
          gte(submissions.createdAt, since30)
        )
      ),
    // Practice is only counted for students who agreed to share it.
    sharing.size
      ? db
          .selectDistinct({
            userId: submissions.userId,
            problemId: submissions.problemId,
          })
          .from(submissions)
          .where(
            and(
              inArray(submissions.userId, [...sharing]),
              eq(submissions.kind, "submit"),
              eq(submissions.verdict, "AC")
            )
          )
      : [],
  ])
  const visibleWork = recent.filter(
    (r) =>
      sharing.has(r.userId) ||
      (r.problemId && base.orgProblemIds.has(r.problemId)) ||
      (r.contestId && base.contestIds.has(r.contestId))
  )
  return students.map((s) => {
    const last = visibleWork
      .filter((w) => w.userId === s.id)
      .reduce<Date | null>(
        (m, w) => (!m || w.createdAt > m ? w.createdAt : m),
        null
      )
    return {
      name: s.name,
      email: s.email,
      groups: seats
        .filter((x) => x.userId === s.id)
        .map((x) => base.pathOf(x.groupId)),
      lastActive: last,
      activeThisWeek: Boolean(last && last >= base.since7),
      assignmentPercent: assignmentPercent(books, s.email),
      practiceSolved: sharing.has(s.id)
        ? solved.filter((x) => x.userId === s.id).length
        : null,
    }
  })
}

/** Everything but the student table: the summary, assignments and teaching. */
async function reportFigures(
  base: ReportBase,
  students: ReportStudent[],
  books: Books,
  activeThisWeek: number
) {
  const { ctx, scope, pathOf } = base
  const db = getDb()
  const day = await today()
  const groupIds = base.coveredGroups
  const [plans, sessions] = groupIds.length
    ? await Promise.all([
        db.select().from(syllabi).where(inArray(syllabi.groupId, groupIds)),
        db
          .select({
            session: teachingSessions,
            teacher: users.name,
            email: users.email,
          })
          .from(teachingSessions)
          .leftJoin(users, eq(teachingSessions.teacherId, users.id))
          .where(
            and(
              inArray(teachingSessions.groupId, groupIds),
              eq(teachingSessions.kind, "class")
            )
          ),
      ])
    : [[], []]
  const monthAgo = daysAgo(day, 30)
  const feedback = await feedbackFor(
    sessions.filter((s) => s.session.day >= monthAgo).map((s) => s.session.id)
  )
  const teacherTotals = new Map<
    string,
    { classes: number; minutes: number; ratingSum: number; ratings: number }
  >()
  for (const { session, teacher, email } of sessions) {
    if (session.day < monthAgo) continue
    const key = teacher ?? email ?? "Someone removed"
    const t = teacherTotals.get(key) ?? {
      classes: 0,
      minutes: 0,
      ratingSum: 0,
      ratings: 0,
    }
    t.classes += 1
    t.minutes += session.minutes
    const f = feedback.get(session.id)
    if (f) {
      t.ratingSum += f.average * f.count
      t.ratings += f.count
    }
    teacherTotals.set(key, t)
  }
  const scored = students
    .map((s) => assignmentPercent(books, s.email))
    .filter((p): p is number => p !== null)

  return {
    org: ctx.org.name,
    levels: ctx.org.groupLevels,
    groups: ctx.groups
      .filter((g) => scope === "all" || scope.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parentId,
        path: pathOf(g.id),
      }))
      .sort((a, b) => byName(a.path, b.path)),
    summary: {
      students: students.length,
      activeThisWeek,
      sharing: students.filter((s) => s.share).length,
      averageAssignment: scored.length
        ? Math.round(scored.reduce((sum, p) => sum + p, 0) / scored.length)
        : null,
    },
    assignments: books.map(({ a, book }) => ({
      title: a.title,
      dueAt: a.dueAt,
      students: book.summary.students,
      started: book.summary.started,
      averagePercent: book.total
        ? Math.round((100 * book.summary.average) / book.total)
        : 0,
    })),
    teaching: {
      groups: groupIds
        .map((id) => ({
          path: pathOf(id),
          progress: syllabusProgress(
            plans.find((p) => p.groupId === id)?.topics ?? [],
            sessions
              .filter((s) => s.session.groupId === id)
              .map((s) => s.session),
            day
          ),
          classes: sessions.filter(
            (s) => s.session.groupId === id && s.session.day >= monthAgo
          ).length,
        }))
        .filter((g) => g.progress.total > 0 || g.classes > 0)
        .sort((a, b) => byName(a.path, b.path)),
      teachers: [...teacherTotals].map(([name, t]) => ({
        name,
        classes: t.classes,
        minutes: t.minutes,
        rating: t.ratings
          ? Math.round((10 * t.ratingSum) / t.ratings) / 10
          : null,
        ratings: t.ratings,
      })),
    },
  }
}

/** The whole report, every student (the CSV, and `GET /reports` without a page). */
export async function orgReport(
  slug: string,
  user: User,
  groupId: string | null
) {
  const base = await reportBase(slug, user, groupId)
  const [students, books] = await Promise.all([
    allStudents(base),
    gradebooks(base),
  ])
  const rows = await studentRows(base, students, books)
  return {
    ...(await reportFigures(
      base,
      students,
      books,
      rows.filter((r) => r.activeThisWeek).length
    )),
    students: rows.sort(
      (a, b) =>
        Number(a.activeThisWeek) - Number(b.activeThisWeek) ||
        byName(a.name ?? a.email, b.name ?? b.email)
    ),
  }
}

/** The report's figures, for the group chosen: no student table. */
export async function orgReportFigures(
  slug: string,
  user: User,
  groupId: string | null
) {
  const base = await reportBase(slug, user, groupId)
  const db = getDb()
  const [students, books, [active]] = await Promise.all([
    allStudents(base),
    gradebooks(base),
    db
      .select({ n: count() })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(base.isStudent, base.activeThisWeek)),
  ])
  return reportFigures(base, students, books, active?.n ?? 0)
}

const REPORT_STUDENTS_PER_PAGE = 100

/**
 * The student table a page at a time: the page's students chosen in the database (`q`:
 * name or email; `inactive`: no work this week), those with no work this week first, then
 * figures worked out for those students only.
 */
export async function orgReportStudents(
  slug: string,
  user: User,
  groupId: string | null,
  opts: { page: number; perPage?: number; inactive?: boolean; q?: string }
) {
  const base = await reportBase(slug, user, groupId)
  const db = getDb()
  const where = and(
    base.isStudent,
    opts.inactive ? not(base.activeThisWeek) : undefined,
    opts.q
      ? or(
          ilike(users.name, likeTerm(opts.q)),
          ilike(users.email, likeTerm(opts.q))
        )
      : undefined
  )
  const page = await paged({
    page: opts.page,
    perPage: opts.perPage ?? REPORT_STUDENTS_PER_PAGE,
    count: async () =>
      (
        await db
          .select({ n: count() })
          .from(orgMembers)
          .innerJoin(users, eq(orgMembers.userId, users.id))
          .where(where)
      )[0]?.n ?? 0,
    rows: (limit, offset) =>
      db
        .select(studentFields)
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(where)
        .orderBy(
          asc(base.activeThisWeek),
          asc(raw`coalesce(${users.name}, ${users.email})`),
          asc(users.id)
        )
        .limit(limit)
        .offset(offset),
  })
  const ids = page.items.map((s) => s.id)
  const books = ids.length ? await gradebooks(base, ids) : []
  const items = await studentRows(base, page.items, books)
  return { ...page, items, students: items }
}

/** The student table as CSV, defused against spreadsheet formulas. */
export async function orgReportCsv(
  slug: string,
  user: User,
  groupId: string | null
) {
  const report = await orgReport(slug, user, groupId)
  const field = (value: string | number | null) => {
    let text = value === null ? "" : String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [
    [
      "Name",
      "Email",
      "Groups",
      "Last active",
      "Active this week",
      "Assignments %",
      "Practice solved",
    ],
    ...report.students.map((s) => [
      s.name,
      s.email,
      s.groups.join("; "),
      s.lastActive ? s.lastActive.toISOString().slice(0, 10) : "",
      s.activeThisWeek ? "yes" : "no",
      s.assignmentPercent,
      s.practiceSolved,
    ]),
  ].map((row) => row.map(field).join(","))
  return "﻿" + lines.join("\r\n") + "\r\n"
}

/* ---------- class feedback ---------- */

export const feedbackSchema = z.object({
  rating: z.number().int().min(1, "1 to 5 stars").max(5, "1 to 5 stars"),
  comment: z.string().trim().max(1000).default(""),
})

const FEEDBACK_DAYS = 14

/** Classes from the last two weeks, for the groups this member is in, not yet rated. */
export async function classesToRate(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (ctx.membership?.status !== "active") return []
  const db = getDb()
  const mine = (
    await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, user.id))
  )
    .map((m) => m.groupId)
    .filter((id) => ctx.groups.some((g) => g.id === id))
  // A class for a branch is a class for everyone in its batches.
  const reachable = new Set(mine.flatMap((id) => groupChain(ctx, id)))
  if (reachable.size === 0) return []
  const day = await today()
  const [sessions, rated] = await Promise.all([
    db
      .select({
        session: teachingSessions,
        teacher: users.name,
        email: users.email,
      })
      .from(teachingSessions)
      .leftJoin(users, eq(teachingSessions.teacherId, users.id))
      .where(
        and(
          eq(teachingSessions.orgId, ctx.org.id),
          eq(teachingSessions.kind, "class"),
          inArray(teachingSessions.groupId, [...reachable]),
          gte(teachingSessions.day, daysAgo(day, FEEDBACK_DAYS))
        )
      )
      .orderBy(desc(teachingSessions.day)),
    db
      .select({ sessionId: sessionFeedback.sessionId })
      .from(sessionFeedback)
      .where(eq(sessionFeedback.userId, user.id)),
  ])
  const done = new Set(rated.map((r) => r.sessionId))
  return sessions
    .filter(
      ({ session }) => !done.has(session.id) && session.teacherId !== user.id
    )
    .map(({ session, teacher, email }) => ({
      id: session.id,
      day: session.day,
      group: ctx.groups.find((g) => g.id === session.groupId)?.name ?? "",
      teacher: teacher ?? email ?? "",
      minutes: session.minutes,
    }))
}

export async function rateClass(
  slug: string,
  user: User,
  sessionId: string,
  input: z.infer<typeof feedbackSchema>
) {
  const allowed = await classesToRate(slug, user)
  if (!allowed.some((c) => c.id === sessionId)) {
    throw new ApiError(
      403,
      "forbidden",
      "You can rate classes of your own groups from the last two weeks, once."
    )
  }
  await getDb()
    .insert(sessionFeedback)
    .values({ sessionId, userId: user.id, ...input })
    .onConflictDoNothing()
}

/** Average rating and count per class. Comments come without names. */
export async function feedbackFor(sessionIds: string[]) {
  if (sessionIds.length === 0)
    return new Map<
      string,
      { average: number; count: number; comments: string[] }
    >()
  const rows = await getDb()
    .select({
      sessionId: sessionFeedback.sessionId,
      rating: sessionFeedback.rating,
      comment: sessionFeedback.comment,
    })
    .from(sessionFeedback)
    .where(inArray(sessionFeedback.sessionId, sessionIds))
  const out = new Map<
    string,
    { average: number; count: number; comments: string[] }
  >()
  for (const id of sessionIds) {
    const own = rows.filter((r) => r.sessionId === id)
    if (own.length === 0) continue
    out.set(id, {
      average:
        Math.round(
          (10 * own.reduce((sum, r) => sum + r.rating, 0)) / own.length
        ) / 10,
      count: own.length,
      comments: own.map((r) => r.comment).filter(Boolean),
    })
  }
  return out
}
