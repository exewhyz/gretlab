import {
  assignmentProblems,
  courseOutcomes,
  getDb,
  organizations,
  programOutcomes,
  sql,
  type User,
} from "@workspace/db"
import { DEFAULT_ATTAINMENT, type Permission } from "@workspace/judge"

import {
  canAnywhere,
  canFor,
  groupChain,
  needFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import type { CourseOutcomesInput, ProgramOutcomesInput } from "./schemas"

/*
 * Outcome-based education. Program outcomes (POs) belong to the organization; course
 * outcomes (COs) to a class, mapped to POs. Assignment problems are tagged with COs, and
 * attainment is computed from grades (features/classes/server.ts, classOutcomes).
 */

const { and, asc, eq, inArray, notInArray } = sql

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

/** People who set or read outcomes: anyone who teaches, reports or runs settings. */
const OUTCOME_READERS: Permission[] = [
  "assignments.manage",
  "gradebook.view",
  "reports.view",
  "org.settings.manage",
]

function needReader(ctx: OrgContext) {
  if (!OUTCOME_READERS.some((p) => canAnywhere(ctx, p))) {
    throw forbidden("Only teachers and organization managers see outcomes.")
  }
}

export function programOutcomesOf(orgId: string) {
  return getDb()
    .select({
      id: programOutcomes.id,
      code: programOutcomes.code,
      title: programOutcomes.title,
    })
    .from(programOutcomes)
    .where(eq(programOutcomes.orgId, orgId))
    .orderBy(asc(programOutcomes.position))
}

export const rulesOf = (ctx: OrgContext) =>
  ctx.org.attainment ?? DEFAULT_ATTAINMENT

export async function getProgramOutcomes(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needReader(ctx)
  return {
    outcomes: await programOutcomesOf(ctx.org.id),
    rules: rulesOf(ctx),
    canEdit: canEditOrg(ctx),
  }
}

/** Program outcomes are organization-wide, so editing them needs an organization-wide grant. */
const canEditOrg = (ctx: OrgContext) => canFor(ctx, "org.settings.manage", [])

/** Replaces the list, keeping ids so CO mappings follow each outcome. */
export async function saveProgramOutcomes(
  slug: string,
  user: User,
  input: ProgramOutcomesInput
) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.settings.manage", [])
  const codes = input.outcomes.map((o) => o.code.toLowerCase())
  if (new Set(codes).size !== codes.length) {
    throw new ApiError(400, "duplicate_code", "Two outcomes share a code.")
  }
  await getDb().transaction(async (tx) => {
    const kept = input.outcomes.flatMap((o) => (o.id ? [o.id] : []))
    await tx
      .delete(programOutcomes)
      .where(
        and(
          eq(programOutcomes.orgId, ctx.org.id),
          kept.length ? notInArray(programOutcomes.id, kept) : undefined
        )
      )
    for (const [position, o] of input.outcomes.entries()) {
      const values = { code: o.code, title: o.title, position }
      if (o.id) {
        const updated = await tx
          .update(programOutcomes)
          .set(values)
          .where(
            and(eq(programOutcomes.id, o.id), eq(programOutcomes.orgId, ctx.org.id))
          )
          .returning({ id: programOutcomes.id })
        if (updated.length === 0) {
          throw new ApiError(400, "unknown_outcome", "An outcome no longer exists.")
        }
      } else {
        await tx.insert(programOutcomes).values({ ...values, orgId: ctx.org.id })
      }
    }
    await tx
      .update(organizations)
      .set({ attainment: input.rules })
      .where(eq(organizations.id, ctx.org.id))
  })
  await writeAudit(ctx, "outcomes.program", "Changed the program outcomes", {
    outcomes: input.outcomes.length,
  })
  return getProgramOutcomes(slug, user)
}

export function courseOutcomesOf(groupIds: string[]) {
  if (groupIds.length === 0) return Promise.resolve([])
  return getDb()
    .select()
    .from(courseOutcomes)
    .where(inArray(courseOutcomes.groupId, groupIds))
    .orderBy(asc(courseOutcomes.position))
}

/** A class's COs replaced, mappings limited to the organization's POs. */
export async function saveCourseOutcomes(
  ctx: OrgContext,
  groupId: string,
  input: CourseOutcomesInput
) {
  needFor(ctx, "assignments.manage", [[groupId]])
  const codes = input.outcomes.map((o) => o.code.toLowerCase())
  if (new Set(codes).size !== codes.length) {
    throw new ApiError(400, "duplicate_code", "Two outcomes share a code.")
  }
  const pos = new Set((await programOutcomesOf(ctx.org.id)).map((p) => p.id))
  await getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: courseOutcomes.id })
      .from(courseOutcomes)
      .where(eq(courseOutcomes.groupId, groupId))
    const kept = new Set(input.outcomes.flatMap((o) => (o.id ? [o.id] : [])))
    const removed = existing.filter((e) => !kept.has(e.id)).map((e) => e.id)
    if (removed.length) {
      await tx.delete(courseOutcomes).where(inArray(courseOutcomes.id, removed))
      // Problems tagged with a removed CO lose the tag.
      for (const id of removed) {
        await tx
          .update(assignmentProblems)
          .set({ outcomes: sql.sql`${assignmentProblems.outcomes} - ${id}` })
          .where(sql.sql`${assignmentProblems.outcomes} ? ${id}`)
      }
    }
    for (const [position, o] of input.outcomes.entries()) {
      const mapping = Object.fromEntries(
        Object.entries(o.mapping).filter(([po, s]) => pos.has(po) && s > 0)
      )
      const values = { code: o.code, title: o.title, position, mapping }
      if (o.id) {
        const updated = await tx
          .update(courseOutcomes)
          .set(values)
          .where(and(eq(courseOutcomes.id, o.id), eq(courseOutcomes.groupId, groupId)))
          .returning({ id: courseOutcomes.id })
        if (updated.length === 0) {
          throw new ApiError(400, "unknown_outcome", "An outcome no longer exists.")
        }
      } else {
        await tx
          .insert(courseOutcomes)
          .values({ ...values, orgId: ctx.org.id, groupId })
      }
    }
  })
  await writeAudit(ctx, "outcomes.course", "Changed a class's course outcomes", {
    group: groupId,
    outcomes: input.outcomes.length,
  })
}

/** Every course's outcomes, to tag assignment problems with. */
export async function orgCourseOutcomes(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (!canAnywhere(ctx, "assignments.manage")) {
    throw forbidden("Only people who set assignments tag outcomes.")
  }
  const rows = await courseOutcomesOf(ctx.groups.map((g) => g.id))
  const name = (id: string) => ctx.groups.find((g) => g.id === id)?.name ?? "?"
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    groupId: r.groupId,
    course: groupChain(ctx, r.groupId).reverse().map(name).join(" › "),
  }))
}
