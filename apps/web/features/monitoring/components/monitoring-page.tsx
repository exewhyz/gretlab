"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { Badge } from "@workspace/ui/components/badge"

import {
  Card,
  Loading,
  PageTitle,
  Stats,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"
import type { monitoring } from "@/features/monitoring/server"

type Health = ApiResult<typeof monitoring>

/** Seconds as people read them. */
const ago = (seconds: number) =>
  seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`

const TONES = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
} as const

export function MonitoringPage() {
  const { data, error } = useQuery({
    queryKey: ["admin", "monitoring"],
    queryFn: () => api<Health>("/admin/monitoring"),
    refetchInterval: 30_000,
  })
  if (!data) return <Loading error={error} />
  const { queue, judges, email, webhooks } = data
  return (
    <>
      <PageTitle>Monitoring</PageTitle>
      <p className="mb-4 text-body-sm text-body">
        Checked {formatDateTime(data.checkedAt)}; it refreshes every 30 seconds.
      </p>
      <Card>
        {data.problems.length === 0 ? (
          <p className="text-body-sm text-ink" data-testid="health-ok">
            ✓ All well: judges are keeping up, and email and webhooks are going
            out.
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="health-problems">
            {data.problems.map((p) => (
              <li key={p.text} className="flex items-start gap-2 text-body-sm">
                <Badge variant={TONES[p.level]}>
                  {p.level === "critical"
                    ? "Critical"
                    : p.level === "warning"
                      ? "Warning"
                      : "Note"}
                </Badge>
                <span className="text-ink">{p.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mt-6 mb-2 text-title-sm text-ink">Judging queue</h2>
      <Stats
        items={[
          {
            label: "Waiting",
            value: queue.queued,
            tone:
              queue.queued && queue.oldestQueuedSeconds >= 60
                ? "bad"
                : undefined,
          },
          {
            label: "Oldest wait",
            value: queue.queued ? ago(queue.oldestQueuedSeconds) : "–",
          },
          { label: "Running", value: queue.running },
          {
            label: "Wait (typical / slowest)",
            value: `${queue.waitP50Seconds} s / ${queue.waitP95Seconds} s`,
            hint: "last 5 minutes",
          },
          {
            label: "Judged",
            value: queue.judgedLastHour,
            hint: `last hour; ${queue.judgedLastDay} today`,
          },
          {
            label: "System errors",
            value: queue.systemErrorsLastHour,
            tone: queue.systemErrorsLastHour ? "bad" : undefined,
            hint: "last hour",
          },
        ]}
      />

      <h2 className="mt-6 mb-2 text-title-sm text-ink">
        Judges{" "}
        <Link
          href="/admin/judges"
          className="text-body-sm font-normal text-primary underline underline-offset-2"
        >
          manage
        </Link>
      </h2>
      <Stats
        items={[
          {
            label: "Online",
            value: judges.online,
            tone: judges.online === 0 ? "bad" : undefined,
          },
          {
            label: "Busy slots",
            value: `${judges.busySlots} of ${judges.slots}`,
          },
          {
            label: "Machines from the dashboard",
            value: judges.machinesRunning,
          },
          {
            label: "Out of date",
            value: judges.outOfDate,
            tone: judges.outOfDate ? "bad" : undefined,
          },
          {
            label: "Automatic scaling",
            value: judges.autoscale ? "On" : "Off",
          },
        ]}
      />

      <h2 className="mt-6 mb-2 text-title-sm text-ink">Email</h2>
      <Stats
        items={[
          { label: "Waiting to send", value: email.queued },
          {
            label: "Oldest waiting",
            value: email.queued ? ago(email.oldestQueuedSeconds) : "–",
          },
          { label: "Sent", value: email.sentLastDay, hint: "last day" },
          {
            label: "Failed",
            value: email.failedLastDay,
            tone: email.failedLastDay ? "bad" : undefined,
            hint: "last day",
          },
        ]}
      />
      {email.reasons.length > 0 && (
        <Card>
          <p className="mb-2 text-body-sm text-ink">
            Why email failed in the last day
          </p>
          <ul className="grid gap-1" data-testid="email-reasons">
            {email.reasons.map((r) => (
              <li
                key={r.reason}
                className="text-xs whitespace-normal text-body"
              >
                <span className="font-semibold text-ink tabular-nums">
                  {r.count}×
                </span>{" "}
                {r.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mt-6 mb-2 text-title-sm text-ink">Webhooks</h2>
      <Stats
        items={[
          { label: "Waiting", value: webhooks.waiting },
          { label: "Sent", value: webhooks.sentLastDay, hint: "last day" },
          {
            label: "Failed",
            value: webhooks.failedLastDay,
            tone: webhooks.failedLastDay ? "bad" : undefined,
            hint: "last day",
          },
        ]}
      />
    </>
  )
}
