/**
 * The queue's guarantees, against a real Postgres. Needs DATABASE_URL pointing at a
 * throwaway database: it deletes every submission.
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import {
  getDb,
  organizations,
  runners,
  sql,
  submissions,
  users,
} from "@workspace/db"

import {
  claimNext,
  heartbeat,
  processSubmission,
  releaseExpired,
  retrySystemErrors,
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
  await db
    .delete(organizations)
    .where(sql.inArray(organizations.slug, ["pool-a", "pool-b", "pool-c"]))
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

test("a system error is judged again later, keeping when it was submitted", async () => {
  await clear()
  const submitted = new Date(Date.now() - 10 * 60_000)
  const failed = await enqueue({
    kind: "submit",
    status: "done",
    verdict: "SE",
    createdAt: submitted,
    finishedAt: new Date(Date.now() - 5 * 60_000),
  })
  const recent = await enqueue({
    kind: "submit",
    status: "done",
    verdict: "SE",
    finishedAt: new Date(),
  })
  const run = await enqueue({
    kind: "run",
    status: "done",
    verdict: "SE",
    finishedAt: new Date(Date.now() - 5 * 60_000),
  })
  assert.equal(await retrySystemErrors(db), 1)
  const rows = await db.select().from(submissions)
  const by = (id: string) => rows.find((r) => r.id === id)!
  assert.equal(by(failed.id).status, "queued")
  assert.equal(by(failed.id).rejudges, 1)
  assert.equal(by(failed.id).createdAt.getTime(), submitted.getTime())
  // Just failed: wait a little first. A plain run: nothing graded to save.
  assert.equal(by(recent.id).status, "done")
  assert.equal(by(run.id).status, "done")
})

test("re-judging gives up after a few rounds", async () => {
  await clear()
  await enqueue({
    kind: "submit",
    status: "done",
    verdict: "SE",
    rejudges: 3,
    finishedAt: new Date(Date.now() - 5 * 60_000),
  })
  assert.equal(await retrySystemErrors(db), 0)
})

/* ---------- pools: an organization's own judges (RUNNER_POOL) ---------- */

async function poolOrgs() {
  await db
    .delete(organizations)
    .where(sql.inArray(organizations.slug, ["pool-a", "pool-b", "pool-c"]))
  const made = await db
    .insert(organizations)
    .values(
      ["pool-a", "pool-b", "pool-c"].map((slug) => ({ slug, name: slug }))
    )
    .returning()
  const id = (slug: string) => made.find((o) => o.slug === slug)!.id
  return { a: id("pool-a"), b: id("pool-b"), c: id("pool-c") }
}
const online = (id: string, poolOrgId: string | null, ago = 0) =>
  db
    .insert(runners)
    .values({
      id,
      host: id,
      slots: 4,
      poolOrgId,
      // By the database's clock, which the queue judges "online" by (the Docker VM's clock can
      // drift minutes from this machine's).
      lastSeenAt: sql.sql`now() - make_interval(secs => ${ago / 1000})`,
    })
    .onConflictDoUpdate({
      target: runners.id,
      set: {
        poolOrgId,
        lastSeenAt: sql.sql`now() - make_interval(secs => ${ago / 1000})`,
      },
    })
const earlier = (ms: number) => new Date(Date.now() - ms)

test("pools: an organization's judge takes its own work first, ahead of older shared work", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  await online("judge-a", org.a)
  const shared = await enqueue({ queueAt: earlier(60_000) })
  const own = await enqueue({ poolOrgId: org.a, queueAt: earlier(1_000) })
  assert.equal((await claimNext(db, "judge-a", 4096, org.a))?.id, own.id)
  assert.equal((await claimNext(db, "judge-a", 4096, org.a))?.id, shared.id)
})

test("pools: while one of its judges is online, an organization's work never goes elsewhere", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  await online("judge-a", org.a)
  await online("judge-b", org.b)
  await enqueue({ poolOrgId: org.a })
  assert.equal(
    await claimNext(db, "shared-1", 4096, null),
    null,
    "not to a shared judge"
  )
  assert.equal(
    await claimNext(db, "judge-b", 4096, org.b),
    null,
    "not to another organization's judge"
  )
})

test("pools: with none of its judges online, an organization's work falls back to the shared judges", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  // Its judge stopped reporting two minutes ago.
  await online("judge-a", org.a, 120_000)
  const stranded = await enqueue({ poolOrgId: org.a })
  assert.equal((await claimNext(db, "shared-1", 4096, null))?.id, stranded.id)
})

test("pools: an idle organization judge helps the shared pool, and organizations without judges", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  await online("judge-a", org.a)
  const shared = await enqueue({ queueAt: earlier(2_000) })
  const noJudges = await enqueue({ poolOrgId: org.c, queueAt: earlier(1_000) })
  const helped = [
    await claimNext(db, "judge-a", 4096, org.a),
    await claimNext(db, "judge-a", 4096, org.a),
  ].map((job) => job?.id)
  assert.deepEqual(helped, [shared.id, noJudges.id])
})

test("pools: an organization judge never helps another organization that has its own judges", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  await online("judge-a", org.a)
  await online("judge-b", org.b)
  await enqueue({ poolOrgId: org.b })
  assert.equal(await claimNext(db, "judge-a", 4096, org.a), null)
})

test("pools: a shared judge keeps taking shared work in due order", async () => {
  await clear()
  await db.delete(runners)
  const org = await poolOrgs()
  await online("judge-a", org.a)
  await enqueue({ poolOrgId: org.a, queueAt: earlier(9_000) })
  const first = await enqueue({ queueAt: earlier(5_000) })
  const second = await enqueue({ poolOrgId: org.c, queueAt: earlier(1_000) })
  assert.equal((await claimNext(db, "shared-1", 4096, null))?.id, first.id)
  assert.equal((await claimNext(db, "shared-1", 4096, null))?.id, second.id)
  assert.equal(await claimNext(db, "shared-1", 4096, null), null)
})

test("a heartbeat records the judge's code version and machine", async () => {
  await db.delete(runners)
  await heartbeat(
    db,
    {
      id: "v-judge",
      host: "h",
      slots: 2,
      poolOrgId: null,
      version: "abc123",
      machineId: "i-0123",
    },
    []
  )
  const [row] = await db
    .select()
    .from(runners)
    .where(sql.eq(runners.id, "v-judge"))
  assert.equal(row?.version, "abc123")
  assert.equal(row?.machineId, "i-0123")
})

test("a heartbeat with work marks the judge busy now; one without leaves when it last was", async () => {
  await db.delete(runners)
  const self = { id: "b-judge", host: "h", slots: 2 }
  await heartbeat(db, self, [])
  const long = new Date(Date.now() - 60 * 60_000)
  await db
    .update(runners)
    .set({ lastBusyAt: long })
    .where(sql.eq(runners.id, "b-judge"))
  await heartbeat(db, self, [])
  const [quiet] = await db
    .select()
    .from(runners)
    .where(sql.eq(runners.id, "b-judge"))
  assert.equal(
    quiet?.lastBusyAt.getTime(),
    long.getTime(),
    "an idle heartbeat keeps the time"
  )
  const job = await enqueue()
  await heartbeat(db, self, [job.id])
  const [busy] = await db
    .select()
    .from(runners)
    .where(sql.eq(runners.id, "b-judge"))
  const [{ dbNow } = { dbNow: new Date(0) }] = await db.execute<{
    dbNow: Date
  }>(sql.sql`select now() as "dbNow"`)
  assert.ok(
    busy!.lastBusyAt.getTime() > new Date(dbNow).getTime() - 5_000,
    "a busy heartbeat moves it to now, by the database's clock"
  )
})
