import { getDb, problemSlugHistory, problems, sql } from "@workspace/db"

import { ApiError } from "@/lib/api/errors"
import { cached } from "@/lib/ttl-cache"

const { and, eq, inArray, ne, or } = sql

/*
 * A problem's address is its slug (`/problems/integer-operations`). When it changes, the old
 * one is kept in problem_slug_history, so old links, saved browser progress and API callers
 * still reach the problem: lookups match either (slugIs), and public pages redirect to the
 * current address (currentSlug). A slug, current or former, belongs to one problem only.
 */

/** Matches the problem whose slug is, or used to be, `slug`. Use it for every lookup by slug. */
export const slugIs = (slug: string) =>
  or(
    eq(problems.slug, slug),
    sql.sql`exists (select 1 from ${problemSlugHistory} h where h.slug = ${slug} and h.problem_id = ${problems.id})`
  )!

/**
 * Every former slug and where it leads now ({ p2: "integer-operations" }), kept 5 minutes per
 * server: proxy.ts answers old addresses from it with a real 308 before any page renders.
 */
export function formerSlugMap(): Promise<Map<string, string>> {
  return cached("former-slug-map", 5 * 60 * 1000, async () => {
    const rows = await getDb()
      .select({ from: problemSlugHistory.slug, to: problems.slug })
      .from(problemSlugHistory)
      .innerJoin(problems, eq(problems.id, problemSlugHistory.problemId))
    return new Map(rows.map((r) => [r.from, r.to]))
  })
}

/** The current slug of the problem that used to be at `slug`, or null. */
export async function currentSlug(slug: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: problems.slug })
    .from(problemSlugHistory)
    .innerJoin(problems, eq(problems.id, problemSlugHistory.problemId))
    .where(eq(problemSlugHistory.slug, slug))
  return row?.slug ?? null
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

/** Problem ids for several slugs, each current or former: { given slug → id }. */
export async function idsForSlugs(db: Tx | ReturnType<typeof getDb>, slugs: string[]) {
  const ids = new Map<string, string>()
  if (slugs.length === 0) return ids
  for (const row of await db
    .select({ id: problems.id, slug: problems.slug })
    .from(problems)
    .where(inArray(problems.slug, slugs)))
    ids.set(row.slug, row.id)
  const rest = slugs.filter((s) => !ids.has(s))
  if (rest.length) {
    for (const row of await db
      .select({ slug: problemSlugHistory.slug, id: problemSlugHistory.problemId })
      .from(problemSlugHistory)
      .where(inArray(problemSlugHistory.slug, rest)))
      ids.set(row.slug, row.id)
  }
  return ids
}

/**
 * Before a problem takes `slug`: refuses one another problem has or had, so an old link never
 * changes which problem it opens.
 */
export async function claimSlug(tx: Tx, slug: string, problemId: string | null) {
  const [current] = await tx
    .select({ id: problems.id })
    .from(problems)
    .where(problemId ? and(eq(problems.slug, slug), ne(problems.id, problemId)) : eq(problems.slug, slug))
  const [former] = await tx
    .select({ id: problemSlugHistory.problemId })
    .from(problemSlugHistory)
    .where(
      problemId
        ? and(eq(problemSlugHistory.slug, slug), ne(problemSlugHistory.problemId, problemId))
        : eq(problemSlugHistory.slug, slug)
    )
  if (current || former) {
    throw new ApiError(
      409,
      "slug_taken",
      current
        ? "Another problem has that address. Choose another."
        : "Another problem used to have that address, and old links still lead to it. Choose another."
    )
  }
}

/** After a problem's slug changed: the old one keeps leading to it; taking back a former one un-lists it. */
export async function recordSlugChange(tx: Tx, problemId: string, from: string, to: string) {
  if (from === to) return
  await tx
    .insert(problemSlugHistory)
    .values({ slug: from, problemId })
    .onConflictDoNothing()
  await tx
    .delete(problemSlugHistory)
    .where(and(eq(problemSlugHistory.slug, to), eq(problemSlugHistory.problemId, problemId)))
}

/** Former slugs starting with any of `prefixes`, so imports pick addresses nobody had. */
export async function formerSlugsLike(prefixes: string[]) {
  if (prefixes.length === 0) return []
  const rows = await getDb()
    .select({ slug: problemSlugHistory.slug })
    .from(problemSlugHistory)
    .where(or(...prefixes.map((p) => sql.like(problemSlugHistory.slug, `${p}%`))))
  return rows.map((r) => r.slug)
}
