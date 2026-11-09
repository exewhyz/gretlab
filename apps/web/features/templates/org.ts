import type { User } from "@workspace/db"

import type { AssignmentInput } from "@/features/problems/schemas"
import { canAnywhere, needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

import type { ApplyTemplateInput } from "./schemas"
import {
  copyTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  saveTemplate,
  templateFromAssignment,
  applyTemplate,
} from "./server"

/** A college's templates: for people who set assignments somewhere in it. */
async function templateContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (!canAnywhere(ctx, "assignments.manage")) {
    throw new ApiError(403, "forbidden", "You don't have permission to do that.")
  }
  return ctx
}

export async function orgTemplates(slug: string, user: User) {
  const ctx = await templateContext(slug, user)
  return listTemplates(ctx.org.id, user.id)
}

export async function orgTemplate(slug: string, user: User, id: string) {
  const ctx = await templateContext(slug, user)
  return getTemplate(ctx.org.id, id, user.id)
}

export async function orgSaveTemplate(slug: string, user: User, id: string | null, input: AssignmentInput) {
  const ctx = await templateContext(slug, user)
  const result = await saveTemplate(ctx.org.id, id, input, user.id)
  await writeAudit(
    ctx,
    id ? "template.update" : "template.create",
    `${id ? "Changed" : "Created"} the template ${result.template.title}${result.updated ? `, updating ${result.updated} unopened uses` : ""}`
  )
  return result
}

export async function orgDeleteTemplate(slug: string, user: User, id: string) {
  const ctx = await templateContext(slug, user)
  const row = await deleteTemplate(ctx.org.id, id)
  await writeAudit(ctx, "template.delete", `Deleted the template ${row.title}`)
}

export async function orgTemplateFromAssignment(slug: string, user: User, assignmentId: string) {
  const ctx = await templateContext(slug, user)
  const row = await templateFromAssignment(ctx.org.id, assignmentId)
  await writeAudit(ctx, "template.create", `Saved an assignment as the template ${row.title}`)
  return row
}

export async function orgCopyTemplate(slug: string, user: User, id: string) {
  const ctx = await templateContext(slug, user)
  const row = await copyTemplate(ctx.org.id, id, user.id)
  await writeAudit(ctx, "template.copy", `Copied the template ${row.title}`)
  return row
}

/** Uses a template for classes: setting work for each needs that permission for it. */
export async function orgApplyTemplate(slug: string, user: User, id: string, input: ApplyTemplateInput) {
  const ctx = await templateContext(slug, user)
  for (const use of input.uses) {
    if (use.groupId && !ctx.groups.some((g) => g.id === use.groupId)) throw notFound("Class not found")
    needFor(ctx, "assignments.manage", use.groupId ? [[use.groupId]] : [])
  }
  const name = (groupId: string) => ctx.groups.find((g) => g.id === groupId)?.name ?? ""
  const result = await applyTemplate(ctx.org.id, id, input, name, user.id)
  await writeAudit(ctx, "template.use", `Made ${result.created.length} assignments from a template`, {
    assignments: result.created.map((c) => c.slug),
  })
  return result
}
