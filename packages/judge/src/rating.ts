/**
 * Contest ratings (the owner's decisions, 25 November 2026): Elo for many players. Each
 * contestant is compared with every other on the final board (a better rank is a win, the same
 * rank half a win) against the chance their ratings gave them, and moves by K times the average
 * surprise. Everyone starts at 1500; newcomers move twice as fast for their first contests so
 * they settle quickly. Among equally rated people the changes add up to nothing.
 */

export const INITIAL_RATING = 1500
/** Rated contests during which a newcomer's rating moves faster. */
export const NEWCOMER_CONTESTS = 5
const K = 32

/** The chance someone rated `a` finishes above someone rated `b`. */
const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400))

export interface RatedContestant {
  id: string
  /** Final rank: equal ranks are ties. */
  rank: number
  /** Their rating before this contest (INITIAL_RATING if they have none). */
  rating: number
  /** Rated contests they took part in before this one. */
  ratedContests: number
}

export function contestRatings(people: readonly RatedContestant[]) {
  const n = people.length
  return people.map((me) => {
    if (n < 2)
      return { id: me.id, rank: me.rank, before: me.rating, after: me.rating }
    let surprise = 0
    for (const other of people) {
      if (other === me) continue
      const score = me.rank < other.rank ? 1 : me.rank === other.rank ? 0.5 : 0
      surprise += score - expected(me.rating, other.rating)
    }
    const k = me.ratedContests < NEWCOMER_CONTESTS ? 2 * K : K
    const after = Math.max(0, Math.round(me.rating + (k * surprise) / (n - 1)))
    return { id: me.id, rank: me.rank, before: me.rating, after }
  })
}
