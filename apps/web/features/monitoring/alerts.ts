import {
  getDb,
  judgeMachines,
  monitoringAlerts,
  platformStaff,
  sql,
  users,
} from "@workspace/db"
import { planAlerts, type AlertLevel, type AlertSignal } from "@workspace/judge"

import { costs } from "@/features/costs/server"
import { composeEmail } from "@/features/emails/server"
import { mailEnabled } from "@/features/notifications/mailer"
import { queueEmails, sendUrgent } from "@/features/notifications/outbox"
import { platformCan } from "@/features/platform/access"
import { getSettings } from "@/features/settings/server"
import { isAdminEmail } from "@/lib/admin-emails"
import { reportError } from "@/lib/report-error"

import { monitoring } from "./server"

/*
 * Monitoring alerts: what's wrong on Dashboard › Monitoring, plus a judge machine that won't set
 * up and the month's judge cost past its limit, emailed to the people whose platform role has
 * "Get monitoring alerts" (packages/judge/src/alerts.ts decides when). Checked by the email
 * cron, by GET /api/health/judge (what an uptime monitor calls) and when Monitoring is opened,
 * at most once a minute per server; one server at a time does the work (an advisory lock).
 */

const { and, eq, inArray, isNotNull, isNull, or, desc } = sql
const EVERY_MS = 60_000
const LOCK = 7_204_118 // pg_try_advisory_xact_lock key: "alerts"
let lastCheck = 0

/** Everything that may be an alert right now. */
async function signals(costLimit: number): Promise<AlertSignal[]> {
  const db = getDb()
  const [health, failed, spend] = await Promise.all([
    monitoring(),
    db
      .select({ n: sql.count() })
      .from(judgeMachines)
      // Failed while setting up and still running (costing money): not a start AWS refused
      // (no machine), nor one that ended by itself (as Dashboard › Costs counts them).
      .where(
        and(
          eq(judgeMachines.stage, "failed"),
          isNotNull(judgeMachines.instanceId),
          sql.notLike(judgeMachines.note, "%stopped without being asked%")
        )
      ),
    costLimit > 0 ? costs() : null,
  ])
  const out: AlertSignal[] = health.problems.map((p) => ({
    key: p.key,
    level: p.level,
    text: p.text,
  }))
  const machines = Number(failed[0]?.n ?? 0)
  if (machines > 0) {
    out.push({
      key: "machine_failed",
      level: "warning",
      text: `${machines === 1 ? "A judge machine" : `${machines} judge machines`} failed to set up and still ${machines === 1 ? "runs" : "run"}, costing money (Dashboard › Judges shows why; Stop ends ${machines === 1 ? "it" : "them"}).`,
    })
  }
  if (spend && spend.forecast > costLimit) {
    out.push({
      key: "cost",
      level: "warning",
      text: `Judge machines are forecast to cost US$${spend.forecast.toFixed(2)} this month, over the US$${costLimit.toFixed(2)} limit (US$${spend.soFar.toFixed(2)} so far).`,
    })
  }
  return out
}

/** Everyone whose platform role has "Get monitoring alerts", with their address. */
async function recipients() {
  const candidates = await getDb()
    .select()
    .from(users)
    .where(
      and(
        eq(users.disabled, false),
        or(
          inArray(users.role, ["admin", "teacher"]),
          inArray(
            users.id,
            getDb().select({ id: platformStaff.userId }).from(platformStaff)
          ),
          inArray(
            users.email,
            (process.env.ADMIN_EMAILS ?? "")
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean)
          )
        )
      )
    )
  const allowed = await Promise.all(
    candidates.map(async (u) =>
      isAdminEmail(u.email) ||
      (await platformCan(u, "platform.monitoring.alerts"))
        ? u.email
        : null
    )
  )
  return allowed.filter((e): e is string => Boolean(e))
}

const STATUS: Record<AlertLevel, string> = {
  critical: "Critical",
  warning: "Warning",
}

function when(date: Date, timeZone: string) {
  return `${date.toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" })} (${timeZone})`
}

/**
 * Checks once (at most once a minute per server unless forced) and emails what's new, worse
 * or fixed. Never throws: a monitoring check must never break the request that ran it.
 */
export async function checkAlerts({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < EVERY_MS) return null
  lastCheck = Date.now()
  try {
    const settings = await getSettings()
    if (!settings["alerts.enabled"]) return null
    const found = await signals(settings["alerts.cost_limit"])
    const tz = settings["site.timezone"]
    const site = (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "")
    const result = await getDb().transaction(async (tx) => {
      // One server at a time. A forced check (the cron) waits its turn; the others skip.
      const [lock] = await tx.execute<{ ok: boolean }>(
        force
          ? sql.sql`select true as ok from pg_advisory_xact_lock(${LOCK})`
          : sql.sql`select pg_try_advisory_xact_lock(${LOCK}) as ok`
      )
      if (!lock?.ok) return null
      const open = await tx
        .select()
        .from(monitoringAlerts)
        .where(isNull(monitoringAlerts.clearedAt))
      const now = new Date()
      const plan = planAlerts(open, found, now)
      for (const a of plan.start) {
        await tx.insert(monitoringAlerts).values({
          key: a.key,
          level: a.level,
          text: a.text,
          firstSeenAt: now,
          lastSeenAt: now,
        })
      }
      for (const a of plan.seen) {
        await tx
          .update(monitoringAlerts)
          .set({ level: a.level, text: a.text, lastSeenAt: now })
          .where(
            and(
              eq(monitoringAlerts.key, a.key),
              isNull(monitoringAlerts.clearedAt)
            )
          )
      }
      for (const a of plan.notify) {
        await tx
          .update(monitoringAlerts)
          .set({ notifiedLevel: a.level, notifiedAt: now })
          .where(
            and(
              eq(monitoringAlerts.key, a.key),
              isNull(monitoringAlerts.clearedAt)
            )
          )
      }
      for (const a of plan.clear) {
        await tx
          .update(monitoringAlerts)
          .set({ clearedAt: now })
          .where(
            and(
              eq(monitoringAlerts.key, a.key),
              isNull(monitoringAlerts.clearedAt)
            )
          )
      }
      const firstSeen = new Map(open.map((a) => [a.key, a.firstSeenAt]))
      const messages = [
        ...plan.notify.map((a) => ({
          status: a.kind === "worse" ? "Worse" : STATUS[a.level],
          problem: a.text,
          detail: `Started ${when(firstSeen.get(a.key) ?? now, tz)}.`,
        })),
        ...plan.clear
          .filter((a) => a.notify)
          .map((a) => ({
            status: "Fixed",
            problem: a.text,
            detail: `Started ${when(firstSeen.get(a.key) ?? now, tz)}; all clear since ${when(now, tz)}.`,
          })),
      ]
      let emailed = 0
      if (messages.length && mailEnabled()) {
        const to = await recipients()
        const composed = await Promise.all(
          messages.map((m) =>
            composeEmail("monitoring.alert", {
              ...m,
              link: `${site}/admin/monitoring`,
            })
          )
        )
        const emails = composed.flatMap((c) =>
          to.map((address) => ({ to: address, ...c }))
        )
        // Urgent: ahead of any backlog of other email, which may be the very problem.
        await queueEmails(tx, emails, { urgent: true })
        emailed = emails.length
      }
      return {
        started: plan.start.length,
        notified: plan.notify.length,
        cleared: plan.clear.length,
        emailed,
      }
    })
    if (result?.emailed) await sendUrgent().catch(() => {})
    return result
  } catch (error) {
    reportError(error, { where: "monitoring alerts" })
    return null
  }
}

/** Open alerts and the last cleared ones, for Dashboard › Monitoring. */
export async function recentAlerts() {
  const rows = await getDb()
    .select({
      id: monitoringAlerts.id,
      key: monitoringAlerts.key,
      level: monitoringAlerts.level,
      text: monitoringAlerts.text,
      firstSeenAt: monitoringAlerts.firstSeenAt,
      notifiedAt: monitoringAlerts.notifiedAt,
      clearedAt: monitoringAlerts.clearedAt,
    })
    .from(monitoringAlerts)
    .orderBy(desc(monitoringAlerts.firstSeenAt))
    .limit(20)
  return rows
}
