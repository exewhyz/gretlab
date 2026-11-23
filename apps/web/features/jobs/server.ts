import { randomUUID } from "node:crypto"

import { after } from "next/server"

import { getDb, jobFiles, jobs, sql, type User } from "@workspace/db"
import { JOB_KEEP, JOB_LEASE_MS, jobAfterFailure } from "@workspace/judge"

import { notFound } from "@/lib/api/route"
import { reportError } from "@/lib/report-error"

import { KINDS, type JobKind, type JobRow } from "./kinds"

/*
 * Background jobs: long work (an export of a whole organization) done in small steps outside the
 * request that asked for it, so no request runs into the host's time limit. The queue is in
 * Postgres (`jobs`), like the email outbox and the judge queue; the rules are pure
 * (packages/judge/src/jobs.ts).
 *
 * Each step is about 1,000 rows and saves where the next one starts, in the same transaction
 * as its writes, so a process that dies loses at most one step. Jobs move forward from the
 * request that queued them (after it answers), the email cron, the uptime monitor's
 * /api/health/judge, and apps/worker when one runs: whichever comes first.
 */

const { and, eq, or, sql: q } = sql
type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export const JOBS_CHANNEL = "gretlab_jobs"

/** Queues a job, in the caller's transaction when it passes one. */
export async function enqueue(
  db: Db | Tx,
  job: {
    kind: keyof typeof KINDS
    orgId: string | null
    userId: string
    input: Record<string, unknown>
  }
) {
  const [row] = await db
    .insert(jobs)
    .values({
      kind: job.kind,
      orgId: job.orgId,
      createdBy: job.userId,
      input: job.input,
    })
    .returning({ id: jobs.id })
  await db.execute(q`select pg_notify(${JOBS_CHANNEL}, '')`)
  return row!.id
}

/** Starts on the queue right after the response (20 s at most), as the outbox does. */
export function kickJobs(budgetMs = 20_000) {
  const run = () => runJobs(budgetMs).catch(() => {})
  try {
    after(run)
  } catch {
    void run()
  }
}

async function claim(runner: string): Promise<JobRow | null> {
  const [row] = (await getDb().execute(q`
    update jobs set status = 'running', locked_by = ${runner},
      locked_until = now() + make_interval(secs => ${JOB_LEASE_MS / 1000}),
      attempts = attempts + 1
    where id = (
      select id from jobs
      where (status = 'queued' and next_attempt_at <= now())
         or (status = 'running' and locked_until < now())
      order by created_at
      for update skip locked
      limit 1
    )
    returning id, kind, org_id as "orgId", created_by as "createdBy", input, cursor, progress,
      total, attempts`)) as unknown as JobRow[]
  return row ?? null
}

/** The step's outcome is saved only while this runner still holds the job. */
const mine = (id: string, runner: string) =>
  and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.lockedBy, runner))

class LostJob extends Error {}

async function stepOnce(runner: string, job: JobRow) {
  const kind: JobKind | undefined = KINDS[job.kind as keyof typeof KINDS]
  try {
    if (!kind) throw new Error(`Unknown job kind ${job.kind}`)
    await getDb().transaction(async (tx) => {
      const out = await kind.step(tx, job)
      const [saved] = await tx
        .update(jobs)
        .set({
          cursor: out.cursor,
          progress: out.progress,
          total: out.total ?? job.total,
          // A step that worked starts the count of tries afresh.
          attempts: 0,
          ...(out.done
            ? {
                status: "done" as const,
                result: out.result ?? null,
                finishedAt: new Date(),
                lockedBy: null,
                lockedUntil: null,
              }
            : {
                status: "queued" as const,
                nextAttemptAt: new Date(),
                lockedBy: null,
                lockedUntil: null,
              }),
        })
        .where(mine(job.id, runner))
        .returning({ id: jobs.id })
      // Cancelled, or taken over after the lease ran out: none of this step counts.
      if (!saved) throw new LostJob()
    })
  } catch (error) {
    if (error instanceof LostJob) return
    const ref = reportError(error, {
      where: "job",
      kind: job.kind,
      job: job.id,
    })
    const next = jobAfterFailure(job.attempts)
    await getDb()
      .update(jobs)
      .set({
        status: next.status,
        lastError: `Something went wrong (ref ${ref}).`,
        nextAttemptAt: new Date(Date.now() + (next.retryInMs ?? 0)),
        lockedBy: null,
        lockedUntil: null,
        ...(next.status === "failed" ? { finishedAt: new Date() } : {}),
      })
      .where(mine(job.id, runner))
  }
}

/**
 * Runs steps until the budget is nearly spent (each step is short: about 1,000 rows) or the
 * queue is empty. Any number of processes may run this at once.
 */
export async function runJobs(budgetMs: number) {
  const runner = `web-${randomUUID().slice(0, 8)}`
  const stopAt = Date.now() + budgetMs
  let steps = 0
  // Leaves room for one more step after the last check, as the outbox's drain does.
  while (Date.now() < stopAt - Math.min(8_000, budgetMs / 3)) {
    const job = await claim(runner)
    if (!job) break
    await stepOnce(runner, job)
    steps++
  }
  return { steps }
}

/** Finished jobs go after 30 days, their files after a day. */
export async function tidyJobs() {
  const db = getDb()
  await db.execute(q`
    delete from job_files where created_at < now() - make_interval(hours => ${JOB_KEEP.fileHours})`)
  await db.execute(q`
    delete from jobs where finished_at < now() - make_interval(days => ${JOB_KEEP.jobsDays})`)
}

/** Waiting and failed, for Dashboard › Monitoring. */
export async function jobsHealth() {
  const [row] = (await getDb().execute(q`
    select count(*) filter (where status in ('queued', 'running')) as waiting,
      extract(epoch from now() - min(created_at) filter (where status = 'queued')) as oldest,
      count(*) filter (where status = 'failed' and finished_at > now() - interval '1 day') as failed
    from jobs where status in ('queued', 'running') or finished_at > now() - interval '1 day'`)) as unknown as {
    waiting: string
    oldest: string | null
    failed: string
  }[]
  return {
    waiting: Number(row?.waiting ?? 0),
    oldestSeconds: Math.round(Number(row?.oldest ?? 0)),
    failedLastDay: Number(row?.failed ?? 0),
  }
}

/* ---------- what the person who started it sees ---------- */

/** A job is only ever its starter's: anyone else is told it doesn't exist. */
async function ownJob(user: User, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Job not found")
  const [row] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.createdBy, user.id)))
  if (!row) throw notFound("Job not found")
  return row
}

export async function jobView(user: User, id: string) {
  const job = await ownJob(user, id)
  const [file] = await getDb()
    .select({ name: jobFiles.name })
    .from(jobFiles)
    .where(eq(jobFiles.jobId, job.id))
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    total: job.total,
    result: job.result,
    /** Why it's being retried or failed (a reference, never internals). */
    error: job.lastError,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    file: job.status === "done" && file ? { name: file.name } : null,
  }
}

export async function cancelJob(user: User, id: string) {
  const job = await ownJob(user, id)
  await getDb()
    .update(jobs)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
    })
    .where(
      and(
        eq(jobs.id, job.id),
        or(eq(jobs.status, "queued"), eq(jobs.status, "running"))
      )
    )
  return jobView(user, id)
}

export async function jobFile(user: User, id: string) {
  const job = await ownJob(user, id)
  const [file] = await getDb()
    .select()
    .from(jobFiles)
    .where(eq(jobFiles.jobId, job.id))
  if (!file || job.status !== "done")
    throw notFound("The file isn't ready, or has expired")
  return file
}
