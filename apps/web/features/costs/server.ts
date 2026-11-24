import { getDb, judgeMachines, organizations, sql } from "@workspace/db"
import { hourlyCost, judgeCosts } from "@workspace/judge"

/*
 * Dashboard › Costs: what judge machines started from the dashboard cost this month
 * (packages/judge/src/costs.ts does the arithmetic, at AWS's Sydney prices). A machine counts
 * from when it was started until it stopped; one that failed while setting up still runs, and
 * costs, until someone stops it, so it counts until then.
 */

const { and, eq, gte, isNotNull, or, inArray } = sql

export async function costs() {
  const now = new Date()
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
  const rows = await getDb()
    .select({
      size: judgeMachines.size,
      stage: judgeMachines.stage,
      note: judgeMachines.note,
      createdAt: judgeMachines.createdAt,
      stageAt: judgeMachines.stageAt,
      pool: organizations.slug,
      poolId: judgeMachines.poolOrgId,
      poolName: organizations.name,
    })
    .from(judgeMachines)
    .leftJoin(organizations, eq(organizations.id, judgeMachines.poolOrgId))
    .where(
      and(
        isNotNull(judgeMachines.instanceId),
        // Ended this month, or still running.
        or(
          gte(judgeMachines.stageAt, monthStart),
          inArray(judgeMachines.stage, [
            "launching",
            "installing",
            "ready",
            "draining",
            "drained",
            "stopping",
            "failed",
          ])
        )
      )
    )
  const ended = (r: (typeof rows)[number]) =>
    r.stage === "stopped" ||
    (r.stage === "failed" && r.note.includes("stopped without being asked"))
  const report = judgeCosts(
    rows.map((r) => ({
      size: r.size,
      pool: r.pool,
      startedAt: r.createdAt,
      endedAt: ended(r) ? r.stageAt : null,
    })),
    now
  )
  const names = new Map(rows.map((r) => [r.pool, r.poolName]))
  const ids = new Map(rows.map((r) => [r.pool, r.poolId]))
  return {
    /** "November 2026". */
    month: report.monthStart.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    soFar: report.soFar,
    forecast: report.forecast,
    runningHourly: report.runningHourly,
    running: rows.filter((r) => !ended(r)).length,
    byPool: report.byPool.map((p) => ({
      pool: p.pool,
      name: p.pool ? (names.get(p.pool) ?? p.pool) : null,
      /** The organization's id; null for the shared judges. */
      id: p.pool ? (ids.get(p.pool) ?? null) : null,
      hours: p.hours,
      cost: p.cost,
      forecast: p.forecast,
    })),
    /** US$ an hour for each size, as charged here. */
    prices: Object.fromEntries(
      ["c7i-flex.large", "c7i-flex.xlarge", "c7i.large", "c7i.xlarge"].map(
        (s) => [s, hourlyCost(s)]
      )
    ),
  }
}
