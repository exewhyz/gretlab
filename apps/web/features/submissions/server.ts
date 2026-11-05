import {
  contestParticipants,
  contestProblems,
  contests,
  getDb,
  problems,
  sql,
  submissions,
  testCases,
  users,
  type RunCase,
  type Submission,
  type User,
} from "@workspace/db"
import {
  nextPollMs,
  QUEUE_CHANNEL,
  queueHeadStartMs,
  sourceFilesSchema,
  type LanguageId,
} from "@workspace/judge"

import { ApiError, isStaff, notFound } from "@/lib/api/route"
import { getLanguages, requireFeature } from "@/features/settings/server"
import { contestFor } from "@/features/contests/server"
import { accessTo, orgPolicy, viewpoint } from "@/features/orgs/access"
import { cached } from "@/lib/ttl-cache"

const { and, asc, count, desc, eq, gte, inArray, lt, ne } = sql

export interface CreateSubmission {
  kind: "run" | "submit"
  language: string
  entry: string
  files: unknown
  stdin?: string
  inputs?: string[]
  problemSlug?: string
  contestSlug?: string
}

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0]

/**
 * Must run in the transaction that inserts. The per-student lock is what makes "check, then
 * insert" safe: without it, parallel requests all pass the check before any has inserted.
 */
async function enforceRateLimits(
  tx: Transaction,
  user: User,
  perMinute: number,
  maxPending: number
) {
  await tx.execute(sql.sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`)
  const minuteAgo = new Date(Date.now() - 60_000)
  const [recent] = await tx
    .select({ total: count() })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, user.id),
        gte(submissions.createdAt, minuteAgo)
      )
    )
  const [pending] = await tx
    .select({ total: count() })
    .from(submissions)
    .where(and(eq(submissions.userId, user.id), ne(submissions.status, "done")))
  if ((recent?.total ?? 0) >= perMinute) {
    throw new ApiError(
      429,
      "rate_limited",
      "Too many runs in the last minute. Wait a moment and try again."
    )
  }
  if ((pending?.total ?? 0) >= maxPending) {
    throw new ApiError(
      429,
      "too_many_pending",
      "Your earlier runs are still in the queue. Wait for them to finish."
    )
  }
}

const QUEUE_DEPTH_TTL_MS = 1000
const BUSY_RETRY_SECONDS = 15

/**
 * Load shedding: past the limit, refuse work early and honestly rather than letting everyone
 * wait minutes. Graded work has a higher limit than casual runs, so it survives a spike.
 */
async function enforceCapacity(kind: "run" | "submit", maxDepth: number) {
  const depth = await cached("queue-depth", QUEUE_DEPTH_TTL_MS, async () => {
    const [row] = await getDb()
      .select({ total: count() })
      .from(submissions)
      .where(eq(submissions.status, "queued"))
    return row?.total ?? 0
  })
  if (depth >= (kind === "submit" ? maxDepth * 2 : maxDepth)) {
    throw new ApiError(
      503,
      "busy",
      "The lab is very busy right now. Please try again in a few seconds.",
      BUSY_RETRY_SECONDS
    )
  }
}

/** Platform staff write platform problems; an organization's writers write its own. */
export async function canEditProblem(
  user: User | null,
  problem: { orgId: string | null }
) {
  const vp = await viewpoint(user)
  return (
    accessTo(vp, { orgId: problem.orgId, audience: [] }, "problems.manage") ===
    "manage"
  )
}

/** Whether someone may open and practise a problem outside a contest. */
export async function canReachProblem(
  user: User | null,
  problem: { published: boolean; membersOnly: boolean; orgId: string | null }
) {
  if (problem.published && !problem.membersOnly) return true
  const vp = await viewpoint(user)
  const content = { orgId: problem.orgId, audience: [] as string[][] }
  if (accessTo(vp, content, "problems.manage") === "manage") return true
  // Published for members: any active member of its organization.
  return (
    problem.published &&
    problem.orgId !== null &&
    accessTo(vp, content, "problems.manage") === "take"
  )
}

/** Checks the contest rules, and returns the contest for a contest submission. */
async function resolveContest(
  user: User,
  contestSlug: string,
  problemId: string
) {
  await requireFeature("contests.enabled")
  const db = getDb()
  // The same check as the contest page: not a member of its audience means not found.
  const contest = await contestFor(contestSlug, user)
  const now = new Date()
  if (now < contest.startsAt) {
    throw new ApiError(
      403,
      "contest_not_started",
      "The contest hasn't started."
    )
  }
  if (now >= contest.endsAt) {
    throw new ApiError(403, "contest_over", "The contest has ended.")
  }
  const [registered] = await db
    .select({ userId: contestParticipants.userId })
    .from(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, contest.id),
        eq(contestParticipants.userId, user.id)
      )
    )
  if (!registered) {
    throw new ApiError(403, "not_registered", "Register for the contest first.")
  }
  const [listed] = await db
    .select({ problemId: contestProblems.problemId })
    .from(contestProblems)
    .where(
      and(
        eq(contestProblems.contestId, contest.id),
        eq(contestProblems.problemId, problemId)
      )
    )
  if (!listed) throw notFound("That problem isn't in this contest")
  return contest
}

const sameInput = (a: string, b: string) =>
  a.replace(/\r/g, "").trimEnd() === b.replace(/\r/g, "").trimEnd()

/**
 * A Run is only checked against an answer the server already publishes: an input that matches
 * a sample gets that sample's expected output, and anything else simply runs. So a Run can't be
 * used to probe hidden tests, and "passed" here always means a real comparison.
 */
async function resolveRunCases(
  inputs: string[],
  problemId: string | undefined
): Promise<RunCase[]> {
  const samples = problemId
    ? await getDb()
        .select({ input: testCases.input, expected: testCases.expected })
        .from(testCases)
        .where(
          and(eq(testCases.problemId, problemId), eq(testCases.isSample, true))
        )
        .orderBy(asc(testCases.position))
    : []
  let custom = 0
  return inputs.map((input) => {
    const index = samples.findIndex((row) => sameInput(row.input, input))
    const sample = samples[index]
    if (sample) {
      return {
        label: `Sample ${index + 1}`,
        input,
        expected: sample.expected,
      }
    }
    custom += 1
    return { label: `Custom ${custom}`, input, expected: null }
  })
}

export async function createSubmission(user: User, input: CreateSubmission) {
  const settings = await requireFeature("server_execution.enabled")

  const files = sourceFilesSchema.safeParse(input.files)
  if (!files.success) {
    throw new ApiError(
      400,
      "invalid_files",
      files.error.issues[0]?.message ?? "Invalid files"
    )
  }
  if (!files.data.some((file) => file.path === input.entry)) {
    throw new ApiError(400, "invalid_entry", "The file to run doesn't exist.")
  }

  const language = (await getLanguages()).find(
    (item) => item.id === input.language && item.enabled
  )
  if (!language) {
    throw new ApiError(
      400,
      "language_unavailable",
      "That language is turned off."
    )
  }
  if (!language.extensions.some((ext) => input.entry.endsWith(ext))) {
    throw new ApiError(
      400,
      "invalid_entry",
      `The file to run must end with ${language.extensions.join(" or ")}.`
    )
  }

  const db = getDb()
  let problem = null
  if (input.problemSlug) {
    ;[problem] = await db
      .select()
      .from(problems)
      .where(eq(problems.slug, input.problemSlug))
    if (!problem) throw notFound("Problem not found")
  }
  if (input.kind === "submit" && !problem) {
    throw new ApiError(
      400,
      "problem_required",
      "Choose a problem to submit to."
    )
  }

  let contestId: string | null = null
  // An organization's language rules cover its contests and its members-only problems.
  let ruledBy: string | null = null
  if (input.contestSlug) {
    if (!problem)
      throw new ApiError(400, "problem_required", "Choose a problem.")
    const contest = await resolveContest(user, input.contestSlug, problem.id)
    contestId = contest.id
    ruledBy = contest.orgId
  } else if (problem && !(await canReachProblem(user, problem))) {
    // Drafts are reachable only through a contest that lists them, or by their writers;
    // members-only problems only by the organization's members.
    throw notFound("Problem not found")
  }
  if (!contestId && problem?.membersOnly) ruledBy = problem.orgId
  if (ruledBy) {
    const { languages } = await orgPolicy(ruledBy)
    if (languages && !languages.includes(language.id)) {
      throw new ApiError(
        400,
        "language_unavailable",
        "That language isn't allowed here."
      )
    }
  }

  if (
    problem?.allowedLanguages &&
    !problem.allowedLanguages.includes(language.id)
  ) {
    throw new ApiError(
      400,
      "language_unavailable",
      "That language isn't allowed for this problem."
    )
  }

  const runCases =
    input.kind === "run"
      ? await resolveRunCases(input.inputs ?? [input.stdin ?? ""], problem?.id)
      : null

  await enforceCapacity(input.kind, settings["queue.max_depth"])

  const headStart = queueHeadStartMs({
    kind: input.kind,
    inContest: contestId !== null,
  })
  return db.transaction(async (tx) => {
    await enforceRateLimits(
      tx,
      user,
      settings["submissions.per_minute"],
      settings["submissions.max_pending"]
    )
    const [created] = await tx
      .insert(submissions)
      .values({
        userId: user.id,
        problemId: problem?.id,
        contestId,
        kind: input.kind,
        language: language.id satisfies LanguageId,
        entry: input.entry,
        files: files.data,
        runCases,
        timeLimitMs: problem?.timeLimitMs ?? language.timeLimitMs,
        memoryLimitMb: problem?.memoryLimitMb ?? language.memoryLimitMb,
        queueAt: new Date(Date.now() + headStart),
      })
      .returning({ id: submissions.id, status: submissions.status })
    // Delivered only on commit, so a runner never wakes for a row it can't see yet.
    await tx.execute(sql.sql`SELECT pg_notify(${QUEUE_CHANNEL}, '')`)
    return created
  })
}

/**
 * What a waiting browser polls. It reads none of the large columns, so waiting costs little,
 * and tells the browser how long to wait before asking again.
 */
export async function getSubmissionStatus(id: string, viewer: User) {
  const db = getDb()
  const [row] = await db
    .select({
      status: submissions.status,
      userId: submissions.userId,
      queueAt: submissions.queueAt,
    })
    .from(submissions)
    .where(eq(submissions.id, id))
  if (!row || (row.userId !== viewer.id && !isStaff(viewer))) {
    throw notFound("Submission not found")
  }
  if (row.status !== "queued") {
    return { status: row.status, position: null, nextPollMs: nextPollMs(null) }
  }
  const [ahead] = await db
    .select({ total: count() })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, "queued"),
        lt(submissions.queueAt, row.queueAt)
      )
    )
  const position = ahead?.total ?? 0
  return { status: row.status, position, nextPollMs: nextPollMs(position) }
}

/**
 * Shapes a submission for its viewer. Students get a verdict and timing for hidden
 * tests but never their input, expected output or the program's output on them,
 * which would let a student reconstruct the hidden tests.
 */
export async function presentSubmission(submission: Submission, viewer: User) {
  const staff = isStaff(viewer)
  // Only someone allowed to open it gets here; see getSubmissionFor.
  const caseIds = (submission.results ?? []).flatMap((item) =>
    item.testCaseId && (item.isSample || staff) ? [item.testCaseId] : []
  )
  const cases = caseIds.length
    ? await getDb()
        .select({
          id: testCases.id,
          input: testCases.input,
          expected: testCases.expected,
        })
        .from(testCases)
        .where(inArray(testCases.id, caseIds))
    : []

  const db = getDb()
  const [problem] = submission.problemId
    ? await db
        .select({ slug: problems.slug, title: problems.title })
        .from(problems)
        .where(eq(problems.id, submission.problemId))
    : []
  const [contest] = submission.contestId
    ? await db
        .select({
          slug: contests.slug,
          title: contests.title,
          scoring: contests.scoring,
        })
        .from(contests)
        .where(eq(contests.id, submission.contestId))
    : []
  const [author] = staff
    ? await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, submission.userId))
    : []

  const {
    files,
    stdin: _stdin,
    runCases: _runCases,
    lockedBy: _l,
    lockedUntil: _u,
    attempts: _a,
    ...rest
  } = submission
  let sampleNo = 0
  let hiddenNo = 0
  return {
    ...rest,
    problem: problem ?? null,
    contest: contest ?? null,
    author: author ?? null,
    files,
    results: (submission.results ?? []).map((item, index) => {
      const fromRun = item.testCaseId === null
      const revealed = staff || item.isSample || fromRun
      const source = cases.find((row) => row.id === item.testCaseId)
      return {
        number: index + 1,
        label:
          item.label ??
          (fromRun
            ? "Custom"
            : item.isSample
              ? `Sample ${++sampleNo}`
              : `Hidden test ${++hiddenNo}`),
        isSample: item.isSample,
        hidden: !fromRun && !item.isSample,
        verdict: item.verdict,
        wallMs: item.wallMs,
        maxRssKb: item.maxRssKb,
        points: item.points,
        stdout: revealed ? item.stdout : null,
        stderr: revealed ? item.stderr : null,
        input: item.input ?? source?.input ?? null,
        expected: item.expected ?? source?.expected ?? null,
      }
    }),
  }
}

export async function getSubmissionFor(id: string, viewer: User) {
  const [submission] = await getDb()
    .select()
    .from(submissions)
    .where(eq(submissions.id, id))
  // 404 rather than 403, so ids can't be probed.
  if (!submission || (submission.userId !== viewer.id && !isStaff(viewer))) {
    throw notFound("Submission not found")
  }
  return presentSubmission(submission, viewer)
}

const LIST_COLUMNS = {
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
  problem: problems.title,
  problemSlug: problems.slug,
  contest: contests.title,
  contestSlug: contests.slug,
}

/** A student's own graded submissions. Runs aren't submissions, so they never appear here. */
export async function listSubmissionsFor(
  user: User,
  filters: { problemSlug: string | null; contestSlug: string | null }
) {
  const conditions = [
    eq(submissions.userId, user.id),
    eq(submissions.kind, "submit"),
  ]
  if (filters.problemSlug) {
    conditions.push(eq(problems.slug, filters.problemSlug))
  }
  if (filters.contestSlug) {
    conditions.push(eq(contests.slug, filters.contestSlug))
  }
  return getDb()
    .select(LIST_COLUMNS)
    .from(submissions)
    .leftJoin(problems, eq(submissions.problemId, problems.id))
    .leftJoin(contests, eq(submissions.contestId, contests.id))
    .where(and(...conditions))
    .orderBy(desc(submissions.createdAt))
    .limit(100)
}

/**
 * Per-problem status for the signed-in student's question list. Only a graded submit
 * can solve a problem: a plain run has nothing to compare against, so it counts as tried.
 */
export async function getProgress(user: User) {
  const rows = await getDb()
    .selectDistinct({
      slug: problems.slug,
      kind: submissions.kind,
      verdict: submissions.verdict,
    })
    .from(submissions)
    .innerJoin(problems, eq(submissions.problemId, problems.id))
    .where(eq(submissions.userId, user.id))
  const progress: Record<string, "solved" | "tried"> = {}
  for (const row of rows) {
    if (row.kind === "submit" && row.verdict === "AC") {
      progress[row.slug] = "solved"
    } else {
      progress[row.slug] ??= "tried"
    }
  }
  return progress
}
