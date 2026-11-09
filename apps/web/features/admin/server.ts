import {
  contests,
  getDb,
  languageConfigs,
  problems,
  runners,
  sql,
  submissions,
  users,
  type Submission,
  type User,
} from "@workspace/db"
import { z } from "zod"

import { ApiError, notFound } from "@/lib/api/route"
import { platformAccess } from "@/features/platform/access"
import { writePlatformAudit } from "@/features/platform/staff"
import { invalidateLanguages } from "@/features/settings/server"

const { and, asc, count, desc, eq, gte, ilike, lt, or } = sql

export const languageUpdateSchema = z.object({
  enabled: z.boolean(),
  timeLimitMs: z.number().int().min(100).max(60_000),
  memoryLimitMb: z.number().int().min(32).max(4096),
})

export async function updateLanguage(
  id: string,
  input: z.infer<typeof languageUpdateSchema>
) {
  await getDb()
    .insert(languageConfigs)
    .values({ id, ...input })
    .onConflictDoUpdate({ target: languageConfigs.id, set: input })
  invalidateLanguages()
}

/** Blocking and unblocking. Platform roles are given on the Staff page, under its rules. */
export const userUpdateSchema = z.object({
  disabled: z.boolean(),
})

export async function listUsers(search: string | null) {
  const db = getDb()
  const filter = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
    : undefined
  return db
    .select()
    .from(users)
    .where(filter)
    .orderBy(asc(users.email))
    .limit(200)
}

export async function updateUser(
  actor: User,
  id: string,
  input: z.infer<typeof userUpdateSchema>
) {
  // Otherwise the last admin could lock everyone out of the dashboard.
  if (actor.id === id) {
    throw new ApiError(400, "self_change", "You can't change your own account.")
  }
  const [target] = await getDb().select().from(users).where(eq(users.id, id))
  if (!target) throw notFound("User not found")
  // Blocking staff takes their access away: only for people whose access you hold.
  const [mine, theirs] = await Promise.all([platformAccess(actor), platformAccess(target)])
  if (
    (theirs.owner && !mine.owner) ||
    !theirs.permissions.every((p) => mine.permissions.includes(p))
  ) {
    throw new ApiError(403, "forbidden", "You can't block someone with more access than you.")
  }
  const [user] = await getDb()
    .update(users)
    .set({ disabled: input.disabled })
    .where(eq(users.id, id))
    .returning()
  await writePlatformAudit(
    actor,
    input.disabled ? "user.block" : "user.unblock",
    `${input.disabled ? "Blocked" : "Unblocked"} ${target.email}`
  )
  return user!
}

/** A runner silent for longer than this is treated as down. */
const RUNNER_ONLINE_MS = 60_000

/** Everything an autoscaler or the dashboard needs about the queue and its capacity. */
export async function getQueueHealth() {
  const db = getDb()
  const [rows] = await db.execute<{
    queued: string
    running: string
    oldest_seconds: string | null
  }>(sql.sql`
    SELECT
      count(*) FILTER (WHERE status = 'queued') AS queued,
      count(*) FILTER (WHERE status = 'running') AS running,
      EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status = 'queued')) AS oldest_seconds
    FROM submissions WHERE status <> 'done'
  `)
  const [recent] = await db.execute<{
    finished: string
    p50: string | null
    p95: string | null
  }>(sql.sql`
    SELECT
      count(*) AS finished,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM started_at - created_at)) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM started_at - created_at)) AS p95
    FROM submissions
    WHERE finished_at > now() - interval '5 minutes' AND started_at IS NOT NULL
  `)
  const online = (
    await db.select().from(runners).orderBy(asc(runners.host))
  ).filter(
    (runner) => Date.now() - runner.lastSeenAt.getTime() < RUNNER_ONLINE_MS
  )
  return {
    queued: Number(rows?.queued ?? 0),
    running: Number(rows?.running ?? 0),
    oldestQueuedSeconds: Math.round(Number(rows?.oldest_seconds ?? 0)),
    finishedLast5Min: Number(recent?.finished ?? 0),
    waitP50Seconds: Number(recent?.p50 ?? 0),
    waitP95Seconds: Number(recent?.p95 ?? 0),
    runners: online.map(({ id, host, slots, busy }) => ({
      id,
      host,
      slots,
      busy,
    })),
    slots: online.reduce((sum, runner) => sum + runner.slots, 0),
    busySlots: online.reduce((sum, runner) => sum + runner.busy, 0),
  }
}

export async function getOverview() {
  const db = getDb()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000)
  const total = async (
    table: typeof users | typeof problems | typeof contests
  ) => (await db.select({ total: count() }).from(table))[0]?.total ?? 0
  const [userCount, problemCount, contestCount, queue, verdicts] =
    await Promise.all([
      total(users),
      total(problems),
      total(contests),
      getQueueHealth(),
      db
        .select({ verdict: submissions.verdict, total: count() })
        .from(submissions)
        .where(
          and(
            gte(submissions.createdAt, dayAgo),
            eq(submissions.status, "done"),
            eq(submissions.kind, "submit")
          )
        )
        .groupBy(submissions.verdict),
    ])
  return {
    users: userCount,
    problems: problemCount,
    contests: contestCount,
    queue,
    verdictsLast24h: verdicts.map((item) => ({
      verdict: item.verdict ?? "unknown",
      total: item.total,
    })),
  }
}

export interface SubmissionFilters {
  kind: "submit" | "run" | "all"
  verdict: string | null
  search: string | null
  contest: string | null
}

const SUBMISSION_PAGE = 50

export async function listAllSubmissions(
  filters: SubmissionFilters,
  before: Date | null
) {
  const conditions = []
  if (filters.kind !== "all") {
    conditions.push(eq(submissions.kind, filters.kind))
  }
  if (filters.verdict) {
    conditions.push(
      eq(
        submissions.verdict,
        filters.verdict as NonNullable<Submission["verdict"]>
      )
    )
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(problems.title, pattern)
      )
    )
  }
  if (filters.contest) conditions.push(eq(contests.slug, filters.contest))
  if (before) conditions.push(lt(submissions.createdAt, before))

  const rows = await getDb()
    .select({
      id: submissions.id,
      kind: submissions.kind,
      language: submissions.language,
      status: submissions.status,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      runtimeMs: submissions.runtimeMs,
      memoryKb: submissions.memoryKb,
      passedTests: submissions.passedTests,
      totalTests: submissions.totalTests,
      createdAt: submissions.createdAt,
      email: users.email,
      name: users.name,
      problem: problems.title,
      contest: contests.title,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .leftJoin(problems, eq(submissions.problemId, problems.id))
    .leftJoin(contests, eq(submissions.contestId, contests.id))
    .where(and(...conditions))
    .orderBy(desc(submissions.createdAt))
    .limit(SUBMISSION_PAGE + 1)
  const page = rows.slice(0, SUBMISSION_PAGE)
  return {
    rows: page,
    next:
      rows.length > SUBMISSION_PAGE
        ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
        : null,
  }
}
