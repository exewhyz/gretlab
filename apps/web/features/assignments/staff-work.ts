import {
  assignmentProblems,
  assignmentQuestions,
  assignments,
  courseOutcomes,
  examEvents,
  examSessions,
  getDb,
  problems,
  sql,
  submissions,
  type User,
} from "@workspace/db"
import { QUEUE_CHANNEL } from "@workspace/judge"

import { sittingsOn } from "@/features/exams/sittings"
import { usableIds } from "@/features/library/sharing"
import { notify } from "@/features/notifications/server"
import { projectsOf, saveProjects } from "@/features/projects/server"
import { usableQuestions } from "@/features/questions/server"
import { canVerifyAddresses } from "@/lib/api/client-ip"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"
import { ApiError, notFound } from "@/lib/api/route"

import type { AssignmentInput } from "../problems/schemas"
import { colleaguesOf, studentsOf } from "./gradebook-server"
import {
  chosenProblems,
  itemsOf,
  ownedBy,
  phaseOf,
  questionsOf,
} from "./grading"

const { and, asc, eq, gte, inArray } = sql

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
  const [items, questions, projects] = await Promise.all([
    itemsOf([id]),
    questionsOf([id]),
    projectsOf([id]),
  ])
  return {
    ...assignment,
    projects: projects.map(
      ({ id: projectId, title, instructions, points }) => ({
        id: projectId,
        title,
        instructions,
        points,
      })
    ),
    chosenProblems: await chosenProblems(items.map((i) => i.problemId)),
    problems: items.map(({ problemId, points, rubric, outcomes }) => ({
      problemId,
      points,
      rubric,
      outcomes,
    })),
    questions: questions.map((q) => ({ questionId: q.id, points: q.points })),
  }
}

export async function saveAssignment(
  id: string | null,
  input: AssignmentInput,
  orgId: string | null,
  options: {
    /** Problems and questions allowed without being shared: a template's. */
    allowed?: Set<string>
    /** A new use of this template. */
    templateId?: string
    /** Who is saving it, so they aren't told about their own work. */
    by?: User
  } = {}
) {
  const {
    problems: chosen,
    expectedUpdatedAt,
    questions,
    projects,
    ...fields
  } = input
  const ids = chosen.map((c) => c.problemId)
  // What it already has stays allowed (a template's shared problems, or sharing taken back).
  const allowed = new Set(options.allowed)
  if (id) {
    const [had, hadQuestions] = await Promise.all([
      getDb()
        .select({ id: assignmentProblems.problemId })
        .from(assignmentProblems)
        .where(eq(assignmentProblems.assignmentId, id)),
      getDb()
        .select({ id: assignmentQuestions.questionId })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, id)),
    ])
    for (const r of [...had, ...hadQuestions]) allowed.add(r.id)
  }
  const found = await getDb()
    .select({
      id: problems.id,
      published: problems.published,
      membersOnly: problems.membersOnly,
      listed: problems.listed,
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
  const usable = await usableIds("problem", ids, orgId)
  if (
    found.some(
      (p) => p.orgId !== orgId && !usable.has(p.id) && !allowed.has(p.id)
    )
  ) {
    throw new ApiError(
      400,
      "private_problem",
      "That problem isn't shared with you."
    )
  }
  if (found.some((p) => !p.published)) {
    throw new ApiError(
      400,
      "draft_problem",
      "Only published problems can be assigned. Publish the drafts first."
    )
  }
  if (fields.exam?.networks.length && !canVerifyAddresses()) {
    throw new ApiError(
      400,
      "addresses_unverifiable",
      "This server can't confirm where students connect from, so an exam can't be limited to a network yet. This works on Vercel, or behind Caddy once an administrator sets PROXY_SECRET (see docs/deploy-exams.md)."
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
  await usableQuestions(
    questions.map((q) => q.questionId).filter((q) => !allowed.has(q)),
    orgId
  )
  if (id) await guardStartedExam(id, input)
  const wasPublished = id
    ? ((
        await getDb()
          .select({ published: assignments.published })
          .from(assignments)
          .where(eq(assignments.id, id))
      )[0]?.published ?? false)
    : false
  const values = {
    ...fields,
    orgId,
    audience: orgId ? fields.audience : [],
    ...(options.templateId ? { templateId: options.templateId } : {}),
  }

  const saved = await getDb().transaction(async (tx) => {
    const [assignment] = id
      ? await tx
          .update(assignments)
          .set(values)
          .where(
            and(
              eq(assignments.id, id),
              ownedBy(orgId),
              unchangedSince(assignments.updatedAt, expectedUpdatedAt)
            )
          )
          .returning()
      : await tx.insert(assignments).values(values).returning()
    if (!assignment) {
      const [exists] = id
        ? await tx
            .select({ id: assignments.id })
            .from(assignments)
            .where(and(eq(assignments.id, id), ownedBy(orgId)))
        : []
      throw exists ? editedElsewhere() : notFound("Assignment not found")
    }
    await tx
      .delete(assignmentProblems)
      .where(eq(assignmentProblems.assignmentId, assignment.id))
    if (chosen.length) {
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
    }
    await saveProjects(tx, assignment.id, projects)
    // Answers are kept by bank question, so they stay with a question across edits.
    await tx
      .delete(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignment.id))
    if (questions.length) {
      await tx.insert(assignmentQuestions).values(
        questions.map((q, position) => ({
          assignmentId: assignment.id,
          questionId: q.questionId,
          points: q.points,
          position,
        }))
      )
    }
    return assignment
  })
  // Students hear about it when it's first published.
  if (saved.published && !wasPublished) {
    const students = await studentsOf(saved, "all")
    await notify(
      students.map((s) => s.id),
      {
        kind: saved.exam ? "new_exam" : "new_assignment",
        title: `${saved.exam ? "New exam" : "New assignment"}: ${saved.title}`,
        body: saved.exam
          ? "Read its rules before you start: one sitting, timed."
          : `${[
              chosen.length &&
                `${chosen.length} ${chosen.length === 1 ? "problem" : "problems"}`,
              questions.length &&
                `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
            ]
              .filter(Boolean)
              .join(" and ")}. Open it to see when it's due.`,
        href: `/assignments/${saved.slug}`,
        orgId: saved.orgId,
      }
    )
    // The class's other teachers get a copy, so nobody is surprised by a colleague's work.
    const kind = saved.exam ? "exam" : "assignment"
    await notify(await colleaguesOf(saved, options.by?.id), {
      kind: "staff_assignment_published",
      title: `${options.by?.name ?? "A colleague"} published the ${kind} ${saved.title}`,
      body: `${students.length} ${students.length === 1 ? "student" : "students"} can see it.`,
      href: `/assignments/${saved.slug}`,
      orgId: saved.orgId,
    })
  }
  return saved
}

/**
 * Once students have started an exam, it stays an exam with the same problems: turning it
 * off would count everyone's practice, and swapping problems would change it under them.
 * Time, due time and networks can still change (running sittings keep their end time).
 */
export async function guardStartedExam(id: string, input: AssignmentInput) {
  const [current] = await getDb()
    .select({ exam: assignments.exam })
    .from(assignments)
    .where(eq(assignments.id, id))
  if (!current?.exam) return
  const started = await sittingsOn([id])
  if ((started.get(id)?.size ?? 0) === 0) return
  if (!input.exam) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so it can't stop being an exam."
    )
  }
  const before = (await itemsOf([id])).map((i) => i.problemId)
  const after = input.problems.map((p) => p.problemId)
  if (before.length !== after.length || before.some((p, i) => p !== after[i])) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so its problems can't change. Points and rubrics can."
    )
  }
  const asked = (await questionsOf([id])).map((q) => q.id)
  const asking = input.questions.map((q) => q.questionId)
  if (asked.length !== asking.length || asked.some((q, i) => q !== asking[i])) {
    throw new ApiError(
      409,
      "exam_started",
      "Students have started this exam, so its questions can't be added, removed or reordered."
    )
  }
}

/**
 * After a runner outage: every graded submission of this assignment's students on its
 * problems that ended in "System error" is judged again. They keep the time they were
 * submitted, so work done in time (an exam's last submission) counts.
 */
export async function rejudgeSystemErrors(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string> = "all"
) {
  const [assignment] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  const [items, students] = await Promise.all([
    itemsOf([id]),
    studentsOf(assignment, scope),
  ])
  if (items.length === 0 || students.length === 0) return { queued: 0 }
  const queued = await getDb().transaction(async (tx) => {
    const rows = await tx
      .update(submissions)
      .set({
        status: "queued",
        verdict: null,
        attempts: 0,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      })
      .where(
        and(
          eq(submissions.kind, "submit"),
          eq(submissions.status, "done"),
          eq(submissions.verdict, "SE"),
          inArray(
            submissions.problemId,
            items.map((i) => i.problemId)
          ),
          inArray(
            submissions.userId,
            students.map((s) => s.id)
          ),
          gte(submissions.createdAt, assignment.opensAt)
        )
      )
      .returning({ id: submissions.id })
    if (rows.length)
      await tx.execute(sql.sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`)
    return rows.length
  })
  return { queued }
}

/** Drops the network addresses an exam recorded: where each sitting started, and refused submissions. */
export async function forgetExamAddresses(id: string, orgId: string | null) {
  const [assignment] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!assignment) throw notFound("Assignment not found")
  await getDb().transaction(async (tx) => {
    await tx
      .update(examSessions)
      .set({ ip: null })
      .where(eq(examSessions.assignmentId, id))
    await tx
      .update(examEvents)
      .set({ detail: "" })
      .where(
        and(
          eq(examEvents.assignmentId, id),
          eq(examEvents.kind, "other_network")
        )
      )
  })
}

export async function deleteAssignment(id: string, orgId: string | null) {
  const deleted = await getDb()
    .delete(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
    .returning({ id: assignments.id })
  if (deleted.length === 0) throw notFound("Assignment not found")
}
