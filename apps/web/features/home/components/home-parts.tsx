"use client"

import Link from "next/link"
import { createContext, useContext } from "react"

import { KINDS, type KindTerms } from "@workspace/judge"

import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { runLabel, runPercent, runStatus } from "@/features/runs/format"
import { StatusBadge } from "@/features/training/components/training"
import { EventCard, type EventView } from "@/features/events/components/events"
import { formatDay } from "@/lib/format"

import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { orgHome } from "@/features/home/server"

export type Tone = "bad" | "plain"

export type AdminData = NonNullable<Home["admin"]>

export type TeacherData = NonNullable<Home["teacher"]>

export type StudentData = NonNullable<Home["student"]>

export type ParentData = NonNullable<Home["parent"]>

export type View = "admin" | "teacher" | "student" | "parent" | "staff"

/** The organization's own words (Students or Learners, Classes or Cohorts). */
export const TermsContext = createContext<KindTerms>(KINDS.school.terms)

export const useTerms = () => useContext(TermsContext)

export type Runs = NonNullable<Home["runs"]>

export type MyTrainingItem = NonNullable<Home["training"]["mine"]>[number]

export type TeamTraining = NonNullable<Home["training"]["team"]>

export type Home = ApiResult<typeof orgHome>

export const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

export function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

export function Greeting({
  day,
  title,
  actions,
  holiday,
}: {
  day: string
  title: string
  actions?: React.ReactNode
  /** Today's holiday, if the organization is closed. */
  holiday?: string | null
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-body-sm text-muted-foreground">
          {longDay(day)}
          {holiday && (
            <span data-testid="holiday-today">
              {" "}
              · <span className="font-medium text-ink">Holiday: {holiday}</span>
            </span>
          )}
        </p>
        <h1 className="mt-1 text-[26px] leading-tight tracking-tight text-ink sm:text-display-lg">
          {title}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "primary" | "bad"
}) {
  return (
    <Card size="sm" data-testid="home-tile">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {/* Not CardTitle: a small card sizes its title down, and this is the figure. */}
        <div
          className={cn(
            "text-3xl leading-tight font-semibold tracking-tight text-ink tabular-nums",
            tone === "primary" && "text-primary-active",
            tone === "bad" && "text-destructive"
          )}
        >
          {value}
        </div>
      </CardHeader>
      {hint && (
        <CardContent className="text-xs text-muted-foreground">
          {hint}
        </CardContent>
      )}
    </Card>
  )
}

export function Meter({ value, bad }: { value: number; bad?: boolean }) {
  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      aria-label={`${Math.round(value)}%`}
      className={cn(
        "w-full",
        bad && "[&_[data-slot=progress-indicator]]:bg-destructive"
      )}
    />
  )
}

export function TaskList({
  base,
  items,
  empty,
}: {
  base: string
  items: {
    kind: string
    tone: Tone
    text: string
    action: string
    href: string
  }[]
  empty: string
}) {
  if (items.length === 0)
    return <p className="text-body-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="grid">
      {items.map((t, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-t border-hairline-soft py-2.5 text-body-sm first:border-t-0"
        >
          <Badge variant={t.tone === "bad" ? "destructive" : "secondary"}>
            {t.kind}
          </Badge>
          <span className="min-w-0 flex-1">{t.text}</span>
          <Link
            href={t.href.startsWith("/orgs/") ? t.href : `${base}${t.href}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t.action}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })

/** Whether a lesson "HH:MM"–"HH:MM" is on now, by this device's clock. */
export function isNow(starts: string, ends: string) {
  const d = new Date()
  const m = d.getHours() * 60 + d.getMinutes()
  const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return m >= at(starts) && m < at(ends)
}

/** A community member in no group yet: where to find one. */
export function FindAGroup({ slug }: { slug: string }) {
  const terms = useTerms()
  return (
    <Card size="sm" data-testid="find-a-group">
      <CardHeader>
        <CardTitle className="text-title-md">
          Find your {terms.groups.toLowerCase()}
        </CardTitle>
        <CardDescription>
          Join the {terms.groups.toLowerCase()} you&apos;re into to see their
          events, notices and contests.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href={orgPages(slug).groups}
          className="text-body-sm font-medium text-primary hover:underline"
        >
          Browse {terms.groups.toLowerCase()}
        </Link>
      </CardContent>
    </Card>
  )
}

/** The next few events, each with your answer, and a link to them all. */
export function UpcomingEvents({
  slug,
  events,
}: {
  slug: string
  events: EventView[]
}) {
  return (
    <section className="grid gap-3" data-testid="upcoming-events">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-title-md font-semibold text-ink">Events</h2>
        <Link
          href={orgPages(slug).events}
          className="text-body-sm font-medium text-primary hover:underline"
        >
          All events
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          No events coming up.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => (
            <EventCard key={e.id} slug={slug} e={e} />
          ))}
        </div>
      )}
    </section>
  )
}

/** An employee's assigned training, most urgent first, each linked to where it's taken. */
export function MyTrainingCard({ items }: { items: MyTrainingItem[] }) {
  const open = items.filter((i) => i.status !== "done").length
  return (
    <Card data-testid="my-training">
      <CardHeader>
        <CardTitle className="text-title-md">My training</CardTitle>
        <CardDescription>
          {open ? `${open} to finish or renew` : "All done and up to date"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {items.map((t) => (
            <li
              key={t.courseId}
              data-testid="my-training-item"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <Link
                href={t.href}
                className="min-w-0 font-medium text-ink hover:underline"
              >
                {t.course}
              </Link>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t.progress.done}/{t.progress.total}
                </span>
                {t.needBy && t.status !== "done" && (
                  <span>by {formatDay(t.needBy)}</span>
                )}
                {t.status === "done" && t.validUntil && (
                  <span>valid until {formatDay(t.validUntil)}</span>
                )}
                <StatusBadge status={t.status} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** A manager's team view: how their teams are doing with training, and what's late. */
export function TeamTrainingCard({
  slug,
  data,
}: {
  slug: string
  data: TeamTraining
}) {
  return (
    <Card size="sm" data-testid="team-training">
      <CardHeader>
        <CardTitle className="text-title-md">Team training</CardTitle>
        <CardDescription>
          {data.done} of {data.assigned} done ·{" "}
          <span
            className={data.late ? "font-medium text-destructive" : ""}
            data-testid="team-late"
          >
            {data.late} late
          </span>{" "}
          · {data.soon} due soon
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {data.trainings.map((t) => (
          <Link
            key={`${t.groupId}:${t.courseId}`}
            href={orgPages(slug).manage(`/training/${t.groupId}/${t.courseId}`)}
            className="flex flex-wrap justify-between gap-2 text-body-sm hover:underline"
          >
            <span className="text-ink">
              {t.course}{" "}
              <span className="text-muted-foreground">· {t.group}</span>
            </span>
            <span className="text-xs">
              {t.late > 0 && (
                <span className="text-destructive">{t.late} late</span>
              )}
              {t.late > 0 && t.soon > 0 && " · "}
              {t.soon > 0 && (
                <span className="text-primary-active">{t.soon} soon</span>
              )}
            </span>
          </Link>
        ))}
        <Link
          href={orgPages(slug).manage(`/training`)}
          className="text-body-sm font-medium text-primary hover:underline"
        >
          All training
        </Link>
      </CardContent>
    </Card>
  )
}

/** A learner's runs: which cohort, its week, their pod and its mentor. */
export function MyRuns({ runs }: { runs: Runs }) {
  const terms = useTerms()
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="my-runs">
      {runs.learning.map((r) => (
        <Card key={r.id} size="sm" data-testid="my-run">
          <CardHeader>
            <CardDescription>{terms.group}</CardDescription>
            <CardTitle className="text-title-md">{r.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="font-semibold text-ink"
                data-testid="my-run-week"
              >
                {runStatus(r.state)}
              </span>
              <span className="text-xs text-muted-foreground">
                {runLabel(r.startsOn, r.endsOn)}
              </span>
            </div>
            <Meter value={runPercent(r.state)} />
            <span className="text-body-sm text-body" data-testid="my-run-lead">
              {r.pod ? `${r.pod.name} · ` : ""}
              {r.lead
                ? `${terms.groupLead}: ${r.lead}`
                : `No ${terms.groupLead.toLowerCase()} yet`}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** A mentor's pods, each with where its run is, linked to its progress. */
export function LeadingRuns({ slug, runs }: { slug: string; runs: Runs }) {
  const terms = useTerms()
  return (
    <Card size="sm" data-testid="leading-runs">
      <CardHeader>
        <CardTitle className="text-title-md">
          You&apos;re the {terms.groupLead.toLowerCase()} of
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1.5">
          {runs.leading.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <Link
                href={orgPages(slug).manage(`/progress/${g.run.id}`)}
                className="font-medium text-ink hover:underline"
              >
                {g.name}
                {g.id !== g.run.id && (
                  <span className="text-muted-foreground"> · {g.run.name}</span>
                )}
              </Link>
              <span className="text-xs text-muted-foreground">
                {runStatus(g.run.state)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
