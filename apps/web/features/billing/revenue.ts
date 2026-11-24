import {
  getDb,
  organizations,
  payments,
  sql,
  subscriptions,
  type User,
} from "@workspace/db"
import { margins, monthlyRevenue, type BillingPeriod } from "@workspace/judge"

import { costs } from "@/features/costs/server"
import { getSettings } from "@/features/settings/server"
import { needPlans } from "./server"

/*
 * Dashboard › Plans › Revenue: what each organization pays a month against what its judging
 * costs this month (margins() in packages/judge/src/billing.ts). Costs are Dashboard › Costs'
 * judge machines, forecast to the month's end: an organization's own, plus a share of the shared
 * ones by its submissions this month. Machines set up by hand and the rest of the bill (database,
 * hosting, email) aren't counted, so a margin here is an upper bound.
 */

const { and, eq, gt, gte, inArray } = sql
const q = sql.sql

/** At most this many organizations are listed (the worst margins first); totals count all. */
const SHOWN = 200

export async function revenue(user: User) {
  await needPlans(user)
  const db = getDb()
  const now = new Date()
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
  const [machines, paying, work, received, settings] = await Promise.all([
    costs(),
    // Plans that bring something in.
    db
      .select({
        id: subscriptions.orgId,
        status: subscriptions.status,
        period: subscriptions.period,
        price: subscriptions.price,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, ["active", "custom"]),
          gt(subscriptions.price, 0)
        )
      ),
    // Whose work the judges ran this month (runs too); null: personal practice and the platform's.
    db.execute(q`
      select pool_org_id as id, count(*)::int as n from submissions
      where kind = any('{run,submit}'::submission_kind[]) and created_at >= ${monthStart.toISOString()}
      group by pool_org_id`) as unknown as Promise<
      { id: string | null; n: number }[]
    >,
    db
      .select({ total: q<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(eq(payments.status, "paid"), gte(payments.paidAt, monthStart))
      ),
    getSettings(),
  ])
  const usdRate = settings["billing.usd_rate"]
  const submissions = new Map(work.map((w) => [w.id, Number(w.n)]))
  const own = new Map(
    machines.byPool.filter((p) => p.id).map((p) => [p.id!, p.forecast])
  )
  const plan = new Map(paying.map((p) => [p.id, p]))
  const ids = [
    ...new Set([
      ...plan.keys(),
      ...own.keys(),
      ...[...submissions.keys()].filter((id): id is string => id !== null),
    ]),
  ]
  const report = margins(
    ids.map((id) => {
      const p = plan.get(id)
      return {
        id,
        monthly: p
          ? monthlyRevenue(p.price, p.period as BillingPeriod, p.status)
          : 0,
        ownCost: own.get(id) ?? 0,
        submissions: submissions.get(id) ?? 0,
        ownJudges: own.has(id),
      }
    }),
    {
      sharedCost: machines.byPool.find((p) => p.pool === null)?.forecast ?? 0,
      platformSubmissions: submissions.get(null) ?? 0,
      usdRate,
    }
  )
  const rows = report.orgs
    .filter((r) => r.revenue > 0 || r.cost > 0)
    .sort((a, b) => a.margin - b.margin)
  const shown = rows.slice(0, SHOWN)
  const names = shown.length
    ? await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
        })
        .from(organizations)
        .where(
          inArray(
            organizations.id,
            shown.map((r) => r.id)
          )
        )
    : []
  const byId = new Map(names.map((n) => [n.id, n]))
  return {
    month: machines.month,
    usdRate,
    /** ₹ a month from plans, before GST. */
    revenue: report.revenue,
    /** ₹ this month's judging is forecast to cost, organizations' share. */
    cost: report.cost,
    /** ₹ of the shared judges' cost that is personal practice and the platform's own work. */
    platformCost: report.platformCost,
    /** ₹ actually paid this month, before GST (a yearly plan is paid all at once). */
    received: Number(received[0]?.total ?? 0),
    losing: rows.filter((r) => r.losing).length,
    total: rows.length,
    organizations: shown.map((r) => ({
      ...r,
      name: byId.get(r.id)?.name ?? "Removed organization",
      slug: byId.get(r.id)?.slug ?? null,
      submissions: submissions.get(r.id) ?? 0,
      ownJudges: own.has(r.id),
    })),
  }
}
