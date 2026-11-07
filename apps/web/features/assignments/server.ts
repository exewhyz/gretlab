import {
  assignmentProblems,
  courseOutcomes,
  rubricMarks,
  submissionComments,
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
  rubricEarned,
  rubricTotal,
  duringSitting,
  sittingClosesAt,
  type Grade,
  type GradedAttempt,
  type RubricCriterion,
} from "@workspace/judge"

import { draftHistory, latestDraft } from "@/features/drafts/server"
import { extendSitting } from "@/features/exams/server"
import {
  eventsOf,
  presentSitting,
  sittingsOn,
  warningCounts,
  type Sitting,
} from "@/features/exams/sittings"
import { ApiError, notFound } from "@/lib/api/route"
import {
  accessTo,
  classLinks,
  rolePermissions,
  viewpoint,
} from "@/features/orgs/access"
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
  rubric: RubricCriterion[]
  outcomes: string[]
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
      rubric: assignmentProblems.rubric,
      outcomes: assignmentProblems.outcomes,
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

/** Hand marks by problem, for one student on one assignment. */
type Marks = Map<string, Record<string, number>>

/**
 * One student's marks on each problem of one assignment: the tests' marks from their
 * attempts, plus any rubric marks a teacher gave (`marks`; leave it out while feedback is
 * held). A problem is out of its test points plus its rubric's.
 */
function grade(
  assignment: Assignment,
  items: Item[],
  attempts: Attempt[],
  marks?: Marks,
  /** For an exam, the student's sitting: only work during it counts, none without one. */
  sitting?: Sitting
) {
  const counted = assignment.exam ? duringSitting(attempts, sitting) : attempts
  // A sitting can run past the due time when a teacher gives more time.
  const rules =
    assignment.exam && sitting
      ? { ...assignment, dueAt: sittingClosesAt(sitting), allowLate: false }
      : assignment
  const cells = items.map((item) => {
    const tests = gradeProblem(
      item.points,
      counted.filter((a) => a.problemId === item.problemId),
      rules
    )
    const byHand = rubricEarned(item.rubric, marks?.get(item.problemId))
    return {
      problemId: item.problemId,
      ...tests,
      tests: tests.earned,
      byHand,
      earned: round(tests.earned + (byHand ?? 0)),
      max: item.points + rubricTotal(item.rubric),
    }
  })
  return {
    cells,
    earned: round(cells.reduce((sum, cell) => sum + cell.earned, 0)),
    total: cells.reduce((sum, cell) => sum + cell.max, 0),
    solved: cells.filter((cell) => cell.status === "solved").length,
  }
}

/** Rubric marks on these assignments, for one student or everyone, by student then problem. */
async function marksOn(assignmentIds: string[], userId?: string) {
  const byUser = new Map<string, Map<string, Marks>>()
  if (assignmentIds.length === 0) return byUser
  const rows = await getDb()
    .select()
    .from(rubricMarks)
    .where(
      and(
        inArray(rubricMarks.assignmentId, assignmentIds),
        userId ? eq(rubricMarks.userId, userId) : undefined
      )
    )
  for (const row of rows) {
    const byAssignment = byUser.get(row.userId) ?? new Map<string, Marks>()
    const marks = byAssignment.get(row.assignmentId) ?? new Map()
    marks.set(row.problemId, row.marks)
    byAssignment.set(row.assignmentId, marks)
    byUser.set(row.userId, byAssignment)
  }
  return byUser
}

const round = (value: number) => Math.round(value * 100) / 100

/** The assignment and what this person may do with it; one they can't take is not found. */
export async function findAssignment(slug: string, viewer: User) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(eq(assignments.slug, slug))
  const vp = await viewpoint(viewer)
  const access = assignment
    ? accessTo(vp, assignment, "assignments.manage")
    : "none"
  if (
    !assignment ||
    access === "none" ||
    (!assignment.published && access !== "manage")
  ) {
    throw notFound("Assignment not found")
  }
  return { assignment, access, vp }
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
  const [attempts, marks, sittings] = await Promise.all([
    earliest
      ? attemptsOn(
          [...new Set(items.map((i) => i.problemId))],
          earliest,
          viewer.id
        )
      : [],
    marksOn(
      rows.map((a) => a.id),
      viewer.id
    ),
    sittingsOn(
      rows.filter((a) => a.exam).map((a) => a.id),
      viewer.id
    ),
  ])

  return rows.map((assignment) => {
    const own = items.filter((i) => i.assignmentId === assignment.id)
    const { earned, total, solved } = grade(
      assignment,
      own,
      attempts,
      // Held feedback counts once it's released.
      assignment.holdFeedback
        ? undefined
        : marks.get(viewer.id)?.get(assignment.id),
      sittings.get(assignment.id)?.get(viewer.id)
    )
    return {
      exam: Boolean(assignment.exam),
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
  const { assignment, access, vp } = await findAssignment(slug, viewer)
  const phase = phaseOf(assignment)
  const classes = await classLinks(vp, assignment, access === "manage")
  const sitting = assignment.exam
    ? (await sittingsOn([assignment.id], viewer.id))
        .get(assignment.id)
        ?.get(viewer.id)
    : undefined
  // Before it opens, students learn when, not what; an exam's problems show once started.
  const visible =
    access === "manage" ||
    (phase !== "upcoming" && (!assignment.exam || sitting !== undefined))
  const items = visible ? await itemsOf([assignment.id]) : []
  const [attempts, marks] = await Promise.all([
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt,
      viewer.id
    ),
    marksOn([assignment.id], viewer.id),
  ])
  const own = assignment.holdFeedback
    ? undefined
    : marks.get(viewer.id)?.get(assignment.id)
  const { cells, earned, total, solved } = grade(
    assignment,
    items,
    attempts,
    own,
    sitting
  )

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
    /** The classes it's for, linked. */
    classes,
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
      max: cells[index]!.max,
      earned: cells[index]!.earned,
      tests: cells[index]!.tests,
      status: cells[index]!.status,
      /** Each criterion with the mark given, once feedback is out. */
      rubric: item.rubric.map((c) => ({
        ...c,
        mark: own?.get(item.problemId)?.[c.id] ?? null,
      })),
    })),
    /** Rubric marks and line comments wait until the teacher releases them. */
    feedbackHeld: assignment.holdFeedback,
    /** How many problems, so an exam can say so before it starts. */
    problemCount: visible ? items.length : await countProblems(assignment.id),
    exam: assignment.exam
      ? {
          minutes: assignment.exam.minutes,
          fullscreen: assignment.exam.fullscreen,
          /** Whether it must be taken from certain networks (which ones stays private). */
          restricted: assignment.exam.networks.length > 0,
          sitting: presentSitting(sitting),
        }
      : null,
  }
}

async function countProblems(assignmentId: string) {
  const [row] = await getDb()
    .select({ n: sql.count() })
    .from(assignmentProblems)
    .where(eq(assignmentProblems.assignmentId, assignmentId))
  return row?.n ?? 0
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
  const sittings = await sittingsOn(
    rows.filter((r) => r.assignment.exam).map((r) => r.assignment.id),
    viewer.id
  )
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
      exam: assignment.exam
        ? {
            fullscreen: assignment.exam.fullscreen,
            sitting: presentSitting(
              sittings.get(assignment.id)?.get(viewer.id),
              now
            ),
          }
        : null,
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
    problems: items.map(({ problemId, points, rubric, outcomes }) => ({
      problemId,
      points,
      rubric,
      outcomes,
    })),
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
  const tagged = [...new Set(chosen.flatMap((c) => c.outcomes))]
  if (tagged.length > 0) {
    // Only the organization's own course outcomes; the platform has none.
    const known = orgId
      ? await getDb()
          .select({ id: courseOutcomes.id })
          .from(courseOutcomes)
          .where(
            and(
              eq(courseOutcomes.orgId, orgId),
              inArray(courseOutcomes.id, tagged)
            )
          )
      : []
    if (known.length !== tagged.length) {
      throw new ApiError(
        400,
        "unknown_outcome",
        "A chosen course outcome no longer exists."
      )
    }
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
        rubric: item.rubric,
        outcomes: item.outcomes,
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
  exam: (ReturnType<typeof presentSitting> & { warnings: number }) | null
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
  const [students, attempts, marks] = await Promise.all([
    studentsOf(assignment, scope),
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt
    ),
    // Teachers see rubric marks whether or not they're released yet.
    marksOn([id]),
  ])
  const [sittings, warnings] = assignment.exam
    ? await Promise.all([sittingsOn([id]), warningCounts(id)])
    : [new Map<string, Map<string, Sitting>>(), new Map<string, number>()]

  const rows: GradebookRow[] = students.map((student) => {
    const { cells, earned } = grade(
      assignment,
      items,
      attempts.filter((a) => a.userId === student.id),
      marks.get(student.id)?.get(id),
      sittings.get(id)?.get(student.id)
    )
    return {
      exam: assignment.exam
        ? {
            ...presentSitting(sittings.get(id)?.get(student.id)),
            warnings: warnings.get(student.id) ?? 0,
          }
        : null,
      name: student.name,
      email: student.email,
      handle: student.handle,
      cells,
      earned,
      late: cells.filter((c) => c.status === "late").length,
    }
  })
  const total = items.reduce(
    (sum, i) => sum + i.points + rubricTotal(i.rubric),
    0
  )
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
      holdFeedback: assignment.holdFeedback,
      exam: assignment.exam,
    },
    problems: items.map(({ problemId, slug, title, points, rubric, outcomes }) => ({
      problemId,
      slug,
      title,
      outcomes,
      // Out of the tests' points and the rubric's.
      points: points + rubricTotal(rubric),
      tests: points,
      rubric,
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

/** An assignment, one of its problems and one of its students, or not found. */
async function gradebookStudent(
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
  return { assignment, item, student }
}

/** More time on an exam for one student in this gradebook. */
export async function extendStudentSitting(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; minutes: number }
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment?.exam) throw notFound("Exam not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  return extendSitting(id, student.id, input.minutes)
}

/** Line comments on these submissions, given in this assignment. */
async function commentsOn(assignmentId: string, submissionIds: string[]) {
  if (submissionIds.length === 0) return []
  return getDb()
    .select({
      id: submissionComments.id,
      submissionId: submissionComments.submissionId,
      path: submissionComments.path,
      line: submissionComments.line,
      body: submissionComments.body,
      createdAt: submissionComments.createdAt,
      author: users.name,
      authorEmail: users.email,
    })
    .from(submissionComments)
    .leftJoin(users, eq(submissionComments.authorId, users.id))
    .where(
      and(
        eq(submissionComments.assignmentId, assignmentId),
        inArray(submissionComments.submissionId, submissionIds)
      )
    )
    .orderBy(asc(submissionComments.line), asc(submissionComments.createdAt))
}

/** A teacher's rubric marks for one student on one problem. Unknown criteria are refused. */
export async function setRubricMarks(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; problemId: string; marks: Record<string, number> },
  graderId: string
) {
  const { item, student } = await gradebookStudent(
    id,
    orgId,
    scope,
    input.student,
    input.problemId
  )
  for (const [criterion, mark] of Object.entries(input.marks)) {
    const c = item.rubric.find((r) => r.id === criterion)
    if (!c)
      throw new ApiError(400, "unknown_criterion", "That isn't on this rubric.")
    if (mark < 0 || mark > c.points) {
      throw new ApiError(
        400,
        "out_of_range",
        `"${c.label}" is out of ${c.points}.`
      )
    }
  }
  const now = new Date()
  await getDb()
    .insert(rubricMarks)
    .values({
      assignmentId: id,
      problemId: input.problemId,
      userId: student.id,
      marks: input.marks,
      graderId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        rubricMarks.assignmentId,
        rubricMarks.problemId,
        rubricMarks.userId,
      ],
      set: { marks: input.marks, graderId, updatedAt: now },
    })
  return { byHand: rubricEarned(item.rubric, input.marks) }
}

/** A comment on one line of a student's submission to this assignment. */
export async function addLineComment(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: {
    student: string
    submissionId: string
    path: string
    line: number
    body: string
  },
  authorId: string
) {
  const [submission] = await getDb()
    .select({
      problemId: submissions.problemId,
      userId: submissions.userId,
      files: submissions.files,
    })
    .from(submissions)
    .where(eq(submissions.id, input.submissionId))
  if (!submission?.problemId) throw notFound("Submission not found")
  const { student } = await gradebookStudent(
    id,
    orgId,
    scope,
    input.student,
    submission.problemId
  )
  if (submission.userId !== student.id) throw notFound("Submission not found")
  const file = submission.files.find((f) => f.path === input.path)
  if (!file || input.line > file.content.split("\n").length) {
    throw new ApiError(
      400,
      "no_such_line",
      "That line isn't in the submission."
    )
  }
  const [comment] = await getDb()
    .insert(submissionComments)
    .values({ ...input, assignmentId: id, authorId })
    .returning()
  return comment
}

/** Removes a line comment from this assignment, for whoever may give its feedback. */
export async function deleteLineComment(
  id: string,
  orgId: string | null,
  commentId: string
) {
  const [assignment] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const removed = await getDb()
    .delete(submissionComments)
    .where(
      and(
        eq(submissionComments.id, commentId),
        eq(submissionComments.assignmentId, id)
      )
    )
    .returning({ id: submissionComments.id })
  if (removed.length === 0) throw notFound("Comment not found")
}

/** Shows held rubric marks and line comments to students. */
export async function releaseFeedback(id: string, orgId: string | null) {
  const updated = await getDb()
    .update(assignments)
    .set({ holdFeedback: false })
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
    .returning({ id: assignments.id })
  if (updated.length === 0) throw notFound("Assignment not found")
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
  problemId: string,
  /** Also every snapshot of the student's code, for playback. */
  withHistory = false
) {
  const { assignment, item, student } = await gradebookStudent(
    id,
    orgId,
    scope,
    email,
    problemId
  )
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
  // Who may see the graded work may also see the code being written: live, and as it grew.
  const [draft, history, marks, comments, events, sittings] = await Promise.all([
    latestDraft(student.id, problemId),
    withHistory ? draftHistory(student.id, problemId) : null,
    marksOn([id], student.id),
    commentsOn(
      id,
      rows.map((r) => r.id)
    ),
    assignment.exam ? eventsOf(id, student.id) : [],
    assignment.exam ? sittingsOn([id], student.id) : null,
  ])
  const sitting = sittings?.get(id)?.get(student.id)
  return {
    exam: assignment.exam
      ? { ...presentSitting(sitting), ip: sitting?.ip ?? null, events }
      : null,
    student: { name: student.name, email: student.email },
    problem: { title: item.title, points: item.points, rubric: item.rubric },
    marks: marks.get(student.id)?.get(id)?.get(problemId) ?? {},
    holdFeedback: assignment.holdFeedback,
    attempts: rows.map((r) => ({
      ...r,
      late: r.createdAt > assignment.dueAt,
      /** For an exam: made outside the student's sitting, so it doesn't count. */
      outside:
        assignment.exam !== null && duringSitting([r], sitting).length === 0,
      comments: comments.filter((c) => c.submissionId === r.id),
    })),
    draft,
    ...(history ? { history } : {}),
  }
}

/** Quotes a CSV field, and stops spreadsheets running it as a formula. */
export function csvField(value: string | number | null) {
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
    ...(book.assignment.exam ? ["Exam", "Exam warnings"] : []),
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
      ...(row.exam
        ? [
            row.exam.status === "finished"
              ? row.exam.finishedEarly
                ? "Finished"
                : "Time ran out"
              : row.exam.status === "in_progress"
                ? "In progress"
                : "Not started",
            row.exam.warnings,
          ]
        : []),
    ]),
  ].map((fields) => fields.map(csvField).join(","))
  return {
    filename: `${book.assignment.slug}-grades.csv`,
    // A byte-order mark so Excel reads names in any script correctly.
    body: "﻿" + lines.join("\r\n") + "\r\n",
  }
}
