/*
 * What's wrong right now, from the platform's numbers (Dashboard › Monitoring). Pure and
 * unit-tested (health.test.ts); apps/web/features/monitoring gathers the numbers. The judge
 * thresholds match GET /api/health/judge: work waiting three minutes is an outage.
 */

import { JOB_STUCK_MS } from "./jobs.ts"

export interface HealthInput {
  judgesOnline: number
  queued: number
  oldestQueuedSeconds: number
  systemErrorsLastHour: number
  emailQueued: number
  emailOldestSeconds: number
  emailFailedLastDay: number
  webhooksWaiting: number
  judgesOutOfDate: number
  /** Background jobs queued or running (features/jobs), and how long the oldest has waited. */
  jobsWaiting: number
  jobsOldestSeconds: number
}

export type HealthLevel = "critical" | "warning" | "info"

export interface HealthProblem {
  /** Stays the same while the problem lasts, so an alert can follow it (alerts.ts). */
  key: string
  level: HealthLevel
  text: string
}

const ORDER: Record<HealthLevel, number> = { critical: 0, warning: 1, info: 2 }
const minutes = (seconds: number) => Math.round(seconds / 60)
/** "1 email", "2 emails". */
const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

export function healthProblems(input: HealthInput): HealthProblem[] {
  const out: HealthProblem[] = []
  if (input.judgesOnline === 0) {
    out.push(
      input.queued > 0
        ? {
            key: "judges_none",
            level: "critical",
            text: `No judge is online, and ${count(input.queued, "submission is", "submissions are")} waiting.`,
          }
        : {
            key: "judges_none",
            level: "warning",
            text: "No judge is online: the next submission will wait.",
          }
    )
  } else if (input.queued > 0 && input.oldestQueuedSeconds >= 180) {
    out.push({
      key: "queue_waiting",
      level: "critical",
      text: `Submissions have waited ${minutes(input.oldestQueuedSeconds)} minutes for a judge (${input.queued} waiting).`,
    })
  } else if (input.queued > 0 && input.oldestQueuedSeconds >= 60) {
    out.push({
      key: "queue_waiting",
      level: "warning",
      text: `Submissions are waiting over a minute for a judge (${input.queued} waiting).`,
    })
  }
  if (input.systemErrorsLastHour > 0) {
    out.push({
      key: "system_errors",
      level: "warning",
      text: `${count(input.systemErrorsLastHour, "submission")} ended in a system error in the last hour; they're judged again automatically.`,
    })
  }
  if (input.emailFailedLastDay > 0) {
    out.push({
      key: "email_failed",
      level: "warning",
      text: `${count(input.emailFailedLastDay, "email")} failed in the last day (see the reasons below).`,
    })
  }
  if (input.emailQueued > 0 && input.emailOldestSeconds >= 15 * 60) {
    out.push({
      key: "email_waiting",
      level: "warning",
      text: `${count(input.emailQueued, "email is", "emails are")} waiting; the oldest has waited ${minutes(input.emailOldestSeconds)} minutes. Is the email cron running?`,
    })
  }
  if (input.webhooksWaiting >= 100) {
    out.push({
      key: "webhooks_waiting",
      level: "warning",
      text: `${count(input.webhooksWaiting, "webhook delivery is", "webhook deliveries are")} waiting to be sent.`,
    })
  }
  if (input.jobsWaiting > 0 && input.jobsOldestSeconds * 1000 >= JOB_STUCK_MS) {
    out.push({
      key: "jobs_waiting",
      level: "warning",
      text: `${count(input.jobsWaiting, "background job (exports and the like) is", "background jobs (exports and the like) are")} waiting; the oldest for ${minutes(input.jobsOldestSeconds)} minutes. Is the cron running?`,
    })
  }
  if (input.judgesOutOfDate > 0) {
    out.push({
      key: "judges_outdated",
      level: "info",
      text: `${count(input.judgesOutOfDate, "judge runs", "judges run")} older code than the site (Dashboard › Judges).`,
    })
  }
  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level])
}
