/*
 * When a course's modules open for a student. A module opens `openAfterDays` after the
 * class starts the course (on the start day when unset), and, with `afterPrevious`, only
 * once the student has finished the module before it. Pure; dates are YYYY-MM-DD.
 */

export interface ReleaseRule {
  openAfterDays: number | null
  afterPrevious: boolean
  /** Items in the module, and how many this student has finished. */
  total: number
  done: number
}

export interface Release {
  opensOn: string
  open: boolean
  /** Why it's still closed. */
  waiting: "date" | "previous" | null
  complete: boolean
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function releaseModules(rules: ReleaseRule[], startsOn: string, today: string): Release[] {
  const out: Release[] = []
  for (const [i, rule] of rules.entries()) {
    const opensOn = addDays(startsOn, rule.openAfterDays ?? 0)
    const before = out[i - 1]
    const previousDone = !rule.afterPrevious || i === 0 || (before!.open && before!.complete)
    const dateReached = today >= opensOn
    const open = dateReached && previousDone
    out.push({
      opensOn,
      open,
      waiting: open ? null : !dateReached ? "date" : "previous",
      complete: rule.done >= rule.total,
    })
  }
  return out
}
