/*
 * Peer review: who reviews whom, and how a review is scored. Pure. Pairing is a shuffled
 * ring, so nobody reviews themselves, everyone reviews the same number, and everyone's
 * work gets the same number of reviews; the same seed gives the same pairs.
 */

export interface PeerReviewSettings {
  /** Reviews each student writes (and receives), per problem. */
  reviews: number
  /** Reviewers and authors don't see each other's names (teachers always do). */
  anonymous: boolean
  /** Reviews can be written and changed until then; null for no end. ISO time. */
  dueAt: string | null
}

export interface ReviewCriterion {
  id: string
  label: string
  points: number
}

/** A problem with no rubric is reviewed on one overall score. */
export const OVERALL: ReviewCriterion = { id: "overall", label: "Overall", points: 5 }

export const criteriaFor = (rubric: readonly ReviewCriterion[]) => (rubric.length ? [...rubric] : [OVERALL])

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A deterministic shuffle (by seed), so pairs don't follow names or join order. */
function shuffled<T>(items: readonly T[], seed: string, key: (item: T) => string) {
  return [...items].sort((a, b) => hash(seed + key(a)) - hash(seed + key(b)) || key(a).localeCompare(key(b)))
}

/** Pairs authors with reviewers: each reviews the next `reviews` people around the ring. */
export function allocateReviews(authors: readonly string[], reviews: number, seed: string) {
  const ring = shuffled([...new Set(authors)], seed, (x) => x)
  const k = Math.min(reviews, ring.length - 1)
  const pairs: { reviewer: string; author: string }[] = []
  for (const [i, reviewer] of ring.entries()) {
    for (let step = 1; step <= k; step++) pairs.push({ reviewer, author: ring[(i + step) % ring.length]! })
  }
  return pairs
}

/** Checks a review's scores against its criteria: every criterion, whole points in range. */
export function checkScores(criteria: readonly ReviewCriterion[], scores: Record<string, number>) {
  const errors: string[] = []
  for (const c of criteria) {
    const s = scores[c.id]
    if (s === undefined) errors.push(`Score "${c.label}"`)
    else if (!Number.isInteger(s) || s < 0 || s > c.points) errors.push(`"${c.label}" is out of ${c.points}`)
  }
  for (const id of Object.keys(scores)) {
    if (!criteria.some((c) => c.id === id)) errors.push("A score for an unknown criterion")
  }
  return errors
}
