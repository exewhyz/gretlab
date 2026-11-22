/*
 * What judge machines started from the dashboard cost (Dashboard › Costs). Pure and unit-tested
 * (costs.test.ts). Prices are AWS's on-demand rates in Sydney, checked 22 November 2026 with
 * AWS's price list: each size's hour, plus what every machine also pays by the hour, its public
 * IPv4 address ($0.005) and its 30 GB gp3 disk ($0.096 a GB-month, 730 hours to the month).
 * Judges set up by hand aren't counted: their machines weren't started here.
 */

/** US$ an hour for each size the website may start (features.ts judges.size). */
export const JUDGE_HOURLY: Record<string, number> = {
  "c7i-flex.large": 0.11072,
  "c7i-flex.xlarge": 0.22145,
  "c7i.large": 0.11655,
  "c7i.xlarge": 0.2331,
}

/** The public IPv4 address and the 30 GB disk, by the hour. */
export const MACHINE_EXTRAS_HOURLY = 0.005 + (30 * 0.096) / 730

/** One machine's hour; an unknown size as the dearest allowed, so cost is never understated. */
export function hourlyCost(size: string) {
  const largest = Math.max(...Object.values(JUDGE_HOURLY))
  return (JUDGE_HOURLY[size] ?? largest) + MACHINE_EXTRAS_HOURLY
}

export interface MachineSpan {
  size: string
  /** The organization's address for its own judges; null for shared. */
  pool: string | null
  /** When AWS started it; null if it never started. */
  startedAt: Date | null
  /** When it ended; null while it still runs. */
  endedAt: Date | null
}

const HOUR = 3_600_000

/** This month's cost so far, by pool, and a forecast to the month's end at today's rate. */
export function judgeCosts(machines: MachineSpan[], now: Date) {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  )
  const byPool = new Map<string | null, { hours: number; cost: number }>()
  let soFar = 0
  let runningHourly = 0
  for (const m of machines) {
    if (!m.startedAt) continue
    const from = Math.max(m.startedAt.getTime(), monthStart.getTime())
    const to = Math.min((m.endedAt ?? now).getTime(), now.getTime())
    const hours = Math.max(0, to - from) / HOUR
    const cost = hours * hourlyCost(m.size)
    soFar += cost
    if (!m.endedAt) runningHourly += hourlyCost(m.size)
    const pool = byPool.get(m.pool) ?? { hours: 0, cost: 0 }
    pool.hours += hours
    pool.cost += cost
    byPool.set(m.pool, pool)
  }
  const hoursLeft = Math.max(0, monthEnd.getTime() - now.getTime()) / HOUR
  return {
    monthStart,
    soFar,
    runningHourly,
    forecast: soFar + runningHourly * hoursLeft,
    byPool: [...byPool.entries()]
      .map(([pool, v]) => ({ pool, hours: v.hours, cost: v.cost }))
      .sort((a, b) => b.cost - a.cost),
  }
}
