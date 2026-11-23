import {
  assignmentExtensions,
  assignments,
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  quizResponses,
  roleAssignments,
  rubricMarks,
  sql,
  submissionComments,
  submissions,
  users,
  type Assignment,
} from "@workspace/db"
import {
  ancestry,
  duringSitting,
  extendedDue,
  grantsAnyUnder,
  inAudience,
  markQuestion,
  rubricEarned,
  rubricTotal,
  type Grade,
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
import { notify } from "@/features/notifications/server"
import { rolePermissions } from "@/features/orgs/access"
import { projectGrades } from "@/features/projects/server"
import { ApiError, notFound } from "@/lib/api/route"
import { pageOf, type PageQuery } from "@/lib/api/paging"
import { byName } from "@/lib/by-name"

import {
  attemptsOn,
  extensionsOn,
  grade,
  gradeQuiz,
  itemsOf,
  marksOn,
  ownedBy,
  phaseOf,
  questionsOf,
  responsesOn,
  round,
} from "./grading"

const { and, asc, desc, eq, gte, inArray, ne } = sql
const raw = sql.sql

export interface GradebookRow {
  name: string | null
  email: string
  handle: string | null
  cells: (Grade & { problemId: string })[]
  earned: number
  late: number
  exam: (ReturnType<typeof presentSitting> & { warnings: number }) | null
  extension: {
    dueAt: Date
    problemIds: readonly string[]
    reason: string
  } | null
  quiz: {
    earned: number
    max: number
    answered: boolean
    needsMarking: number
  } | null
  projects: {
    earned: number
    max: number
    submitted: number
    needsMarking: number
  } | null
}

/** The people an assignment is for: everyone's students, or an organization's audience. */
export async function studentsOf(
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
      .filter((g) => grantsAnyUnder(rolePermissions(g), "assignments.manage"))
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

/**
 * The teachers of the classes an assignment is for, other than `exceptId`: people whose
 * role lets them set or mark work for a group the audience touches (the group, one above
 * it or one inside it), or for the whole organization. Owners and admins run everything
 * and would get a copy of all of it, so they're left out.
 */
export async function colleaguesOf(assignment: Assignment, exceptId?: string) {
  if (assignment.orgId === null) return []
  const db = getDb()
  const [grants, groups] = await Promise.all([
    db
      .select({
        userId: roleAssignments.userId,
        groupId: roleAssignments.groupId,
        systemKey: orgRoles.systemKey,
        permissions: orgRoles.permissions,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.orgId, roleAssignments.orgId),
          eq(orgMembers.userId, roleAssignments.userId)
        )
      )
      .where(
        and(
          eq(roleAssignments.orgId, assignment.orgId),
          eq(orgMembers.status, "active")
        )
      ),
    db
      .select({ id: orgGroups.id, parentId: orgGroups.parentId })
      .from(orgGroups)
      .where(eq(orgGroups.orgId, assignment.orgId)),
  ])
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]))
  const chain = (id: string) => ancestry(id, (x) => parentOf.get(x))
  const audience = assignment.audience.flat()
  const touches = (groupId: string) =>
    audience.length === 0 ||
    audience.some(
      (g) => chain(g).includes(groupId) || chain(groupId).includes(g)
    )
  return [
    ...new Set(
      grants
        .filter(
          (g) =>
            g.userId !== exceptId &&
            g.systemKey !== "owner" &&
            g.systemKey !== "admin" &&
            (grantsAnyUnder(rolePermissions(g), "assignments.manage") ||
              rolePermissions(g).includes("gradebook.view")) &&
            (g.groupId === null || touches(g.groupId))
        )
        .map((g) => g.userId)
    ),
  ]
}

/*
 * The screen's gradebook, kept between page requests. Working out a gradebook grades every
 * student (2 s at 20,000), and the screen asks for it page by page and every 30 seconds.
 * A kept copy is used only while a fingerprint of everything it was worked out from is
 * unchanged: the assignment's own rows (settings, problems, questions, projects,
 * extensions), its graded submissions, rubric marks, quiz answers and marks, project work,
 * and who is in the organization. Rows are hashed whole (`hashtext(row::text)`), so a change
 * to any column counts, whatever the code that made it. Nothing needs clearing by hand, so it
 * stays right across server instances, each with its own copy. Exams aren't kept (their
 * sittings change with the clock), and the phase (open, closed) is worked out on every read.
 */
const KEPT = new Map<
  string,
  { print: string; book: Awaited<ReturnType<typeof getGradebook>>; at: number }
>()
const KEEP_MS = 10 * 60_000
const KEEP_MAX = 20

async function gradebookPrint(id: string, orgId: string | null) {
  const q = raw
  // Only the table's name is written into the query (one of the fixed names below); the
  // assignment's id is always a parameter.
  const rowsOf = (table: string) =>
    q`(select count(*)::text || ':' || coalesce(sum(hashtext(t::text)), 0)::text
      from ${q.raw(table)} t where t.assignment_id = ${id})`
  const [row] = (await getDb().execute(q`
    select
      (select (a.exam is not null)::text || ':' || hashtext(a::text)::text from assignments a where a.id = ${id})
      || '|' || ${rowsOf("assignment_problems")}
      || '|' || ${rowsOf("assignment_questions")}
      || '|' || ${rowsOf("assignment_projects")}
      || '|' || ${rowsOf("assignment_extensions")}
      || '|' || ${rowsOf("rubric_marks")}
      || '|' || ${rowsOf("quiz_responses")}
      || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(ps::text)), 0)::text
          from project_submissions ps join assignment_projects ap on ap.id = ps.project_id
          where ap.assignment_id = ${id})
      || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(
            s.id::text || s.status::text || coalesce(s.verdict, '') || coalesce(s.score, -1)::text
            || coalesce(s.max_score, -1)::text || s.created_at::text)), 0)::text
          from submissions s
          where s.kind = 'submit' and s.status = 'done'
            and s.problem_id in (select problem_id from assignment_problems where assignment_id = ${id})
            and s.created_at >= (select opens_at from assignments where id = ${id}))
      || '|' || ${
        orgId
          ? q`(select count(*)::text || ':' || coalesce(sum(hashtext(m.user_id::text || m.status::text)), 0)::text
                from org_members m where m.org_id = ${orgId})
             || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(gm.user_id::text || gm.group_id::text)), 0)::text
                from group_members gm join org_groups g on g.id = gm.group_id where g.org_id = ${orgId})`
          : q`(select count(*)::text from users where role = 'student' and disabled = false)`
      } as print`)) as unknown as { print: string | null }[]
  return row?.print ?? null
}

/** The whole gradebook, from the kept copy when nothing it depends on has changed. */
export async function keptGradebook(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const [print, assignment] = await Promise.all([
    gradebookPrint(id, orgId),
    getDb()
      .select()
      .from(assignments)
      .where(and(eq(assignments.id, id), ownedBy(orgId)))
      .then((rows) => rows[0]),
  ])
  if (!assignment || !print || assignment.exam)
    return getGradebook(id, orgId, scope)
  const key = `${orgId ?? ""}|${id}|${scope === "all" ? "all" : [...scope].sort().join(",")}`
  const kept = KEPT.get(key)
  if (kept && kept.print === print && Date.now() - kept.at < KEEP_MS) {
    // The one part that changes with the clock alone.
    return {
      ...kept.book,
      assignment: { ...kept.book.assignment, phase: phaseOf(assignment) },
    }
  }
  const book = await getGradebook(id, orgId, scope)
  KEPT.delete(key)
  KEPT.set(key, { print, book, at: Date.now() })
  if (KEPT.size > KEEP_MAX) KEPT.delete(KEPT.keys().next().value!)
  return book
}

/**
 * One page of a gradebook, for the screen (`?page`, `?q`, `?perPage`): the summary still
 * counts everyone, while the rows are the search's matches, ordered by name as people read
 * them, `perPage` at a time. The paging is under `paging`, since `total` here is the points.
 */
export function gradebookPage(
  book: Awaited<ReturnType<typeof getGradebook>>,
  view: PageQuery
) {
  const q = view.q?.toLowerCase()
  const matches = (
    q
      ? book.rows.filter(
          (r) =>
            r.email.toLowerCase().includes(q) ||
            (r.name ?? "").toLowerCase().includes(q)
        )
      : [...book.rows]
  ).sort(
    (a, b) =>
      byName(a.name ?? a.email, b.name ?? b.email) || byName(a.email, b.email)
  )
  const at = pageOf(matches.length, view.page ?? 1, view.perPage ?? 100)
  return {
    ...book,
    rows: matches.slice(at.offset, at.offset + at.perPage),
    paging: {
      total: matches.length,
      page: at.page,
      pages: at.pages,
      perPage: at.perPage,
    },
  }
}

/** Every student's marks, including those who haven't started. */
export async function getGradebook(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all",
  /** Only these students (a page of a report); left out, everyone in scope. */
  only?: readonly string[]
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const onlySet = only && new Set(only)
  const [items, students] = await Promise.all([
    itemsOf([id]),
    studentsOf(assignment, scope).then((all) =>
      onlySet ? all.filter((s) => onlySet.has(s.id)) : all
    ),
  ])
  // Only these students' work: a library problem is also solved by people this assignment
  // isn't for, and their attempts have nothing to do with it.
  const who = only ?? students.map((s) => s.id)
  const [attempts, marks] = await Promise.all([
    attemptsOn(
      items.map((i) => i.problemId),
      assignment.opensAt,
      who
    ),
    // Teachers see rubric marks whether or not they're released yet.
    marksOn([id], who),
  ])
  // Each student's attempts, found by lookup: scanning them all per student grows with the
  // square of the class (30,000 students, billions of comparisons).
  const attemptsBy = new Map<string, typeof attempts>()
  for (const attempt of attempts) {
    const list = attemptsBy.get(attempt.userId)
    if (list) list.push(attempt)
    else attemptsBy.set(attempt.userId, [attempt])
  }
  const [sittings, warnings] = assignment.exam
    ? await Promise.all([sittingsOn([id], only), warningCounts(id)])
    : [new Map<string, Map<string, Sitting>>(), new Map<string, number>()]
  const extensions = (await extensionsOn([id], only)).get(id)
  const [questions, responses, projectBook] = await Promise.all([
    questionsOf([id]),
    responsesOn([id], only).then((r) => r.get(id)),
    projectGrades([id], only),
  ])

  const rows: GradebookRow[] = students.map((student) => {
    const { cells, earned } = grade(
      assignment,
      items,
      attemptsBy.get(student.id) ?? [],
      marks.get(student.id)?.get(id),
      sittings.get(id)?.get(student.id),
      extensions?.get(student.id)
    )
    const extension = extensions?.get(student.id)
    const response = responses?.get(student.id)
    const quiz = gradeQuiz(questions, response)
    const project = projectBook.grade(id, student.id)
    return {
      /** Teachers see project marks at once, held or not. */
      projects: projectBook.projects.length ? project : null,
      /** Teachers see quiz marks at once, held or not. */
      quiz: questions.length
        ? {
            earned: quiz.earned,
            max: quiz.max,
            answered: Boolean(response),
            needsMarking: quiz.needsMarking,
          }
        : null,
      extension: extension
        ? {
            dueAt: extension.dueAt,
            problemIds: extension.problemIds,
            reason: extension.reason,
          }
        : null,
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
      earned: round(earned + quiz.earned + project.earned),
      late: cells.filter((c) => c.status === "late").length,
    }
  })
  const total =
    items.reduce((sum, i) => sum + i.points + rubricTotal(i.rubric), 0) +
    questions.reduce((sum, q) => sum + q.points, 0) +
    projectBook.max(id)
  const started = rows.filter(
    (r) =>
      r.cells.some((c) => c.status !== "missing") ||
      r.quiz?.answered ||
      (r.projects?.submitted ?? 0) > 0
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
      /** The quiz part, when there is one. */
      quiz: questions.length
        ? {
            questions: questions.length,
            points: questions.reduce((t, q) => t + q.points, 0),
          }
        : null,
      /** The project part, when there is one. */
      projects: projectBook.projects.length
        ? projectBook.projects.map((p) => ({
            id: p.id,
            title: p.title,
            points: p.points,
          }))
        : null,
    },
    problems: items.map(
      ({ problemId, slug, title, points, rubric, outcomes }) => ({
        problemId,
        slug,
        title,
        outcomes,
        // Out of the tests' points and the rubric's.
        points: points + rubricTotal(rubric),
        tests: points,
        rubric,
      })
    ),
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
export async function gradebookStudent(
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

/** One student's answers to the quiz, with the automatic marks, for marking. */
export async function studentQuiz(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === email
  )
  if (!student) throw notFound("Not in this gradebook")
  const [questions, response] = await Promise.all([
    questionsOf([id]),
    responsesOn([id], student.id).then((r) => r.get(id)?.get(student.id)),
  ])
  const quiz = gradeQuiz(questions, response)
  return {
    student: { name: student.name, email: student.email },
    savedAt: response?.updatedAt ?? null,
    earned: quiz.earned,
    max: quiz.max,
    held: assignment.holdFeedback,
    questions: questions.map((q, index) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      options: q.options,
      correct: q.correct,
      accepted: q.accepted,
      points: q.points,
      answer: response?.answers[q.id] ?? null,
      ...quiz.per[index]!,
      /** What it would earn without the teacher's mark. */
      automatic: markQuestion(q, response?.answers[q.id]).earned,
    })),
  }
}

/** Teacher marks on a student's answers; null takes a mark back to the automatic one. */
export async function setQuizMarks(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; marks: Record<string, number | null> }
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  const questions = await questionsOf([id])
  const current =
    (await responsesOn([id], student.id)).get(id)?.get(student.id)?.marks ?? {}
  const next = { ...current }
  for (const [questionId, mark] of Object.entries(input.marks)) {
    const q = questions.find((x) => x.id === questionId)
    if (!q)
      throw new ApiError(400, "unknown_question", "That question isn't here.")
    if (mark === null) {
      delete next[questionId]
      continue
    }
    if (mark < 0 || mark > q.points) {
      throw new ApiError(
        400,
        "out_of_range",
        `Marks for that question are 0 to ${q.points}.`
      )
    }
    next[questionId] = mark
  }
  await getDb()
    .insert(quizResponses)
    .values({ assignmentId: id, userId: student.id, marks: next })
    .onConflictDoUpdate({
      target: [quizResponses.assignmentId, quizResponses.userId],
      set: { marks: next },
    })
  if (!assignment.holdFeedback) {
    await notify([student.id], {
      kind: "marks",
      title: `Your teacher marked your answers in ${assignment.title}`,
      href: `/assignments/${assignment.slug}`,
      orgId: assignment.orgId,
    })
  }
  return { marks: next }
}

/**
 * A later due date for one student in this gradebook: for the whole assignment, or only
 * some problems (reopening them after feedback). For an exam it lets them start later.
 */
export async function setExtension(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; dueAt: Date; problemIds: string[]; reason: string },
  grantedBy: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === input.student
  )
  if (!student) throw notFound("Not in this gradebook")
  if (input.dueAt <= assignment.dueAt) {
    throw new ApiError(
      400,
      "not_later",
      "Pick a time after the assignment's due time."
    )
  }
  const items = await itemsOf([id])
  if (input.problemIds.some((p) => !items.some((i) => i.problemId === p))) {
    throw new ApiError(
      400,
      "unknown_problem",
      "That problem isn't in this assignment."
    )
  }
  const values = {
    dueAt: input.dueAt,
    problemIds: [...new Set(input.problemIds)],
    reason: input.reason,
    grantedBy,
  }
  await getDb()
    .insert(assignmentExtensions)
    .values({ assignmentId: id, userId: student.id, ...values })
    .onConflictDoUpdate({
      target: [assignmentExtensions.assignmentId, assignmentExtensions.userId],
      set: values,
    })
  await notify([student.id], {
    kind: "extension",
    title: `More time on ${assignment.title}`,
    body: values.problemIds.length
      ? "Some of its problems are open again for you. Open it to see until when."
      : "Your teacher moved your due time. Open it to see the new one.",
    href: `/assignments/${assignment.slug}`,
    orgId: assignment.orgId,
  })
  return { student: student.email, ...values }
}

export async function removeExtension(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  email: string
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const student = (await studentsOf(assignment, scope)).find(
    (s) => s.email === email
  )
  if (!student) throw notFound("Not in this gradebook")
  await getDb()
    .delete(assignmentExtensions)
    .where(
      and(
        eq(assignmentExtensions.assignmentId, id),
        eq(assignmentExtensions.userId, student.id)
      )
    )
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
export async function commentsOn(
  assignmentId: string,
  submissionIds: string[]
) {
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
  const [assignment] = await getDb()
    .select({
      title: assignments.title,
      slug: assignments.slug,
      hold: assignments.holdFeedback,
      orgId: assignments.orgId,
    })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (assignment && !assignment.hold) {
    await notify([student.id], {
      kind: "marks",
      title: `Your teacher marked ${item.title} in ${assignment.title}`,
      href: `/assignments/${assignment.slug}`,
      orgId: assignment.orgId,
    })
  }
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
  const [assignment] = await getDb()
    .select({
      title: assignments.title,
      hold: assignments.holdFeedback,
      orgId: assignments.orgId,
    })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (assignment && !assignment.hold) {
    await notify([student.id], {
      kind: "comment",
      title: `A comment on your code in ${assignment.title}`,
      body: input.body.slice(0, 300),
      href: `/submissions/${input.submissionId}`,
      orgId: assignment.orgId,
    })
  }
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
    .returning({
      id: assignments.id,
      title: assignments.title,
      slug: assignments.slug,
    })
  if (updated.length === 0) throw notFound("Assignment not found")
  // Everyone who has marks or comments waiting hears that they're out.
  const [marked, commented] = await Promise.all([
    getDb()
      .select({ userId: rubricMarks.userId })
      .from(rubricMarks)
      .where(eq(rubricMarks.assignmentId, id)),
    getDb()
      .select({ userId: submissions.userId })
      .from(submissionComments)
      .innerJoin(
        submissions,
        eq(submissionComments.submissionId, submissions.id)
      )
      .where(eq(submissionComments.assignmentId, id)),
  ])
  const answered = await getDb()
    .select({ userId: quizResponses.userId })
    .from(quizResponses)
    .where(eq(quizResponses.assignmentId, id))
  await notify(
    [...marked, ...commented, ...answered].map((r) => r.userId),
    {
      kind: "feedback",
      title: `Results of ${updated[0]!.title} are out`,
      body: "Your marks, the right answers and your teacher's comments.",
      href: `/assignments/${updated[0]!.slug}`,
      orgId,
    }
  )
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
  const extensionNow = (await extensionsOn([id], student.id))
    .get(id)
    ?.get(student.id)
  const [draft, history, marks, comments, events, sittings] = await Promise.all(
    [
      latestDraft(student.id, problemId),
      withHistory ? draftHistory(student.id, problemId) : null,
      marksOn([id], student.id),
      commentsOn(
        id,
        rows.map((r) => r.id)
      ),
      assignment.exam ? eventsOf(id, student.id) : [],
      assignment.exam ? sittingsOn([id], student.id) : null,
    ]
  )
  const sitting = sittings?.get(id)?.get(student.id)
  return {
    extension: extensionNow ?? null,
    exam: assignment.exam
      ? { ...presentSitting(sitting), ip: sitting?.ip ?? null, events }
      : null,
    student: { name: student.name, email: student.email },
    problem: { title: item.title, points: item.points, rubric: item.rubric },
    marks: marks.get(student.id)?.get(id)?.get(problemId) ?? {},
    holdFeedback: assignment.holdFeedback,
    attempts: rows.map((r) => ({
      ...r,
      late:
        r.createdAt > extendedDue(assignment.dueAt, extensionNow, problemId),
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

type Gradebook = Awaited<ReturnType<typeof getGradebook>>

/** A gradebook as CSV lines: its header, and a line per student. */
function csvLines(book: Gradebook) {
  const header = [
    "Name",
    "Email",
    "Handle",
    ...book.problems.map((p) => `${p.title} (${p.points})`),
    ...(book.assignment.quiz ? [`Quiz (${book.assignment.quiz.points})`] : []),
    ...(book.assignment.projects
      ? [
          `Projects (${book.assignment.projects.reduce((n, p) => n + p.points, 0)})`,
        ]
      : []),
    `Total (${book.total})`,
    "Problems late",
    ...(book.assignment.exam ? ["Exam", "Exam warnings"] : []),
  ]
  const rows = [
    ...book.rows.map((row) => [
      row.name,
      row.email,
      row.handle,
      ...row.cells.map((c) => c.earned),
      ...(book.assignment.quiz ? [row.quiz?.earned ?? 0] : []),
      ...(book.assignment.projects ? [row.projects?.earned ?? 0] : []),
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
  return { header: [...header].map(csvField).join(","), rows }
}

export async function gradebookCsv(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const book = await getGradebook(id, orgId, scope)
  const { header, rows } = csvLines(book)
  return {
    filename: `${book.assignment.slug}-grades.csv`,
    // A byte-order mark so Excel reads names in any script correctly.
    body: "\ufeff" + [header, ...rows].join("\r\n") + "\r\n",
  }
}

/**
 * One part of the same CSV, for an export done as a job (features/jobs): the students from
 * `offset`, in the gradebook's order (name, then email), so the parts join into exactly the
 * file gradebookCsv makes. The first part starts with the byte-order mark and the header.
 */
export async function gradebookCsvPart(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  offset: number,
  size: number
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const students = await studentsOf(assignment, scope)
  const ids = students.slice(offset, offset + size).map((s) => s.id)
  const book = await getGradebook(id, orgId, scope, ids)
  const { header, rows } = csvLines(book)
  const lines = rows.map((r) => r + "\r\n").join("")
  return {
    filename: `${book.assignment.slug}-grades.csv`,
    text: offset === 0 ? "\ufeff" + header + "\r\n" + lines : lines,
    total: students.length,
    next: offset + ids.length,
  }
}
