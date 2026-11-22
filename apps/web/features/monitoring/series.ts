import { getDb, sql } from "@workspace/db"
import { MONITOR_RANGES, type MonitorRange } from "@workspace/judge"

/*
 * Dashboard › Monitoring's charts: each signal over time, from what GretLab already keeps
 * (submissions, the email outbox, webhook deliveries), bucketed in the database (date_bin) so
 * a chart is one small query however busy the site is. Only finished steps are drawn: the
 * current one isn't over, and drawn it would look like a sudden drop. The buckets are the range's step;
 * throughput is per minute, so ranges compare. Sent email is kept 7 days, so the longest range
 * still has it all.
 */

type Raw = Record<string, string | number | Date | null>

const n = (value: unknown) =>
  value === null || value === undefined ? 0 : Number(value)
const seconds = (value: unknown) =>
  value === null || value === undefined
    ? null
    : Math.round(Number(value) * 10) / 10

export async function monitoringSeries(range: MonitorRange) {
  const { seconds: window, step } = MONITOR_RANGES[range]
  const q = sql.sql
  const binned = (column: string) =>
    q.raw(
      `date_bin(make_interval(secs => ${step}), ${column}, timestamptz '2000-01-01')`
    )
  const since = q`now() - make_interval(secs => ${window})`
  const rows = (await getDb().execute(q`
    with buckets as (
      select generate_series(${binned(`now() - make_interval(secs => ${window})`)}, now() - make_interval(secs => ${step}), make_interval(secs => ${step})) as t
    ),
    created as (
      select ${binned("created_at")} as t, count(*) as n
      from submissions where created_at > ${since} group by 1
    ),
    judged as (
      select ${binned("finished_at")} as t,
        count(*) as n,
        count(*) filter (where verdict = 'SE') as system_errors,
        percentile_cont(0.5) within group (order by extract(epoch from started_at - created_at)) as wait_p50,
        percentile_cont(0.95) within group (order by extract(epoch from started_at - created_at)) as wait_p95,
        percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at)) as run_p95
      from submissions
      where finished_at > ${since} and started_at is not null
      group by 1
    ),
    mail as (
      select ${binned("created_at")} as t,
        count(*) as queued,
        count(*) filter (where status = 'failed') as failed
      from email_outbox where created_at > ${since} group by 1
    ),
    sent as (
      select ${binned("sent_at")} as t, count(*) as n
      from email_outbox where sent_at > ${since} group by 1
    ),
    hooks as (
      select ${binned("created_at")} as t,
        count(*) filter (where status = 'sent') as sent,
        count(*) filter (where status = 'failed') as failed
      from webhook_deliveries where created_at > ${since} group by 1
    )
    select b.t,
      coalesce(created.n, 0) as submitted,
      coalesce(judged.n, 0) as judged,
      coalesce(judged.system_errors, 0) as system_errors,
      judged.wait_p50, judged.wait_p95, judged.run_p95,
      -- At the bucket's end: waiting for a judge, and being judged.
      (select count(*) from submissions s
        where s.created_at <= b.t + make_interval(secs => ${step})
          and s.created_at > ${since} - interval '1 day'
          and (s.started_at > b.t + make_interval(secs => ${step})
               or (s.started_at is null and s.status = 'queued'))) as waiting,
      (select count(*) from submissions s
        where s.started_at <= b.t + make_interval(secs => ${step})
          and s.started_at > ${since} - interval '1 day'
          and (s.finished_at > b.t + make_interval(secs => ${step})
               or (s.finished_at is null and s.status = 'running'))) as running,
      coalesce(mail.queued, 0) as email_queued,
      coalesce(sent.n, 0) as email_sent,
      coalesce(mail.failed, 0) as email_failed,
      coalesce(hooks.sent, 0) as hooks_sent,
      coalesce(hooks.failed, 0) as hooks_failed
    from buckets b
    left join created on created.t = b.t
    left join judged on judged.t = b.t
    left join mail on mail.t = b.t
    left join sent on sent.t = b.t
    left join hooks on hooks.t = b.t
    order by b.t`)) as unknown as Raw[]
  const perMinute = 60 / step
  return {
    range,
    step,
    points: rows.map((r) => ({
      t: new Date(r.t as string | Date).toISOString(),
      submittedPerMin: Math.round(n(r.submitted) * perMinute * 100) / 100,
      judgedPerMin: Math.round(n(r.judged) * perMinute * 100) / 100,
      judged: n(r.judged),
      systemErrors: n(r.system_errors),
      waitP50: seconds(r.wait_p50),
      waitP95: seconds(r.wait_p95),
      runP95: seconds(r.run_p95),
      waiting: n(r.waiting),
      running: n(r.running),
      emailQueued: n(r.email_queued),
      emailSent: n(r.email_sent),
      emailFailed: n(r.email_failed),
      hooksSent: n(r.hooks_sent),
      hooksFailed: n(r.hooks_failed),
    })),
  }
}
