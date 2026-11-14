import { sql } from "@workspace/db"

/** Whose rows a loader reads: one person, these people, or (left out) everyone. */
export type Who = string | readonly string[] | undefined

/** The WHERE part for `Who` on a user id column: nothing for everyone, nobody for []. */
export function forUsers(column: sql.Column, who: Who) {
  if (who === undefined) return undefined
  if (typeof who === "string") return sql.eq(column, who)
  return who.length ? sql.inArray(column, [...who]) : sql.sql`false`
}
