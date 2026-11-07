import {
  contestParticipants,
  contestProblems,
  contests,
  getDb,
  organizations,
  problems,
  sql,
  submissions,
  users,
  type Contest,
  type User,
} from "@workspace/db"
import { computeLeaderboard, freezeTime } from "@workspace/judge"

import { ApiError, notFound } from "@/lib/api/route"
import {
  accessTo,
  classLinks,
  narrowLanguages,
  orgPolicy,
  viewpoint,
  type Access,
  type Viewpoint,
} from "@/features/orgs/access"
import { cached, invalidate } from "@/lib/ttl-cache"
import { buildDetail, type ProblemSummary } from "@/features/problems/server"

import type { ContestInput } from "../problems/schemas"

const { and, asc, count, desc, eq, inArray, isNull } = sql

export type ContestPhase = "upcoming" | "live" | "ended"

function phaseOf(contest: Contest, now = new Date()): ContestPhase {
  if (now < contest.startsAt) return "upcoming"
  return now < contest.endsAt ? "live" : "ended"
}

/**
 * The contest and what this person may do with it. A contest they can't take part in
 * looks the same as one that doesn't exist.
 */
async function findContest(
  slug: string,
  viewer: User | null
): Promise<{
  contest: Contest
  access: Exclude<Access, "none">
  vp: Viewpoint
}> {
  const [contest] = await getDb()
    .select()
    .from(contests)
    .where(eq(contests.slug, slug))
  const vp = await viewpoint(viewer)
  const access = contest ? accessTo(vp, contest, "contests.manage") : "none"
  if (
    !contest ||
    access === "none" ||
    (!contest.published && access !== "manage")
  ) {
    throw notFound("Contest not found")
  }
  return { contest, access, vp }
}

/** For submissions: the contest, if this person may take part in it. */
export async function contestFor(slug: string, viewer: User) {
  return (await findContest(slug, viewer)).contest
}

async function contestProblemRows(contestId: string) {
  return getDb()
    .select({ link: contestProblems, problem: problems })
    .from(contestProblems)
    .innerJoin(problems, eq(contestProblems.problemId, problems.id))
    .where(eq(contestProblems.contestId, contestId))
    .orderBy(asc(contestProblems.position))
}

export async function listContests(viewer: User | null) {
  const db = getDb()
  const [rows, counts, vp] = await Promise.all([
    db
      .select({
        contest: contests,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(contests)
      .leftJoin(organizations, eq(contests.orgId, organizations.id))
      .orderBy(desc(contests.startsAt)),
    db
      .select({ contestId: contestParticipants.contestId, total: count() })
      .from(contestParticipants)
      .groupBy(contestParticipants.contestId),
    viewpoint(viewer),
  ])
  return rows
    .map((row) => ({
      ...row,
      access: accessTo(vp, row.contest, "contests.manage"),
    }))
    .filter(
      ({ contest, access }) =>
        access !== "none" && (contest.published || access === "manage")
    )
    .map(({ contest, orgName, orgSlug }) => ({
      ...contest,
      org: orgName ? { name: orgName, slug: orgSlug } : null,
      phase: phaseOf(contest),
      participants:
        counts.find((item) => item.contestId === contest.id)?.total ?? 0,
    }))
}

async function isRegistered(contestId: string, userId: string) {
  const [row] = await getDb()
    .select({ userId: contestParticipants.userId })
    .from(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, contestId),
        eq(contestParticipants.userId, userId)
      )
    )
  return Boolean(row)
}

/** Problems stay secret until the start, except from staff. */
export async function getContestView(slug: string, viewer: User | null) {
  const { contest, access, vp } = await findContest(slug, viewer)
  const phase = phaseOf(contest)
  const rows = await contestProblemRows(contest.id)
  const classes = await classLinks(vp, contest, access === "manage")
  const canSeeProblems = phase !== "upcoming" || access === "manage"
  const status = viewer ? await ownStatus(contest.id, viewer.id) : {}
  const [participants] = await getDb()
    .select({ total: count() })
    .from(contestParticipants)
    .where(eq(contestParticipants.contestId, contest.id))
  return {
    ...contest,
    phase,
    /** The classes it's for, linked. */
    classes,
    participants: participants?.total ?? 0,
    registered: viewer ? await isRegistered(contest.id, viewer.id) : false,
    problems: canSeeProblems
      ? rows.map(({ link, problem }) => ({
          id: problem.slug,
          label: link.label,
          title: problem.title,
          level: problem.level,
          status: status[problem.slug] ?? null,
        }))
      : [],
  }
}

/** The viewer's own result per problem in this contest. Practice attempts don't count here. */
async function ownStatus(contestId: string, userId: string) {
  const rows = await getDb()
    .selectDistinct({ slug: problems.slug, verdict: submissions.verdict })
    .from(submissions)
    .innerJoin(problems, eq(submissions.problemId, problems.id))
    .where(
      and(
        eq(submissions.contestId, contestId),
        eq(submissions.userId, userId),
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done")
      )
    )
  const status: Record<string, "solved" | "tried"> = {}
  for (const row of rows) {
    if (row.verdict === "AC") status[row.slug] = "solved"
    else status[row.slug] ??= "tried"
  }
  return status
}

export async function register(slug: string, user: User) {
  const { contest } = await findContest(slug, user)
  if (!contest.registrationOpen) {
    throw new ApiError(403, "registration_closed", "Registration is closed.")
  }
  if (phaseOf(contest) === "ended") {
    throw new ApiError(403, "contest_over", "The contest has ended.")
  }
  await getDb()
    .insert(contestParticipants)
    .values({ contestId: contest.id, userId: user.id })
    .onConflictDoNothing()
  refreshLeaderboard(contest.id)
}

export async function unregister(slug: string, user: User) {
  const { contest } = await findContest(slug, user)
  if (phaseOf(contest) !== "upcoming") {
    throw new ApiError(
      403,
      "contest_started",
      "The contest has already started."
    )
  }
  await getDb()
    .delete(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, contest.id),
        eq(contestParticipants.userId, user.id)
      )
    )
  refreshLeaderboard(contest.id)
}

export async function getContestProblem(
  slug: string,
  label: string,
  viewer: User | null
) {
  const { contest, access } = await findContest(slug, viewer)
  if (phaseOf(contest) === "upcoming" && access !== "manage") {
    throw new ApiError(
      403,
      "contest_not_started",
      "The contest hasn't started."
    )
  }
  const rows = await contestProblemRows(contest.id)
  const summaries: ProblemSummary[] = rows.map(({ link, problem }, index) => ({
    id: problem.slug,
    title: problem.title,
    level: problem.level,
    unit: contest.title,
    // Contest problems aren't part of a unit.
    unitNo: 0,
    no: index + 1,
    label: link.label,
  }))
  const index = rows.findIndex((row) => row.link.label === label)
  const row = rows[index]
  const summary = summaries[index]
  if (!row || !summary) throw notFound("Problem not found")
  return {
    contest: {
      ...contest,
      phase: phaseOf(contest),
      canManage: access === "manage",
    },
    summaries,
    problem: await (async () => {
      const detail = await buildDetail(row.problem, summary)
      const policy = await orgPolicy(contest.orgId)
      return {
        ...detail,
        hasSolution: false,
        allowedLanguages: narrowLanguages(
          detail.allowedLanguages,
          policy.languages
        ),
        pasteBlocked: !policy.allowPaste,
      }
    })(),
    published: row.problem.published,
    status: viewer ? await ownStatus(contest.id, viewer.id) : {},
    registered: viewer ? await isRegistered(contest.id, viewer.id) : false,
  }
}

/** Everyone in a contest refreshes this. Cached and shared, it costs one computation per interval. */
const LEADERBOARD_TTL_MS = 5000

export async function getLeaderboard(slug: string, viewer: User | null) {
  const { contest, access } = await findContest(slug, viewer)
  // Staff see through the freeze, so they must not share an entry with students.
  const staff = access === "manage"
  return cached(`leaderboard:${contest.id}:${staff}`, LEADERBOARD_TTL_MS, () =>
    computeBoard(contest, staff)
  )
}

async function computeBoard(contest: Contest, staff: boolean) {
  const db = getDb()
  const rows = await contestProblemRows(contest.id)
  const labelOf = new Map(rows.map((row) => [row.problem.id, row.link.label]))
  const [participants, attempts] = await Promise.all([
    db
      .select({ id: users.id, name: users.name })
      .from(contestParticipants)
      .innerJoin(users, eq(contestParticipants.userId, users.id))
      .where(eq(contestParticipants.contestId, contest.id)),
    db
      .select({
        userId: submissions.userId,
        problemId: submissions.problemId,
        verdict: submissions.verdict,
        score: submissions.score,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.contestId, contest.id),
          eq(submissions.kind, "submit"),
          eq(submissions.status, "done")
        )
      ),
  ])

  const phase = phaseOf(contest)
  // Revealed for everyone when the contest ends; staff can always see the real board.
  const frozen = phase !== "ended" && !staff
  const config = {
    scoring: contest.scoring,
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    penaltyMinutes: contest.penaltyMinutes,
    freezeMinutes: contest.freezeMinutes,
    problemLabels: rows.map((row) => row.link.label),
  }
  const cutoff = freezeTime(config)
  return {
    scoring: contest.scoring,
    problemLabels: config.problemLabels,
    frozen: frozen && cutoff !== null && new Date() >= cutoff,
    rows: computeLeaderboard(
      config,
      participants.map((person) => ({
        id: person.id,
        // Display names only: other students' email addresses are never exposed.
        user: { id: person.id, name: person.name ?? "Student" },
      })),
      attempts.flatMap((attempt) => {
        const label = attempt.problemId && labelOf.get(attempt.problemId)
        return label
          ? [
              {
                userId: attempt.userId,
                problemLabel: label,
                verdict: attempt.verdict,
                score: attempt.score,
                createdAt: attempt.createdAt,
              },
            ]
          : []
      }),
      frozen
    ),
  }
}

/* ---------- staff ---------- */
// `orgId` is the owner: null for platform contests run from the dashboard, or the
// organization whose permissions were already checked. Every query matches it, so an id
// from another organization behaves as if it didn't exist.

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(contests.orgId) : eq(contests.orgId, orgId)

export async function listOwnedContests(orgId: string | null) {
  const db = getDb()
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(contests)
      .where(ownedBy(orgId))
      .orderBy(desc(contests.startsAt)),
    db
      .select({ contestId: contestParticipants.contestId, total: count() })
      .from(contestParticipants)
      .groupBy(contestParticipants.contestId),
  ])
  return rows.map((contest) => ({
    ...contest,
    phase: phaseOf(contest),
    participants: counts.find((c) => c.contestId === contest.id)?.total ?? 0,
  }))
}

export async function getContestForStaff(id: string, orgId: string | null) {
  const [contest] = await getDb()
    .select()
    .from(contests)
    .where(and(eq(contests.id, id), ownedBy(orgId)))
  if (!contest) throw notFound("Contest not found")
  const rows = await contestProblemRows(id)
  return { ...contest, problemIds: rows.map((row) => row.problem.id) }
}

/** Problems an owner may use: published ones, and its own drafts. */
export async function checkUsableProblems(
  problemIds: string[],
  orgId: string | null
) {
  const found = await getDb()
    .select({
      id: problems.id,
      published: problems.published,
      membersOnly: problems.membersOnly,
      orgId: problems.orgId,
    })
    .from(problems)
    .where(inArray(problems.id, problemIds))
  if (found.length !== new Set(problemIds).size) {
    throw new ApiError(
      400,
      "unknown_problem",
      "A chosen problem no longer exists."
    )
  }
  if (found.some((p) => (!p.published || p.membersOnly) && p.orgId !== orgId)) {
    throw new ApiError(
      400,
      "draft_problem",
      "Drafts can only be used by whoever wrote them. Pick published problems or your own."
    )
  }
}

export async function saveContest(
  id: string | null,
  input: ContestInput,
  orgId: string | null
) {
  const { problemIds, ...fields } = input
  await checkUsableProblems(problemIds, orgId)
  const values = { ...fields, orgId, audience: orgId ? fields.audience : [] }
  if (id) refreshLeaderboard(id)
  return getDb().transaction(async (tx) => {
    const [contest] = id
      ? await tx
          .update(contests)
          .set(values)
          .where(and(eq(contests.id, id), ownedBy(orgId)))
          .returning()
      : await tx.insert(contests).values(values).returning()
    if (!contest) throw notFound("Contest not found")
    await tx
      .delete(contestProblems)
      .where(eq(contestProblems.contestId, contest.id))
    await tx.insert(contestProblems).values(
      problemIds.map((problemId, position) => ({
        contestId: contest.id,
        problemId,
        position,
        label: String.fromCharCode(65 + position),
      }))
    )
    return contest
  })
}

function refreshLeaderboard(contestId: string) {
  invalidate(`leaderboard:${contestId}:true`)
  invalidate(`leaderboard:${contestId}:false`)
}

export async function deleteContest(id: string, orgId: string | null) {
  const deleted = await getDb()
    .delete(contests)
    .where(and(eq(contests.id, id), ownedBy(orgId)))
    .returning({ id: contests.id })
  if (deleted.length === 0) throw notFound("Contest not found")
}
