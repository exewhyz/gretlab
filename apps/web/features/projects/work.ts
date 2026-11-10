import { assignments, getDb, projectSubmissions, sql, type User } from "@workspace/db"
import { personalDue } from "@workspace/judge"

import { extensionsOn, findAssignment, studentsOf } from "@/features/assignments/server"
import { dbNow } from "@/features/exams/sittings"
import { notify } from "@/features/notifications/server"
import { ApiError, notFound } from "@/lib/api/route"

import { checkRepository, projectsOf } from "./server"

/*
 * Handing in a project (students) and marking it (teachers). Students hand in from when
 * the assignment opens until their own due time (later only when it takes late work, and
 * then it's marked late). Handing in again replaces it and clears the mark.
 */

const { and, eq, isNull } = sql

export async function submitProject(
  slug: string,
  viewer: User,
  projectId: string,
  input: { url: string; note: string }
) {
  const { assignment: a } = await findAssignment(slug, viewer)
  const project = (await projectsOf([a.id])).find((p) => p.id === projectId)
  if (!project) throw notFound("Project not found")
  const now = await dbNow()
  if (now < a.opensAt) throw new ApiError(409, "not_open", "This assignment hasn't opened yet.")
  const extension = (await extensionsOn([a.id], viewer.id)).get(a.id)?.get(viewer.id)
  const late = now > personalDue(a.dueAt, extension)
  if (late && !a.allowLate) {
    throw new ApiError(409, "closed", "The due time has passed and this assignment doesn't take late work.")
  }
  const repo = await checkRepository(input.url)
  const values = {
    repoUrl: repo.url,
    ref: repo.ref,
    commitSha: repo.sha,
    note: input.note,
    submittedAt: now,
    late,
    mark: null,
    feedback: "",
    markedBy: null,
    markedAt: null,
  }
  await getDb()
    .insert(projectSubmissions)
    .values({ projectId, userId: viewer.id, ...values })
    .onConflictDoUpdate({ target: [projectSubmissions.projectId, projectSubmissions.userId], set: values })
  return { repoUrl: repo.url, ref: repo.ref, commitSha: repo.sha, late }
}

async function staffAssignment(id: string, orgId: string | null) {
  const [a] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)))
  if (!a) throw notFound("Assignment not found")
  return a
}

async function studentIn(a: typeof assignments.$inferSelect, scope: "all" | Set<string>, email: string) {
  const student = (await studentsOf(a, scope)).find((s) => s.email === email.toLowerCase())
  if (!student) throw notFound("Student not found")
  return student
}

/** One student's projects, for marking. */
export async function studentProjects(id: string, orgId: string | null, scope: "all" | Set<string>, email: string) {
  const a = await staffAssignment(id, orgId)
  const student = await studentIn(a, scope, email)
  const projects = await projectsOf([id])
  const subs = await getDb()
    .select()
    .from(projectSubmissions)
    .where(eq(projectSubmissions.userId, student.id))
  return {
    student: { name: student.name, email: student.email },
    holdFeedback: a.holdFeedback,
    projects: projects.map((p) => {
      const s = subs.find((x) => x.projectId === p.id)
      return {
        id: p.id,
        title: p.title,
        points: p.points,
        submission: s
          ? {
              repoUrl: s.repoUrl,
              ref: s.ref,
              commitSha: s.commitSha,
              note: s.note,
              submittedAt: s.submittedAt,
              late: s.late,
              mark: s.mark,
              feedback: s.feedback,
            }
          : null,
      }
    }),
  }
}

export async function markProject(
  id: string,
  orgId: string | null,
  scope: "all" | Set<string>,
  input: { student: string; projectId: string; mark: number | null; feedback: string },
  markerId: string
) {
  const a = await staffAssignment(id, orgId)
  const student = await studentIn(a, scope, input.student)
  const project = (await projectsOf([id])).find((p) => p.id === input.projectId)
  if (!project) throw notFound("Project not found")
  if (input.mark !== null && input.mark > project.points) {
    throw new ApiError(400, "too_many_marks", `${project.title} is out of ${project.points}.`)
  }
  const [row] = await getDb()
    .update(projectSubmissions)
    .set({ mark: input.mark, feedback: input.feedback, markedBy: markerId, markedAt: new Date() })
    .where(and(eq(projectSubmissions.projectId, project.id), eq(projectSubmissions.userId, student.id)))
    .returning()
  if (!row) throw new ApiError(409, "not_submitted", "They haven't handed this project in.")
  if (!a.holdFeedback && input.mark !== null) {
    await notify([student.id], {
      kind: "project_marked",
      title: `${project.title} was marked`,
      body: `${input.mark} / ${project.points}${input.feedback ? ` · ${input.feedback.slice(0, 120)}` : ""}`,
      href: `/assignments/${a.slug}`,
    })
  }
}
