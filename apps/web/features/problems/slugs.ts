import { getDb, problemSlugHistory, problems, sql } from "@workspace/db"

import { ApiError } from "@/lib/api/errors"

import { RESERVED_SLUGS } from "./schemas"

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
 * Where a problem's old address leads now ("p2" → "integer-operations"), or undefined, for
 * proxy.ts, which answers old addresses with a real 308 before any page renders. Former and
 * current slugs are kept in memory and reloaded every 5 minutes; a slug that's neither (a
 * problem renamed moments ago, or an address that doesn't exist) is looked up on its own,
 * one indexed query, and remembered as unknown until the next reload, so a page like
 * /problems/topics never waits on the database. Reserved addresses are skipped outright.
 * The proxy runs apart from the API, so saves can't clear this directly.
 */
let slugMaps: {
  former: Map<string, string>
  current: Set<string>
  unknown: Set<string>
  at: number
} | null = null
/** Unknown slugs remembered between reloads, at most this many (bots try random ones). */
const MAX_UNKNOWN = 5000
let loading: Promise<void> | null = null

async function loadSlugMaps() {
  const db = getDb()
  const [former, current] = await Promise.all([
    db
      .select({ from: problemSlugHistory.slug, to: problems.slug })
      .from(problemSlugHistory)
      .innerJoin(problems, eq(problems.id, problemSlugHistory.problemId)),
    db.select({ slug: problems.slug }).from(problems),
  ])
  slugMaps = {
    former: new Map(former.map((r) => [r.from, r.to])),
    current: new Set(current.map((r) => r.slug)),
    unknown: new Set(),
    at: Date.now(),
  }
}

export async function formerSlugTarget(slug: string): Promise<string | undefined> {
  if (RESERVED_SLUGS.has(slug)) return undefined
  if (!slugMaps || Date.now() - slugMaps.at > 5 * 60 * 1000) {
    loading ??= loadSlugMaps().finally(() => (loading = null))
    await loading
  }
  const maps = slugMaps!
  const known = maps.former.get(slug)
  if (known !== undefined || maps.current.has(slug) || maps.unknown.has(slug)) return known
  const now = await currentSlug(slug)
  if (now) maps.former.set(slug, now)
  else if (maps.unknown.size < MAX_UNKNOWN) maps.unknown.add(slug)
  return now ?? undefined
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
