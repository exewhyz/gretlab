/**
 * A person's contest rating and the rated contests behind it, for their profile. Reads only the
 * database, so profiles needn't load the contest server (features/contests/ratings.ts applies
 * the changes).
 */
import { contests, getDb, ratingChanges, sql } from "@workspace/db"

const { desc, eq } = sql

/** A person's rating and rated contests, newest first, for their profile. */
export async function ratingHistory(userId: string) {
  const rows = await getDb()
    .select({
      slug: contests.slug,
      title: contests.title,
      endsAt: contests.endsAt,
      rank: ratingChanges.rank,
      before: ratingChanges.before,
      after: ratingChanges.after,
    })
    .from(ratingChanges)
    .innerJoin(contests, eq(ratingChanges.contestId, contests.id))
    .where(eq(ratingChanges.userId, userId))
    .orderBy(desc(ratingChanges.createdAt))
  return { rating: rows[0]?.after ?? null, contests: rows }
}
