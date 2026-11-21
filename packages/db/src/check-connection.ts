/**
 * Checks a database the way the web app uses it: the same client and settings (DATABASE_URL,
 * DATABASE_PREPARE, DATABASE_POOL), parallel queries that repeat with different values, a join,
 * and a transaction that writes and is rolled back. Changes nothing. Used before pointing the
 * site at a new database (deploy/move-to-mumbai.md):
 *
 *   cd packages/db && DATABASE_URL='<transaction pooler>' DATABASE_PREPARE=false \
 *     pnpm exec tsx src/check-connection.ts
 */
import { count, desc, eq, sql } from "drizzle-orm"

import { getDb, organizations, problems, submissions, users } from "./index.ts"

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
  console.log("All checks passed.")
  process.exit(0)
} catch (error) {
  console.error("FAILED:", error instanceof Error ? error.message : error)
  process.exit(1)
}
