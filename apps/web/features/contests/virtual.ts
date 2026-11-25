/**
 * Virtual contests (rules: packages/judge/src/virtual.ts). After a contest ends, someone who
 * could have entered it and didn't take part live may take it once on their own clock. Their
 * submissions are stored without the contest (so no official board, report or plagiarism check
 * ever counts them); the attempt is their graded submits to its problems made in the window.
 * Answers to its questions are kept on the attempt's row.
 */
import {
  contestAnswers,
  contestVirtuals,
  getDb,
  problems,
  sql,
  submissions,
  users,
  type Contest,
  type User,
} from "@workspace/db"
import {
  markQuestion,
  virtualBoard,
  virtualPhase,
  virtualRefusal,
} from "@workspace/judge"

import { dbNow } from "@/features/exams/sittings"
import { requireFeature } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"

import {
  answerContestQuestion,
  boardInputs,
  contestProblemRows,
  contestQuestionRows,
  findContest,
  getContestProblem,
  getContestView,
  phaseOf,
} from "./server"

const { and, eq, gte, inArray, lt } = sql

const REFUSALS = {
  contest_not_over: "A contest can be taken virtually once it has ended.",
  took_part_live:
    "You took part in this contest, so it can't be taken again virtually.",
  already_taken: "You've already taken this contest virtually.",
} as const

async function attemptOf(contestId: string, userId: string) {
  const [row] = await getDb()
    .select()
    .from(contestVirtuals)
    .where(
      and(
        eq(contestVirtuals.contestId, contestId),
        eq(contestVirtuals.userId, userId)
      )
    )
  return row ?? null
}

/** Made a graded submission or answered a question during the live contest. */
async function tookPartLive(contest: Contest, userId: string) {
  const db = getDb()
  const [[submitted], [answered]] = await Promise.all([
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.contestId, contest.id),
          eq(submissions.userId, userId),
          eq(submissions.kind, "submit")
        )
      )
      .limit(1),
    db
      .select({ userId: contestAnswers.userId })
      .from(contestAnswers)
      .where(
        and(
          eq(contestAnswers.contestId, contest.id),
          eq(contestAnswers.userId, userId)
        )
      )
      .limit(1),
  ])
  return Boolean(submitted || answered)
}

/** The viewer's virtual attempt at a contest: whether they may start one, or where it stands. */
export async function virtualStatus(slug: string, user: User) {
  await requireFeature("contests.enabled")
  const { contest } = await findContest(slug, user)
  const [now, attempt, live] = await Promise.all([
    dbNow(),
    attemptOf(contest.id, user.id),
    tookPartLive(contest, user.id),
  ])
  if (!attempt) {
    const refusal = virtualRefusal({
      contest,
      now,
      tookPartLive: live,
      alreadyTaken: false,
    })
    return {
      state: refusal ? ("unavailable" as const) : ("available" as const),
      reason: refusal,
      lengthMinutes: Math.round(
        (contest.endsAt.getTime() - contest.startsAt.getTime()) / 60_000
      ),
    }
  }
  const phase = virtualPhase(contest, attempt.startedAt, now)
  const board = phase.running
    ? null
    : await boardFor(contest, user, attempt, now)
  const mine = board?.rows.find((r) => r.user.id === user.id)
  return {
    state: phase.running ? ("running" as const) : ("done" as const),
    startedAt: attempt.startedAt,
    endsAt: phase.endsAt,
    now,
    /** Once it's over: where they'd have finished. */
    result: mine
      ? {
          scoring: contest.scoring,
          rank: mine.rank,
          of: board!.rows.length,
          solved: mine.solved,
          penalty: mine.penalty,
          score: mine.score,
        }
      : null,
  }
}

/** Starts the viewer's one virtual attempt, now. */
export async function startVirtual(slug: string, user: User) {
  await requireFeature("contests.enabled")
  const { contest } = await findContest(slug, user)
  const [now, live] = await Promise.all([
    dbNow(),
    tookPartLive(contest, user.id),
  ])
  const refusal = virtualRefusal({
    contest,
    now,
    tookPartLive: live,
    alreadyTaken: false,
  })
  if (refusal) throw new ApiError(409, refusal, REFUSALS[refusal])
  const [started] = await getDb()
    .insert(contestVirtuals)
    .values({ contestId: contest.id, userId: user.id })
    .onConflictDoNothing()
    .returning()
  if (!started) throw new ApiError(409, "already_taken", REFUSALS.already_taken)
  return { startedAt: started.startedAt }
}

/**
 * For submitting: true when this person is in a running virtual attempt at the contest, whose
 * submissions then go in without the contest. Its own rules (where code runs, languages,
 * limits) still apply.
 */
export async function inRunningVirtual(contest: Contest, userId: string) {
  const attempt = await attemptOf(contest.id, userId)
  if (!attempt) return false
  return virtualPhase(contest, attempt.startedAt, await dbNow()).running
}

/** Answering a contest question: live as before, or during the viewer's virtual attempt. */
export async function answerQuestion(
  slug: string,
  questionId: string,
  user: User,
  answer: string[] | string
) {
  await requireFeature("contests.enabled")
  const { contest } = await findContest(slug, user)
  if (phaseOf(contest) !== "ended")
    return answerContestQuestion(slug, questionId, user, answer)
  const [attempt, now] = await Promise.all([
    attemptOf(contest.id, user.id),
    dbNow(),
  ])
  if (!attempt || !virtualPhase(contest, attempt.startedAt, now).running)
    throw new ApiError(
      403,
      "contest_not_live",
      "Answers count only while the contest runs."
    )
  const q = (await contestQuestionRows(contest.id)).find(
    (x) => x.id === questionId
  )
  if (!q) throw notFound("Question not found")
  if ((q.kind === "single" || q.kind === "multiple") && Array.isArray(answer)) {
    const valid = q.options.map((o) => o.id)
    if (answer.some((id) => !valid.includes(id)))
      throw new ApiError(400, "bad_answer", "Choose from the options.")
  }
  const correct = markQuestion(q, answer).earned === q.points
  // One answer each: the update only applies while this question has none.
  const saved = await getDb()
    .update(contestVirtuals)
    .set({
      answers: sql.sql`${contestVirtuals.answers} || jsonb_build_object(${questionId}::text, ${JSON.stringify({ answer, correct, answeredAt: now.toISOString() })}::jsonb)`,
    })
    .where(
      and(
        eq(contestVirtuals.contestId, contest.id),
        eq(contestVirtuals.userId, user.id),
        sql.sql`not (${contestVirtuals.answers} ? ${questionId}::text)`
      )
    )
    .returning({ userId: contestVirtuals.userId })
  if (!saved.length)
    throw new ApiError(
      409,
      "already_answered",
      "You've already answered this question."
    )
  return { correct }
}

/** The viewer's own answers in their virtual attempt, by question id. */
export async function virtualAnswers(contest: Contest, userId: string) {
  return (await attemptOf(contest.id, userId))?.answers ?? null
}

async function boardFor(
  contest: Contest,
  user: User,
  attempt: NonNullable<Awaited<ReturnType<typeof attemptOf>>>,
  now: Date
) {
  const { config, participants, entries, labelOf, questionOf } =
    await boardInputs(contest)
  const phase = virtualPhase(contest, attempt.startedAt, now)
  const problemIds = [...labelOf.keys()]
  const own = problemIds.length
    ? await getDb()
        .select({
          problemId: submissions.problemId,
          verdict: submissions.verdict,
          score: submissions.score,
          createdAt: submissions.createdAt,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.userId, user.id),
            inArray(submissions.problemId, problemIds),
            eq(submissions.kind, "submit"),
            eq(submissions.status, "done"),
            gte(submissions.createdAt, attempt.startedAt),
            lt(submissions.createdAt, phase.endsAt)
          )
        )
    : []
  const [me] = await getDb()
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, user.id))
  const taker = { id: user.id, user: { id: user.id, name: me?.name ?? "You" } }
  const takerEntries = [
    ...own.flatMap((s) => {
      const label = s.problemId && labelOf.get(s.problemId)
      return label
        ? [
            {
              userId: user.id,
              problemLabel: label,
              verdict: s.verdict,
              score: s.score,
              createdAt: s.createdAt,
            },
          ]
        : []
    }),
    ...Object.entries(attempt.answers).flatMap(([questionId, a]) => {
      const q = questionOf.get(questionId)
      return q
        ? [
            {
              userId: user.id,
              problemLabel: q.label,
              verdict: (a.correct ? "AC" : "WA") as "AC" | "WA",
              score: a.correct ? q.points : 0,
              createdAt: new Date(a.answeredAt),
            },
          ]
        : []
    }),
  ]
  return {
    scoring: contest.scoring,
    problemLabels: config.problemLabels,
    rows: virtualBoard({
      config,
      participants,
      submissions: entries,
      taker,
      takerSubmissions: takerEntries,
      startedAt: attempt.startedAt,
      now,
    }),
  }
}

/**
 * The taker's board: the real contestants as they stood at the same minute of the original,
 * with the taker among them (marked `you`). Only for someone who has started an attempt.
 */
export async function virtualLeaderboard(slug: string, user: User) {
  await requireFeature("contests.enabled")
  const { contest } = await findContest(slug, user)
  const attempt = await attemptOf(contest.id, user.id)
  if (!attempt) throw notFound("You haven't taken this contest virtually")
  const now = await dbNow()
  const board = await boardFor(contest, user, attempt, now)
  const phase = virtualPhase(contest, attempt.startedAt, now)
  const cutoff =
    contest.freezeMinutes > 0
      ? contest.endsAt.getTime() - contest.freezeMinutes * 60_000
      : null
  return {
    ...board,
    you: user.id,
    running: phase.running,
    /** Minutes into the contest the board stands at. */
    minute: Math.floor(phase.elapsedMs / 60_000),
    frozen:
      phase.running &&
      cutoff !== null &&
      contest.startsAt.getTime() + phase.elapsedMs >= cutoff,
  }
}

/** For the contest's problem list during an attempt: the taker's own result per problem. */
export async function virtualStatusByProblem(contest: Contest, userId: string) {
  const attempt = await attemptOf(contest.id, userId)
  if (!attempt) return null
  const phase = virtualPhase(contest, attempt.startedAt, await dbNow())
  const rows = await contestProblemRows(contest.id)
  const ids = rows.map((r) => r.problem.id)
  if (!ids.length) return {}
  const done = await getDb()
    .selectDistinct({ slug: problems.slug, verdict: submissions.verdict })
    .from(submissions)
    .innerJoin(problems, eq(submissions.problemId, problems.id))
    .where(
      and(
        eq(submissions.userId, userId),
        inArray(submissions.problemId, ids),
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        gte(submissions.createdAt, attempt.startedAt),
        lt(submissions.createdAt, phase.endsAt)
      )
    )
  const status: Record<string, "solved" | "tried"> = {}
  for (const row of done) {
    if (row.verdict === "AC") status[row.slug] = "solved"
    else status[row.slug] ??= "tried"
  }
  return status
}

/**
 * The contest page's data, with the viewer's virtual attempt: while it runs, their own answers
 * and results come from the attempt and right answers stay hidden; afterwards, as for anyone.
 */
export async function contestViewWithVirtual(
  slug: string,
  viewer: User | null
) {
  const view = await getContestView(slug, viewer)
  if (!viewer || view.phase !== "ended") return { ...view, virtual: null }
  const virtual = await virtualStatus(slug, viewer)
  if (virtual.state !== "running" && virtual.state !== "done")
    return { ...view, virtual }
  const { contest } = await findContest(slug, viewer)
  const [answers, status] = await Promise.all([
    virtualAnswers(contest, viewer.id),
    virtualStatusByProblem(contest, viewer.id),
  ])
  const running = virtual.state === "running"
  return {
    ...view,
    virtual,
    problems: view.problems.map((p) => ({
      ...p,
      status: status?.[p.id] ?? null,
    })),
    questions: view.questions.map((q) => {
      const mine = answers?.[q.id]
      return {
        ...q,
        answer: mine ? { value: mine.answer, correct: mine.correct } : null,
        solution: running ? null : q.solution,
      }
    }),
  }
}

/** A contest problem's page data, with the viewer's virtual attempt when one is running. */
export async function contestProblemWithVirtual(
  slug: string,
  label: string,
  viewer: User | null
) {
  const data = await getContestProblem(slug, label, viewer)
  if (!viewer || data.contest.phase !== "ended")
    return { ...data, virtual: null }
  const { contest } = await findContest(slug, viewer)
  const attempt = await attemptOf(contest.id, viewer.id)
  if (!attempt) return { ...data, virtual: null }
  const phase = virtualPhase(contest, attempt.startedAt, await dbNow())
  if (!phase.running) return { ...data, virtual: null }
  return {
    ...data,
    status: (await virtualStatusByProblem(contest, viewer.id)) ?? {},
    virtual: { endsAt: phase.endsAt },
  }
}
