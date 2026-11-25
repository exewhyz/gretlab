import {
  getDb,
  problemListItems,
  problemLists,
  problems,
  sql,
  submissions,
  type User,
} from "@workspace/db"
import { z } from "zod"

import { needCoding } from "@/features/orgs/content"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { slugify } from "@/features/problems/schemas"
import { isPublicProblem } from "@/features/problems/server"
import { idsForSlugs } from "@/features/problems/slugs"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"

/*
 * An organization's own study plans (Manage › Study plans; members at /orgs/:slug/study-plans).
 * They're `problem_lists` rows of kind study_plan with `org_id` set, so the platform's list pages
 * never show them. A plan holds library problems anyone can practise and the organization's own
 * published members-only problems (solved on its practice pages); only its active members see
 * published plans. Whoever may edit problems across the organization manages them.
 */

const { and, asc, count, eq, inArray, or } = sql

/** At most this many problems in a plan, as in people's own lists. */
const MAX_ITEMS = 200

export const orgPlanSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(120),
  description: z.string().trim().max(2000).default(""),
})

export const orgPlanUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  published: z.boolean().optional(),
  problemSlugs: z.array(z.string().max(120)).max(MAX_ITEMS).optional(),
})

const manages = (ctx: OrgContext) => canFor(ctx, "problems.edit", [])

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needCoding(ctx)
  return ctx
}

function needManage(ctx: OrgContext) {
  if (!manages(ctx))
    throw new ApiError(
      403,
      "forbidden",
      "Managing study plans isn't part of your role here."
    )
}

/** What a plan may hold: problems anyone can practise, and this organization's members-only ones. */
const allowedHere = (orgId: string) =>
  or(
    isPublicProblem,
    and(
      eq(problems.orgId, orgId),
      eq(problems.membersOnly, true),
      eq(problems.published, true)
    )
  )!

async function planOf(ctx: OrgContext, planSlug: string) {
  const [plan] = await getDb()
    .select()
    .from(problemLists)
    .where(
      and(eq(problemLists.slug, planSlug), eq(problemLists.orgId, ctx.org.id))
    )
  // Drafts only for those who manage them; members see published plans.
  if (!plan || (!plan.published && !manages(ctx)))
    throw notFound("Study plan not found")
  if (!manages(ctx) && ctx.membership?.status !== "active")
    throw notFound("Study plan not found")
  return plan
}

/** The organization's study plans: published ones for members, all of them for whoever manages them. */
export async function orgStudyPlans(slug: string, user: User) {
  const ctx = await context(slug, user)
  const manager = manages(ctx)
  if (!manager && ctx.membership?.status !== "active")
    throw notFound("Organization not found")
  const db = getDb()
  const rows = await db
    .select({
      id: problemLists.id,
      slug: problemLists.slug,
      title: problemLists.title,
      description: problemLists.description,
      published: problemLists.published,
      size: count(problemListItems.problemId),
    })
    .from(problemLists)
    .leftJoin(problemListItems, eq(problemListItems.listId, problemLists.id))
    .where(
      and(
        eq(problemLists.orgId, ctx.org.id),
        ...(manager ? [] : [eq(problemLists.published, true)])
      )
    )
    .groupBy(problemLists.id)
    .orderBy(asc(problemLists.title))
  return {
    plans: rows.map((r) => ({ ...r, size: Number(r.size) })),
    canManage: manager,
  }
}

/** One plan with its problems in order, where each is solved, and whether the viewer solved it. */
export async function orgStudyPlan(slug: string, user: User, planSlug: string) {
  const ctx = await context(slug, user)
  const plan = await planOf(ctx, planSlug)
  const db = getDb()
  const items = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      level: problems.level,
      membersOnly: problems.membersOnly,
      position: problemListItems.position,
    })
    .from(problemListItems)
    .innerJoin(problems, eq(problemListItems.problemId, problems.id))
    .where(and(eq(problemListItems.listId, plan.id), allowedHere(ctx.org.id)))
    .orderBy(asc(problemListItems.position), asc(problems.title))
  const solved = items.length
    ? new Set(
        (
          await db
            .selectDistinct({ id: submissions.problemId })
            .from(submissions)
            .where(
              and(
                eq(submissions.userId, user.id),
                eq(submissions.kind, "submit"),
                eq(submissions.verdict, "AC"),
                inArray(
                  submissions.problemId,
                  items.map((i) => i.id)
                )
              )
            )
        ).map((r) => r.id)
      )
    : new Set<string>()
  const pages = orgPages(ctx.org.slug)
  return {
    slug: plan.slug,
    title: plan.title,
    description: plan.description,
    published: plan.published,
    canManage: manages(ctx),
    items: items.map(({ id, membersOnly, ...item }) => ({
      ...item,
      // Members-only problems are solved on the organization's practice pages.
      href: membersOnly ? pages.practice(item.slug) : `/problems/${item.slug}`,
      solved: solved.has(id),
    })),
  }
}

export async function createOrgPlan(
  slug: string,
  user: User,
  input: z.infer<typeof orgPlanSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const suffix = Math.random().toString(36).slice(2, 7)
  const [plan] = await getDb()
    .insert(problemLists)
    .values({
      ownerId: user.id,
      orgId: ctx.org.id,
      kind: "study_plan",
      title: input.title,
      description: input.description,
      slug: `${slugify(input.title) || "plan"}-${suffix}`,
    })
    .returning()
  await writeAudit(
    ctx,
    "study_plan.create",
    `Made the study plan "${input.title}"`
  )
  return plan!
}

export async function updateOrgPlan(
  slug: string,
  user: User,
  planSlug: string,
  input: z.infer<typeof orgPlanUpdateSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const plan = await planOf(ctx, planSlug)
  const { problemSlugs, ...fields } = input
  await getDb().transaction(async (tx) => {
    if (Object.keys(fields).length)
      await tx
        .update(problemLists)
        .set(fields)
        .where(eq(problemLists.id, plan.id))
    if (problemSlugs) {
      const idOf = await idsForSlugs(tx, problemSlugs)
      const ids = [...new Set(problemSlugs.flatMap((s) => idOf.get(s) ?? []))]
      const usable = ids.length
        ? new Set(
            (
              await tx
                .select({ id: problems.id })
                .from(problems)
                .where(and(inArray(problems.id, ids), allowedHere(ctx.org.id)))
            ).map((r) => r.id)
          )
        : new Set<string>()
      if (
        ids.length !== problemSlugs.length ||
        ids.some((id) => !usable.has(id))
      )
        throw new ApiError(
          400,
          "problem_not_allowed",
          "A study plan holds library problems and this organization's own published members-only problems."
        )
      await tx
        .delete(problemListItems)
        .where(eq(problemListItems.listId, plan.id))
      if (ids.length)
        await tx
          .insert(problemListItems)
          .values(
            ids.map((problemId, position) => ({
              listId: plan.id,
              problemId,
              position,
            }))
          )
    }
  })
  await writeAudit(
    ctx,
    "study_plan.update",
    `Changed the study plan "${input.title ?? plan.title}"`
  )
}

export async function deleteOrgPlan(
  slug: string,
  user: User,
  planSlug: string
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const plan = await planOf(ctx, planSlug)
  await getDb().delete(problemLists).where(eq(problemLists.id, plan.id))
  await writeAudit(
    ctx,
    "study_plan.delete",
    `Deleted the study plan "${plan.title}"`
  )
}
