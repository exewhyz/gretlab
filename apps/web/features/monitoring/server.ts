import { getDb, sql } from "@workspace/db"
import { healthProblems } from "@workspace/judge"

import { getQueueHealth } from "@/features/admin/server"
import { webhooksWaiting } from "@/features/integrations/deliver"
import { listJudges } from "@/features/judges/server"
import { jobsHealth } from "@/features/jobs/server"
import { outboxHealth } from "@/features/notifications/outbox"

/*
 * Dashboard › Monitoring: the platform's health in one place, and what's wrong right now
 * (packages/judge/src/health.ts decides which numbers are a problem). Read-only, from the same
 * numbers the dashboard, /api/metrics and the health checks use.
 */

type Row = Record<string, string | number | null>

export async function monitoring() {
  const db = getDb()
  const [
    queue,
    judges,
    email,
    waitingHooks,
    [judged],
    emailFailures,
    [hooks],
    background,
  ] = await Promise.all([
    getQueueHealth(),
    listJudges(),
    outboxHealth(),
    webhooksWaiting(),
    db.execute(sql.sql`
        select count(*) filter (where finished_at > now() - interval '1 hour') as last_hour,
               count(*) filter (where finished_at > now() - interval '1 hour' and verdict = 'SE') as system_errors,
               count(*) filter (where finished_at > now() - interval '1 day') as last_day
        from submissions
        where finished_at > now() - interval '1 day'`) as unknown as Promise<
      Row[]
    >,
    // Why email failed in the last day: the commonest reasons, never the addresses.
    db.execute(sql.sql`
        select coalesce(last_error, 'no reason recorded') as reason, count(*) as n
        from email_outbox
        where status = 'failed' and created_at > now() - interval '1 day'
        group by 1 order by 2 desc limit 5`) as unknown as Promise<Row[]>,
    db.execute(sql.sql`
        select count(*) filter (where status = 'sent' and created_at > now() - interval '1 day') as sent,
               count(*) filter (where status = 'failed' and created_at > now() - interval '1 day') as failed
        from webhook_deliveries
        where created_at > now() - interval '1 day'`) as unknown as Promise<
      Row[]
    >,
    jobsHealth(),
  ])
  const [emailSent] = (await db.execute(sql.sql`
    select count(*) as n from email_outbox
    where status = 'sent' and sent_at > now() - interval '1 day'`)) as unknown as Row[]
  const numbers = {
    judgesOnline: judges.online.length,
    queued: queue.queued,
    oldestQueuedSeconds: queue.oldestQueuedSeconds,
    systemErrorsLastHour: Number(judged?.system_errors ?? 0),
    emailQueued: email.queued,
    emailOldestSeconds: email.oldestQueuedSeconds,
    emailFailedLastDay: email.failedLastDay,
    webhooksWaiting: waitingHooks,
    judgesOutOfDate: judges.online.filter((r) => r.outOfDate).length,
    jobsWaiting: background.waiting,
    jobsOldestSeconds: background.oldestSeconds,
  }
  return {
    problems: healthProblems(numbers),
    /** Background jobs (features/jobs): waiting, the oldest's wait, failed in the last day. */
    jobs: background,
    queue: {
      queued: queue.queued,
      running: queue.running,
      oldestQueuedSeconds: queue.oldestQueuedSeconds,
      waitP50Seconds: Math.round(queue.waitP50Seconds),
      waitP95Seconds: Math.round(queue.waitP95Seconds),
      judgedLastHour: Number(judged?.last_hour ?? 0),
      judgedLastDay: Number(judged?.last_day ?? 0),
      systemErrorsLastHour: numbers.systemErrorsLastHour,
    },
    judges: {
      /** Every judge reporting in: what serves what, how busy, which code. */
      list: judges.online.map((r) => ({
        host: r.host,
        pool: r.pool,
        busy: r.busy,
        slots: r.slots,
        version: r.version,
        outOfDate: r.outOfDate,
        fromDashboard: r.fromDashboard,
      })),
      online: judges.online.length,
      slots: queue.slots,
      busySlots: queue.busySlots,
      outOfDate: numbers.judgesOutOfDate,
      machinesRunning: judges.machines.filter((m) =>
        [
          "requested",
          "launching",
          "installing",
          "ready",
          "draining",
          "drained",
          "stopping",
        ].includes(m.stage)
      ).length,
      autoscale: judges.settings.autoscale,
    },
    email: {
      queued: email.queued,
      oldestQueuedSeconds: email.oldestQueuedSeconds,
      sentLastDay: Number(emailSent?.n ?? 0),
      failedLastDay: email.failedLastDay,
      reasons: emailFailures.map((r) => ({
        reason: String(r.reason).slice(0, 300),
        count: Number(r.n),
      })),
    },
    webhooks: {
      waiting: waitingHooks,
      sentLastDay: Number(hooks?.sent ?? 0),
      failedLastDay: Number(hooks?.failed ?? 0),
    },
    checkedAt: new Date().toISOString(),
  }
}
