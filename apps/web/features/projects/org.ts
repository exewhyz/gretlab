import { assignments, getDb, sql, type User } from "@workspace/db"

import { groupsFor, needFor, orgContext } from "@/features/orgs/server"
import { notFound } from "@/lib/api/route"

import { markProject, studentProjects } from "./work"

/** A college's assignment, for people who see (or mark) its grades for its students. */
async function context(slug: string, user: User, id: string, mark: boolean) {
  const ctx = await orgContext(slug, user)
  const [a] = await getDb()
    .select({ audience: assignments.audience })
    .from(assignments)
    .where(
      sql.and(sql.eq(assignments.id, id), sql.eq(assignments.orgId, ctx.org.id))
    )
  if (!a) throw notFound("Assignment not found")
  needFor(ctx, "gradebook.view", a.audience)
  if (mark) needFor(ctx, "assignments.grade", a.audience)
  return { ctx, scope: groupsFor(ctx, "gradebook.view") }
}

export async function orgStudentProjects(
  slug: string,
  user: User,
  id: string,
  email: string
) {
  const { ctx, scope } = await context(slug, user, id, false)
  return studentProjects(id, ctx.org.id, scope, email)
}

export async function orgMarkProject(
  slug: string,
  user: User,
  id: string,
  input: Parameters<typeof markProject>[3]
) {
  const { ctx, scope } = await context(slug, user, id, true)
  return markProject(id, ctx.org.id, scope, input, user.id)
}
