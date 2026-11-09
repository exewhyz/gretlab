import {
  assignments,
  attendance,
  contests,
  getDb,
  groupMembers,
  notes,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sql,
  syllabi,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  coAttainment,
  poAttainment,
  type Audience,
  type OutcomeMarks,
  type Permission,
} from "@workspace/judge"

import {
  csvField,
  getGradebook,
  listAssignments,
} from "@/features/assignments/server"
import {
  courseOutcomesOf,
  programOutcomesOf,
  rulesOf,
  saveCourseOutcomes,
} from "@/features/outcomes/server"
import type { CourseOutcomesInput } from "@/features/outcomes/schemas"
import { listContests } from "@/features/contests/server"
import { accessTo, rolePermissions, viewpoint } from "@/features/orgs/access"
import {
  canFor,
  checkAudience,
  groupChain,
  groupsFor,
  needFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { notFound } from "@/lib/api/route"
import { notify } from "@/features/notifications/server"

/*
 * A class is a group someone teaches, at any level: "CSE", "CSE › 2026-A" or a lab. Its
 * page gathers what's otherwise spread over the organization: notices and logged
 * classes, assignments and contests aimed at it (or at a group above it), its people
 * and grades. Teachers of the group see all of it; students sitting in it (or a group
 * inside it) see what's theirs. Everyone else gets 404.
 */

const { and, desc, eq, inArray } = sql

/** Holding any of these for a group makes someone its teacher. */
const TEACHING: Permission[] = [
  "teaching.log",
  "assignments.manage",
  "contests.manage",
  "gradebook.view",
  "notices.manage",
  "reports.view",
]

export interface ClassContext {
  ctx: OrgContext
  groupId: string
  teaches: boolean
  /** Whether the viewer sits in this group or one inside it. */
  sits: boolean
  /** Ids of this group and every group inside it. */
  inside: string[]
}

export async function classContext(
  slug: string,
  user: User,
  groupId: string
): Promise<ClassContext> {
  const ctx = await orgContext(slug, user)
  if (!ctx.groups.some((g) => g.id === groupId))
    throw notFound("Class not found")
  const inside = ctx.groups
    .filter((g) => groupChain(ctx, g.id).includes(groupId))
    .map((g) => g.id)
  const teaches = TEACHING.some((p) => canFor(ctx, p, [[groupId]]))
  let sits = false
  if (ctx.membership?.status === "active") {
    const mine = await getDb()
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, user.id),
          inArray(groupMembers.groupId, inside)
        )
      )
      .limit(1)
    sits = mine.length > 0
  }
  if (!teaches && !sits) throw notFound("Class not found")
  return { ctx, groupId, teaches, sits, inside }
}

const nameOf = (ctx: OrgContext, id: string) =>
  ctx.groups.find((g) => g.id === id)?.name ?? "?"

const pathOf = (ctx: OrgContext, id: string) =>
  groupChain(ctx, id)
    .reverse()
    .map((x) => ({ id: x, name: nameOf(ctx, x) }))

/**
 * How content reaches a class, or null when it doesn't: aimed at the class itself, at a
 * group above it ("From CSE"), at groups inside it, or more narrowly ("3rd Year and
 * CAC"). Organization-wide content reaches every class.
 */
export function relation(ctx: OrgContext, audience: Audience, groupId: string) {
  const conditions = audience.filter((c) => c.length > 0)
  if (conditions.length === 0)
    return { kind: "org" as const, label: "Whole organization" }
  const above = groupChain(ctx, groupId)
  const related = (id: string) =>
    above.includes(id) || groupChain(ctx, id).includes(groupId)
  if (!conditions.some((c) => c.some(related))) return null
  const label = conditions
    .map((c) => c.map((id) => nameOf(ctx, id)).join(" or "))
    .join(" and ")
  if (conditions.length === 1 && conditions[0]!.length === 1) {
    const only = conditions[0]![0]!
    if (only === groupId) return { kind: "class" as const, label: "This class" }
    if (above.includes(only))
      return { kind: "above" as const, label: `From ${nameOf(ctx, only)}` }
  }
  return { kind: "narrow" as const, label: `For ${label}` }
}

/** Members sitting in a class (any group inside it), without people who teach. */
export async function studentsIn(cc: ClassContext) {
  const db = getDb()
  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
      handle: users.handle,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.userId, users.id),
        eq(orgMembers.orgId, cc.ctx.org.id),
        eq(orgMembers.status, "active")
      )
    )
    .where(inArray(groupMembers.groupId, cc.inside))
  const teachers = new Set((await teachersOf(cc)).map((t) => t.id))
  return rows
    .filter((r) => !teachers.has(r.id))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
}

/** People with a teaching role covering this class, named for its page. */
async function teachersOf(cc: ClassContext) {
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      handle: users.handle,
      groupId: roleAssignments.groupId,
      role: orgRoles.name,
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .innerJoin(users, eq(roleAssignments.userId, users.id))
    .where(eq(roleAssignments.orgId, cc.ctx.org.id))
  const above = groupChain(cc.ctx, cc.groupId)
  const seen = new Map<string, { id: string; name: string; roles: string[] }>()
  for (const r of rows) {
    // Owners and admins run everything; only people given teaching count as teachers.
    if (r.systemKey === "owner" || r.systemKey === "admin") continue
    if (!rolePermissions(r).includes("teaching.log")) continue
    if (r.groupId && !above.includes(r.groupId)) continue
    const t = seen.get(r.id) ?? {
      id: r.id,
      name: r.name ?? r.handle ?? r.email,
      roles: [],
    }
    t.roles.push(
      r.groupId && r.groupId !== cc.groupId
        ? `${r.role} (${nameOf(cc.ctx, r.groupId)})`
        : r.role
    )
    seen.set(r.id, t)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------- the class ---------- */

export async function classOverview(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  const can = (p: Permission) => canFor(ctx, p, [[groupId]])
  const [students, teachers, sizes] = await Promise.all([
    studentsIn(cc),
    teachersOf(cc),
    getDb()
      .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, cc.inside)),
  ])
  const depth = groupChain(ctx, groupId).length - 1
  const children = ctx.groups
    .filter((g) => g.parentId === groupId)
    .map((g) => ({
      id: g.id,
      name: g.name,
      members: new Set(
        sizes
          .filter((s) => groupChain(ctx, s.groupId).includes(g.id))
          .map((s) => s.userId)
      ).size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return {
    org: { slug: ctx.org.slug, name: ctx.org.name },
    group: {
      id: groupId,
      name: nameOf(ctx, groupId),
      level: ctx.org.groupLevels[depth] ?? null,
      path: pathOf(ctx, groupId),
    },
    children,
    students: students.length,
    teachers: teachers.map(({ name, roles }) => ({ name, roles })),
    viewer: { teaches: cc.teaches, sits: cc.sits },
    can: {
      assignments: can("assignments.manage"),
      contests: can("contests.manage"),
      notices: can("notices.manage"),
      grades: can("gradebook.view"),
      people: can("org.members.view"),
      log: can("teaching.log"),
      reports: can("reports.view"),
    },
  }
}

/** Assignments and contests reaching this class, and its syllabus. */
export async function classwork(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  const db = getDb()
  const [mineA, mineC, rowsA, rowsC, plan, vp] = await Promise.all([
    // Each list already holds only what this person may take part in or manage.
    listAssignments(user).catch(() => []),
    listContests(user).catch(() => []),
    db
      .select({
        id: assignments.id,
        slug: assignments.slug,
        audience: assignments.audience,
        createdAt: assignments.createdAt,
      })
      .from(assignments)
      .where(eq(assignments.orgId, ctx.org.id)),
    db
      .select({
        id: contests.id,
        slug: contests.slug,
        audience: contests.audience,
      })
      .from(contests)
      .where(eq(contests.orgId, ctx.org.id)),
    db.select().from(syllabi).where(eq(syllabi.groupId, groupId)),
    viewpoint(user),
  ])
  const work = mineA.flatMap((a) => {
    const row = rowsA.find((r) => r.slug === a.slug)
    const rel = row && relation(ctx, row.audience, groupId)
    if (!row || !rel) return []
    const canManage =
      accessTo(
        vp,
        { orgId: ctx.org.id, audience: row.audience },
        "assignments.manage"
      ) === "manage"
    return [
      { ...a, id: row.id, createdAt: row.createdAt, reach: rel, canManage },
    ]
  })
  const events = mineC.flatMap((c) => {
    const row = rowsC.find((r) => r.id === c.id)
    const rel = row && relation(ctx, row.audience, groupId)
    if (!row || !rel) return []
    return [
      {
        id: c.id,
        slug: c.slug,
        title: c.title,
        phase: c.phase,
        published: c.published,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        createdAt: c.createdAt,
        reach: rel,
        canManage:
          accessTo(
            vp,
            { orgId: ctx.org.id, audience: row.audience },
            "contests.manage"
          ) === "manage",
      },
    ]
  })
  return {
    topics: plan[0]?.topics ?? [],
    assignments: work,
    contests: events,
  }
}

/** Notices, logged classes and new work, newest first. */
export async function classStream(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  const db = getDb()
  const [noticeRows, sessions, work, vp] = await Promise.all([
    db
      .select({ note: notes, author: users.name, email: users.email })
      .from(notes)
      .leftJoin(users, eq(notes.authorId, users.id))
      .where(eq(notes.orgId, ctx.org.id))
      .orderBy(desc(notes.createdAt))
      .limit(200),
    db
      .select({
        session: teachingSessions,
        teacher: users.name,
        email: users.email,
      })
      .from(teachingSessions)
      .leftJoin(users, eq(teachingSessions.teacherId, users.id))
      .where(inArray(teachingSessions.groupId, cc.inside))
      .orderBy(desc(teachingSessions.createdAt))
      .limit(50),
    classwork(slug, user, groupId),
    viewpoint(user),
  ])
  const topicTitle = (id: string) => work.topics.find((t) => t.id === id)?.title
  const items = [
    ...noticeRows.flatMap(({ note, author, email }) => {
      const rel = relation(ctx, note.audience, groupId)
      const access = accessTo(
        vp,
        { orgId: ctx.org.id, audience: note.audience },
        "notices.manage"
      )
      if (!rel || access === "none") return []
      return [
        {
          kind: "notice" as const,
          id: note.id,
          at: note.createdAt,
          text: note.text,
          by: author ?? email ?? null,
          reach: rel,
          canDelete: access === "manage",
        },
      ]
    }),
    ...sessions.map(({ session, teacher, email }) => ({
      kind: "class" as const,
      id: session.id,
      at: session.createdAt,
      day: session.day,
      minutes: session.minutes,
      group: session.groupId === groupId ? null : nameOf(ctx, session.groupId),
      topics: session.topicIds.map(topicTitle).filter(Boolean) as string[],
      note: session.note,
      by: teacher ?? email ?? null,
    })),
    ...work.assignments
      .filter((a) => a.published)
      .map((a) => ({
        kind: "assignment" as const,
        id: a.id,
        at: a.createdAt,
        slug: a.slug,
        title: a.title,
        dueAt: a.dueAt,
        reach: a.reach,
      })),
    ...work.contests
      .filter((c) => c.published)
      .map((c) => ({
        kind: "contest" as const,
        id: c.id,
        at: c.createdAt,
        slug: c.slug,
        title: c.title,
        startsAt: c.startsAt,
        reach: c.reach,
      })),
  ]
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 80)
}

/** A notice for this class: everyone in it, including groups inside it. */
export async function postClassNotice(
  slug: string,
  user: User,
  groupId: string,
  text: string
) {
  const { ctx } = await classContext(slug, user, groupId)
  const audience = [[groupId]]
  checkAudience(ctx, audience)
  needFor(ctx, "notices.manage", audience)
  const [note] = await getDb()
    .insert(notes)
    .values({ text, orgId: ctx.org.id, audience, authorId: user.id })
    .returning()
  await writeAudit(
    ctx,
    "notice.create",
    `Posted a notice to ${nameOf(ctx, groupId)}`
  )
  const cc = await classContext(slug, user, groupId)
  await notify(
    (await studentsIn(cc)).map((s) => s.id),
    {
      kind: "notice",
      title: `New notice in ${nameOf(ctx, groupId)}`,
      body: text.slice(0, 300),
      href: `/orgs/${slug}/classes/${groupId}`,
    }
  )
  return note
}

/** Every student of the class against every published assignment reaching it. */
export async function classGrades(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  needFor(ctx, "gradebook.view", [[groupId]])
  const [students, work] = await Promise.all([
    studentsIn(cc),
    classwork(slug, user, groupId),
  ])
  const scope = groupsFor(ctx, "gradebook.view")
  const published = work.assignments
    .filter((a) => a.published)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const books = await Promise.all(
    published.map((a) => getGradebook(a.id, ctx.org.id, scope))
  )
  const emails = new Set(students.map((s) => s.email))
  const columns = published.map((a, i) => {
    const book = books[i]!
    const rows = book.rows.filter((r) => emails.has(r.email))
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      dueAt: a.dueAt,
      phase: a.phase,
      total: book.total,
      average: rows.length
        ? Math.round(
            (10 * rows.reduce((s, r) => s + r.earned, 0)) / rows.length
          ) / 10
        : null,
      marks: new Map(rows.map((r) => [r.email, r.earned])),
    }
  })
  return {
    assignments: columns.map(({ marks: _, ...c }) => c),
    students: students.map((s) => {
      const marks = columns.map((c) => c.marks.get(s.email) ?? null)
      const given = columns.filter((c) => c.marks.has(s.email))
      const total = given.reduce((sum, c) => sum + c.total, 0)
      const earned = given.reduce(
        (sum, c) => sum + (c.marks.get(s.email) ?? 0),
        0
      )
      return {
        name: s.name ?? s.handle ?? s.email,
        email: s.email,
        marks,
        percent: total ? Math.round((100 * earned) / total) : null,
      }
    }),
  }
}

/** Teachers and classmates, as a student sees them: names only. */
export async function classPeople(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const [students, teachers] = await Promise.all([
    studentsIn(cc),
    teachersOf(cc),
  ])
  return {
    teachers: teachers.map(({ name, roles }) => ({ name, roles })),
    students: students.map((s) => ({
      name: s.name ?? s.handle ?? "Someone",
      handle: s.handle,
      me: s.id === user.id,
    })),
  }
}

/* ---------- attendance ---------- */

/** The class's students with each one's attendance over logged classes that marked it. */
export async function classAttendance(
  slug: string,
  user: User,
  groupId: string
) {
  const cc = await classContext(slug, user, groupId)
  const db = getDb()
  const sessions = await db
    .select({ id: teachingSessions.id, day: teachingSessions.day })
    .from(teachingSessions)
    .where(inArray(teachingSessions.groupId, cc.inside))
  const marks = sessions.length
    ? await db
        .select()
        .from(attendance)
        .where(
          inArray(
            attendance.sessionId,
            sessions.map((s) => s.id)
          )
        )
    : []
  const summarize = (userId: string) => {
    const own = marks.filter((m) => m.userId === userId)
    const present = own.filter((m) => m.present).length
    return {
      marked: own.length,
      present,
      percent: own.length ? Math.round((100 * present) / own.length) : null,
    }
  }
  const staff =
    canFor(cc.ctx, "teaching.log", [[groupId]]) ||
    canFor(cc.ctx, "reports.view", [[groupId]])
  if (!staff) return { mine: summarize(user.id), students: [] }
  const students = await studentsIn(cc)
  return {
    mine: null,
    students: students.map((s) => ({
      id: s.id,
      name: s.name ?? s.handle ?? s.email,
      email: s.email,
      ...summarize(s.id),
    })),
  }
}

/* ---------- a student's classes ---------- */

/**
 * The classes someone sits in, across their organizations: each last-level group they're
 * in, with its path. Work set for a group above reaches them through these.
 */
export async function myClasses(user: User) {
  const db = getDb()
  const rows = await db
    .select({
      groupId: groupMembers.groupId,
      orgId: orgGroups.orgId,
    })
    .from(groupMembers)
    .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, orgGroups.orgId),
        eq(orgMembers.userId, user.id),
        eq(orgMembers.status, "active")
      )
    )
    .innerJoin(organizations, eq(orgGroups.orgId, organizations.id))
    .where(
      and(eq(groupMembers.userId, user.id), eq(organizations.active, true))
    )
  const orgIds = [...new Set(rows.map((r) => r.orgId))]
  if (orgIds.length === 0) return []
  const [orgs, groups] = await Promise.all([
    db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        levels: organizations.groupLevels,
      })
      .from(organizations)
      .where(inArray(organizations.id, orgIds)),
    db
      .select({
        id: orgGroups.id,
        name: orgGroups.name,
        parentId: orgGroups.parentId,
      })
      .from(orgGroups)
      .where(inArray(orgGroups.orgId, orgIds)),
  ])
  const chain = (id: string) => {
    const out: { id: string; name: string }[] = []
    let current = groups.find((g) => g.id === id)
    while (current) {
      out.unshift({ id: current.id, name: current.name })
      current = groups.find((g) => g.id === current!.parentId)
    }
    return out
  }
  return orgs
    .map((org) => ({
      slug: org.slug,
      name: org.name,
      classes: rows
        .filter((r) => r.orgId === org.id)
        .map((r) => {
          const path = chain(r.groupId)
          return {
            id: r.groupId,
            name: path.at(-1)?.name ?? "?",
            path: path.map((p) => p.name).join(" › "),
            level: org.levels[path.length - 1] ?? null,
          }
        })
        .sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------- outcomes ---------- */

/**
 * Course outcome attainment for a class: each CO's evidence (problems tagged with it in
 * published assignments reaching the class), how many students reached it and its level,
 * the POs it feeds, and each student's percent per CO. Teachers only.
 */
export async function classOutcomes(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  const { ctx } = cc
  if (!cc.teaches) throw notFound("Class not found")
  needFor(ctx, "gradebook.view", [[groupId]])
  const [students, work, pos, cos] = await Promise.all([
    studentsIn(cc),
    classwork(slug, user, groupId),
    programOutcomesOf(ctx.org.id),
    courseOutcomesOf([groupId]),
  ])
  const rules = rulesOf(ctx)
  const scope = groupsFor(ctx, "gradebook.view")
  const published = work.assignments.filter((a) => a.published)
  const books = await Promise.all(
    published.map((a) => getGradebook(a.id, ctx.org.id, scope))
  )
  const emails = new Set(students.map((s) => s.email))
  const coIds = new Set(cos.map((c) => c.id))
  const marks = new Map<string, Map<string, OutcomeMarks>>()
  const evidence = new Map<string, { assignment: string; problem: string; points: number }[]>()
  for (const [i, book] of books.entries()) {
    for (const [index, problem] of book.problems.entries()) {
      const tags = problem.outcomes.filter((id) => coIds.has(id))
      if (tags.length === 0) continue
      for (const co of tags) {
        evidence.set(co, [
          ...(evidence.get(co) ?? []),
          { assignment: published[i]!.title, problem: problem.title, points: problem.points },
        ])
      }
      // Only students the assignment is for: work not set for someone doesn't count against them.
      for (const row of book.rows) {
        if (!emails.has(row.email)) continue
        const own = marks.get(row.email) ?? new Map<string, OutcomeMarks>()
        for (const co of tags) {
          const m = own.get(co) ?? { earned: 0, max: 0 }
          own.set(co, {
            earned: m.earned + (row.cells[index]?.earned ?? 0),
            max: m.max + problem.points,
          })
        }
        marks.set(row.email, own)
      }
    }
  }
  const poIds = new Set(pos.map((p) => p.id))
  const outcomes = cos.map((co) => ({
    id: co.id,
    code: co.code,
    title: co.title,
    mapping: Object.fromEntries(
      Object.entries(co.mapping).filter(([po]) => poIds.has(po))
    ),
    evidence: evidence.get(co.id) ?? [],
    ...coAttainment(
      students.map((s) => marks.get(s.email)?.get(co.id) ?? { earned: 0, max: 0 }),
      rules
    ),
  }))
  return {
    canEdit: canFor(ctx, "assignments.manage", [[groupId]]),
    rules,
    programOutcomes: pos.map((po) => ({
      ...po,
      attainment: poAttainment(outcomes, po.id),
    })),
    outcomes,
    students: students.map((s) => ({
      name: s.name ?? s.handle ?? s.email,
      email: s.email,
      /** Percent per CO, in the order of `outcomes`; null when not assessed. */
      percents: cos.map((co) => {
        const m = marks.get(s.email)?.get(co.id)
        return m && m.max > 0 ? Math.round((1000 * m.earned) / m.max) / 10 : null
      }),
    })),
  }
}

export async function saveClassOutcomes(
  slug: string,
  user: User,
  groupId: string,
  input: CourseOutcomesInput
) {
  const cc = await classContext(slug, user, groupId)
  await saveCourseOutcomes(cc.ctx, groupId, input)
  return classOutcomes(slug, user, groupId)
}

/** The attainment report as a spreadsheet: each student's percent per CO, then the levels. */
export async function classOutcomesCsv(slug: string, user: User, groupId: string) {
  const report = await classOutcomes(slug, user, groupId)
  const cc = await classContext(slug, user, groupId)
  const name = nameOf(cc.ctx, groupId)
  const lines: (string | number | null)[][] = [
    ["Name", "Email", ...report.outcomes.map((o) => `${o.code} %`)],
    ...report.students.map((s) => [s.name, s.email, ...s.percents]),
    [],
    ["Outcome", "Students assessed", "Reached", "Percent reached", "Level"],
    ...report.outcomes.map((o) => [o.code, o.assessed, o.reached, o.percent, o.level]),
    [],
    ["Program outcome", "Attainment"],
    ...report.programOutcomes.map((p) => [p.code, p.attainment]),
  ]
  return {
    filename: `${name.replace(/[^\w-]+/g, "-")}-outcomes.csv`,
    body: "﻿" + lines.map((l) => l.map(csvField).join(",")).join("\r\n") + "\r\n",
  }
}
