"use client"

import {
  ArrowRightIcon,
  CheckCircleIcon,
  FireIcon,
  LightningIcon,
  TrophyIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { ORG_TYPE_CONFIG, type OrgType } from "@workspace/judge"
import Link from "next/link"

import { Badge } from "@workspace/ui/components/badge"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { Figure, Figures } from "@/components/figures"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { memberDashboard } from "@/features/me/dashboard"

type Dashboard = ApiResult<typeof memberDashboard>

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

/** "Due today", "Due tomorrow", "Due in 3 days", "Due 4 Dec". */
function due(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  const days = Math.floor(ms / 86_400_000)
  if (ms < 0) return "Overdue"
  if (ms < 86_400_000 && new Date(iso).getDate() === new Date().getDate())
    return "Due today"
  if (days < 1) return "Due tomorrow"
  if (days < 7) return `Due in ${days + 1} days`
  return `Due ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  })

/** One of the home's figures (components/figures.tsx), leading to its detail. */
function Tile(props: {
  label: string
  value: string
  hint?: string
  tone?: "bad"
  href?: string
}) {
  return <Figure {...props} testId="member-tile" />
}

/** Twelve weeks of practice, a column a week, darker for busier days. */
function Heatmap({ days }: { days: { day: string; count: number }[] }) {
  const weeks: { day: string; count: number }[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  const level = (n: number) =>
    n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 7 ? 3 : 4
  const shades = [
    "bg-muted",
    "bg-primary/25",
    "bg-primary/45",
    "bg-primary/70",
    "bg-primary",
  ]
  return (
    <div
      className="flex gap-1"
      role="img"
      aria-label="Practice over the last twelve weeks"
      data-testid="heatmap"
    >
      {weeks.map((w, i) => (
        <div key={i} className="grid gap-1">
          {w.map((d) => (
            <span
              key={d.day}
              title={`${d.day}: ${d.count} submission${d.count === 1 ? "" : "s"}`}
              className={cn("size-3.5 rounded-[3px]", shades[level(d.count)])}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** /home: a signed-in person's day across their schools, work, contests and practice. */
export function MemberHome() {
  const { data, error } = useQuery({
    queryKey: ["me", "dashboard"],
    queryFn: () => api<Dashboard>("/me/dashboard"),
  })
  if (error)
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    )
  if (!data)
    return (
      <div className="grid gap-5" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-12 w-80" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  const first = data.name.split(" ")[0]
  const p = data.practice
  const nothingYet = data.orgs.length === 0 && data.children.length === 0
  // Here as a parent or as staff, with nothing to code: a row of zeros helps nobody, so
  // the coding lab shrinks to one line and their organizations lead.
  const quiet =
    !nothingYet &&
    data.work.open === 0 &&
    data.work.overdue === 0 &&
    (p?.solved ?? 0) === 0 &&
    (p?.streak.longest ?? 0) === 0 &&
    (data.children.length > 0 || data.orgs.some((o) => o.staff))
  const orgsSection = (
    <section aria-labelledby="my-schools" className="grid gap-2.5">
      <h2
        id="my-schools"
        className="text-body-sm font-medium text-muted-foreground"
      >
        Your organizations
      </h2>
      {nothingYet ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>You haven&apos;t joined a school yet</EmptyTitle>
            <EmptyDescription>
              Use the invite link your school sent, or{" "}
              <Link href="/orgs" className="underline underline-offset-2">
                find yours
              </Link>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {data.orgs.map((o) => (
            <Link
              key={o.slug}
              href={orgPages(o.slug).home}
              className="group/org"
              data-testid="member-org"
            >
              <Card
                size="sm"
                className="h-full flex-row items-center gap-3 px-4 transition-colors group-hover/org:ring-foreground/20"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground"
                >
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-ink">
                    {o.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {ORG_TYPE_CONFIG[o.type]?.label ?? o.type}
                    {o.roles.length > 0 && ` · ${o.roles.join(", ")}`}
                  </span>
                </span>
              </Card>
            </Link>
          ))}
          {data.children.map((c) => (
            <Link
              key={c.id}
              href={orgPages(c.org.slug).child(c.id)}
              className="group/org"
              data-testid="member-child"
            >
              <Card
                size="sm"
                className="h-full flex-row items-center gap-3 px-4 transition-colors group-hover/org:ring-foreground/20"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-ink"
                >
                  {c.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-ink">
                    {c.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Your child · {c.org.name}
                  </span>
                </span>
              </Card>
            </Link>
          ))}
          {data.pendingOrgs.map((o) => (
            <Card
              key={o.slug}
              size="sm"
              className="flex-row items-center gap-3 px-4 opacity-80"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-ink">
                  {o.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Your request to join is waiting
                </span>
              </span>
              <Badge variant="outline">Waiting</Badge>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
  return (
    <div className="grid gap-6" data-testid="member-home">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-body-sm text-muted-foreground">
            {longDay(data.day)}
          </p>
          <h1 className="mt-1 text-[26px] leading-tight tracking-tight text-ink sm:text-display-lg">
            {greeting()}, {first}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.features.practice && !quiet && (
            // Outline: today's challenge carries the one orange button.
            <Link
              href="/problems"
              className={buttonVariants({ variant: "outline" })}
            >
              Practise
            </Link>
          )}
          {data.orgs.length > 0 && (
            <Link
              href="/classes"
              className={buttonVariants({ variant: "outline" })}
            >
              My classes
            </Link>
          )}
        </div>
      </div>

      {!nothingYet && orgsSection}

      {quiet ? (
        data.features.practice && (
          <div
            data-testid="coding-invite"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-card px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block text-body-sm font-semibold text-ink">
                Coding lab
              </span>
              <span className="block text-xs text-muted-foreground">
                Problems to practise in the browser, with instant results.
              </span>
            </span>
            <Link
              href="/problems"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Try a problem
            </Link>
          </div>
        )
      ) : (
        <>
          <Figures>
            {data.features.assignments && (
              <Tile
                label="Due this week"
                value={String(data.work.dueThisWeek)}
                hint={`${data.work.open} open in all`}
                href="/assignments"
              />
            )}
            {data.features.assignments && (
              <Tile
                label="Overdue"
                value={String(data.work.overdue)}
                hint={
                  data.work.overdue
                    ? "Still accepting late work"
                    : "Nothing overdue"
                }
                tone={data.work.overdue ? "bad" : undefined}
                href="/assignments"
              />
            )}
            {p && (
              <Tile
                label="Problems solved"
                value={String(p.solved)}
                hint={`${p.solvedBy.easy} easy · ${p.solvedBy.medium} medium · ${p.solvedBy.hard} hard`}
                href="/problems"
              />
            )}
            {p && (
              <Tile
                label="Streak"
                value={`${p.streak.current} day${p.streak.current === 1 ? "" : "s"}`}
                hint={`Longest ${p.streak.longest}`}
              />
            )}
          </Figures>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="grid content-start gap-4">
              {data.features.assignments && (
                <Card data-testid="due-next">
                  <CardHeader>
                    <CardTitle className="text-title-md">Due next</CardTitle>
                    <CardAction>
                      <Link
                        href="/assignments"
                        className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
                      >
                        All work <ArrowRightIcon className="size-3.5" />
                      </Link>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {data.work.next.length === 0 ? (
                      <Empty className="border border-dashed border-hairline">
                        <EmptyHeader>
                          <EmptyTitle>You&apos;re all caught up</EmptyTitle>
                          <EmptyDescription>
                            New work from your classes shows up here.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <ul className="grid">
                        {data.work.next.map((a) => {
                          const pct =
                            a.total > 0
                              ? (100 * a.earned) / a.total
                              : a.problemCount
                                ? (100 * a.solved) / a.problemCount
                                : 0
                          return (
                            <li
                              key={a.slug}
                              className="border-t border-hairline-soft py-3 first:border-t-0 first:pt-0"
                              data-testid="due-item"
                            >
                              <Link
                                href={`/assignments/${a.slug}`}
                                className="group grid gap-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="min-w-0 font-medium text-ink group-hover:underline">
                                    {a.title}
                                    {a.exam && (
                                      <Badge
                                        variant="secondary"
                                        className="ml-2"
                                      >
                                        Exam
                                      </Badge>
                                    )}
                                  </span>
                                  <span className="text-caption text-muted-foreground">
                                    {due(a.dueAt)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Progress value={pct} className="flex-1" />
                                  <span className="w-28 shrink-0 text-right text-caption text-muted-foreground tabular-nums">
                                    {a.problemCount
                                      ? `${a.solved} of ${a.problemCount} solved`
                                      : `${Math.round(pct)}%`}
                                  </span>
                                </div>
                                {a.org && (
                                  <span className="text-caption text-muted-foreground">
                                    {a.org}
                                  </span>
                                )}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {data.features.contests && data.contests.length > 0 && (
                <Card data-testid="contests-coming">
                  <CardHeader>
                    <CardTitle className="text-title-md">Contests</CardTitle>
                    <CardAction>
                      <Link
                        href="/contests"
                        className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
                      >
                        All contests <ArrowRightIcon className="size-3.5" />
                      </Link>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {data.contests.map((c) => (
                      <Link
                        key={c.slug}
                        href={`/contests/${c.slug}`}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline p-3 transition-colors hover:border-hairline-strong"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-ink">
                          <TrophyIcon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">
                            {c.title}
                          </span>
                          <span className="block text-caption text-muted-foreground">
                            {c.phase === "live"
                              ? "On now"
                              : `Starts ${when(c.startsAt)}`}
                            {c.org && ` · ${c.org}`}
                          </span>
                        </span>
                        {c.phase === "live" ? (
                          <Badge>Live</Badge>
                        ) : (
                          <Badge variant="outline">Soon</Badge>
                        )}
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="grid content-start gap-4">
              {data.daily?.problem && (
                <Card data-testid="daily">
                  <CardHeader>
                    <CardDescription className="flex items-center gap-2">
                      <LightningIcon className="size-4" aria-hidden="true" />{" "}
                      Today&apos;s challenge
                    </CardDescription>
                    <CardTitle className="text-title-md">
                      {data.daily.problem.title}
                    </CardTitle>
                    <CardAction>
                      <Badge variant="secondary" className="capitalize">
                        {data.daily.problem.level}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex-row flex-wrap items-center justify-between gap-3">
                    {data.daily.solvedToday ? (
                      <span className="inline-flex items-center gap-1.5 text-body-sm text-success">
                        <CheckCircleIcon className="size-4" weight="fill" />{" "}
                        Solved today
                      </span>
                    ) : (
                      <span className="text-body-sm text-muted-foreground">
                        {data.daily.streak
                          ? `Keep your ${data.daily.streak}-day run going`
                          : "Solve it to start a run"}
                      </span>
                    )}
                    <Link
                      href={`/problems/${data.daily.problem.slug}`}
                      className={buttonVariants({
                        size: "sm",
                        variant: data.daily.solvedToday ? "outline" : "default",
                      })}
                    >
                      {data.daily.solvedToday ? "Open" : "Solve"}
                    </Link>
                  </CardContent>
                </Card>
              )}

              {p && (
                <Card data-testid="practice">
                  <CardHeader>
                    <CardTitle className="text-title-md">Practice</CardTitle>
                    <CardDescription className="flex items-center gap-1.5">
                      <FireIcon
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                      {p.streak.current
                        ? `${p.streak.current}-day streak`
                        : "No streak yet: solve one today"}
                    </CardDescription>
                    {data.handle && data.features.profiles && (
                      <CardAction>
                        <Link
                          href={`/u/${data.handle}`}
                          className="text-body-sm font-medium hover:text-primary-active"
                        >
                          Profile
                        </Link>
                      </CardAction>
                    )}
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <Heatmap days={p.activity} />
                    <div className="grid gap-2">
                      {/* A level with no problems yet is left out, not shown as 0 / 0. */}
                      {(["easy", "medium", "hard"] as const)
                        .filter((l) => p.totalBy[l] > 0)
                        .map((l) => (
                          <div key={l} className="grid gap-1">
                            <div className="flex justify-between text-caption">
                              <span className="text-ink capitalize">{l}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {p.solvedBy[l]} / {p.totalBy[l]}
                              </span>
                            </div>
                            <Progress
                              value={
                                p.totalBy[l]
                                  ? (100 * p.solvedBy[l]) / p.totalBy[l]
                                  : 0
                              }
                            />
                          </div>
                        ))}
                    </div>
                    {p.recent.length > 0 && (
                      <div className="grid gap-1">
                        <div className="text-caption font-medium text-muted-foreground">
                          Recently solved
                        </div>
                        {p.recent.map((r) => (
                          <Link
                            key={`${r.slug}${r.at}`}
                            href={`/problems/${r.slug}`}
                            className="flex justify-between gap-2 text-body-sm hover:underline"
                          >
                            <span className="truncate text-ink">{r.title}</span>
                            <span className="shrink-0 text-caption text-muted-foreground">
                              {new Date(r.at).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {nothingYet && orgsSection}
    </div>
  )
}
