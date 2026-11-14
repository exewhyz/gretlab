"use client"

import {
  BuildingsIcon,
  CodeIcon,
  TrophyIcon,
  UsersIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { VERDICTS, type Verdict } from "@workspace/judge"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

import { Loading, PageTitle } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { getOverview } from "@/features/admin/server"

type Overview = ApiResult<typeof getOverview>

const STUCK_AFTER_SECONDS = 60

const trendConfig = {
  total: { label: "Submissions", color: "var(--chart-1)" },
} satisfies ChartConfig

function Tile({
  label,
  value,
  hint,
  href,
  icon: I,
}: {
  label: string
  value: string | number
  hint?: string
  href?: string | null
  icon: Icon
}) {
  const body = (
    <Card
      size="sm"
      className={cn("h-full", href && "transition-shadow hover:shadow-md")}
      data-testid="admin-tile"
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <I className="size-4" aria-hidden="true" />
          {label}
        </CardDescription>
        <div className="text-3xl leading-tight font-semibold text-ink tabular-nums">
          {value}
        </div>
        {hint && (
          <div className="text-caption text-muted-foreground">{hint}</div>
        )}
      </CardHeader>
    </Card>
  )
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  )
}

/** /admin: the platform at a glance, what needs attention, and the judge's health. */
export function AdminOverview() {
  const { data: viewer } = useViewer()
  const client = useQueryClient()
  const isAdmin = viewer?.user?.role === "admin"
  const held: string[] = viewer?.user?.platform.permissions ?? []
  const { data, error } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<Overview>("/admin/overview"),
    refetchInterval: 5000,
  })
  const approve = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/organizations/${id}`, {
        method: "PATCH",
        body: { active: true },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["admin"] }),
  })
  if (!data) return <Loading error={error} />

  const { queue } = data
  const first = viewer?.user?.name?.split(" ")[0]
  const week = data.submissionsByDay.slice(-7).reduce((s, d) => s + d.total, 0)
  const verdictTotal = data.verdictsLast24h.reduce((s, v) => s + v.total, 0)
  const accepted =
    data.verdictsLast24h.find((v) => v.verdict === "accepted")?.total ?? 0
  const manageOrgs = held.includes("platform.orgs.manage")
  // Each shortcut only for those whose role opens its page.
  const actions = [
    {
      href: "/admin/problems/new",
      label: "New problem",
      needs: "platform.library.create",
    },
    {
      href: "/admin/assignments/new",
      label: "New assignment",
      needs: "platform.work.create",
    },
    {
      href: "/admin/contests/new",
      label: "New contest",
      needs: "platform.work.create",
    },
    {
      href: "/admin/daily",
      label: "Schedule daily challenge",
      needs: "platform.library.manage",
    },
    {
      href: "/admin/notes",
      label: "Post a notice",
      needs: "platform.library.manage",
    },
  ].filter((a) => held.includes(a.needs))
  const alerts: {
    tone: "bad" | "plain"
    text: string
    href?: string
    action?: string
  }[] = [
    // Runner alerts are for those who run the platform; others can't act on them.
    ...(queue.runners.length === 0 && held.includes("platform.settings.manage")
      ? [
          {
            tone: "bad" as const,
            text: "No runner is online, so server runs won't finish. Start the runner service.",
          },
        ]
      : []),
    ...(queue.runners.length > 0 &&
    held.includes("platform.settings.manage") &&
    queue.oldestQueuedSeconds > STUCK_AFTER_SECONDS
      ? [
          {
            tone: "bad" as const,
            text: `A submission has waited ${queue.oldestQueuedSeconds} seconds. Add runner capacity if this continues.`,
          },
        ]
      : []),
    ...(viewer && !viewer.features.serverExecution
      ? [
          {
            tone: "plain" as const,
            text: `Server execution is off. Students can't submit, and ${viewer.features.browserExecution ? "Run uses Python in their browser." : "they can't run code at all."}`,
            href: isAdmin ? "/admin/settings" : undefined,
            action: "Change in Settings",
          },
        ]
      : []),
  ]

  return (
    <div className="grid gap-6" data-testid="admin-overview">
      <div>
        <PageTitle
          action={
            actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((a, n) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    className={buttonVariants({
                      variant: n === 0 ? "default" : "outline",
                      size: "sm",
                    })}
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            )
          }
        >
          Overview
        </PageTitle>
        {first && (
          <p className="-mt-2 text-body-sm text-muted-foreground">
            Welcome back, {first}. Here&apos;s the platform today.
          </p>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="grid gap-2">
          {alerts.map((a) => (
            <div
              key={a.text}
              role={a.tone === "bad" ? "alert" : "status"}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border p-3 text-body-sm",
                a.tone === "bad"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-hairline-strong bg-card text-ink"
              )}
            >
              <WarningIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{a.text}</span>
              {a.href && (
                <Link
                  href={a.href}
                  className="font-medium underline underline-offset-2"
                >
                  {a.action}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Students and staff"
          value={data.users}
          hint={`${data.newUsers7d} joined this week`}
          href={isAdmin ? "/admin/users" : null}
          icon={UsersIcon}
        />
        <Tile
          label="Organizations"
          value={data.organizations.total}
          hint={`${data.organizations.active} active${data.organizations.pending.length ? ` · ${data.organizations.pending.length} waiting` : ""}`}
          href={manageOrgs ? "/admin/organizations" : null}
          icon={BuildingsIcon}
        />
        <Tile
          label="Problems"
          value={data.problems}
          href={
            held.includes("platform.library.edit") ? "/admin/problems" : null
          }
          icon={CodeIcon}
        />
        <Tile
          label="Contests"
          value={data.contests}
          href={
            held.includes("platform.work.manage") ? "/admin/contests" : null
          }
          icon={TrophyIcon}
        />
      </div>

      {data.organizations.pending.length > 0 && manageOrgs && (
        <Card data-testid="pending-schools">
          <CardHeader>
            <CardTitle>Schools waiting for approval</CardTitle>
            <CardDescription>
              Registered on the site; nobody can use them until you approve.
            </CardDescription>
            <CardAction>
              <Badge>{data.organizations.pending.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.organizations.pending.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{o.name}</div>
                  <div className="text-caption text-muted-foreground">
                    /orgs/{o.slug} · {o.type} · registered{" "}
                    {new Date(o.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => approve.mutate(o.id)}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Submissions</CardTitle>
            <CardDescription>
              Graded submissions a day, last two weeks
            </CardDescription>
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {week} this week
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={trendConfig}
              className="aspect-auto h-56 w-full"
            >
              <BarChart
                data={data.submissionsByDay.map((d) => ({
                  ...d,
                  label: d.day.slice(8),
                }))}
                margin={{ left: 0, right: 4 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel />}
                />
                <Bar
                  dataKey="total"
                  fill="var(--color-total)"
                  radius={[6, 6, 2, 2]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Submissions, last 24 hours</CardTitle>
            <CardDescription>
              {verdictTotal
                ? `${verdictTotal} graded, ${Math.round((100 * accepted) / verdictTotal)}% accepted`
                : "None yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.verdictsLast24h
              .slice()
              .sort((a, b) => b.total - a.total)
              .map((v) => (
                <div key={v.verdict} className="grid gap-1">
                  <div className="flex justify-between text-body-sm">
                    <span className="text-ink">
                      {VERDICTS[v.verdict as Verdict] ?? v.verdict}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {v.total}
                    </span>
                  </div>
                  <Progress
                    value={(100 * v.total) / Math.max(1, verdictTotal)}
                  />
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="judge-health">
        <CardHeader>
          <CardTitle>Code execution</CardTitle>
          <CardDescription>
            The judge queue and its runners, live
          </CardDescription>
          <CardAction>
            {queue.runners.length === 0 ? (
              <Badge variant="destructive">Offline</Badge>
            ) : queue.oldestQueuedSeconds > STUCK_AFTER_SECONDS ? (
              <Badge variant="destructive">Backed up</Badge>
            ) : (
              <Badge>Healthy</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ["Waiting to run", queue.queued],
                ["Running now", queue.running],
                ["Done, last 5 min", queue.finishedLast5Min],
                ["Typical wait", `${queue.waitP50Seconds.toFixed(1)} s`],
                ["Slowest 5% wait", `${queue.waitP95Seconds.toFixed(1)} s`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <div className="text-caption text-muted-foreground">
                  {label}
                </div>
                <div className="text-title-md text-ink tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <div className="flex justify-between text-body-sm">
              <span className="text-ink">Runner slots in use</span>
              <span className="text-muted-foreground tabular-nums">
                {queue.busySlots} / {queue.slots}
              </span>
            </div>
            <Progress
              value={queue.slots ? (100 * queue.busySlots) / queue.slots : 0}
            />
          </div>
          {queue.runners.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runners online ({queue.runners.length})</TableHead>
                  <TableHead className="text-right">Busy</TableHead>
                  <TableHead className="w-1/3">Load</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.runners.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.host}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.busy} / {r.slots} slots busy
                    </TableCell>
                    <TableCell>
                      <Progress
                        value={r.slots ? (100 * r.busy) / r.slots : 0}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
