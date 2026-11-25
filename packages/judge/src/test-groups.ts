/**
 * Test-case groups (subtasks; the owner's decisions, 25 November 2026). Tests sharing a group
 * name are scored together: the group is worth the sum of its tests' points and earns them only
 * when every one of its tests passes. Once a test in a group fails, the judge skips the group's
 * remaining tests (they can't change its score). Tests without a group score one by one, as
 * they always have. Used by the runner and by browser grading, so both score alike.
 */
import type { Verdict } from "./verdicts.ts"

export const MAX_GROUP_NAME = 40

/** A group name as stored: trimmed, and blank meaning none. */
export function groupName(value: string | null | undefined): string | null {
  const name = value?.trim()
  return name ? name : null
}

const passed = (verdict: Verdict) => verdict === "AC"

/**
 * Whether the test at `index` is skipped: it's in a group, and an earlier test of that group
 * (whose verdicts are `before`, in order) has already failed.
 */
export function skipsCase(
  cases: readonly { group: string | null }[],
  index: number,
  before: readonly Verdict[]
): boolean {
  const group = cases[index]?.group
  if (!group) return false
  return before.some(
    (verdict, i) => cases[i]?.group === group && !passed(verdict)
  )
}

export type GroupScore = {
  name: string
  /** What the group is worth: the sum of its tests' points. */
  points: number
  earned: number
  passed: boolean
  tests: number
}

/** Each test's points, the total and each group's result, groups in the order they first appear. */
export function scoreCases(
  cases: readonly { group: string | null; points: number; verdict: Verdict }[]
): { points: number[]; score: number; maxScore: number; groups: GroupScore[] } {
  const groups = new Map<string, GroupScore>()
  for (const c of cases) {
    if (!c.group) continue
    const g = groups.get(c.group) ?? {
      name: c.group,
      points: 0,
      earned: 0,
      passed: true,
      tests: 0,
    }
    g.points += c.points
    g.tests += 1
    g.passed &&= passed(c.verdict)
    groups.set(c.group, g)
  }
  for (const g of groups.values()) g.earned = g.passed ? g.points : 0
  const points = cases.map((c) =>
    c.group
      ? groups.get(c.group)!.passed
        ? c.points
        : 0
      : passed(c.verdict)
        ? c.points
        : 0
  )
  return {
    points,
    score: points.reduce((sum, p) => sum + p, 0),
    maxScore: cases.reduce((sum, c) => sum + c.points, 0),
    groups: [...groups.values()],
  }
}

/**
 * A judged submission's groups, from its stored results: each grouped result keeps its
 * test's full points (`worth`) beside what it earned (`points`).
 */
export function groupSummary(
  results: readonly {
    group?: string | null
    points: number
    worth?: number
    verdict: Verdict
  }[]
): GroupScore[] {
  const groups = new Map<string, GroupScore>()
  for (const r of results) {
    if (!r.group) continue
    const g = groups.get(r.group) ?? {
      name: r.group,
      points: 0,
      earned: 0,
      passed: true,
      tests: 0,
    }
    g.points += r.worth ?? 0
    g.earned += r.points
    g.tests += 1
    g.passed &&= passed(r.verdict)
    groups.set(r.group, g)
  }
  return [...groups.values()]
}
