/**
 * The queue's guarantees, against a real Postgres. Needs DATABASE_URL pointing at a
 * throwaway database: it deletes every submission.
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import {
  getDb,
  organizations,
  problems,
  runners,
  sql,
  submissions,
  testCases,
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
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-groups"))
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

test("a job with a checker program counts its checker's memory too", async () => {
  await clear()
  const job = await enqueue({
    memoryLimitMb: 256,
    checker: { program: { language: "python", code: "pass" } },
  })
  assert.equal(await claimNext(db, "r1", 600), null, "256 + 512 doesn't fit in 600")
  assert.equal((await claimNext(db, "r1", 800))?.id, job.id)
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

/** A sandbox whose program prints its input back, counting the tests it ran. */
function echoBackend() {
  const ran: string[] = []
  const done = {
    stderr: "",
    exitCode: 0,
    wallMs: 1,
    maxRssKb: 1000,
    timedOut: false,
    outputLimitExceeded: false,
    sandboxDied: null,
  }
  const backend = {
    verify: async () => {},
    sweepOrphans: async () => {},
    create: async () => ({
      upload: async () => {},
      build: async () => ({ ...done, stdout: "" }),
      freeze: async () => {},
      run: async (_command: string[], options: { stdin?: string }) => {
        ran.push(options.stdin ?? "")
        return { ...done, stdout: options.stdin ?? "" }
      },
      destroy: async () => {},
    }),
  } satisfies SandboxBackend
  return { backend, ran }
}

test("groups: a group scores only when all its tests pass, and a failed group's rest are skipped", async () => {
  await clear()
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-groups"))
  const [problem] = await db
    .insert(problems)
    .values({ slug: "queue-test-groups", title: "Groups", statement: [] })
    .returning()
  // The program echoes its input, so a test passes when expected equals input.
  const tests: [string, string, string | null, number][] = [
    ["s", "s", null, 0], // a sample, ungrouped
    ["a1", "a1", "A", 10], // group A passes
    ["a2", "a2", "A", 10],
    ["b1", "b1", "B", 15], // group B fails on its second test
    ["b2", "nope", "B", 15],
    ["b3", "b3", "B", 15], // skipped, not run
    ["c", "nope", null, 5], // ungrouped, fails alone
    ["d", "d", null, 5],
  ]
  await db.insert(testCases).values(
    tests.map(([input, expected, group, points], position) => ({
      problemId: problem!.id,
      position,
      input,
      expected,
      group,
      points,
    }))
  )
  const job = await enqueue({ kind: "submit", problemId: problem!.id })
  const claimed = await claimNext(db, "r1", 4096)
  assert.equal(claimed?.id, job.id)
  const { backend, ran } = echoBackend()
  await processSubmission(db, backend, claimed!, "r1")
  const [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(row?.status, "done")
  assert.equal(row?.verdict, "WA")
  assert.deepEqual(ran, ["s", "a1", "a2", "b1", "b2", "c", "d"], "b3 isn't run")
  assert.deepEqual(
    row?.results?.map((r) => r.verdict),
    ["AC", "AC", "AC", "AC", "WA", "SK", "WA", "AC"]
  )
  assert.deepEqual(
    row?.results?.map((r) => r.points),
    [0, 10, 10, 0, 0, 0, 0, 5]
  )
  assert.equal(row?.results?.[1]?.group, "A")
  assert.equal(row?.results?.[0]?.group, undefined)
  assert.equal(row?.score, 25)
  assert.equal(row?.maxScore, 75)
})

test("checkers: the submission's checker decides how output is compared", async () => {
  await clear()
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-checker"))
  const [problem] = await db
    .insert(problems)
    .values({ slug: "queue-test-checker", title: "Checker", statement: [] })
    .returning()
  // The program echoes its input; the expected output differs from it within 1e-6.
  await db.insert(testCases).values({
    problemId: problem!.id,
    input: "0.3333333\nB 2",
    expected: "0.333333333\nb 2",
  })
  const judgeOne = async (checker: Record<string, unknown> | null) => {
    await clear()
    const job = await enqueue({ kind: "submit", problemId: problem!.id, checker })
    const claimed = await claimNext(db, "r1", 4096)
    await processSubmission(db, echoBackend().backend, claimed!, "r1")
    const [row] = await db
      .select({ verdict: submissions.verdict })
      .from(submissions)
      .where(sql.eq(submissions.id, job.id))
    return row?.verdict
  }
  assert.equal(await judgeOne(null), "WA", "exact by default")
  assert.equal(await judgeOne({ numbers: { absolute: 1e-6 } }), "WA", "case still counts")
  assert.equal(
    await judgeOne({ numbers: { absolute: 1e-6 }, ignoreCase: true }),
    "AC"
  )
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-checker"))
})

test("checker programs: run in their own sandbox with the three files, and decide each test", async () => {
  await clear()
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-program"))
  const [problem] = await db
    .insert(problems)
    .values({ slug: "queue-test-program", title: "Program", statement: [] })
    .returning()
  // The student's program echoes its input; the fake checker answers by what it printed.
  const tests: [string, number][] = [
    ["right", 4],
    ["half", 10],
    ["wrong", 3],
    ["none", 0], // a sample: no points
  ]
  for (const [i, [input, points]] of tests.entries())
    await db.insert(testCases).values({
      problemId: problem!.id,
      input,
      expected: `secret-${input}`,
      points,
      position: i,
      isSample: points === 0,
    })
  const sandboxes: { uploads: string[]; stdins: string[] }[] = []
  const done = {
    stderr: "",
    wallMs: 1,
    maxRssKb: 1000,
    timedOut: false,
    outputLimitExceeded: false,
    sandboxDied: null,
  }
  const backend = {
    verify: async () => {},
    sweepOrphans: async () => {},
    create: async () => {
      const seen = { uploads: [] as string[], stdins: [] as string[] }
      sandboxes.push(seen)
      let files: Record<string, string> = {}
      return {
        upload: async (list: { path: string; content: string }[]) => {
          for (const f of list) {
            seen.uploads.push(`${f.path}=${f.content}`)
            files[f.path] = f.content
          }
        },
        build: async () => ({ ...done, exitCode: 0, stdout: "" }),
        freeze: async () => {},
        run: async (_command: string[], options: { stdin?: string }) => {
          seen.stdins.push(options.stdin ?? "")
          if (!("answer.txt" in files))
            return { ...done, exitCode: 0, stdout: options.stdin ?? "" }
          const out = files["output.txt"]
          const ok = files["answer.txt"] === `secret-${files["input.txt"]}`
          if (!ok) return { ...done, exitCode: 2, stdout: "" }
          if (out === "right") return { ...done, exitCode: 0, stdout: "" }
          if (out === "half") return { ...done, exitCode: 3, stdout: "0.5\nhalf of it" }
          if (out === "wrong") return { ...done, exitCode: 1, stdout: "not a path" }
          return { ...done, exitCode: 1, stdout: "" }
        },
        destroy: async () => {
          files = {}
        },
      }
    },
  } satisfies SandboxBackend
  const job = await enqueue({
    kind: "submit",
    problemId: problem!.id,
    checker: { program: { language: "python", code: "import sys" } },
  })
  const claimed = await claimNext(db, "r1", 4096)
  await processSubmission(db, backend, claimed!, "r1")
  const [row] = await db
    .select()
    .from(submissions)
    .where(sql.eq(submissions.id, job.id))
  assert.equal(sandboxes.length, 2, "the student's sandbox and the checker's")
  const [student, checker] = sandboxes as [
    (typeof sandboxes)[number],
    (typeof sandboxes)[number],
  ]
  assert.ok(
    !student.uploads.some((u) => u.includes("secret")) &&
      !student.stdins.some((s) => s.includes("secret")),
    "expected outputs never reach the student's sandbox"
  )
  assert.ok(checker.uploads.includes("main.py=import sys"), "the checker's code")
  assert.ok(checker.uploads.includes("answer.txt=secret-half"))
  assert.deepEqual(
    row?.results?.map((r) => r.verdict),
    ["AC", "PC", "WA", "WA"]
  )
  assert.deepEqual(row?.results?.map((r) => r.points), [4, 5, 0, 0])
  assert.equal(row?.results?.[1]?.fraction, 0.5)
  assert.equal(row?.results?.[1]?.checkerMessage, "half of it")
  assert.equal(row?.results?.[2]?.checkerMessage, "not a path")
  assert.equal(row?.verdict, "PC")
  assert.equal(row?.score, 9)
  assert.equal(row?.passedTests, 1)
  await db.delete(problems).where(sql.eq(problems.slug, "queue-test-program"))
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
