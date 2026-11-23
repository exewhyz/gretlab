/**
 * The judge's own database login (`gretlab_judge`, migration 0081): everything a judge does
 * works through it, and nothing else does. Judges run strangers' code, so a judge machine is the
 * likeliest to be taken over; whoever takes one must not get the people, grades or secrets.
 *
 * Needs DATABASE_URL pointing at a throwaway, seeded database, as an owner who may act as the
 * role (the test acts as it with `SET ROLE` at connection, so no password is involved).
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import {
  connectTo,
  getDb,
  judgeMachines,
  organizations,
  runners,
  settings,
  sql,
  submissions,
  testCases,
  users,
} from "@workspace/db"

import {
  claimNext,
  deregister,
  heartbeat,
  notifyQueue,
  processSubmission,
  pruneOldRuns,
  rejudgeProvisional,
  releaseExpired,
  retrySystemErrors,
} from "./queue.ts"
import type { SandboxBackend } from "./sandbox/types.ts"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const owner = getDb()
const judge = connectTo(url, { options: "-c role=gretlab_judge" })

const RUNNER = "role-test-runner"
const MACHINE = "i-roletest0000000"
let userId = ""
let problemId = ""
let orgId = ""

const down = {
  verify: async () => {},
  sweepOrphans: async () => {},
  create: async () => {
    throw new Error("no sandbox in this test")
  },
} satisfies SandboxBackend

/** Postgres's refusal: "permission denied for table …" (or column). */
async function refused(what: Promise<unknown>) {
  await assert.rejects(what, (error: unknown) => {
    const text = String(
      (error as { cause?: { message?: string } })?.cause?.message ??
        (error as Error)?.message
    )
    return /permission denied/.test(text)
  })
}

before(async () => {
  const [who] = await judge.execute<{ me: string }>(
    sql.sql`select current_user as me`
  )
  assert.equal(who?.me, "gretlab_judge", "the test acts as the judge's role")
  const [user] = await owner
    .insert(users)
    .values({ email: "role-test@example.com", name: "Role test" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Role test" } })
    .returning()
  userId = user!.id
  const [problem] = await owner
    .select({ id: testCases.problemId })
    .from(testCases)
    .limit(1)
  assert.ok(problem, "the database is seeded with problems and their tests")
  problemId = problem.id
  const [org] = await owner
    .insert(organizations)
    .values({ slug: "role-test-pool", name: "Role test pool" })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: { name: "Role test pool" },
    })
    .returning()
  orgId = org!.id
  await owner
    .insert(judgeMachines)
    .values({
      instanceId: MACHINE,
      size: "c7i-flex.large",
      stage: "draining",
    })
    .onConflictDoNothing()
})

after(async () => {
  // Closed even when a check failed, so a failure ends the run instead of hanging it.
  try {
    if (userId) await cleanUp()
  } finally {
    await judge.$client.end({ timeout: 2 })
    await owner.$client.end({ timeout: 2 })
  }
})

async function cleanUp() {
  await owner.delete(submissions).where(sql.eq(submissions.userId, userId))
  await owner.delete(runners).where(sql.eq(runners.id, RUNNER))
  await owner
    .delete(judgeMachines)
    .where(sql.eq(judgeMachines.instanceId, MACHINE))
  await owner.delete(organizations).where(sql.eq(organizations.id, orgId))
  await owner.delete(users).where(sql.eq(users.id, userId))
}

test("a judge's whole round works through its own login", async () => {
  // Starting: settings, and its pool's organization by address.
  await judge.select().from(settings)
  const [pool] = await judge
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql.eq(organizations.slug, "role-test-pool"))
  assert.equal(pool?.id, orgId)

  const [queued] = await owner
    .insert(submissions)
    .values({
      userId,
      problemId,
      kind: "submit",
      language: "python",
      entry: "main.py",
      files: [{ path: "main.py", content: "print(1)" }],
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    })
    .returning()

  await heartbeat(judge, { id: RUNNER, host: "role-test", slots: 1 }, [])
  const claimed = await claimNext(judge, RUNNER, 4096)
  assert.equal(claimed?.id, queued!.id, "it claims queued work")
  await heartbeat(judge, { id: RUNNER, host: "role-test", slots: 1 }, [
    claimed!.id,
  ])
  // Its tests are read, the sandbox fails, and the job goes back to the queue: every write a
  // result makes, without a sandbox.
  const quiet = console.error
  console.error = () => {}
  await processSubmission(judge, down, claimed!, RUNNER)
  const [back] = await owner
    .select({ status: submissions.status })
    .from(submissions)
    .where(sql.eq(submissions.id, queued!.id))
  assert.equal(back?.status, "queued")
  const again = await claimNext(judge, RUNNER, 4096)
  assert.equal(again?.id, queued!.id)
  await processSubmission(judge, down, { ...again!, attempts: 99 }, RUNNER)
  console.error = quiet
  const [done] = await owner
    .select({ status: submissions.status, verdict: submissions.verdict })
    .from(submissions)
    .where(sql.eq(submissions.id, queued!.id))
  assert.deepEqual(done, { status: "done", verdict: "SE" })

  // Housekeeping any judge does.
  await releaseExpired(judge)
  await retrySystemErrors(judge)
  await rejudgeProvisional(judge, true)
  await pruneOldRuns(judge, 7)
  // It may delete old plain runs, never graded work: that's the record.
  const gone = await judge
    .delete(submissions)
    .where(sql.eq(submissions.id, queued!.id))
    .returning({ id: submissions.id })
  assert.equal(gone.length, 0, "a graded submission can't be deleted")
  await notifyQueue(judge)

  // A dashboard machine: is it asked to drain, then says it drained.
  const [machine] = await judge
    .select({ stage: judgeMachines.stage })
    .from(judgeMachines)
    .where(sql.eq(judgeMachines.instanceId, MACHINE))
  assert.equal(machine?.stage, "draining")
  await judge
    .update(judgeMachines)
    .set({ stage: "drained", note: "", stageAt: new Date() })
    .where(sql.eq(judgeMachines.instanceId, MACHINE))

  await deregister(judge, RUNNER)
})

test("nothing else is open to it", async () => {
  // People, and everything about them.
  await refused(judge.select({ id: users.id }).from(users).limit(1))
  for (const table of [
    "two_factor",
    "audit_log",
    "org_members",
    "student_records",
    "org_api_keys",
    "email_outbox",
    "uploads",
    "lti_keys",
    "drafts",
  ]) {
    await refused(
      judge.execute(sql.sql`select 1 from ${sql.sql.identifier(table)} limit 1`)
    )
  }
  // Organizations: only their address and where their code may run.
  await refused(judge.execute(sql.sql`select name from organizations limit 1`))
  await refused(
    judge.execute(
      sql.sql`update organizations set execution = '{}' where id = ${orgId}`
    )
  )
  // Problems: only which organization owns one, never the statement or solutions.
  await refused(judge.execute(sql.sql`select code from problems limit 1`))
  await refused(
    judge.execute(sql.sql`update test_cases set expected = 'x' where false`)
  )
  // No new submissions, no settings changes, no machines it isn't.
  await refused(
    judge.execute(
      sql.sql`insert into submissions (user_id, kind, language, entry, files) values (${userId}, 'run', 'python', 'main.py', '[]')`
    )
  )
  await refused(judge.execute(sql.sql`delete from settings`))
  await refused(
    judge.execute(sql.sql`update judge_machines set size = 'x' where false`)
  )
  await refused(
    judge.execute(
      sql.sql`insert into judge_machines (instance_id, size) values ('i-x', 'x')`
    )
  )
  // And no new tables.
  await refused(judge.execute(sql.sql`create table role_test_owned (id int)`))
})
