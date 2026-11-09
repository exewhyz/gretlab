import { assignments, getDb, sql, type User } from "@workspace/db"

import { needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { notFound } from "@/lib/api/route"

import { hideReview, peerOverview, startPeerReview } from "./server"

/** A college's assignment, for someone who sees its grades (to read) or sets it (to start). */
async function peerContext(slug: string, user: User, id: string, manage: boolean) {
  const ctx = await orgContext(slug, user)
  const [a] = await getDb()
    .select({ audience: assignments.audience, title: assignments.title })
    .from(assignments)
    .where(sql.and(sql.eq(assignments.id, id), sql.eq(assignments.orgId, ctx.org.id)))
  if (!a) throw notFound("Assignment not found")
  needFor(ctx, manage ? "assignments.manage" : "gradebook.view", a.audience)
  return { ctx, title: a.title }
}

export async function orgPeerOverview(slug: string, user: User, id: string) {
  const { ctx } = await peerContext(slug, user, id, false)
  return peerOverview(id, ctx.org.id)
}

export async function orgStartPeerReview(slug: string, user: User, id: string) {
  const { ctx, title } = await peerContext(slug, user, id, true)
  const result = await startPeerReview(id, ctx.org.id)
  await writeAudit(ctx, "assignment.peer_review", `Handed out ${result.reviews} peer reviews for ${title}`)
  return result
}

export async function orgHideReview(slug: string, user: User, id: string, reviewId: string, hidden: boolean) {
  const { ctx, title } = await peerContext(slug, user, id, false)
  await hideReview(id, ctx.org.id, reviewId, hidden)
  await writeAudit(ctx, "assignment.peer_review", `${hidden ? "Hid" : "Showed"} a peer review on ${title}`)
}
