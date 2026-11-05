import {
  runners,
  sql,
  submissions,
  testCases,
  type Database,
  type StoredCaseResult,
  type Submission,
} from "@workspace/db"
import { QUEUE_CHANNEL, isLanguageId, type LanguageId } from "@workspace/judge"

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
export async function claimNext(
  db: Database,
  runnerId: string,
  freeMemoryMb: number
): Promise<Submission | null> {
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
          SELECT id FROM submissions
          WHERE status = 'queued' AND memory_limit_mb <= ${freeMemoryMb}
          ORDER BY queue_at
          FOR UPDATE SKIP LOCKED
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
  runner: { id: string; host: string; slots: number },
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
  const values = { ...runner, busy: jobIds.length, lastSeenAt: new Date() }
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
