import { timingSafeEqual } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { getQueueHealth } from "@/features/admin/server"
import { outboxHealth } from "@/features/notifications/outbox"

export const dynamic = "force-dynamic"

function authorized(request: NextRequest) {
  const expected = process.env.METRICS_TOKEN
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!expected || !given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Prometheus format, for dashboards and for autoscaling runners on queue depth. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 })
  }
  const [queue, mail] = await Promise.all([getQueueHealth(), outboxHealth()])
  const metrics: [string, string, number][] = [
    ["gretlab_queue_waiting", "Jobs waiting for a runner", queue.queued],
    ["gretlab_queue_running", "Jobs running now", queue.running],
    [
      "gretlab_queue_oldest_seconds",
      "Age of the oldest waiting job",
      queue.oldestQueuedSeconds,
    ],
    [
      "gretlab_queue_wait_p95_seconds",
      "95th percentile wait, last 5 minutes",
      queue.waitP95Seconds,
    ],
    [
      "gretlab_jobs_finished_5m",
      "Jobs finished in the last 5 minutes",
      queue.finishedLast5Min,
    ],
    [
      "gretlab_runners_online",
      "Runners with a recent heartbeat",
      queue.runners.length,
    ],
    ["gretlab_runner_slots", "Total runner slots", queue.slots],
    ["gretlab_runner_slots_busy", "Runner slots in use", queue.busySlots],
    ["gretlab_mail_queued", "Emails waiting to be sent", mail.queued],
    [
      "gretlab_mail_oldest_seconds",
      "Age of the oldest waiting email",
      mail.oldestQueuedSeconds,
    ],
    [
      "gretlab_mail_failed_1d",
      "Emails given up on, last day",
      mail.failedLastDay,
    ],
  ]
  const body = metrics
    .map(
      ([name, help, value]) =>
        `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}`
    )
    .join("\n")
  return new NextResponse(`${body}\n`, {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  })
}
