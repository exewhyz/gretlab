import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.ts"

export * from "./schema.ts"
export * as sql from "drizzle-orm"

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    // PgBouncer in transaction mode can't track prepared statements.
    prepare: process.env.DATABASE_PREPARE !== "false",
  })
  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof connect>

// Kept on globalThis so Next.js hot reload doesn't open a new pool on every edit.
const holder = globalThis as unknown as { gretlabDb?: Database }

/** Connects on first use, so importing this during a build needs no database. */
export function getDb(): Database {
  holder.gretlabDb ??= connect()
  return holder.gretlabDb
}
