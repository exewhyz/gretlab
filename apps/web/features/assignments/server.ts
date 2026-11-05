import {
  assignmentProblems,
  assignments,
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  problems,
  sql,
  submissions,
  users,
  type Assignment,
  type User,
} from "@workspace/db"
import {
  ancestry,
  gradeProblem,
  inAudience,
  type Grade,
  type GradedAttempt,
} from "@workspace/judge"

import { ApiError, notFound } from "@/lib/api/route"
import { accessTo, rolePermissions, viewpoint } from "@/features/orgs/access"
import { getSettings, requireFeature } from "@/features/settings/server"

import type { AssignmentInput } from "../problems/schemas"

const { and, asc, desc, eq, gte, inArray, isNull, ne } = sql

export type AssignmentPhase = "upcoming" | "open" | "late" | "closed"

function phaseOf(assignment: Assignment, now = new Date()): AssignmentPhase {
  if (now < assignment.opensAt) return "upcoming"
  if (now <= assignment.dueAt) return "open"
  return assignment.allowLate ? "late" : "closed"
}

interface Item {
  assignmentId: string
  problemId: string
  slug: string
  title: string
  level: string
  points: number
  membersOnly: boolean
  orgSlug: string | null
}

async function itemsOf(assignmentIds: string[]): Promise<Item[]> {
  if (assignmentIds.length === 0) return []
  return getDb()
    .select({
      assignmentId: assignmentProblems.assignmentId,
      problemId: assignmentProblems.problemId,
      slug: problems.slug,
      title: problems.title,
      level: problems.level,
      points: assignmentProblems.points,
      membersOnly: problems.membersOnly,
      orgSlug: organizations.slug,
    })
    .from(assignmentProblems)
    .innerJoin(problems, eq(assignmentProblems.problemId, problems.id))
    .leftJoin(organizations, eq(problems.orgId, organizations.id))
    .where(inArray(assignmentProblems.assignmentId, assignmentIds))
    .orderBy(asc(assignmentProblems.position))
}

type Attempt = GradedAttempt & { userId: string; problemId: string }

/** Graded submissions on these problems since a time, for one student or everyone. */
async function attemptsOn(
  problemIds: string[],
  since: Date,
  userId?: string
): Promise<Attempt[]> {
  if (problemIds.length === 0) return []
  const rows = await getDb()
    .select({
      userId: submissions.userId,
      problemId: submissions.problemId,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        inArray(submissions.problemId, problemIds),
        gte(submissions.createdAt, since),
        userId ? eq(submissions.userId, userId) : undefined
      )
    )
  return rows.filter((row): row is Attempt => row.problemId !== null)
}

/** One student's marks on each problem of one assignment, from their attempts. */
function grade(assignment: Assignment, items: Item[], attempts: Attempt[]) {
  const cells = items.map((item) => ({
    problemId: item.problemId,
    ...gradeProblem(
      item.points,
      attempts.filter((a) => a.problemId === item.problemId),
      assignment
    ),
  }))
  return {
    cells,
    earned: round(cells.reduce((sum, cell) => sum + cell.earned, 0)),
    total: items.reduce((sum, item) => sum + item.points, 0),
    solved: cells.filter((cell) => cell.status === "solved").length,
  }
}

const round = (value: number) => Math.round(value * 100) / 100

/** The assignment and what this person may do with it; one they can't take is not found. */
async function findAssignment(slug: string, viewer: User) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(eq(assignments.slug, slug))
  const access = assignment
    ? accessTo(await viewpoint(viewer), assignment, "assignments.manage")
    : "none"
  if (
    !assignment ||
    access === "none" ||
    (!assignment.published && access !== "manage")
  ) {
    throw notFound("Assignment not found")
  }
  return { assignment, access }
}

/* ---------- students ---------- */

export async function listAssignments(viewer: User) {
  await requireFeature("assignments.enabled")
  const [all, vp] = await Promise.all([
    getDb()
      .select({
        assignment: assignments,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(assignments)
      .leftJoin(organizations, eq(assignments.orgId, organizations.id))
      .orderBy(asc(assignments.dueAt)),
    viewpoint(viewer),
  ])
  const visible = all.filter(({ assignment }) => {
    const access = accessTo(vp, assignment, "assignments.manage")
    return access !== "none" && (assignment.published || access === "manage")
  })
  const rows = visible.map((v) => v.assignment)
  const orgOf = new Map(
    visible.map((v) => [
      v.assignment.id,
      v.orgName ? { name: v.orgName, slug: v.orgSlug! } : null,
    ])
  )
  const items = await itemsOf(rows.map((a) => a.id))
  const earliest = rows.reduce<Date | null>(
    (min, a) => (!min || a.opensAt < min ? a.opensAt : min),
    null
  )
  const attempts = earliest
    ? await attemptsOn(
        [...new Set(items.map((i) => i.problemId))],
        earliest,
        viewer.id
      )
    : []

  return rows.map((assignment) => {
    const own = items.filter((i) => i.assignmentId === assignment.id)
    const { earned, total, solved } = grade(assignment, own, attempts)
    return {
      slug: assignment.slug,
      title: assignment.title,
      org: orgOf.get(assignment.id) ?? null,
      opensAt: assignment.opensAt,
      dueAt: assignment.dueAt,
      allowLate: assignment.allowLate,
      latePenaltyPercent: assignment.latePenaltyPercent,
      published: assignment.published,
      phase: phaseOf(assignment),
      problemCount: own.length,
      solved,
      earned,
      total,
    }
  })
}

export async function getAssignment(slug: string, viewer: User) {
  await requireFeature("assignments.enabled")
  const { assignment, access } = await findAssignment(slug, viewer)
  const phase = phaseOf(assignment)
  // Before it opens, students learn when, not what.
  const visible = phase !== "upcoming" || access === "manage"
  const items = visible ? await itemsOf([assignment.id]) : []
  const attempts = await attemptsOn(
    items.map((i) => i.problemId),
    assignment.opensAt,
    viewer.id
  )
  const { cells, earned, total, solved } = grade(assignment, items, attempts)

  return {
    slug: assignment.slug,
    title: assignment.title,
    description: assignment.description,
    opensAt: assignment.opensAt,
    dueAt: assignment.dueAt,
    allowLate: assignment.allowLate,
    latePenaltyPercent: assignment.latePenaltyPercent,
    phase,
    earned,
    total,
    solved,
    problems: items.map((item, index) => ({
      slug: item.slug,
      // Members-only problems are solved on their organization's pages.
      href:
        item.membersOnly && item.orgSlug
          ? `/orgs/${item.orgSlug}/practice/${item.slug}`
          : `/problems/${item.slug}`,
      title: item.title,
      level: item.level,
      points: item.points,
      earned: cells[index]!.earned,
      status: cells[index]!.status,
    })),
  }
}

/** Open assignments for this person that include this problem, for its page. */
export async function assignmentsForProblem(slug: string, viewer: User) {
  const settings = await getSettings()
  if (!settings["assignments.enabled"]) return []
  const now = new Date()
  const [rows, vp] = await Promise.all([
    getDb()
      .select({ assignment: assignments })
      .from(assignmentProblems)
      .innerJoin(
        assignments,
        eq(assignmentProblems.assignmentId, assignments.id)
      )
      .innerJoin(problems, eq(assignmentProblems.problemId, problems.id))
      .where(and(eq(problems.slug, slug), eq(assignments.published, true))),
    viewpoint(viewer),
  ])
  return rows
    .filter(
      ({ assignment }) =>
        accessTo(vp, assignment, "assignments.manage") !== "none"
    )
    .map(({ assignment }) => ({ assignment, phase: phaseOf(assignment, now) }))
    .filter(({ phase }) => phase === "open" || phase === "late")
    .map(({ assignment, phase }) => ({
      slug: assignment.slug,
      title: assignment.title,
      dueAt: assignment.dueAt,
      phase,
    }))
}

/* ---------- staff ---------- */
// `orgId` is the owner, already authorized by the caller: null for platform assignments,
// or an organization. Every query matches it, so another owner's ids aren't found.

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)

export async function listAssignmentsForStaff(orgId: string | null) {
  const rows = await getDb()
    .select()
    .from(assignments)
    .where(ownedBy(orgId))
    .orderBy(asc(assignments.dueAt))
  const items = await itemsOf(rows.map((a) => a.id))
  return rows.map((assignment) => {
    const own = items.filter((i) => i.assignmentId === assignment.id)
    return {
      ...assignment,
      phase: phaseOf(assignment),
      problemCount: own.length,
      totalPoints: own.reduce((sum, i) => sum + i.points, 0),
    }
  })
}

export async function getAssignmentForStaff(id: string, orgId: string | null) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const items = await itemsOf([id])
  return {
    ...assignment,
    problems: items.map(({ problemId, points }) => ({ problemId, points })),
  }
}

export async function saveAssignment(
  id: string | null,
  input: AssignmentInput,
  orgId: string | null
) {
  const { problems: chosen, ...fields } = input
  const ids = chosen.map((c) => c.problemId)
  const found = await getDb()
    .select({
      id: problems.id,
      published: problems.published,
      membersOnly: problems.membersOnly,
      orgId: problems.orgId,
    })
    .from(problems)
    .where(inArray(problems.id, ids))
  if (found.length !== ids.length) {
    throw new ApiError(
      400,
      "unknown_problem",
      "A chosen problem no longer exists."
    )
  }
  if (found.some((p) => p.membersOnly && p.orgId !== orgId)) {
    throw new ApiError(
      400,
      "private_problem",
      "That problem is only for another organization's members."
    )
  }
  if (found.some((p) => !p.published)) {
    throw new ApiError(
      400,
      "draft_problem",
      "Only published problems can be assigned. Publish the drafts first."
    )
  }
  const values = { ...fields, orgId, audience: orgId ? fields.audience : [] }

  return getDb().transaction(async (tx) => {
    const [assignment] = id
      ? await tx
          .update(assignments)
          .set(values)
          .where(and(eq(assignments.id, id), ownedBy(orgId)))
          .returning()
      : await tx.insert(assignments).values(values).returning()
    if (!assignment) throw notFound("Assignment not found")
    await tx
      .delete(assignmentProblems)
      .where(eq(assignmentProblems.assignmentId, assignment.id))
    await tx.insert(assignmentProblems).values(
      chosen.map((item, position) => ({
        assignmentId: assignment.id,
        problemId: item.problemId,
        points: item.points,
        position,
      }))
    )
    return assignment
  })
}

export async function deleteAssignment(id: string, orgId: string | null) {
  const deleted = await getDb()
    .delete(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
    .returning({ id: assignments.id })
  if (deleted.length === 0) throw notFound("Assignment not found")
}

export interface GradebookRow {
  name: string | null
  email: string
  handle: string | null
  cells: (Grade & { problemId: string })[]
  earned: number
  late: number
}

/** The people an assignment is for: everyone's students, or an organization's audience. */
async function studentsOf(
  assignment: Assignment,
  /** Which groups the viewer may see grades for; "all" for everyone. */
  scope: "all" | Set<string>
) {
  const db = getDb()
  const fields = {
    id: users.id,
    name: users.name,
    email: users.email,
    handle: users.handle,
  }
  if (assignment.orgId === null) {
    return db
      .select(fields)
      .from(users)
      .where(and(eq(users.role, "student"), ne(users.disabled, true)))
      .orderBy(asc(users.name), asc(users.email))
  }
  const orgId = assignment.orgId
  const [members, groups, memberships, grants] = await Promise.all([
    db
      .select(fields)
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          eq(orgMembers.status, "active"),
          ne(users.disabled, true)
        )
      )
      .orderBy(asc(users.name), asc(users.email)),
    db
      .select({ id: orgGroups.id, parentId: orgGroups.parentId })
      .from(orgGroups)
      .where(eq(orgGroups.orgId, orgId)),
    db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
      .where(eq(orgGroups.orgId, orgId)),
    db
      .select({
        userId: roleAssignments.userId,
        systemKey: orgRoles.systemKey,
        permissions: orgRoles.permissions,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(eq(roleAssignments.orgId, orgId)),
  ])
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]))
  const chain = (id: string) => ancestry(id, (x) => parentOf.get(x))
  const groupsOf = (userId: string) =>
    memberships.filter((m) => m.userId === userId).map((m) => m.groupId)
  // People who can set assignments are teachers here, not students.
  const teachers = new Set(
    grants
      .filter((g) => rolePermissions(g).includes("assignments.manage"))
      .map((g) => g.userId)
  )
  return members.filter(
    (m) =>
      !teachers.has(m.id) &&
      inAudience(groupsOf(m.id), assignment.audience, chain) &&
      (scope === "all" ||
        groupsOf(m.id).some((g) => chain(g).some((id) => scope.has(id))))
  )
}

/** Every student's marks, including those who haven't started. */
export async function getGradebook(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const items = await itemsOf([id])
  const [students, attempts] = await Promise.all([
    studentsOf(assignment, scope),
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt
    ),
  ])

  const rows: GradebookRow[] = students.map((student) => {
    const { cells, earned } = grade(
      assignment,
      items,
      attempts.filter((a) => a.userId === student.id)
    )
    return {
      name: student.name,
      email: student.email,
      handle: student.handle,
      cells,
      earned,
      late: cells.filter((c) => c.status === "late").length,
    }
  })
  const total = items.reduce((sum, i) => sum + i.points, 0)
  const started = rows.filter((r) =>
    r.cells.some((c) => c.status !== "missing")
  )

  return {
    assignment: {
      id: assignment.id,
      slug: assignment.slug,
      title: assignment.title,
      dueAt: assignment.dueAt,
      phase: phaseOf(assignment),
    },
    problems: items.map(({ problemId, slug, title, points }) => ({
      problemId,
      slug,
      title,
      points,
    })),
    total,
    summary: {
      students: rows.length,
      started: started.length,
      average: rows.length
        ? round(rows.reduce((sum, r) => sum + r.earned, 0) / rows.length)
        : 0,
      fullMarks: rows.filter((r) => r.earned === total && total > 0).length,
    },
    rows,
  }
}

/**
 * One student's graded submissions on one problem of an assignment, with their code, for
 * whoever may see that student's grades. Anyone outside the gradebook isn't found.
 */
export async function studentAttempts(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string,
  problemId: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const items = await itemsOf([id])
  const item = items.find((i) => i.problemId === problemId)
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === email
  )
  if (!item || !student) throw notFound("Not in this gradebook")
  const rows = await getDb()
    .select({
      id: submissions.id,
      language: submissions.language,
      files: submissions.files,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, student.id),
        eq(submissions.problemId, problemId),
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        gte(submissions.createdAt, assignment.opensAt)
      )
    )
    .orderBy(desc(submissions.createdAt))
    .limit(50)
  return {
    student: { name: student.name, email: student.email },
    problem: { title: item.title, points: item.points },
    attempts: rows.map((r) => ({ ...r, late: r.createdAt > assignment.dueAt })),
  }
}

/** Quotes a CSV field, and stops spreadsheets running it as a formula. */
function csvField(value: string | number | null) {
  let text = value === null ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function gradebookCsv(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const book = await getGradebook(id, orgId, scope)
  const header = [
    "Name",
    "Email",
    "Handle",
    ...book.problems.map((p) => `${p.title} (${p.points})`),
    `Total (${book.total})`,
    "Problems late",
  ]
  const lines = [
    header,
    ...book.rows.map((row) => [
      row.name,
      row.email,
      row.handle,
      ...row.cells.map((c) => c.earned),
      row.earned,
      row.late,
    ]),
  ].map((fields) => fields.map(csvField).join(","))
  return {
    filename: `${book.assignment.slug}-grades.csv`,
    // A byte-order mark so Excel reads names in any script correctly.
    body: "﻿" + lines.join("\r\n") + "\r\n",
  }
}
