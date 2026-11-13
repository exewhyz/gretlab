import type { RunState } from "@workspace/judge"

/* How a run reads on any page: its dates and where it is. Browser-safe. */

const DAY = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const

/** "5 Jan 2026 – 29 Mar 2026" for a run's dates. */
export function runLabel(startsOn: string, endsOn: string) {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", DAY)
  return `${f(startsOn)} – ${f(endsOn)}`
}

/** "Week 3 of 12", "Starts in 4 days", "Finished". */
export function runStatus(s: RunState) {
  if (s.status === "running") return `Week ${s.week} of ${s.weeks}`
  if (s.status === "upcoming") return s.days === 1 ? "Starts tomorrow" : `Starts in ${s.days} days`
  return "Finished"
}

/** How far through it is, 0–100. */
export function runPercent(s: RunState) {
  return s.status === "finished" ? 100 : s.status === "upcoming" ? 0 : Math.round((100 * s.week!) / s.weeks)
}
