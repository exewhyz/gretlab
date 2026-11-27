import {
  courses,
  getDb,
  problems,
  questions,
  sql,
  templates,
  type User,
} from "@workspace/db"
import { z } from "zod"

import { orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import { needUniversity } from "./affiliation"

/*
 * A university shares its own problems, questions, courses and templates with the colleges
 * affiliated to it (`sharing = 'affiliates'`), or keeps them to itself (`owner`). Colleges
 * then use them like the platform's shared items (`usableBy` in features/library/sharing.ts),
 * only while their affiliation is active.
 */

const { and, eq, inArray } = sql

export const affiliateSharingSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["problem", "question", "course", "template"]),
        id: z.string().uuid(),
      })
    )
    .min(1)
    .max(500),
  sharing: z.enum(["owner", "affiliates"]),
})

const TABLES = {
  problem: problems,
  question: questions,
  course: courses,
  template: templates,
}

export async function shareWithAffiliates(
  slug: string,
  user: User,
  input: z.infer<typeof affiliateSharingSchema>
) {
  const ctx = await orgContext(slug, user)
  needUniversity(ctx, "university.share")
  const db = getDb()
  const titles: string[] = []
  await db.transaction(async (tx) => {
    for (const kind of ["problem", "question", "course", "template"] as const) {
      const ids = [
        ...new Set(input.items.filter((i) => i.kind === kind).map((i) => i.id)),
      ]
      if (ids.length === 0) continue
      const table = TABLES[kind]
      const rows = await tx
        .select({ id: table.id, title: table.title, sharing: table.sharing })
        .from(table)
        .where(and(inArray(table.id, ids), eq(table.orgId, ctx.org.id)))
      if (rows.length !== ids.length)
        throw new ApiError(
          400,
          "not_ours",
          "Only the university's own content can be shared from here."
        )
      if (rows.some((r) => r.sharing === "everyone"))
        throw new ApiError(
          409,
          "already_public",
          "Public library problems already reach every college."
        )
      // Who it reaches isn't an edit: open editors keep their version.
      await tx
        .update(table)
        .set({ sharing: input.sharing, updatedAt: sql.sql`${table.updatedAt}` })
        .where(inArray(table.id, ids))
      titles.push(...rows.map((r) => r.title))
    }
  })
  await writeAudit(
    ctx,
    "university.share",
    input.sharing === "affiliates"
      ? `Shared ${titles.length} ${titles.length === 1 ? "item" : "items"} with the affiliated colleges`
      : `Stopped sharing ${titles.length} ${titles.length === 1 ? "item" : "items"} with the affiliated colleges`,
    { items: titles.slice(0, 50) }
  )
  return { changed: titles.length }
}
