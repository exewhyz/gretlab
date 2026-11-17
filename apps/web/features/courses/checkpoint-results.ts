import {
  courseAttempts,
  courseProjectSubmissions,
  courseQuizAnswers,
  getDb,
  questions,
  sql,
  submissions,
} from "@workspace/db"
import {
  attemptState,
  labPoints,
  markQuestion,
  type Attempt,
} from "@workspace/judge"

import type { OutlineCheckpoint } from "./server"

/*
 * Where each student stands on a course's checkpoints, computed from their attempts,
 * answers, submissions and marks every time (never stored), like assignment grades:
 * - a quiz: its saved answers, marked when read (each question scaled to its points here);
 * - a lab: per problem, the best graded submission made during the attempt;
 * - a project: the teacher's mark.
 * A quiz or lab counts toward module progress once its attempt is over; a project once
 * handed in. Scores are final once the attempt is over, or the project is marked.
 */

const { and, eq, gte, inArray } = sql

export type CheckpointState =
  "not_started" | "running" | "finished" | "handed_in" | "marked"

export interface CheckpointResult {
  state: CheckpointState
  attempt: Attempt | null
  earned: number
  max: number
  /** The score won't change any more. */
  final: boolean
  /** Counts toward finishing the module. */
  done: boolean
}

export type Results = Map<string, Map<string, CheckpointResult>>

export async function checkpointResults(
  userIds: string[],
  checkpoints: OutlineCheckpoint[],
  now: Date
): Promise<Results> {
  const out: Results = new Map(userIds.map((u) => [u, new Map()]))
  if (userIds.length === 0 || checkpoints.length === 0) return out
  const db = getDb()
  const timed = checkpoints.filter((c) => c.kind !== "project")
  const quizzes = checkpoints.filter((c) => c.kind === "quiz")
  const labs = checkpoints.filter((c) => c.kind === "lab")
  const projects = checkpoints.filter((c) => c.kind === "project")
  const questionIds = [
    ...new Set(quizzes.flatMap((c) => c.items.map((i) => i.id))),
  ]
  const problemIds = [...new Set(labs.flatMap((c) => c.items.map((i) => i.id)))]

  const [attempts, answers, qs, handedIn] = await Promise.all([
    timed.length
      ? db
          .select()
          .from(courseAttempts)
          .where(
            and(
              inArray(
                courseAttempts.checkpointId,
                timed.map((c) => c.id)
              ),
              inArray(courseAttempts.userId, userIds)
            )
          )
      : [],
    quizzes.length
      ? db
          .select()
          .from(courseQuizAnswers)
          .where(
            and(
              inArray(
                courseQuizAnswers.checkpointId,
                quizzes.map((c) => c.id)
              ),
              inArray(courseQuizAnswers.userId, userIds)
            )
          )
      : [],
    questionIds.length
      ? db.select().from(questions).where(inArray(questions.id, questionIds))
      : [],
    projects.length
      ? db
          .select()
          .from(courseProjectSubmissions)
          .where(
            and(
              inArray(
                courseProjectSubmissions.checkpointId,
                projects.map((c) => c.id)
              ),
              inArray(courseProjectSubmissions.userId, userIds)
            )
          )
      : [],
  ])
  const labAttempts = attempts.filter((a) =>
    labs.some((c) => c.id === a.checkpointId)
  )
  const earliest = labAttempts.reduce<Date | null>(
    (min, a) => (!min || a.startedAt < min ? a.startedAt : min),
    null
  )
  const subs =
    problemIds.length && earliest
      ? await db
          .select({
            userId: submissions.userId,
            problemId: submissions.problemId,
            createdAt: submissions.createdAt,
            verdict: submissions.verdict,
            score: submissions.score,
            maxScore: submissions.maxScore,
          })
          .from(submissions)
          .where(
            and(
              inArray(
                submissions.userId,
                labAttempts.map((a) => a.userId)
              ),
              inArray(submissions.problemId, problemIds),
              eq(submissions.kind, "submit"),
              gte(submissions.createdAt, earliest)
            )
          )
      : []

  for (const userId of userIds) {
    const mine = out.get(userId)!
    for (const c of checkpoints) {
      if (c.kind === "project") {
        const s = handedIn.find(
          (x) => x.userId === userId && x.checkpointId === c.id
        )
        mine.set(c.id, {
          state: !s ? "not_started" : s.mark === null ? "handed_in" : "marked",
          attempt: null,
          earned: s?.mark ?? 0,
          max: c.max,
          final: s?.mark !== null && s?.mark !== undefined,
          done: Boolean(s),
        })
        continue
      }
      const row = attempts.find(
        (a) => a.userId === userId && a.checkpointId === c.id
      )
      const attempt: Attempt | null = row
        ? {
            startedAt: row.startedAt,
            endsAt: row.endsAt,
            finishedAt: row.finishedAt,
          }
        : null
      const state = attemptState(attempt, now)
      let earned = 0
      if (attempt && c.kind === "quiz") {
        for (const item of c.items) {
          const q = qs.find((x) => x.id === item.id)
          const a = answers.find(
            (x) =>
              x.userId === userId &&
              x.checkpointId === c.id &&
              x.questionId === item.id
          )
          if (!q || !a || q.points <= 0) continue
          // A short answer that matches nothing accepted is simply wrong here: nobody marks it.
          const mark = markQuestion(q, a.answer).earned ?? 0
          earned += (item.points * mark) / q.points
        }
      }
      if (attempt && c.kind === "lab") {
        for (const item of c.items) {
          earned += labPoints(
            item.points,
            subs.filter((s) => s.userId === userId && s.problemId === item.id),
            attempt
          )
        }
      }
      mine.set(c.id, {
        state,
        attempt,
        earned: Math.round(earned * 100) / 100,
        max: c.max,
        final: state === "finished",
        done: state === "finished",
      })
    }
  }
  return out
}
