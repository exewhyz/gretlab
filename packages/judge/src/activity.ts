/** Days are calendar days in the site's timezone, as "YYYY-MM-DD". */
export function dayIn(timeZone: string, date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Consecutive days with at least one accepted submission. Today not done yet doesn't break
 * the current streak: it still counts from yesterday, as on LeetCode.
 */
export function streaks(
  activeDays: Iterable<string>,
  today: string
): { current: number; longest: number } {
  const days = new Set(activeDays)
  let current = 0
  let cursor = days.has(today) ? today : previousDay(today)
  while (days.has(cursor)) {
    current += 1
    cursor = previousDay(cursor)
  }
  let longest = 0
  for (const day of days) {
    if (days.has(previousDay(day))) continue
    let length = 0
    let next = day
    while (days.has(next)) {
      length += 1
      const date = new Date(`${next}T12:00:00Z`)
      date.setUTCDate(date.getUTCDate() + 1)
      next = date.toISOString().slice(0, 10)
    }
    longest = Math.max(longest, length)
  }
  return { current, longest: Math.max(longest, current) }
}

/** The automatic pick for a day with nothing scheduled: stable, and spread across problems. */
export function pickDaily<T>(day: string, candidates: T[]): T | null {
  if (!candidates.length) return null
  let value = 0
  for (const char of day) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return candidates[value % candidates.length] ?? null
}

export interface BadgeInput {
  solved: number
  longestStreak: number
  contests: number
  hardSolved: number
}

export interface Badge {
  id: string
  name: string
  description: string
}

const BADGES: (Badge & { earned: (input: BadgeInput) => boolean })[] = [
  { id: "first", name: "First Accepted", description: "Solved a first problem", earned: (i) => i.solved >= 1 },
  { id: "ten", name: "Ten Down", description: "Solved 10 problems", earned: (i) => i.solved >= 10 },
  { id: "fifty", name: "Half Century", description: "Solved 50 problems", earned: (i) => i.solved >= 50 },
  { id: "hard", name: "Hard Mode", description: "Solved a hard problem", earned: (i) => i.hardSolved >= 1 },
  { id: "week", name: "7-Day Streak", description: "Solved something 7 days in a row", earned: (i) => i.longestStreak >= 7 },
  { id: "month", name: "30-Day Streak", description: "Solved something 30 days in a row", earned: (i) => i.longestStreak >= 30 },
  { id: "contest", name: "Contender", description: "Took part in a contest", earned: (i) => i.contests >= 1 },
]

export function earnedBadges(input: BadgeInput): Badge[] {
  return BADGES.filter((badge) => badge.earned(input)).map(
    ({ id, name, description }) => ({ id, name, description })
  )
}
