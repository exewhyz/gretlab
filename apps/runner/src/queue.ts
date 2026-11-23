import {
  runners,
  sql,
  submissions,
  testCases,
  type Database,
  type StoredCaseResult,
  type Submission,
} from "@workspace/db"
import {
  QUEUE_CHANNEL,
  RUNNER_ONLINE_MS,
  isLanguageId,
  type LanguageId,
} from "@workspace/judge"

import { judge, type JudgeResult } from "./judge.ts"
import type { SandboxBackend } from "./sandbox/types.ts"

const { and, asc, eq, inArray, lt } = sql

/** Short, and renewed by heartbeats, so a dead runner's jobs return within a minute or so. */
export const LEASE_MS = Number(process.env.RUNNER_LEASE_MS ?? 30_000)
const MAX_ATTEMPTS = 3
const RETENTION_BATCH = 5000

function leaseEnd() {
  return new Date(Date.now() + LEASE_MS)
}

/**
 * Takes the job that's due first and fits in this runner's free memory. One statement and
 * SKIP LOCKED, so any number of runners can do this at once without blocking each other
 * or taking the same job.
 */
/**
 * The next job for this judge, oldest due first. `pool` is the organization whose own judge
 * this is (RUNNER_POOL), or null for a shared judge:
 * - an organization's work goes only to its own judges while one of them is online;
 * - with none of them online, it counts as shared work, so it never waits on a dead machine;
 * - an organization's judge takes its own work first, and when it has none, helps with
 *   shared work (never with another organization's that has judges of its own).
 */
export async function claimNext(
  db: Database,
  runnerId: string,
  freeMemoryMb: number,
  pool: string | null = null
): Promise<Submission | null> {
  const online = sql.sql`now() - make_interval(secs => ${RUNNER_ONLINE_MS / 1000})`
  // Shared work: the shared pool's, and any organization's whose own judges are all down.
  const shared = sql.sql`(s.pool_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM runners r WHERE r.pool_org_id = s.pool_org_id AND r.last_seen_at > ${online}))`
  const [submission] = await db
    .update(submissions)
    .set({
      status: "running",
      lockedBy: runnerId,
      lockedUntil: leaseEnd(),
      startedAt: new Date(),
      attempts: sql.sql`${submissions.attempts} + 1`,
    })
    .where(
      eq(
        submissions.id,
        sql.sql`(
          SELECT s.id FROM submissions s
          WHERE s.status = 'queued' AND s.memory_limit_mb <= ${freeMemoryMb}
            AND ${pool ? sql.sql`(s.pool_org_id = ${pool} OR ${shared})` : shared}
          ORDER BY ${pool ? sql.sql`(s.pool_org_id IS NOT DISTINCT FROM ${pool}) DESC,` : sql.sql``} s.queue_at
          FOR UPDATE OF s SKIP LOCKED
          LIMIT 1
        )`
      )
    )
    .returning()
  return submission ?? null
}

/** Proves this runner is alive, and keeps its claims from expiring. */
export async function heartbeat(
  db: Database,
  runner: {
    id: string
    host: string
    slots: number
    poolOrgId?: string | null
    /** The commit it was set up from (RUNNER_VERSION), shown on Dashboard › Judges. */
    version?: string | null
    /** Its machine's instance id, when started from the dashboard (RUNNER_MACHINE). */
    machineId?: string | null
  },
  jobIds: string[]
) {
  if (jobIds.length) {
    await db
      .update(submissions)
      .set({ lockedUntil: leaseEnd() })
      .where(
        and(
          inArray(submissions.id, jobIds),
          eq(submissions.lockedBy, runner.id)
        )
      )
  }
  // The database's clock, not this machine's: "online" and "idle" are judged against now() in
  // the database, and a judge whose clock drifts must not look online, or offline, by mistake.
  const now = sql.sql`now()`
  const values = {
    ...runner,
    busy: jobIds.length,
    lastSeenAt: now,
    // The login it judges as, shown on Dashboard › Judges (its own limited one, or not).
    login: sql.sql`current_user`,
    // With work now, it's busy now; without, it keeps when it last was (automatic scaling
    // ends a judge idle long enough).
    ...(jobIds.length ? { lastBusyAt: now } : {}),
  }
  await db
    .insert(runners)
    .values(values)
    .onConflictDoUpdate({ target: runners.id, set: values })
}

export async function deregister(db: Database, runnerId: string) {
  await db.delete(runners).where(eq(runners.id, runnerId))
}

/** Returns jobs from runners that died. Gives up after a few tries so one job can't loop. */
export async function releaseExpired(db: Database) {
  const expired = and(
    eq(submissions.status, "running"),
    lt(submissions.lockedUntil, new Date())
  )
  await db
    .update(submissions)
    .set({
      status: "done",
      verdict: "SE",
      finishedAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
    })
    .where(and(expired, sql.gte(submissions.attempts, MAX_ATTEMPTS)))
  const returned = await db
    .update(submissions)
    .set({ status: "queued", lockedBy: null, lockedUntil: null })
    .where(expired)
    .returning({ id: submissions.id })
  if (returned.length) await notifyQueue(db)
}

/** Rounds of re-judging a "System error", and how long to wait before each. */
const MAX_REJUDGES = 3
const REJUDGE_AFTER_MS = 2 * 60_000
const REJUDGE_WITHIN_MS = 7 * 86_400_000

/**
 * A graded submission that ended in "System error" failed because of us, not the student:
 * a while later it's judged again, keeping the time it was submitted, so it still counts
 * where it was in time (an exam's last submission, a contest). A few rounds at most.
 */
export async function retrySystemErrors(db: Database) {
  const now = Date.now()
  const retried = await db
    .update(submissions)
    .set({
      status: "queued",
      verdict: null,
      attempts: 0,
      rejudges: sql.sql`${submissions.rejudges} + 1`,
      lockedBy: null,
      lockedUntil: null,
      finishedAt: null,
    })
    .where(
      and(
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        eq(submissions.verdict, "SE"),
        lt(submissions.rejudges, MAX_REJUDGES),
        lt(submissions.finishedAt, new Date(now - REJUDGE_AFTER_MS)),
        sql.gt(submissions.createdAt, new Date(now - REJUDGE_WITHIN_MS))
      )
    )
    .returning({ id: submissions.id })
  if (retried.length) await notifyQueue(db)
  return retried.length
}

/** Provisional verdicts sent back to the sandbox per pass, so a backlog drains steadily. */
const PROVISIONAL_BATCH = 200

/**
 * Submissions graded in a browser while the server couldn't run them are judged again here,
 * once server execution is on for the platform and for the organization they belong to.
 * The sandbox's verdict replaces the provisional one.
 */
export async function rejudgeProvisional(db: Database, serverOn: boolean) {
  if (!serverOn) return 0
  const rows = await db.execute<{ id: string }>(sql.sql`
    UPDATE submissions SET
      status = 'queued', provisional = false, verdict = NULL, attempts = 0,
      locked_by = NULL, locked_until = NULL, finished_at = NULL, queue_at = now()
    WHERE id IN (
      SELECT s.id FROM submissions s
      LEFT JOIN contests c ON c.id = s.contest_id
      LEFT JOIN problems p ON p.id = s.problem_id
      LEFT JOIN organizations o ON o.id = COALESCE(c.org_id, p.org_id)
      WHERE s.provisional AND s.status = 'done'
        AND COALESCE((o.execution ->> 'server')::boolean, true)
      ORDER BY s.created_at
      LIMIT ${PROVISIONAL_BATCH}
      FOR UPDATE OF s SKIP LOCKED
    )
    RETURNING id
  `)
  const count = rows.length
  if (count) await notifyQueue(db)
  return count
}

export async function notifyQueue(db: Database) {
  await db.execute(sql.sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`)
}

/**
 * Housekeeping that any runner may do. Plain runs exist only to show a student their output,
 * so old ones are removed; graded submissions are the record and are kept.
 */
export async function pruneOldRuns(db: Database, retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000)
  await db.execute(sql.sql`
    DELETE FROM submissions WHERE id IN (
      SELECT id FROM submissions
      WHERE kind = 'run' AND status = 'done' AND created_at < ${cutoff.toISOString()}
      LIMIT ${RETENTION_BATCH}
    )
  `)
  await db
    .delete(runners)
    .where(lt(runners.lastSeenAt, new Date(Date.now() - 5 * 60_000)))
}

async function casesFor(db: Database, submission: Submission) {
  if (submission.kind === "run") {
    const runCases = submission.runCases ?? [
      { label: "Custom", input: submission.stdin ?? "", expected: null },
    ]
    return runCases.map((item) => ({
      id: undefined,
      input: item.input,
      expected: item.expected,
      isSample: false,
      points: 0,
      run: item,
    }))
  }
  if (!submission.problemId) throw new Error("A submit needs a problem")
  const rows = await db
    .select()
    .from(testCases)
    .where(eq(testCases.problemId, submission.problemId))
    .orderBy(asc(testCases.position))
  return rows.map((row) => ({
    id: row.id,
    input: row.input,
    expected: row.expected,
    isSample: row.isSample,
    points: row.points,
    run: null,
  }))
}

function toStored(
  cases: Awaited<ReturnType<typeof casesFor>>,
  result: JudgeResult
): StoredCaseResult[] {
  return result.cases.map((caseResult, index) => {
    const testCase = cases[index]
    return {
      testCaseId: testCase?.id ?? null,
      isSample: testCase?.isSample ?? false,
      verdict: caseResult.verdict,
      stdout: caseResult.stdout,
      stderr: caseResult.stderr,
      wallMs: caseResult.wallMs,
      maxRssKb: caseResult.maxRssKb,
      points: caseResult.verdict === "AC" ? (testCase?.points ?? 0) : 0,
      ...(testCase?.run ?? {}),
    }
  })
}

export async function processSubmission(
  db: Database,
  backend: SandboxBackend,
  submission: Submission,
  runnerId: string
) {
  // Only while this runner still holds the job: if its lease lapsed and another runner
  // took over, this late result must not overwrite that one.
  const mine = and(
    eq(submissions.id, submission.id),
    eq(submissions.lockedBy, runnerId)
  )
  const finish = (values: Partial<Submission>) =>
    db
      .update(submissions)
      .set({
        ...values,
        status: "done",
        finishedAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
      })
      .where(mine)

  try {
    if (!isLanguageId(submission.language)) {
      throw new Error(`Unknown language ${submission.language}`)
    }
    const language: LanguageId = submission.language
    const cases = await casesFor(db, submission)
    const result = await judge(backend, {
      language,
      files: submission.files,
      entry: submission.entry,
      cases: cases.map(({ id, input, expected }) => ({ id, input, expected })),
      timeLimitMs: submission.timeLimitMs,
      memoryLimitMb: submission.memoryLimitMb,
    })
    const results = toStored(cases, result)
    await finish({
      verdict: result.verdict,
      compileOutput: result.compileOutput,
      results,
      score: results.reduce((sum, item) => sum + item.points, 0),
      maxScore: cases.reduce((sum, item) => sum + item.points, 0),
      runtimeMs: results.length
        ? Math.max(...results.map((item) => item.wallMs))
        : null,
      memoryKb: results.length
        ? Math.max(...results.map((item) => item.maxRssKb ?? 0))
        : null,
      passedTests: results.filter((item) => item.verdict === "AC").length,
      totalTests: cases.length,
    })
  } catch (error) {
    // A judge exception means our infrastructure failed, not the student's code, so it's
    // worth another try. Details stay in this log; students only ever see "System error".
    console.error(`[runner] submission ${submission.id} failed:`, error)
    if (submission.attempts < MAX_ATTEMPTS) {
      await db
        .update(submissions)
        .set({ status: "queued", lockedBy: null, lockedUntil: null })
        .where(mine)
      await notifyQueue(db)
    } else {
      await finish({ verdict: "SE", results: [] })
    }
  }
}
