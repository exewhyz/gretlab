import { contentShares, getDb, problems, questions, sql } from "@workspace/db"

/*
 * Who may use library content in their own work (assignments, exams, contests, the daily
 * challenge). An owner (the platform, or one college) always uses its own. Anyone else uses
 * a published item when it's shared with everyone, or shared with their college or with
 * them ("selected"). Practice is separate: public library problems stay public.
 */

const { and, eq, isNull, or } = sql

type Item = typeof problems | typeof questions

const ownedBy = (table: Item, orgId: string | null) =>
  orgId === null ? isNull(table.orgId) : eq(table.orgId, orgId)

/** Shared with this college or this person. */
function sharedTo(table: Item, kind: "problem" | "question", orgId: string | null, userId?: string) {
  const targets = [
    orgId ? sql.sql`${contentShares.orgId} = ${orgId}` : null,
    userId ? sql.sql`${contentShares.userId} = ${userId}` : null,
  ].filter(Boolean)
  if (targets.length === 0) return sql.sql`false`
  return sql.sql`exists (select 1 from ${contentShares} where ${contentShares.itemType} = ${kind} and ${contentShares.itemId} = ${table.id} and (${sql.sql.join(targets as ReturnType<typeof sql.sql>[], sql.sql` or `)}))`
}

/** A where-condition: items this owner (and person) may use. */
export function usableBy(
  table: Item,
  kind: "problem" | "question",
  orgId: string | null,
  userId?: string
) {
  return or(
    ownedBy(table, orgId),
    and(
      eq(table.published, true),
      or(
        eq(table.sharing, "everyone"),
        and(eq(table.sharing, "selected"), sharedTo(table, kind, orgId, userId))
      )
    )
  )!
}

/** Where an item comes from, as a library shows it. */
export function sourceOf(itemOrgId: string | null, ownerOrgId: string | null) {
  if (itemOrgId === ownerOrgId) return "ours" as const
  return itemOrgId === null ? ("platform" as const) : ("shared" as const)
}

/** Which of these items this owner (and person) may use. */
export async function usableIds(
  kind: "problem" | "question",
  ids: string[],
  orgId: string | null,
  userId?: string
) {
  if (ids.length === 0) return new Set<string>()
  const table = kind === "problem" ? problems : questions
  const rows = await getDb()
    .select({ id: table.id })
    .from(table)
    .where(and(sql.inArray(table.id, ids), usableBy(table, kind, orgId, userId)))
  return new Set(rows.map((r) => r.id))
}
