/**
 * The queue's guarantees, against a real Postgres. Needs DATABASE_URL pointing at a
 * throwaway database: it deletes every submission.
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { getDb, runners, sql, submissions, users } from "@workspace/db"

import {
  claimNext,
  heartbeat,
  processSubmission,
  releaseExpired,
} from "./queue.ts"
import type { SandboxBackend } from "./sandbox/types.ts"

const db = getDb()
let userId = ""

async function enqueue(
  overrides: Partial<typeof submissions.$inferInsert> = {}
) {
  const [row] = await db
    .insert(submissions)
    .values({
      userId,
      kind: "run",
      language: "python",
      entry: "main.py",
      files: [{ path: "main.py", content: "print(1)" }],
      stdin: "",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      ...overrides,
    })
    .returning()
  if (!row) throw new Error("insert failed")
  return row
}
const clear = () => db.delete(submissions)

before(async () => {
  await clear()
  const [user] = await db
    .insert(users)
    .values({ email: "queue-test@example.com", name: "Q" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Q" } })
    .returning()
  userId = user?.id ?? ""
})
after(async () => {
  await clear()
  await db.delete(runners)
  process.exit(0)
})

test("100 parallel claims: every job goes to exactly one runner", async () => {
  await clear()
  await Promise.all(Array.from({ length: 50 }, () => enqueue()))
  const claims = await Promise.all(
    Array.from({ length: 100 }, (_, i) => claimNext(db, `r${i}`, 4096))
  )
  const won = claims.filter((job) => job !== null)
  assert.equal(won.length, 50)
  assert.equal(new Set(won.map((job) => job.id)).size, 50)
})

test("order follows the due time: contest work overtakes older plain runs", async () => {
  await clear()
  const now = Date.now()
  const run = await enqueue({ queueAt: new Date(now + 10_000) })
  const contest = await enqueue({ kind: "submit", queueAt: new Date(now) })
  assert.equal((await claimNext(db, "a", 4096))?.id, contest.id)
  assert.equal((await claimNext(db, "a", 4096))?.id, run.id)
})

test("a job too big for free memory is left for later, and smaller ones go ahead", async () => {
  await clear()
  const now = Date.now()
  const big = await enqueue({ memoryLimitMb: 2048, queueAt: new Date(now) })
  const small = await enqueue({
    memoryLimitMb: 256,
    queueAt: new Date(now + 1),
  })
  assert.equal((await claimNext(db, "a", 512))?.id, small.id)
  assert.equal(await claimNext(db, "a", 512), null)
  assert.equal((await claimNext(db, "a", 4096))?.id, big.id)
})

test("a dead runner's job returns to the queue; a live runner's doesn't", async () => {
  await clear()
  const dead = await enqueue()
  await claimNext(db, "dead-runner", 4096)
  const live = await enqueue()
  await claimNext(db, "live-runner", 4096)
  await db
    .update(submissions)
    .set({ lockedUntil: new Date(Date.now() - 1000) })
    .where(sql.eq(submissions.id, dead.id))
  await releaseExpired(db)
  const [back] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, dead.id))
  const [kept] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, live.id))
  assert.equal(back?.status, "queued")
  assert.equal(back?.lockedBy, null)
  assert.equal(kept?.status, "running")
})

test("heartbeats keep a long job's lease alive", async () => {
  await clear()
  await enqueue()
  const job = await claimNext(db, "r1", 4096)
  assert.ok(job)
  await db
    .update(submissions)
    .set({ lockedUntil: new Date(Date.now() + 100) })
    .where(sql.eq(submissions.id, job.id))
  await heartbeat(db, { id: "r1", host: "h", slots: 2 }, [job.id])
  const [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.ok((row?.lockedUntil?.getTime() ?? 0) > Date.now() + 10_000)
})

test("a job that keeps killing runners ends as a system error, not a loop", async () => {
  await clear()
  const job = await enqueue()
  for (let attempt = 0; attempt < 3; attempt++) {
    await claimNext(db, "doomed", 4096)
    await db
      .update(submissions)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(sql.eq(submissions.id, job.id))
    await releaseExpired(db)
  }
  const [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(row?.status, "done")
  assert.equal(row?.verdict, "SE")
})

const failingBackend = {
  verify: async () => {},
  sweepOrphans: async () => {},
  create: async () => {
    throw new Error("docker is down")
  },
} satisfies SandboxBackend

test("infrastructure failure: retried, then a system error", async () => {
  await clear()
  const job = await enqueue()
  const claimed = await claimNext(db, "r1", 4096)
  assert.ok(claimed)
  const silence = console.error
  console.error = () => {}
  await processSubmission(db, failingBackend, claimed, "r1")
  let [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(row?.status, "queued")
  for (let i = 0; i < 2; i++) {
    const again = await claimNext(db, "r1", 4096)
    assert.ok(again)
    await processSubmission(db, failingBackend, again, "r1")
  }
  console.error = silence
  ;[row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(row?.status, "done")
  assert.equal(row?.verdict, "SE")
})

test("a late result from a runner that lost its lease is ignored", async () => {
  await clear()
  const job = await enqueue()
  const slow = await claimNext(db, "slow", 4096)
  assert.ok(slow)
  await db
    .update(submissions)
    .set({ lockedUntil: new Date(Date.now() - 1000) })
    .where(sql.eq(submissions.id, job.id))
  await releaseExpired(db)
  const fast = await claimNext(db, "fast", 4096)
  assert.ok(fast)
  const silence = console.error
  console.error = () => {}
  await processSubmission(db, failingBackend, slow, "slow")
  console.error = silence
  const [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(row?.lockedBy, "fast")
  assert.equal(row?.status, "running")
})
