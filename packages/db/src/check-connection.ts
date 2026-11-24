/**
 * Checks a database the way the web app uses it: the same client and settings (DATABASE_URL,
 * DATABASE_PREPARE, DATABASE_POOL), parallel queries that repeat with different values, a join,
 * a transaction that writes and is rolled back, and many queries with values at once on a
 * single connection (what Supabase's pooler hung on when they were pipelined, supabase/supavisor
 * #1239: it should finish at once; a hang is reported after 20 seconds). Changes nothing. Used before pointing the
 * site at a new database (deploy/move-to-mumbai.md):
 *
 *   cd packages/db && DATABASE_URL='<transaction pooler>' DATABASE_PREPARE=false \
 *     pnpm exec tsx src/check-connection.ts
 */
import { count, desc, eq, sql } from "drizzle-orm"

import {
  connectTo,
  getDb,
  organizations,
  problems,
  submissions,
  users,
} from "./index.ts"

const db = getDb()
const started = Date.now()
const ms = () => `${Date.now() - started} ms`

class RolledBack extends Error {}

try {
  const [clock] = (await db.execute(
    sql`select now()::text as now`
  )) as unknown as { now: string }[]
  console.log(`connected (${ms()}), database clock ${clock?.now}`)

  // The same statement many times at once with different values: with prepared statements
  // behind a transaction pooler, this is what fails ("prepared statement … does not exist").
  const slugs = await db
    .select({ slug: problems.slug })
    .from(problems)
    .limit(20)
  await Promise.all(
    slugs.map(({ slug }) =>
      db
        .select({ id: problems.id })
        .from(problems)
        .where(eq(problems.slug, slug))
    )
  )
  console.log(`${slugs.length} parallel lookups ok (${ms()})`)

  const [people] = await db.select({ n: count() }).from(users)
  const [orgs] = await db.select({ n: count() }).from(organizations)
  const latest = await db
    .select({ id: submissions.id, verdict: submissions.verdict })
    .from(submissions)
    .orderBy(desc(submissions.createdAt))
    .limit(3)
  console.log(
    `${people?.n} users, ${orgs?.n} organizations, latest submissions: ${latest.map((s) => s.verdict).join(", ") || "none"} (${ms()})`
  )

  // A write inside a transaction, then rolled back: nothing is kept.
  await db
    .transaction(async (tx) => {
      await tx.execute(
        sql`create temporary table connection_check (x int) on commit drop`
      )
      await tx.execute(sql`insert into connection_check values (1)`)
      throw new RolledBack()
    })
    .catch((error) => {
      if (!(error instanceof RolledBack)) throw error
    })
  console.log(`transaction ok, rolled back (${ms()})`)

  // Many queries with values at once on one connection: they queue on it one at a time
  // (max_pipeline 1 behind a pooler). Pipelined through Supavisor's transaction mode, these hung.
  const single = connectTo(process.env.DATABASE_URL ?? "", {}, { max: 1 })
  const many = Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      single
        .select({ id: problems.id })
        .from(problems)
        .where(eq(problems.slug, `check-${i}`))
    )
  )
  const hung = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "40 queries on one connection hung for 20 seconds (pipelining through the pooler)"
          )
        ),
      20_000
    )
  )
  await Promise.race([many, hung])
  console.log(`40 queries with values on one connection ok (${ms()})`)
  console.log("All checks passed.")
  process.exit(0)
} catch (error) {
  // Drizzle wraps the driver's error ("Failed query: …"); the reason is in its cause.
  const cause = error instanceof Error ? (error.cause ?? error) : error
  const code = (cause as { code?: string } | null)?.code
  console.error(
    "FAILED:",
    cause instanceof Error ? cause.message : cause,
    code ? `(${code})` : ""
  )
  process.exit(1)
}
