"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import { RichText } from "@/components/rich-text"
import { Loading, Table } from "@/features/admin/components/shell"
import { Difficulty } from "@/features/catalog/components/difficulty"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

export type AssignmentPhase = "upcoming" | "open" | "late" | "closed"
export type GradeStatus =
  "solved" | "late" | "partial" | "attempted" | "missing"

interface AssignmentSummary {
  slug: string
  title: string
  org: { name: string; slug: string } | null
  opensAt: string
  dueAt: string
  allowLate: boolean
  latePenaltyPercent: number
  published: boolean
  phase: AssignmentPhase
  problemCount: number
  solved: number
  earned: number
  total: number
}

interface AssignmentDetail {
  slug: string
  title: string
  description: string
  opensAt: string
  dueAt: string
  allowLate: boolean
  latePenaltyPercent: number
  phase: AssignmentPhase
  earned: number
  total: number
  solved: number
  problems: {
    slug: string
    href: string
    title: string
    level: string
    points: number
    earned: number
    status: GradeStatus
  }[]
}

const PHASE: Record<AssignmentPhase, { label: string; tone: string }> = {
  upcoming: { label: "Not open yet", tone: "bg-muted text-body" },
  open: { label: "Open", tone: "bg-success/10 text-success" },
  late: {
    label: "Past due, late work accepted",
    tone: "bg-primary/10 text-primary",
  },
  closed: { label: "Closed", tone: "bg-muted text-body" },
}

export const STATUS: Record<GradeStatus, { label: string; tone: string }> = {
  solved: { label: "Solved", tone: "text-success" },
  late: { label: "Solved late", tone: "text-primary" },
  partial: { label: "Partly solved", tone: "text-ink" },
  attempted: { label: "Not passing yet", tone: "text-destructive" },
  missing: { label: "Not started", tone: "text-body" },
}

export function PhaseBadge({ phase }: { phase: AssignmentPhase }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
        PHASE[phase].tone
      )}
    >
      {PHASE[phase].label}
    </span>
  )
}

/** "in 3 days", "in 5 h", "2 days ago". */
function relative(value: string) {
  const ms = new Date(value).getTime() - Date.now()
  const hours = Math.abs(ms) / 3_600_000
  const span =
    hours < 1
      ? `${Math.max(1, Math.round(hours * 60))} min`
      : hours < 48
        ? `${Math.round(hours)} h`
        : `${Math.round(hours / 24)} days`
  return ms >= 0 ? `in ${span}` : `${span} ago`
}

function dueLine(a: {
  phase: AssignmentPhase
  opensAt: string
  dueAt: string
  allowLate: boolean
  latePenaltyPercent: number
}) {
  if (a.phase === "upcoming") {
    return `Opens ${formatDateTime(a.opensAt)} (${relative(a.opensAt)})`
  }
  const due = `Due ${formatDateTime(a.dueAt)} (${relative(a.dueAt)})`
  if (!a.allowLate) return `${due}. Late work doesn't count.`
  return a.latePenaltyPercent > 0
    ? `${due}. Late work loses ${a.latePenaltyPercent}%.`
    : `${due}. Late work counts in full.`
}

function Progress({ earned, total }: { earned: number; total: number }) {
  return (
    <div className="flex items-center gap-2.5 text-caption text-body tabular-nums">
      <div
        aria-hidden
        className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-strong"
      >
        <div
          className="h-full bg-success"
          style={{ width: `${(100 * earned) / Math.max(1, total)}%` }}
        />
      </div>
      {earned} / {total} points
    </div>
  )
}

export function AssignmentList() {
  const { data, error } = useQuery({
    queryKey: ["assignments"],
    queryFn: () => api<AssignmentSummary[]>("/assignments"),
  })
  if (!data) return <Loading error={error} />

  const current = data.filter((a) => a.phase === "open" || a.phase === "late")
  const upcoming = data.filter((a) => a.phase === "upcoming")
  const closed = data.filter((a) => a.phase === "closed")

  const card = (a: AssignmentSummary) => (
    <Link
      key={a.slug}
      href={`/assignments/${a.slug}`}
      data-testid="assignment-card"
      className="grid gap-2 rounded-lg border border-hairline bg-card p-4 hover:border-hairline-strong"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-title-md text-ink">
          {a.title}
          {a.org && (
            <span className="ml-2 text-caption text-body">· {a.org.name}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {!a.published && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
              Draft
            </span>
          )}
          <PhaseBadge phase={a.phase} />
        </span>
      </div>
      <div className="text-caption text-body">{dueLine(a)}</div>
      {a.phase !== "upcoming" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Progress earned={a.earned} total={a.total} />
          <span className="text-caption text-body">
            {a.solved} of {a.problemCount} problems solved
          </span>
        </div>
      )}
    </Link>
  )

  return (
    <>
      <h1 className="mb-4 text-display-lg text-ink">Assignments</h1>
      {data.length === 0 && (
        <p className="text-body-sm text-body">
          No assignments yet. When your teacher sets one, it will show up here
          with its due date.
        </p>
      )}
      {current.length > 0 && (
        <section className="mb-6 grid gap-3">
          <h2 className="text-title-sm text-ink">To do</h2>
          {current.map(card)}
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="mb-6 grid gap-3">
          <h2 className="text-title-sm text-ink">Coming up</h2>
          {upcoming.map(card)}
        </section>
      )}
      {closed.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-title-sm text-ink">Closed</h2>
          {closed.map(card)}
        </section>
      )}
    </>
  )
}

export function AssignmentView({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["assignment", slug],
    queryFn: () => api<AssignmentDetail>(`/assignments/${slug}`),
  })
  if (!data) return <Loading error={error} />

  return (
    <>
      <Link
        href="/assignments"
        className="text-caption text-body hover:text-ink"
      >
        ← All assignments
      </Link>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-display-lg text-ink">{data.title}</h1>
        <PhaseBadge phase={data.phase} />
      </div>
      <p className="mb-4 text-body-sm text-body">{dueLine(data)}</p>
      {data.description && (
        <div className="mb-4 text-body-sm text-body">
          <RichText text={data.description} />
        </div>
      )}
      {data.phase === "upcoming" && data.problems.length === 0 ? (
        <p className="text-body-sm text-body">
          The problems appear here when it opens.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Progress earned={data.earned} total={data.total} />
            <span className="text-caption text-body">
              Open a problem, solve it there and press Submit. Your marks here
              update by themselves.
            </span>
          </div>
          <Table headers={["Problem", "Difficulty", "Status", "Points"]}>
            {data.problems.map((problem) => (
              <tr key={problem.slug} data-testid="assignment-problem">
                <td>
                  <Link
                    href={problem.href}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {problem.title}
                  </Link>
                </td>
                <td>
                  <Difficulty level={problem.level} />
                </td>
                <td className={STATUS[problem.status].tone}>
                  {STATUS[problem.status].label}
                </td>
                <td className="tabular-nums">
                  {problem.earned} / {problem.points}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  )
}
