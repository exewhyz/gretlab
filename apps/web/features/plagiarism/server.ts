/**
 * Plagiarism checks (rules: packages/judge/src/similarity.ts). Each student's latest accepted
 * code for one problem is compared with everyone else's in the same language; a pair can be
 * opened side by side with the stretches they share. The platform checks any problem (Dashboard
 * › Plagiarism check); an organization checks its own assignments and contests, only for the
 * students the person may grade (Manage › Plagiarism check). A match is a reason to look, never
 * proof.
 */
import {
  assignmentProblems,
  assignments,
  contestProblems,
  contests,
  getDb,
  problems,
  sql,
  submissions,
  users,
} from "@workspace/db"
import {
  findSimilarPairs,
  matchingRegions,
  similarity,
  fingerprint,
} from "@workspace/judge"
import { z } from "zod"

import { studentsOf } from "@/features/assignments/gradebook-server"
import { accessTo, viewpoint } from "@/features/orgs/access"
import {
  canAnywhere,
  groupsFor,
  orgContext,
  writeAudit,
} from "@/features/orgs/server"
import { slugIs } from "@/features/problems/slugs"
import { ApiError, notFound } from "@/lib/api/route"

import type { User } from "@workspace/db"

const { and, asc, desc, eq, gte, inArray } = sql

const LANGUAGES = ["python", "javascript", "c", "cpp", "java"] as const

type Candidate = {
  id: string
  userId: string
  name: string | null
  email: string
  language: string
  files: { path: string; content: string }[]
  createdAt: Date
}

/** Each student's latest accepted submit for a problem, from these places and people. */
async function candidates(input: {
  problemId: string
  contestId?: string | null
  since?: Date | null
  userIds?: readonly string[] | null
}): Promise<Candidate[]> {
  if (input.userIds && input.userIds.length === 0) return []
  return getDb()
    .selectDistinctOn([submissions.userId], {
      id: submissions.id,
      userId: submissions.userId,
      name: users.name,
      email: users.email,
      language: submissions.language,
      files: submissions.files,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .where(
      and(
        eq(submissions.problemId, input.problemId),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC"),
        input.contestId
          ? eq(submissions.contestId, input.contestId)
          : undefined,
        input.since ? gte(submissions.createdAt, input.since) : undefined,
        input.userIds ? inArray(submissions.userId, input.userIds) : undefined
      )
    )
    .orderBy(submissions.userId, desc(submissions.createdAt))
}

const codeOf = (c: Candidate) => c.files.map((f) => f.content).join("\n")

/** Pairs at or above the threshold, within each language, most similar first. */
function pairsAmong(rows: Candidate[], threshold: number) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const person = (c: Candidate) => ({
    submissionId: c.id,
    name: c.name,
    email: c.email,
    at: c.createdAt,
  })
  const pairs = LANGUAGES.flatMap((language) =>
    findSimilarPairs(
      rows
        .filter((r) => r.language === language)
        .map((r) => ({ key: r.id, code: codeOf(r) })),
      threshold
    )
  )
  return {
    compared: rows.length,
    pairs: pairs
      .sort((a, b) => b.score - a.score)
      .slice(0, 200)
      .map((pair) => ({
        score: Math.round(pair.score * 100),
        language: byId.get(pair.a)!.language,
        a: person(byId.get(pair.a)!),
        b: person(byId.get(pair.b)!),
      })),
  }
}

/** Two of the compared submissions side by side, with the stretches they share. */
function pairDetail(rows: Candidate[], aId: string, bId: string) {
  const a = rows.find((r) => r.id === aId)
  const b = rows.find((r) => r.id === bId)
  // Only submissions in the set that was checked: never a way to read other code.
  if (!a || !b || a.id === b.id)
    throw notFound("Those submissions aren't in this check")
  if (a.language !== b.language)
    throw new ApiError(
      400,
      "different_languages",
      "Only code in the same language is compared."
    )
  const codeA = codeOf(a)
  const codeB = codeOf(b)
  const side = (c: Candidate, code: string) => ({
    submissionId: c.id,
    name: c.name,
    email: c.email,
    at: c.createdAt,
    code,
  })
  return {
    language: a.language,
    score: Math.round(similarity(fingerprint(codeA), fingerprint(codeB)) * 100),
    a: side(a, codeA),
    b: side(b, codeB),
    regions: matchingRegions(codeA, codeB),
  }
}

export const similarityRequest = z.object({
  threshold: z.number().min(0.3).max(1),
  /** To open one pair side by side instead of listing pairs. */
  compare: z.object({ a: z.uuid(), b: z.uuid() }).optional(),
})

/* ---------- the platform: any problem, optionally one contest ---------- */

export const platformRequest = similarityRequest.extend({
  problemSlug: z.string(),
  contestSlug: z.string().nullable(),
})

export async function platformSimilarity(
  input: z.infer<typeof platformRequest>
) {
  const db = getDb()
  const [problem] = await db
    .select({ id: problems.id })
    .from(problems)
    .where(slugIs(input.problemSlug))
  if (!problem) throw notFound("Problem not found")
  let contestId: string | null = null
  if (input.contestSlug) {
    const [contest] = await db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.slug, input.contestSlug))
    if (!contest) throw notFound("Contest not found")
    contestId = contest.id
  }
  const rows = await candidates({ problemId: problem.id, contestId })
  return input.compare
    ? { pair: pairDetail(rows, input.compare.a, input.compare.b) }
    : pairsAmong(rows, input.threshold)
}

/* ---------- an organization: its own assignments and contests ---------- */

/** The organization's work this person may check, each with its problems. */
export async function orgCheckable(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const db = getDb()
  const vp = await viewpoint(user)
  const [own, ownContests] = await Promise.all([
    canAnywhere(ctx, "gradebook.view")
      ? db
          .select({
            id: assignments.id,
            title: assignments.title,
            opensAt: assignments.opensAt,
          })
          .from(assignments)
          .where(eq(assignments.orgId, ctx.org.id))
          .orderBy(desc(assignments.opensAt))
      : [],
    db
      .select()
      .from(contests)
      .where(eq(contests.orgId, ctx.org.id))
      .orderBy(desc(contests.startsAt)),
  ])
  const managed = ownContests.filter(
    (c) => accessTo(vp, c, "contests.manage") === "manage"
  )
  if (!own.length && !managed.length && !canAnywhere(ctx, "gradebook.view"))
    throw new ApiError(
      403,
      "forbidden",
      "Checking work isn't part of your role."
    )
  const [aProblems, cProblems] = await Promise.all([
    own.length
      ? db
          .select({
            workId: assignmentProblems.assignmentId,
            id: problems.id,
            title: problems.title,
          })
          .from(assignmentProblems)
          .innerJoin(problems, eq(assignmentProblems.problemId, problems.id))
          .where(
            inArray(
              assignmentProblems.assignmentId,
              own.map((a) => a.id)
            )
          )
          .orderBy(asc(assignmentProblems.position))
      : [],
    managed.length
      ? db
          .select({
            workId: contestProblems.contestId,
            id: problems.id,
            title: problems.title,
            label: contestProblems.label,
          })
          .from(contestProblems)
          .innerJoin(problems, eq(contestProblems.problemId, problems.id))
          .where(
            inArray(
              contestProblems.contestId,
              managed.map((c) => c.id)
            )
          )
          .orderBy(asc(contestProblems.position))
      : [],
  ])
  const problemsOf = (
    rows: { workId: string; id: string; title: string }[],
    id: string
  ) =>
    rows.filter((r) => r.workId === id).map(({ id, title }) => ({ id, title }))
  return [
    ...own.map((a) => ({
      kind: "assignment" as const,
      id: a.id,
      title: a.title,
      problems: problemsOf(aProblems, a.id),
    })),
    ...managed.map((c) => ({
      kind: "contest" as const,
      id: c.id,
      title: c.title,
      problems: problemsOf(cProblems, c.id),
    })),
  ].filter((w) => w.problems.length > 0)
}

export const orgRequest = similarityRequest.extend({
  work: z.object({ kind: z.enum(["assignment", "contest"]), id: z.uuid() }),
  problemId: z.uuid(),
})

/**
 * Pairs (or one pair side by side) among the students of one of the organization's
 * assignments the person may grade, or a contest they run. Logged.
 */
export async function orgSimilarity(
  slug: string,
  user: User,
  input: z.infer<typeof orgRequest>
) {
  const ctx = await orgContext(slug, user)
  const db = getDb()
  let rows: Candidate[]
  let title: string
  if (input.work.kind === "assignment") {
    if (!canAnywhere(ctx, "gradebook.view"))
      throw new ApiError(
        403,
        "forbidden",
        "Seeing grades isn't part of your role."
      )
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.id, input.work.id),
          eq(assignments.orgId, ctx.org.id)
        )
      )
    if (!assignment) throw notFound("Assignment not found")
    const [item] = await db
      .select({ id: assignmentProblems.problemId })
      .from(assignmentProblems)
      .where(
        and(
          eq(assignmentProblems.assignmentId, assignment.id),
          eq(assignmentProblems.problemId, input.problemId)
        )
      )
    if (!item) throw notFound("That problem isn't in this assignment")
    // Only the students this person may see grades for, from when it opened.
    const students = await studentsOf(
      assignment,
      groupsFor(ctx, "gradebook.view")
    )
    rows = await candidates({
      problemId: input.problemId,
      since: assignment.opensAt,
      userIds: students.map((s) => s.id),
    })
    title = assignment.title
  } else {
    const [contest] = await db
      .select()
      .from(contests)
      .where(
        and(eq(contests.id, input.work.id), eq(contests.orgId, ctx.org.id))
      )
    if (
      !contest ||
      accessTo(await viewpoint(user), contest, "contests.manage") !== "manage"
    )
      throw notFound("Contest not found")
    const [item] = await db
      .select({ id: contestProblems.problemId })
      .from(contestProblems)
      .where(
        and(
          eq(contestProblems.contestId, contest.id),
          eq(contestProblems.problemId, input.problemId)
        )
      )
    if (!item) throw notFound("That problem isn't in this contest")
    rows = await candidates({
      problemId: input.problemId,
      contestId: contest.id,
    })
    title = contest.title
  }
  if (input.compare) {
    const pair = pairDetail(rows, input.compare.a, input.compare.b)
    await writeAudit(
      ctx,
      "plagiarism.compare",
      `Compared two students' code in ${title}`,
      {
        work: input.work,
        problem: input.problemId,
      }
    )
    return { pair }
  }
  const result = pairsAmong(rows, input.threshold)
  await writeAudit(
    ctx,
    "plagiarism.check",
    `Checked ${title} for similar code`,
    {
      work: input.work,
      problem: input.problemId,
      compared: result.compared,
      pairs: result.pairs.length,
    }
  )
  return result
}
