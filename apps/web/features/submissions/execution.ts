import {
  assignmentProblems,
  contestProblems,
  getDb,
  organizations,
  problems,
  sql,
  testCases,
  type Assignment,
  type Contest,
  type Problem,
  type User,
} from "@workspace/db"
import {
  planExecution,
  platformExecution,
  readOrgExecution,
  type ExecutionPlan,
  type OrgExecution,
  type WorkExecution,
  workExecutionProblem,
} from "@workspace/judge"

import { findAssignment } from "@/features/assignments/grading"
import { contestFor } from "@/features/contests/server"
import { slugIs } from "@/features/problems/slugs"
import { getSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/errors"

/*
 * Where code runs for one problem in its context (practice, an assignment, a contest), from
 * the platform's settings, the owning organization's and the work's own choice. The rules
 * are packages/judge/src/execution.ts; this reads what they need.
 */

const { and, asc, eq } = sql

type Settings = Awaited<ReturnType<typeof getSettings>>


export async function orgExecution(
  orgId: string | null
): Promise<OrgExecution | null> {
  if (!orgId) return null
  const [row] = await getDb()
    .select({ execution: organizations.execution })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return readOrgExecution(row?.execution)
}

export interface ExecutionContext {
  problem: Problem | null
  contest: Pick<Contest, "id" | "orgId" | "execution" | "submissionsPerMinute"> | null
  assignment: Pick<
    Assignment,
    "id" | "orgId" | "execution" | "submissionsPerMinute"
  > | null
}

/** The plan for a context already looked up (createSubmission has done the checks). */
export async function planFor(
  user: User | null,
  ctx: ExecutionContext,
  settings?: Settings
): Promise<ExecutionPlan> {
  const all = settings ?? (await getSettings())
  const work = ctx.contest ?? ctx.assignment
  const orgId = work ? work.orgId : (ctx.problem?.orgId ?? null)
  return planExecution({
    platform: platformExecution(all),
    org: await orgExecution(orgId),
    work: (work?.execution as WorkExecution | undefined) ?? null,
    context: ctx.contest ? "contest" : ctx.assignment ? "assignment" : "practice",
    signedIn: user !== null,
  })
}

/**
 * For the editor: where Run and Submit go for this problem here. Only checks that the
 * problem and work exist for this person; submitting checks everything else.
 */
export async function executionFor(
  user: User | null,
  query: { problem?: string | null; contest?: string | null; assignment?: string | null }
) {
  const settings = await getSettings()
  if (!user) {
    return planExecution({
      platform: platformExecution(settings),
      org: null,
      work: null,
      context: query.contest ? "contest" : "practice",
      signedIn: false,
    })
  }
  const problem = query.problem ? await problemBySlug(query.problem) : null
  const contest = query.contest ? await contestFor(query.contest, user) : null
  const assignment =
    !contest && query.assignment
      ? (await findAssignment(query.assignment, user)).assignment
      : null
  return planFor(user, { problem, contest, assignment }, settings)
}

async function problemBySlug(slug: string) {
  const [problem] = await getDb().select().from(problems).where(slugIs(slug))
  if (!problem) throw notFound("Problem not found")
  return problem
}

/** Whether a problem is part of a work, so its rules can apply to submissions on it. */
export async function workHasProblem(
  work: { contestId?: string; assignmentId?: string },
  problemId: string
) {
  const db = getDb()
  if (work.contestId) {
    const [row] = await db
      .select({ id: contestProblems.problemId })
      .from(contestProblems)
      .where(
        and(
          eq(contestProblems.contestId, work.contestId),
          eq(contestProblems.problemId, problemId)
        )
      )
    return Boolean(row)
  }
  if (work.assignmentId) {
    const [row] = await db
      .select({ id: assignmentProblems.problemId })
      .from(assignmentProblems)
      .where(
        and(
          eq(assignmentProblems.assignmentId, work.assignmentId),
          eq(assignmentProblems.problemId, problemId)
        )
      )
    return Boolean(row)
  }
  return false
}

/** Every test's id and input, in order: what the browser runs for a provisional grade. */
export async function testInputs(problemId: string) {
  return getDb()
    .select({ id: testCases.id, input: testCases.input })
    .from(testCases)
    .where(eq(testCases.problemId, problemId))
    .orderBy(asc(testCases.position))
}

export const browserGradingOff = () =>
  new ApiError(
    403,
    "browser_grading_off",
    "Submitting isn't available here right now: the server can't run code and grading in the browser isn't turned on."
  )

/**
 * Checked when an assignment or contest is saved: its limit can't be above the platform's,
 * and it can choose the browser only where the platform and its organization allow it.
 */
export async function checkWorkExecution(
  orgId: string | null,
  input: { execution: WorkExecution; submissionsPerMinute: number | null }
) {
  const settings = await getSettings()
  const problem = workExecutionProblem({
    execution: input.execution,
    perMinute: input.submissionsPerMinute,
    platform: platformExecution(settings),
    platformPerMinute: settings["submissions.per_minute"],
    org: await orgExecution(orgId),
  })
  if (problem) {
    throw new ApiError(
      400,
      input.submissionsPerMinute !== null && /limit/.test(problem)
        ? "limit_too_high"
        : "browser_not_allowed",
      problem
    )
  }
}

/** For the forms: what may be chosen, and the platform's limit to stay under. */
export async function workExecutionOptions(orgId: string | null) {
  const settings = await getSettings()
  const platform = platformExecution(settings)
  const org = await orgExecution(orgId)
  return {
    platformPerMinute: settings["submissions.per_minute"],
    serverOn: platform.server && org?.server !== false,
    browserAllowed: workExecutionProblem({
      execution: "browser",
      perMinute: null,
      platform,
      platformPerMinute: settings["submissions.per_minute"],
      org,
    }),
  }
}
