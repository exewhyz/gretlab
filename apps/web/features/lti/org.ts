import { assignments, getDb, sql, type User } from "@workspace/db"
import { z } from "zod"

import { groupsFor, needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { notFound } from "@/lib/api/route"

import { deletePlatform, gradeTargets, linkContext, platformsOf, savePlatform, sendGrades, siteOrigin } from "./server"

export const platformSchema = z.object({
  name: z.string().trim().min(1, "Name the LMS").max(120),
  issuer: z.string().trim().min(1, "Enter the issuer").max(500),
  clientId: z.string().trim().min(1, "Enter the client ID").max(500),
  deploymentIds: z.array(z.string().trim().min(1).max(500)).min(1, "Enter at least one deployment ID").max(50),
  authUrl: z.string().trim().max(1000),
  tokenUrl: z.string().trim().max(1000),
  jwksUrl: z.string().trim().max(1000),
})

/** Connecting an LMS changes who can sign in: organization-wide "Change settings". */
async function settingsContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.settings.manage", [])
  return ctx
}

export async function orgLti(slug: string, user: User, origin: string) {
  const ctx = await settingsContext(slug, user)
  const base = siteOrigin(origin)
  return {
    /** What the admin pastes into the LMS. */
    tool: {
      loginUrl: `${base}/api/v1/lti/login`,
      launchUrl: `${base}/api/v1/lti/launch`,
      jwksUrl: `${base}/api/v1/lti/jwks`,
      deepLinkUrl: `${base}/api/v1/lti/launch`,
      domain: new URL(base).host,
    },
    platforms: await platformsOf(ctx.org.id),
  }
}

export async function orgSavePlatform(slug: string, user: User, id: string | null, input: z.infer<typeof platformSchema>) {
  const ctx = await settingsContext(slug, user)
  const row = await savePlatform(ctx.org.id, id, input)
  await writeAudit(ctx, id ? "lti.update" : "lti.create", `${id ? "Changed" : "Connected"} the LMS ${row.name}`)
  return row
}

export async function orgDeletePlatform(slug: string, user: User, id: string) {
  const ctx = await settingsContext(slug, user)
  const row = await deletePlatform(ctx.org.id, id)
  await writeAudit(ctx, "lti.delete", `Disconnected the LMS ${row.name}`)
}

export async function orgLinkContext(slug: string, user: User, id: string, groupId: string | null) {
  const ctx = await settingsContext(slug, user)
  const row = await linkContext(ctx.org.id, id, groupId)
  const group = ctx.groups.find((g) => g.id === groupId)?.name
  await writeAudit(ctx, "lti.course", group ? `Linked the LMS course ${row.title} to ${group}` : `Unlinked the LMS course ${row.title}`)
}

/** Sending grades to the LMS: whoever sets this assignment, for the students they see. */
async function gradesContext(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  const [a] = await getDb()
    .select({ audience: assignments.audience, title: assignments.title })
    .from(assignments)
    .where(sql.and(sql.eq(assignments.id, id), sql.eq(assignments.orgId, ctx.org.id)))
  if (!a) throw notFound("Assignment not found")
  needFor(ctx, "assignments.manage", a.audience)
  needFor(ctx, "gradebook.view", a.audience)
  return { ctx, title: a.title, scope: groupsFor(ctx, "gradebook.view") }
}

export async function orgGradeTargets(slug: string, user: User, id: string) {
  await gradesContext(slug, user, id)
  const targets = await gradeTargets(id)
  return { targets: targets.map((t) => ({ lms: t.platform.name, title: t.link.title })) }
}

export async function orgSendGrades(slug: string, user: User, id: string) {
  const { ctx, title, scope } = await gradesContext(slug, user, id)
  const result = await sendGrades(id, ctx.org.id, scope)
  await writeAudit(ctx, "lti.grades", `Sent ${result.sent} grades for ${title} to the LMS`)
  return result
}
