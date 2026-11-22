/**
 * Lists in queries at any size (lists.ts), against a real Postgres: `pnpm --filter
 * @workspace/db test:lists` with DATABASE_URL set (e2e/run.sh runs it on gretlab_test). Each
 * test works in a temporary table inside a transaction it rolls back, so nothing is kept.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"

import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core"

import { getDb, sql } from "./index.ts"

const { and, eq, inArray, notInArray } = sql
const db = getDb()

/** Same name as the temporary table each test makes, which hides any real one. */
const rows = pgTable("lists_check", {
  id: uuid("id").notNull(),
  name: text("name").notNull(),
  n: integer("n").notNull(),
})

class Rollback extends Error {}

/** Runs `body` with three rows in a fresh temporary table, then throws everything away. */
async function withRows(
  body: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ids: string[]
  ) => Promise<void>
) {
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  await db
    .transaction(async (tx) => {
      await tx.execute(
        sql.sql`create temporary table lists_check (id uuid not null, name text not null, n integer not null) on commit drop`
      )
      await tx
        .insert(rows)
        .values(ids.map((id, i) => ({ id, name: `row ${i}`, n: i })))
      await body(tx, ids)
      throw new Rollback()
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error
    })
}

/** More values than Postgres takes as separate parameters (65,535). */
const strangers = (count: number) =>
  Array.from({ length: count }, () => randomUUID())

after(async () => {
  // postgres.js keeps the pool open; end the process once the tests are done.
  setImmediate(() => process.exit(process.exitCode ?? 0))
})

test("inArray finds rows in a list of 100,000 ids", async () => {
  await withRows(async (tx, ids) => {
    const list = [...strangers(100_000), ids[0]!, ids[2]!]
    const found = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(inArray(rows.id, list))
    assert.deepEqual(new Set(found.map((r) => r.id)), new Set([ids[0], ids[2]]))
  })
})

test("notInArray leaves out the rows in a list of 100,000 ids", async () => {
  await withRows(async (tx, ids) => {
    const list = [...strangers(100_000), ids[1]!]
    const found = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(notInArray(rows.id, list))
    assert.deepEqual(new Set(found.map((r) => r.id)), new Set([ids[0], ids[2]]))
  })
})

test("an empty list matches nothing, and excludes nothing", async () => {
  await withRows(async (tx) => {
    assert.equal(
      (await tx.select().from(rows).where(inArray(rows.id, []))).length,
      0
    )
    assert.equal(
      (await tx.select().from(rows).where(notInArray(rows.id, []))).length,
      3
    )
  })
})

test("text and integer columns get lists of their own type", async () => {
  await withRows(async (tx) => {
    const byName = await tx
      .select()
      .from(rows)
      .where(inArray(rows.name, ["row 1", "nobody"]))
    assert.deepEqual(
      byName.map((r) => r.n),
      [1]
    )
    const byNumber = await tx
      .select()
      .from(rows)
      .where(inArray(rows.n, [0, 2]))
    assert.deepEqual(byNumber.map((r) => r.n).sort(), [0, 2])
  })
})

test("a subquery still works, combined with other conditions", async () => {
  await withRows(async (tx, ids) => {
    const firstTwo = tx
      .select({ id: rows.id })
      .from(rows)
      .where(inArray(rows.n, [0, 1]))
    const found = await tx
      .select({ id: rows.id })
      .from(rows)
      .where(and(inArray(rows.id, firstTwo), eq(rows.name, "row 1")))
    assert.deepEqual(
      found.map((r) => r.id),
      [ids[1]]
    )
  })
})
