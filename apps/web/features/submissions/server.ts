import {
  assignmentProblems,
  assignments,
  examSessions,
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
  type Contest,
  type Submission,
  type User,
} from "@workspace/db"
import {
  isBrowserLanguage,
  nextPollMs,
  outputsMatch,
  overallVerdict,
  perMinuteLimit,
  QUEUE_CHANNEL,
  queueHeadStartMs,
  sourceFilesSchema,
  type LanguageId,
  type Verdict,
} from "@workspace/judge"

import { ApiError, isStaff, notFound } from "@/lib/api/route"
import {
  getLanguages,
  getSettings,
  requireFeature,
} from "@/features/settings/server"
import { findAssignment } from "@/features/assignments/grading"
import {
  browserGradingOff,
  planFor,
  testInputs,
  workHasProblem,
} from "./execution"
import { contestFor } from "@/features/contests/server"
import { accessTo, orgPolicy, viewpoint } from "@/features/orgs/access"
import { cached } from "@/lib/ttl-cache"
import { examScope, guardExamSubmission } from "@/features/exams/server"
import { slugIs } from "@/features/problems/slugs"

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
  /** Submitted from an assignment's own pages, so its rules (execution, limit) apply. */
  assignmentSlug?: string
  /** A Submit graded in the browser: each test's output, checked here. */
  browser?: { outputs: BrowserOutput[] }
}

export interface BrowserOutput {
  testCaseId: string
  stdout: string
  stderr: string
  timeout?: boolean
  wallMs?: number
}

/** As much of a program's output as a result keeps, like the runner's previews. */
const OUTPUT_PREVIEW_CHARS = 16 * 1024

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
  problem: {
    id: string
    published: boolean
    membersOnly: boolean
    listed: boolean
    orgId: string | null
  }
) {
  if (problem.published && !problem.membersOnly && problem.listed) return true
  const vp = await viewpoint(user)
  const content = { orgId: problem.orgId, audience: [] as string[][] }
  if (accessTo(vp, content, "problems.manage") === "manage") return true
  // Written for assignments and contests: only through one that uses it and has begun.
  if (!problem.listed) {
    return problem.published && user !== null && (await usedInOpenWork(user, vp, problem.id))
  }
  // Published for members: any active member of its organization.
  return (
    problem.published &&
    problem.orgId !== null &&
    accessTo(vp, content, "problems.manage") === "take"
  )
}

/**
 * Whether the problem is in an assignment this person takes that has opened (for an exam,
 * once they've started it), or in a contest of theirs that has started.
 */
async function usedInOpenWork(
  user: User,
  vp: Awaited<ReturnType<typeof viewpoint>>,
  problemId: string
) {
  const db = getDb()
  const now = new Date()
  const work = await db
    .select({ assignment: assignments })
    .from(assignmentProblems)
    .innerJoin(assignments, eq(assignmentProblems.assignmentId, assignments.id))
    .where(
      and(eq(assignmentProblems.problemId, problemId), eq(assignments.published, true))
    )
  for (const { assignment } of work) {
    const access = accessTo(vp, assignment, "assignments.manage")
    if (access === "none") continue
    if (access === "manage") return true
    if (assignment.opensAt > now) continue
    if (!assignment.exam) return true
    const started = await db
      .select({ at: examSessions.startedAt })
      .from(examSessions)
      .where(
        and(
          eq(examSessions.assignmentId, assignment.id),
          eq(examSessions.userId, user.id)
        )
      )
      .limit(1)
    if (started.length) return true
  }
  const inContests = await db
    .select({ contest: contests })
    .from(contestProblems)
    .innerJoin(contests, eq(contestProblems.contestId, contests.id))
    .where(eq(contestProblems.problemId, problemId))
  return inContests.some(
    ({ contest }) =>
      contest.startsAt <= now &&
      accessTo(vp, contest, "contests.manage") !== "none"
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

export async function createSubmission(
  user: User,
  input: CreateSubmission,
  /** Where it came from, for exams limited to a lab's network. */
  ip: string | null = null
) {
  const settings = await getSettings()

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
      .where(slugIs(input.problemSlug))
    if (!problem) throw notFound("Problem not found")
  }
  if (input.kind === "submit" && !problem) {
    throw new ApiError(
      400,
      "problem_required",
      "Choose a problem to submit to."
    )
  }

  // During an exam sitting: only the exam's problems, from its networks, contests included.
  const exam = await guardExamSubmission(user, problem?.id ?? null, ip)
  const inExam = exam !== null

  let contestId: string | null = null
  let contestRules: Pick<
    Contest,
    "id" | "orgId" | "execution" | "submissionsPerMinute"
  > | null = null
  // An organization's language rules cover its contests and its members-only problems.
  let ruledBy: string | null = null
  if (input.contestSlug) {
    if (!problem)
      throw new ApiError(400, "problem_required", "Choose a problem.")
    const contest = await resolveContest(user, input.contestSlug, problem.id)
    contestId = contest.id
    contestRules = contest
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

  // The assignment whose rules apply: the exam being sat, or the one it was submitted from.
  let assignment = exam
  if (!assignment && !contestId && input.assignmentSlug && problem) {
    const found = (await findAssignment(input.assignmentSlug, user)).assignment
    if (await workHasProblem({ assignmentId: found.id }, problem.id))
      assignment = found
  }

  const plan = await planFor(
    user,
    { problem, contest: contestRules, assignment },
    settings
  )
  const work = contestRules ?? assignment
  const perMinute = perMinuteLimit(
    settings["submissions.per_minute"],
    work?.submissionsPerMinute ?? null
  )

  if (input.browser) {
    if (input.kind !== "submit" || !problem) {
      throw new ApiError(
        400,
        "browser_submit_only",
        "Only a graded Submit sends its outputs from the browser."
      )
    }
    if (plan.submit !== "browser") throw browserGradingOff()
    if (!isBrowserLanguage(language.id)) {
      throw new ApiError(
        400,
        "language_unavailable",
        "Only Python and JavaScript can be graded in the browser."
      )
    }
    return gradeFromBrowser(user, {
      problemId: problem.id,
      contestId,
      language: language.id,
      entry: input.entry,
      files: files.data,
      timeLimitMs: problem.timeLimitMs ?? language.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb ?? language.memoryLimitMb,
      outputs: input.browser.outputs,
      perMinute,
      maxPending: settings["submissions.max_pending"],
    })
  }

  if (plan[input.kind] !== "server") {
    if (input.kind === "submit" && plan.submit === "browser") {
      throw new ApiError(
        409,
        "grade_in_browser",
        "The server isn't running code right now. Reload the page to submit from your browser."
      )
    }
    throw new ApiError(
      403,
      "feature_disabled",
      "Server execution is turned off."
    )
  }

  const runCases =
    input.kind === "run"
      ? await resolveRunCases(input.inputs ?? [input.stdin ?? ""], problem?.id)
      : null

  // An exam's last submissions aren't shed when the lab is busy: they can't be retried later.
  if (!inExam) await enforceCapacity(input.kind, settings["queue.max_depth"])

  const headStart = queueHeadStartMs({
    kind: input.kind,
    inContest: contestId !== null,
  })
  return db.transaction(async (tx) => {
    await enforceRateLimits(
      tx,
      user,
      perMinute,
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
 * A Submit graded in the browser: the outputs it sent are compared here with expected
 * outputs that never left the server, and the result is kept as provisional until the
 * sandbox judges the same code again (the runner does, once server execution is back).
 */
async function gradeFromBrowser(
  user: User,
  input: {
    problemId: string
    contestId: string | null
    language: LanguageId
    entry: string
    files: Submission["files"]
    timeLimitMs: number
    memoryLimitMb: number
    outputs: BrowserOutput[]
    perMinute: number
    maxPending: number
  }
) {
  const cases = await getDb()
    .select({
      id: testCases.id,
      expected: testCases.expected,
      isSample: testCases.isSample,
      points: testCases.points,
    })
    .from(testCases)
    .where(eq(testCases.problemId, input.problemId))
    .orderBy(asc(testCases.position))
  const sent = new Map(input.outputs.map((o) => [o.testCaseId, o]))
  if (cases.some((c) => !sent.has(c.id)) || sent.size !== cases.length) {
    throw new ApiError(
      400,
      "missing_outputs",
      "The problem's tests changed. Reload the page and submit again."
    )
  }
  const results = cases.map((c) => {
    const out = sent.get(c.id)!
    const verdict: Verdict = out.timeout
      ? "TLE"
      : out.stderr.trim()
        ? "RE"
        : outputsMatch(out.stdout, c.expected)
          ? "AC"
          : "WA"
    return {
      testCaseId: c.id,
      isSample: c.isSample,
      verdict,
      stdout: out.stdout.slice(0, OUTPUT_PREVIEW_CHARS),
      stderr: out.stderr.slice(0, OUTPUT_PREVIEW_CHARS),
      wallMs: Math.max(0, Math.round(out.wallMs ?? 0)),
      maxRssKb: null,
      points: verdict === "AC" ? c.points : 0,
    }
  })
  const now = new Date()
  return getDb().transaction(async (tx) => {
    await enforceRateLimits(tx, user, input.perMinute, input.maxPending)
    const [created] = await tx
      .insert(submissions)
      .values({
        userId: user.id,
        problemId: input.problemId,
        contestId: input.contestId,
        kind: "submit",
        language: input.language,
        entry: input.entry,
        files: input.files,
        timeLimitMs: input.timeLimitMs,
        memoryLimitMb: input.memoryLimitMb,
        status: "done",
        provisional: true,
        verdict: cases.length ? overallVerdict(results) : "AC",
        results,
        score: results.reduce((sum, r) => sum + r.points, 0),
        maxScore: cases.reduce((sum, c) => sum + c.points, 0),
        runtimeMs: results.length
          ? Math.max(...results.map((r) => r.wallMs))
          : null,
        passedTests: results.filter((r) => r.verdict === "AC").length,
        totalTests: cases.length,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: submissions.id, status: submissions.status })
    return created!
  })
}

/** Every test's input, for a Submit the browser will grade. Refused where it isn't allowed. */
export async function browserTests(
  user: User,
  input: { problemSlug: string; contestSlug?: string; assignmentSlug?: string },
  /** Where it came from: during an exam, only its networks may have the tests. */
  ip: string | null = null
) {
  const [problem] = await getDb()
    .select()
    .from(problems)
    .where(slugIs(input.problemSlug))
  if (!problem) throw notFound("Problem not found")
  const exam = await guardExamSubmission(user, problem.id, ip)
  let contest: Pick<
    Contest,
    "id" | "orgId" | "execution" | "submissionsPerMinute"
  > | null = null
  if (input.contestSlug) {
    contest = await resolveContest(user, input.contestSlug, problem.id)
  } else if (!(await canReachProblem(user, problem))) {
    throw notFound("Problem not found")
  }
  let assignment = exam
  if (!assignment && !contest && input.assignmentSlug) {
    const found = (await findAssignment(input.assignmentSlug, user)).assignment
    if (await workHasProblem({ assignmentId: found.id }, problem.id))
      assignment = found
  }
  const plan = await planFor(user, { problem, contest, assignment })
  if (plan.submit !== "browser") throw browserGradingOff()
  return { tests: await testInputs(problem.id) }
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
  const scope = await examScope(viewer.id)
  if (scope && !inExamScope(scope, submission)) {
    throw new ApiError(403, "exam_locked", "Earlier code is closed during your exam.")
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
    conditions.push(slugIs(filters.problemSlug))
  }
  if (filters.contestSlug) {
    conditions.push(eq(contests.slug, filters.contestSlug))
  }
  // During an exam: only this sitting's work on the exam's problems.
  const scope = await examScope(user.id)
  if (scope) {
    conditions.push(inArray(submissions.problemId, scope.problemIds))
    conditions.push(gte(submissions.createdAt, scope.since))
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

const inExamScope = (
  scope: { problemIds: string[]; since: Date },
  row: { problemId: string | null; createdAt: Date }
) =>
  row.problemId !== null &&
  scope.problemIds.includes(row.problemId) &&
  row.createdAt >= scope.since

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
