/*
 * Outcome-based education: course outcomes (COs) mapped to program outcomes (POs), and how
 * far a class attained them, the way accreditation (NBA) reports ask for it. Pure rules.
 *
 * A student reaches a CO when their marks on the problems tagged with it are at least the
 * threshold (60%). The CO's level is 3, 2 or 1 when at least levels[2], [1] or [0] percent
 * of assessed students reached it, else 0. A PO's attainment is the average of its COs'
 * levels weighted by how strongly each CO maps to it (1 low, 2 medium, 3 high).
 */

export interface AttainmentRules {
  /** Percent of a CO's marks a student needs to reach it. */
  threshold: number
  /** Percent of students reaching a CO for levels 1, 2 and 3, rising. */
  levels: [number, number, number]
}

export const DEFAULT_ATTAINMENT: AttainmentRules = {
  threshold: 60,
  levels: [50, 60, 70],
}

/** How strongly a CO supports a PO. */
export type Strength = 1 | 2 | 3

export function attainmentLevel(
  percentReached: number,
  levels: AttainmentRules["levels"]
): 0 | 1 | 2 | 3 {
  if (percentReached >= levels[2]) return 3
  if (percentReached >= levels[1]) return 2
  if (percentReached >= levels[0]) return 1
  return 0
}

/** One student's marks on everything tagged with a CO. */
export interface OutcomeMarks {
  earned: number
  max: number
}

export interface CoAttainment {
  /** Students with something to be assessed on. */
  assessed: number
  reached: number
  /** Percent of assessed students who reached it; null when nobody was assessed. */
  percent: number | null
  level: 0 | 1 | 2 | 3 | null
}

export const reachedOutcome = (m: OutcomeMarks, rules: AttainmentRules) =>
  m.max > 0 && (100 * m.earned) / m.max >= rules.threshold

export function coAttainment(
  students: readonly OutcomeMarks[],
  rules: AttainmentRules
): CoAttainment {
  const assessed = students.filter((s) => s.max > 0)
  if (assessed.length === 0) {
    return { assessed: 0, reached: 0, percent: null, level: null }
  }
  const reached = assessed.filter((s) => reachedOutcome(s, rules)).length
  const percent = Math.round((1000 * reached) / assessed.length) / 10
  return {
    assessed: assessed.length,
    reached,
    percent,
    level: attainmentLevel(percent, rules.levels),
  }
}

/**
 * A PO's attainment from its COs: Σ(level × strength) / Σ(strength), over COs that map to
 * it and were assessed. Null when none were.
 */
export function poAttainment(
  cos: readonly {
    level: number | null
    mapping: Readonly<Record<string, number>>
  }[],
  poId: string
): number | null {
  let weighted = 0
  let strength = 0
  for (const co of cos) {
    const s = co.mapping[poId] ?? 0
    if (s <= 0 || co.level === null) continue
    weighted += co.level * s
    strength += s
  }
  return strength === 0 ? null : Math.round((100 * weighted) / strength) / 100
}

/** Rules a teacher can save: a threshold in 1..100 and rising levels. */
export function validRules(rules: AttainmentRules) {
  const [a, b, c] = rules.levels
  return (
    rules.threshold > 0 &&
    rules.threshold <= 100 &&
    a >= 0 &&
    a < b &&
    b < c &&
    c <= 100
  )
}

/** The twelve program outcomes NBA used for engineering degrees: a starting point to edit. */
export const NBA_PROGRAM_OUTCOMES: { code: string; title: string }[] = [
  { code: "PO1", title: "Engineering knowledge" },
  { code: "PO2", title: "Problem analysis" },
  { code: "PO3", title: "Design and development of solutions" },
  { code: "PO4", title: "Investigation of complex problems" },
  { code: "PO5", title: "Modern tool usage" },
  { code: "PO6", title: "The engineer and society" },
  { code: "PO7", title: "Environment and sustainability" },
  { code: "PO8", title: "Ethics" },
  { code: "PO9", title: "Individual and team work" },
  { code: "PO10", title: "Communication" },
  { code: "PO11", title: "Project management and finance" },
  { code: "PO12", title: "Life-long learning" },
]
