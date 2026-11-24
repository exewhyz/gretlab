import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.ts"

export * from "./schema.ts"
export * as sql from "./sql.ts"
export { anyOf, noneOf } from "./lists.ts"

/**
 * A database client for an address. `startup` adds connection settings (tests use it to act as
 * another role, as the judge's login test does with `options: "-c role=gretlab_judge"`).
 */
export function connectTo(
  url: string,
  startup: Record<string, string> = {},
  { max = Number(process.env.DATABASE_POOL ?? 10) }: { max?: number } = {}
) {
  // DATABASE_PREPARE=false means a pooler in transaction mode (Supabase's, PgBouncer) sits in
  // between: it can't track prepared statements, and it mustn't get pipelined queries either.
  const pooled = process.env.DATABASE_PREPARE === "false"
  const client = postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: !pooled,
    // Without prepared statements a query with values goes in two steps (describe, then run).
    // Pipelined behind another query, Supavisor's transaction mode hands the database
    // connection back between them and the query hangs, holding a pooled connection
    // (supabase/supavisor#1239; the outages of 24 November 2026). One query at a time per
    // connection avoids it; queries in parallel use the pool's other connections.
    // postgres.js reads it (src/index.js, with its other numeric options) but its types omit it.
    ...({ max_pipeline: pooled ? 1 : 100 } as object),
    connection: startup,
  })
  return drizzle(client, { schema })
}

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return connectTo(url)
}

export type Database = ReturnType<typeof connect>

// Kept on globalThis so Next.js hot reload doesn't open a new pool on every edit.
const holder = globalThis as unknown as { gretlabDb?: Database }

/** Connects on first use, so importing this during a build needs no database. */
export function getDb(): Database {
  holder.gretlabDb ??= connect()
  return holder.gretlabDb
}
