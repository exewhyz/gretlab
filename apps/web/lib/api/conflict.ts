import { sql } from "@workspace/db"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { ApiError } from "./route"

/*
 * Save conflicts. A form sends the `updatedAt` it was opened with; saving refuses when the
 * record changed since, so two tabs or two teachers can't silently overwrite each other.
 * Leaving it out (a new record, or "keep mine") saves regardless.
 */

/**
 * A where-condition: unchanged since `expected`. Postgres keeps microseconds and JSON
 * milliseconds, so both sides are compared at milliseconds.
 */
export const unchangedSince = (column: AnyPgColumn, expected?: Date) =>
  expected
    ? sql.sql`date_trunc('milliseconds', ${column}) = ${expected.toISOString()}::timestamptz`
    : undefined

export const editedElsewhere = () =>
  new ApiError(
    409,
    "edited_elsewhere",
    "Someone saved this since you opened it."
  )
