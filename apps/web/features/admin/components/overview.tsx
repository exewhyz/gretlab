"use client"

import { useQuery } from "@tanstack/react-query"
import { VERDICTS, type Verdict } from "@workspace/judge"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

import { Card, Loading, PageTitle } from "./shell"

interface Overview {
  users: number
  problems: number
  contests: number
  queue: {
    queued: number
    running: number
    oldestQueuedSeconds: number
    finishedLast5Min: number
    waitP50Seconds: number
    waitP95Seconds: number
    runners: { id: string; host: string; slots: number; busy: number }[]
    slots: number
    busySlots: number
  }
  verdictsLast24h: { verdict: string; total: number }[]
}

const STUCK_AFTER_SECONDS = 60

export function AdminOverview() {
  const { data: viewer } = useViewer()
  const isAdmin = viewer?.user?.role === "admin"
  const { data, error } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<Overview>("/admin/overview"),
    refetchInterval: 5000,
  })
  if (!data) return <Loading error={error} />

  const { queue } = data
  const stats = [
    ["Students and staff", data.users, isAdmin ? "/admin/users" : null],
    ["Problems", data.problems, "/admin/problems"],
    ["Contests", data.contests, "/admin/contests"],
  ] as const
  const capacity = [
    ["Waiting to run", queue.queued],
    ["Running now", queue.running],
    ["Runner slots in use", `${queue.busySlots} / ${queue.slots}`],
    ["Typical wait", `${queue.waitP50Seconds.toFixed(1)} s`],
    ["Slowest 5% wait", `${queue.waitP95Seconds.toFixed(1)} s`],
  ] as const

  return (
    <>
      <PageTitle>Overview</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/problems/new"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          New problem
        </Link>
        <Link
          href="/admin/assignments/new"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          New assignment
        </Link>
        <Link
          href="/admin/contests/new"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          New contest
        </Link>
        <Link
          href="/admin/daily"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Schedule daily challenge
        </Link>
        <Link
          href="/admin/notes"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Post a notice
        </Link>
      </div>
      {viewer && !viewer.features.serverExecution && (
        <p
          role="status"
          className="mb-4 rounded-md border border-hairline-strong bg-canvas-soft p-3 text-body-sm text-ink"
        >
          Server execution is off. Students can&apos;t submit, and{" "}
          {viewer.features.browserExecution
            ? "Run uses Python in their browser."
            : "they can't run code at all."}{" "}
          {isAdmin && (
            <Link
              href="/admin/settings"
              className="underline underline-offset-2"
            >
              Change in Settings
            </Link>
          )}
        </p>
      )}
      {queue.runners.length === 0 && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 p-3 text-body-sm text-destructive"
        >
          No runner is online, so server runs won&apos;t finish. Start the
          runner service.
        </p>
      )}
      {queue.runners.length > 0 &&
        queue.oldestQueuedSeconds > STUCK_AFTER_SECONDS && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 p-3 text-body-sm text-destructive"
          >
            A submission has waited {queue.oldestQueuedSeconds} seconds. Add
            runner capacity if this continues.
          </p>
        )}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(([label, value, href]) => {
          const body = (
            <Card>
              <div className="text-display-md text-ink tabular-nums">
                {value}
              </div>
              <div className="text-caption">
                {label}
                {href && " →"}
              </div>
            </Card>
          )
          return href ? (
            <Link key={label} href={href} className="hover:opacity-80">
              {body}
            </Link>
          ) : (
            <div key={label}>{body}</div>
          )
        })}
      </div>
      <h2 className="mt-5 mb-2 text-title-sm text-ink">Code execution</h2>
      <div className="grid grid-cols-2 gap-3 min-[901px]:grid-cols-5">
        {capacity.map(([label, value]) => (
          <Card key={label}>
            <div className="text-display-md text-ink tabular-nums">{value}</div>
            <div className="text-caption">{label}</div>
          </Card>
        ))}
      </div>
      <Card className="mt-3">
        <h3 className="mb-2 text-title-sm text-ink">
          Runners online ({queue.runners.length})
        </h3>
        <ul className="grid gap-1">
          {queue.runners.map((runner) => (
            <li key={runner.id} className="flex justify-between tabular-nums">
              <span>{runner.host}</span>
              <span className="text-ink">
                {runner.busy} / {runner.slots} slots busy
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-4">
        <h2 className="mb-2 text-title-sm text-ink">
          Submissions, last 24 hours
        </h2>
        {data.verdictsLast24h.length === 0 && <p>None yet.</p>}
        <ul className="grid gap-1">
          {data.verdictsLast24h.map((item) => (
            <li
              key={item.verdict}
              className="flex justify-between tabular-nums"
            >
              <span>{VERDICTS[item.verdict as Verdict] ?? item.verdict}</span>
              <span className="text-ink">{item.total}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
