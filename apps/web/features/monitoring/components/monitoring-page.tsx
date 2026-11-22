"use client"

import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  MONITOR_RANGES,
  isMonitorRange,
  type MonitorRange,
} from "@workspace/judge"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { Figure, Figures } from "@/components/figures"
import {
  Loading,
  PageTitle,
  PercentBar,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { monitoring } from "@/features/monitoring/server"
import type { monitoringSeries } from "@/features/monitoring/series"

import { TimeChart, type Point } from "./time-chart"

type Health = ApiResult<typeof monitoring>
type Timeline = ApiResult<typeof monitoringSeries>

/*
 * Dashboard › Monitoring, laid out the way operations dashboards are read (Grafana's dashboard
 * guidance; Google SRE's golden signals): the overall state and what's wrong first, then the
 * four golden signals now, then one row per service in the order work flows through it. Judging
 * by RED (rate, errors, duration: how users fare), judges by USE (utilization, saturation:
 * how the machines fare), then email and webhooks. Every chart is over the chosen range.
 */

const RANGE_KEY = "gretlab:monitoring-range"

function savedRange(): MonitorRange {
  try {
    const saved = window.localStorage.getItem(RANGE_KEY)
    return isMonitorRange(saved) ? saved : "24h"
  } catch {
    return "24h"
  }
}

const ago = (seconds: number) =>
  seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`

export function MonitoringPage() {
  const [range, setRange] = useState<MonitorRange>(() =>
    typeof window === "undefined" ? "24h" : savedRange()
  )
  const health = useQuery({
    queryKey: ["admin", "monitoring"],
    queryFn: () => api<Health>("/admin/monitoring"),
    refetchInterval: 30_000,
  })
  const timeline = useQuery({
    queryKey: ["admin", "monitoring", "series", range],
    queryFn: () => api<Timeline>(`/admin/monitoring/series?range=${range}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
  const choose = (value: string) => {
    if (!isMonitorRange(value)) return
    setRange(value)
    try {
      window.localStorage.setItem(RANGE_KEY, value)
    } catch {
      // Private window: the choice just isn't remembered.
    }
  }
  if (!health.data) return <Loading error={health.error} />
  const h = health.data
  const points = (timeline.data?.points ?? []) as Point[]
  const long = range === "7d"
  const state = h.problems.some((p) => p.level === "critical")
    ? "down"
    : h.problems.some((p) => p.level === "warning")
      ? "degraded"
      : "healthy"
  const busy = h.judges.slots
    ? Math.round((100 * h.judges.busySlots) / h.judges.slots)
    : 0
  const errorRate =
    h.queue.judgedLastHour > 0
      ? Math.round(
          (1000 * h.queue.systemErrorsLastHour) / h.queue.judgedLastHour
        ) / 10
      : 0

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PageTitle>Monitoring</PageTitle>
          <StatePill state={state} />
        </div>
        <Tabs value={range} onValueChange={(v) => choose(String(v))}>
          <TabsList aria-label="Time range">
            {Object.entries(MONITOR_RANGES).map(([key, r]) => (
              <TabsTrigger key={key} value={key}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <p className="-mt-2 mb-4 text-caption text-muted-foreground">
        Figures as of {new Date(h.checkedAt).toLocaleTimeString()}, every 30
        seconds; charts over the last {MONITOR_RANGES[range].label}, in steps of{" "}
        {stepLabel(MONITOR_RANGES[range].step)}.
      </p>

      <Problems problems={h.problems} />

      <h2 className="mt-6 mb-2 text-title-sm text-ink">Right now</h2>
      <Figures>
        <Figure
          label="Judged"
          value={h.queue.judgedLastHour}
          hint={`in the last hour (${Math.round((h.queue.judgedLastHour / 60) * 10) / 10} a minute)`}
        />
        <Figure
          label="Slowest wait"
          value={`${h.queue.waitP95Seconds} s`}
          hint={`typical ${h.queue.waitP50Seconds} s, last 5 minutes`}
          tone={h.queue.waitP95Seconds >= 60 ? "bad" : undefined}
        />
        <Figure
          label="System errors"
          value={`${errorRate}%`}
          hint={`${h.queue.systemErrorsLastHour} in the last hour`}
          tone={h.queue.systemErrorsLastHour > 0 ? "bad" : undefined}
        />
        <Figure
          label="Judges busy"
          value={`${busy}%`}
          hint={`${h.judges.busySlots} of ${h.judges.slots} slots; ${h.queue.queued} waiting${h.queue.queued ? `, oldest ${ago(h.queue.oldestQueuedSeconds)}` : ""}`}
          tone={
            h.queue.queued > 0 && h.queue.oldestQueuedSeconds >= 60
              ? "bad"
              : undefined
          }
          href="#judges"
        />
      </Figures>

      <Section
        id="judging"
        title="Judging"
        lead="Code in, verdicts out: how much, how long it waits, and how often it fails."
      >
        <TimeChart
          testId="chart-throughput"
          title="Judged a minute"
          hint="Submissions and runs finished, per minute"
          kind="area"
          data={points}
          series={[
            { key: "judgedPerMin", label: "Judged a minute", color: "primary" },
          ]}
          long={long}
        />
        <TimeChart
          testId="chart-wait"
          title="Waiting for a judge"
          hint="Seconds from pressing Run or Submit to a judge starting"
          kind="line"
          unit=" s"
          data={points}
          series={[
            { key: "waitP95", label: "Slowest (95%)", color: "primary" },
            {
              key: "waitP50",
              label: "Typical",
              color: "primary",
              dashed: true,
            },
          ]}
          thresholds={[
            { y: 60, label: "slow: 1 min", tone: "warning" },
            { y: 180, label: "outage: 3 min", tone: "critical" },
          ]}
          long={long}
        />
        <TimeChart
          testId="chart-errors"
          title="System errors"
          hint="Submissions that ended in a system error (judged again automatically)"
          kind="bar"
          data={points}
          series={[
            {
              key: "systemErrors",
              label: "System errors",
              color: "destructive",
            },
          ]}
          long={long}
        />
        <TimeChart
          title="Running time"
          hint="Seconds a judge spends on a job, the slowest 5%"
          kind="line"
          unit=" s"
          data={points}
          series={[{ key: "runP95", label: "Slowest (95%)", color: "primary" }]}
          long={long}
        />
      </Section>

      <Section
        id="judges"
        title="Judges"
        lead={
          <>
            How full the judges are and what waits for them.{" "}
            <Link
              href="/admin/judges"
              className="text-primary-active underline underline-offset-2"
            >
              Manage judges
            </Link>
          </>
        }
      >
        <TimeChart
          testId="chart-running"
          title="Being judged"
          hint={`Jobs running at once; capacity now ${h.judges.slots}`}
          kind="area"
          data={points}
          series={[{ key: "running", label: "Being judged", color: "primary" }]}
          thresholds={
            h.judges.slots
              ? [
                  {
                    y: h.judges.slots,
                    label: `capacity ${h.judges.slots}`,
                    tone: "warning",
                  },
                ]
              : []
          }
          long={long}
        />
        <TimeChart
          testId="chart-waiting"
          title="Waiting"
          hint="Jobs in the queue for a judge"
          kind="area"
          data={points}
          series={[{ key: "waiting", label: "Waiting", color: "primary" }]}
          long={long}
        />
        <div
          className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 md:col-span-2"
          data-testid="judge-list"
        >
          <h3 className="mb-2 text-title-sm text-ink">
            Judges reporting in ({h.judges.list.length})
            {h.judges.autoscale && (
              <span className="ml-2 text-caption text-muted-foreground">
                automatic scaling on
              </span>
            )}
          </h3>
          {h.judges.list.length === 0 ? (
            <p className="text-body-sm text-destructive">
              No judge is online: code waits in the queue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="text-left text-caption text-muted-foreground">
                    <th className="py-1.5 font-medium">Judge</th>
                    <th className="py-1.5 font-medium">Serves</th>
                    <th className="py-1.5 font-medium">Busy</th>
                    <th className="py-1.5 font-medium">Code</th>
                  </tr>
                </thead>
                <tbody>
                  {h.judges.list.map((j) => (
                    <tr key={j.host} className="border-t border-hairline">
                      <td className="py-1.5 text-ink">
                        {j.host}
                        <span className="ml-2 text-caption text-muted-foreground">
                          {j.fromDashboard ? "dashboard" : "by hand"}
                        </span>
                      </td>
                      <td className="py-1.5 text-body">
                        {j.pool ?? "Everyone"}
                      </td>
                      <td className="py-1.5">
                        <PercentBar
                          value={
                            j.slots
                              ? Math.round((100 * j.busy) / j.slots)
                              : null
                          }
                          low={-1}
                        />
                      </td>
                      <td className="py-1.5">
                        <code className="text-caption">
                          {j.version?.slice(0, 7) ?? "unknown"}
                        </code>
                        {j.outOfDate && (
                          <span className="ml-2 text-caption text-destructive">
                            out of date
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section
        id="email"
        title="Email"
        lead={`${h.email.queued} waiting to send${h.email.queued ? `, the oldest for ${ago(h.email.oldestQueuedSeconds)}` : ""}; ${h.email.sentLastDay} sent and ${h.email.failedLastDay} failed in the last day.`}
      >
        <TimeChart
          testId="chart-email-sent"
          title="Sent"
          hint="Emails the provider accepted"
          kind="bar"
          data={points}
          series={[{ key: "emailSent", label: "Sent", color: "primary" }]}
          long={long}
        />
        <TimeChart
          testId="chart-email-failed"
          title="Failed"
          hint="Emails given up on, by when they were queued"
          kind="bar"
          data={points}
          series={[
            { key: "emailFailed", label: "Failed", color: "destructive" },
          ]}
          long={long}
        />
        {h.email.reasons.length > 0 && (
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 md:col-span-2">
            <h3 className="mb-2 text-title-sm text-ink">
              Why email failed in the last day
            </h3>
            <ul className="grid gap-1.5" data-testid="email-reasons">
              {h.email.reasons.map((r) => (
                <li
                  key={r.reason}
                  className="flex items-baseline gap-3 text-body-sm"
                >
                  <span className="w-10 shrink-0 text-right font-semibold text-ink tabular-nums">
                    {r.count}×
                  </span>
                  <span className="text-body">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        id="webhooks"
        title="Webhooks"
        lead={`${h.webhooks.waiting} waiting; ${h.webhooks.sentLastDay} delivered and ${h.webhooks.failedLastDay} failed in the last day.`}
      >
        <TimeChart
          title="Delivered"
          hint="Webhook deliveries the other side accepted"
          kind="bar"
          data={points}
          series={[{ key: "hooksSent", label: "Delivered", color: "primary" }]}
          long={long}
        />
        <TimeChart
          title="Failed"
          hint="Deliveries given up on after every retry"
          kind="bar"
          data={points}
          series={[
            { key: "hooksFailed", label: "Failed", color: "destructive" },
          ]}
          long={long}
        />
      </Section>
    </div>
  )
}

const stepLabel = (seconds: number) =>
  seconds < 3600
    ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}`
    : `${seconds / 3600} hours`

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2 className="text-title-sm text-ink">{title}</h2>
      <p className="mb-3 text-body-sm text-body">{lead}</p>
      <div className="grid min-w-0 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {children}
      </div>
    </section>
  )
}

/** The overall state: an icon and a word, never colour alone. */
function StatePill({ state }: { state: "healthy" | "degraded" | "down" }) {
  const look = {
    healthy: {
      icon: CheckCircleIcon,
      text: "Healthy",
      cls: "bg-success/10 text-success",
    },
    degraded: {
      icon: WarningIcon,
      text: "Degraded",
      cls: "bg-chart-4/15 text-ink",
    },
    down: {
      icon: XCircleIcon,
      text: "Down",
      cls: "bg-destructive/10 text-destructive",
    },
  }[state]
  const Icon = look.icon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium",
        look.cls
      )}
      data-testid="health-state"
    >
      <Icon weight="fill" aria-hidden className="size-4" />
      {look.text}
    </span>
  )
}

function Problems({ problems }: { problems: Health["problems"] }) {
  if (problems.length === 0) {
    return (
      <p
        className="rounded-xl bg-success/10 px-4 py-3 text-body-sm text-ink"
        data-testid="health-ok"
      >
        <CheckCircleIcon
          weight="fill"
          aria-hidden
          className="mr-1.5 inline size-4 text-success"
        />
        All well: judges are keeping up, and email and webhooks are going out.
      </p>
    )
  }
  const look = {
    critical: { icon: XCircleIcon, label: "Critical", cls: "text-destructive" },
    // Ochre is too light for text (2.9:1): the icon carries it, the word is ink.
    warning: { icon: WarningIcon, label: "Warning", cls: "text-chart-4" },
    info: { icon: InfoIcon, label: "Note", cls: "text-muted-foreground" },
  } as const
  return (
    <ul
      className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      data-testid="health-problems"
    >
      {problems.map((p) => {
        const l = look[p.level]
        const Icon = l.icon
        return (
          <li key={p.text} className="flex items-start gap-2 text-body-sm">
            <Icon
              weight="fill"
              aria-hidden
              className={cn("mt-0.5 size-4 shrink-0", l.cls)}
            />
            <span>
              <span
                className={cn(
                  "font-semibold",
                  p.level === "critical" ? "text-destructive" : "text-ink"
                )}
              >
                {l.label}:
              </span>{" "}
              <span className="text-ink">{p.text}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
