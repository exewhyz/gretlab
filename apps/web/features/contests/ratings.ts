/**
 * Contest ratings (rules: packages/judge/src/rating.ts). Once a rated contest ends, its final
 * standings change the rating of everyone who tried something in it, exactly once and in the
 * order contests ended, so each starts from the ratings the one before left. Virtual attempts
 * are never on the board, so never rated. A person's rating is their latest change's `after`.
 */
import {
  contests,
  getDb,
  ratingChanges,
  sql,
  type Contest,
} from "@workspace/db"
import {
  computeLeaderboard,
  contestRatings,
  INITIAL_RATING,
} from "@workspace/judge"

import { reportError } from "@/lib/report-error"

import { boardInputs } from "./server"

const { and, asc, eq, inArray, isNull, lte } = sql

/** Each person's current rating and how many rated contests they've had. */
async function currentRatings(userIds: string[]) {
  if (!userIds.length)
    return new Map<string, { rating: number; contests: number }>()
  const rows = await getDb()
    .select({
      userId: ratingChanges.userId,
      after: ratingChanges.after,
      createdAt: ratingChanges.createdAt,
    })
    .from(ratingChanges)
    .where(inArray(ratingChanges.userId, userIds))
    .orderBy(asc(ratingChanges.createdAt))
  const out = new Map<string, { rating: number; contests: number }>()
  for (const r of rows) {
    const was = out.get(r.userId)
    out.set(r.userId, { rating: r.after, contests: (was?.contests ?? 0) + 1 })
  }
  return out
}

/** One ended rated contest's changes, written with its `ratedAt` in one transaction. */
async function rate(contest: Contest) {
  const { config, participants, entries } = await boardInputs(contest)
  // Only people who tried something: registering alone isn't taking part.
  const tried = new Set(entries.map((e) => e.userId))
  const board = computeLeaderboard(
    config,
    participants.filter((p) => tried.has(p.id)),
    entries,
    false
  )
  const known = await currentRatings(board.map((r) => r.user.id))
  const changes = contestRatings(
    board.map((row) => ({
      id: row.user.id,
      rank: row.rank,
      rating: known.get(row.user.id)?.rating ?? INITIAL_RATING,
      ratedContests: known.get(row.user.id)?.contests ?? 0,
    }))
  )
  await getDb().transaction(async (tx) => {
    // Applied once: another server got here first if this no longer matches.
    const claimed = await tx
      .update(contests)
      .set({ ratedAt: sql.sql`now()` })
      .where(and(eq(contests.id, contest.id), isNull(contests.ratedAt)))
      .returning({ id: contests.id })
    if (!claimed.length || !changes.length) return
    await tx.insert(ratingChanges).values(
      changes.map((c) => ({
        contestId: contest.id,
        userId: c.id,
        rank: c.rank,
        before: c.before,
        after: c.after,
        // Ordered as the contest ended, so "latest" is the newest contest's.
        createdAt: contest.endsAt,
      }))
    )
  })
}

/**
 * Rates every rated contest that has ended and isn't rated yet, oldest first, under a lock so
 * one server at a time does it. Called by the email cron and after a finished board is read.
 */
export async function applyDueRatings() {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [locked] = (await tx.execute(
      sql.sql`select pg_try_advisory_xact_lock(hashtext('gretlab:ratings')) as ok`
    )) as unknown as { ok: boolean }[]
    if (!locked?.ok) return { rated: 0 }
    const due = await tx
      .select()
      .from(contests)
      .where(
        and(
          eq(contests.rated, true),
          isNull(contests.ratedAt),
          lte(contests.endsAt, sql.sql`now()`)
        )
      )
      .orderBy(asc(contests.endsAt))
      .limit(20)
    let rated = 0
    for (const contest of due) {
      try {
        await rate(contest)
        rated++
      } catch (error) {
        reportError(error, { where: "ratings", contest: contest.id })
        break
      }
    }
    return { rated }
  })
}
