"use client"

import {
  AirplaneTiltIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  ClipboardTextIcon,
  ExamIcon,
  IdentificationBadgeIcon,
  StudentIcon,
  UsersIcon,
  CalendarDotsIcon,
  CheckIcon,
  CheckSquareIcon,
  ChartBarIcon,
  CodeIcon,
  MegaphoneIcon,
  UserPlusIcon,
  type Icon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { createContext, useContext, useState } from "react"

import {
  KINDS,
  type KindTerms,
  type RunState,
  type TrainingStatus,
} from "@workspace/judge"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { useViewer } from "@/features/account/use-viewer"
import {
  CampusSummary,
  type CampusData,
} from "@/features/campus/components/campus"
import { MyCourseAttendance } from "@/features/attendance/components/attendance"
import { runLabel, runPercent, runStatus } from "@/features/runs/format"
import { StatusBadge } from "@/features/training/components/training"
import { EventCard, type EventView } from "@/features/events/components/events"
import { formatDay } from "@/lib/format"
import { CheckInCard } from "@/features/staff-attendance/components/staff-attendance"
import { api } from "@/lib/api/client"

import { useOrgReach, useShell } from "./org-shell"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { orgHome } from "@/features/home/server"

type Tone = "bad" | "plain"

type AdminData = NonNullable<Home["admin"]>

type TeacherData = NonNullable<Home["teacher"]>

type StudentData = NonNullable<Home["student"]>

type ParentData = NonNullable<Home["parent"]>

type View = "admin" | "teacher" | "student" | "parent" | "staff"

/** The organization's own words (Students or Learners, Classes or Cohorts). */
const TermsContext = createContext<KindTerms>(KINDS.school.terms)
const useTerms = () => useContext(TermsContext)

type Runs = NonNullable<Home["runs"]>

type MyTrainingItem = NonNullable<Home["training"]["mine"]>[number]

type TeamTraining = NonNullable<Home["training"]["team"]>

type Home = ApiResult<typeof orgHome>

const LABEL: Record<View, string> = {
  admin: "School",
  teacher: "Teaching",
  student: "My progress",
  parent: "My children",
  staff: "My work",
}

/** The school's home: a dashboard for each of this person's views here (tabs if several). */
export function OrgHome({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "home"],
    queryFn: () => api<Home>(`/orgs/${slug}/home`),
  })
  const shown = data?.views ?? []
  const [picked, setPicked] = useState<View | null>(null)
  if (error)
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    )
  if (!data) return <HomeSkeleton />
  const view = picked && shown.includes(picked) ? picked : shown[0]
  return (
    <TermsContext.Provider value={data.terms ?? KINDS.school.terms}>
      <div className="grid gap-5" data-testid="org-home">
        {shown.length > 1 && (
          <Tabs value={view} onValueChange={(v) => setPicked(v as View)}>
            <TabsList aria-label="Show my home as">
              {shown.map((v) => (
                <TabsTrigger key={v} value={v}>
                  {LABEL[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {view === "admin" && data.admin && (
          <AdminHome slug={slug} data={data.admin} />
        )}
        {view === "teacher" && data.teacher && (
          <TeacherHome
            slug={slug}
            data={data.teacher}
            runs={data.runs ?? null}
            training={data.training?.team ?? null}
          />
        )}
        {(view === "teacher" || view === "admin") &&
          data.events &&
          data.events.length > 0 && (
            <UpcomingEvents slug={slug} events={data.events} />
          )}
        {view === "student" && data.student && (
          <StudentHome
            slug={slug}
            data={data.student}
            runs={data.runs ?? null}
            training={data.training?.mine ?? null}
            events={data.events ?? null}
            openGroups={data.openGroups ?? false}
          />
        )}
        {view === "parent" && data.parent && (
          <ParentHome slug={slug} data={data.parent} />
        )}
        {view === "staff" && data.staff && (
          <StaffHome slug={slug} data={data.staff} />
        )}
      </div>
    </TermsContext.Provider>
  )
}

function HomeSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

/* ---------- shared pieces ---------- */

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

function Greeting({
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

function Tile({
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

function Meter({ value, bad }: { value: number; bad?: boolean }) {
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

function TaskList({
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

/* ---------- the school (admin) ---------- */

const trendConfig = {
  percent: { label: "Present", color: "var(--chart-1)" },
} satisfies ChartConfig

function AdminHome({ slug, data }: { slug: string; data: AdminData }) {
  const terms = useTerms()
  const { data: viewer } = useViewer()
  const { data: shell } = useShell(slug)
  const manage = `/orgs/${slug}/manage`
  const { manages } = useOrgReach(slug)
  const first = (viewer?.user?.name ?? "").split(" ")[0]
  const done = data.steps.filter((s) => s.done).length
  const present = data.tiles.present
  const shortcuts: {
    title: string
    hint: string
    href: string
    icon: Icon
    show: boolean
  }[] = [
    {
      title: "Take attendance",
      hint: "Today, any class",
      href: "/attendance",
      icon: CheckSquareIcon,
      show: manages("attendance"),
    },
    {
      title: `Add ${terms.learners.toLowerCase()}`,
      hint: "One by one or a list",
      href: "/import",
      icon: UserPlusIcon,
      show: manages("import"),
    },
    {
      title: "Post a notice",
      hint: "A class or everyone",
      href: "/notes",
      icon: MegaphoneIcon,
      show: manages("notices"),
    },
    {
      title: "Timetable",
      hint: "Periods and weeks",
      href: "/timetable",
      icon: CalendarDotsIcon,
      show: manages("timetable"),
    },
    {
      title: "Set an assignment",
      hint: "Coding lab",
      href: "/assignments",
      icon: CodeIcon,
      show: manages("assignments"),
    },
    {
      title: "Reports",
      hint: "Attendance and marks",
      href: "/reports",
      icon: ChartBarIcon,
      show: manages("reports"),
    },
  ]
  return (
    <div className="grid gap-5" data-testid="admin-home">
      <Greeting
        day={data.day}
        holiday={data.holiday}
        title={first ? `${greeting()}, ${first}` : greeting()}
        actions={
          <>
            {manages("import") && (
              <Link
                href={`${manage}/import`}
                className={buttonVariants({ variant: "outline" })}
              >
                Add {terms.learners.toLowerCase()}
              </Link>
            )}
            {manages("attendance") && (
              <Link href={`${manage}/attendance`} className={buttonVariants()}>
                Take attendance
              </Link>
            )}
          </>
        }
      />

      {data.steps.length > 0 && done < data.steps.length && (
        <Card data-testid="setup-checklist">
          <CardHeader>
            <CardTitle className="text-title-md">
              Get {shell?.org.name ?? "your school"} running
            </CardTitle>
            <CardDescription>
              {done} of {data.steps.length} steps done. This card goes once they
              all are.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">
                {done} / {data.steps.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Meter value={(100 * done) / data.steps.length} />
            <ol className="grid gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2 xl:grid-cols-4">
              {data.steps.map((s) => (
                <li key={s.key}>
                  <Link
                    href={`${manage}${s.href}`}
                    className="flex items-center gap-2.5 hover:text-primary-active"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full",
                        s.done
                          ? "bg-ink text-canvas"
                          : "border-[1.5px] border-hairline-strong"
                      )}
                    >
                      {s.done && <CheckIcon weight="bold" className="size-3" />}
                    </span>
                    <span
                      className={cn(
                        s.done
                          ? "text-muted-foreground line-through"
                          : "font-medium text-ink"
                      )}
                    >
                      {s.label}
                      <span className="sr-only">
                        {s.done ? " (done)" : " (to do)"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile
          label={terms.learners}
          value={String(data.tiles.students)}
          hint="Active, in a class"
        />
        {present ? (
          <Tile
            label="Present today"
            value={
              present.of
                ? `${Math.round((100 * present.present) / present.of)}%`
                : "—"
            }
            hint={`${present.present} of ${present.of}${present.open ? ` · ${present.open} registers open` : ""}`}
            tone="primary"
          />
        ) : (
          <Tile
            label="Present today"
            value="—"
            hint="Attendance is switched off"
          />
        )}
        <Tile label={terms.instructors} value={String(data.tiles.teachers)} />
        <Tile
          label={terms.groups}
          value={String(data.tiles.classes)}
          hint="Where students sit"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Attendance today</CardTitle>
            <CardDescription>Class by class</CardDescription>
            {manages("attendance") && (
              <CardAction>
                <Link
                  href={`${manage}/attendance`}
                  className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
                >
                  Registers <ArrowRightIcon className="size-3.5" />
                </Link>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {data.classes.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No classes with students yet.
              </p>
            ) : (
              <ul className="grid gap-2.5" data-testid="attendance-today">
                {data.classes.map((c) => (
                  <li
                    key={c.id}
                    className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-body-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5rem]"
                  >
                    <span className="truncate">{c.name}</span>
                    <Meter
                      value={c.taken ? (100 * c.present) / c.students : 0}
                      bad={c.taken && c.present / c.students < 0.85}
                    />
                    <span
                      className={cn(
                        "text-right tabular-nums",
                        c.taken
                          ? "text-muted-foreground"
                          : "font-medium text-destructive"
                      )}
                    >
                      {c.taken ? `${c.present}/${c.students}` : "Not taken"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Recent days</CardTitle>
            <CardDescription>
              Whole-school attendance, last {data.trend.length || 10} days with
              registers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.trend.length === 0 ? (
              <Empty className="border border-dashed border-hairline">
                <EmptyHeader>
                  <EmptyTitle>No registers yet</EmptyTitle>
                  <EmptyDescription>
                    Days appear here once attendance is taken.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ChartContainer
                config={trendConfig}
                className="aspect-auto h-56 w-full"
              >
                <BarChart
                  data={data.trend.map((t) => ({
                    ...t,
                    label: t.day.slice(8),
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
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Bar
                    dataKey="percent"
                    fill="var(--color-percent)"
                    radius={[6, 6, 2, 2]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card data-testid="needs-attention">
          <CardHeader>
            <CardTitle className="text-title-md">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList
              base={manage}
              items={data.attention}
              empty="Nothing needs you right now."
            />
          </CardContent>
        </Card>
        {data.coverage.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-title-md">People</CardTitle>
              <CardDescription>
                How much of the school each part covers
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {data.coverage.map((c) => (
                <div key={c.label} className="grid gap-1.5 text-body-sm">
                  <div className="flex justify-between gap-2">
                    <span>{c.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {c.value} of {c.of}
                    </span>
                  </div>
                  <Meter value={c.of ? (100 * c.value) / c.of : 0} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <section aria-labelledby="shortcuts" className="grid gap-2.5">
        <h2
          id="shortcuts"
          className="text-body-sm font-medium text-muted-foreground"
        >
          Shortcuts
        </h2>
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {shortcuts
            .filter((s) => s.show)
            .map((s) => (
              <Link
                key={s.title}
                href={`${manage}${s.href}`}
                className="group/short"
              >
                <Card
                  size="sm"
                  className="flex-row items-center gap-3 px-4 transition-colors group-hover/short:ring-foreground/20"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-ink">
                    <s.icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body-sm font-semibold text-ink">
                      {s.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {s.hint}
                    </span>
                  </span>
                </Card>
              </Link>
            ))}
        </div>
      </section>
    </div>
  )
}

/* ---------- teaching ---------- */

function TeacherHome({
  slug,
  data,
  runs,
  training,
}: {
  slug: string
  data: TeacherData
  runs: Runs | null
  training: TeamTraining | null
}) {
  const terms = useTerms()
  const { has, manages } = useOrgReach(slug)
  const manage = `/orgs/${slug}/manage`
  const timetable = has("timetable")
  return (
    <div className="grid gap-5" data-testid="teacher-home">
      <Greeting
        day={data.day}
        holiday={data.holiday}
        title={`${terms.instructor === "Mentor" ? "Mentoring" : terms.instructor === "Manager" ? "Your team" : "Teaching"} today`}
      />
      {data.checkIn && <CheckInCard slug={slug} />}
      {runs && runs.leading.length > 0 && (
        <LeadingRuns slug={slug} runs={runs} />
      )}
      {training && training.assigned > 0 && (
        <TeamTrainingCard slug={slug} data={training} />
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {timetable && (
          <Tile
            label="Lessons today"
            value={String(data.tiles.lessons)}
            hint="From the timetable"
          />
        )}
        {data.attendanceOn && (
          <Tile
            label="Registers to take"
            value={String(data.tiles.toTake)}
            tone={data.tiles.toTake ? "primary" : undefined}
          />
        )}
        <Tile
          label={`My ${terms.learners.toLowerCase()}`}
          value={String(data.tiles.students)}
        />
        <Tile
          label={`My ${terms.groups.toLowerCase()}`}
          value={String(data.classes.length)}
        />
        {data.attendanceOn && (
          <Tile
            label="Below 75%"
            value={String(data.tiles.low)}
            hint={`Attendance in my ${terms.groups.toLowerCase()}`}
            tone={data.tiles.low ? "bad" : undefined}
          />
        )}
      </div>

      <div
        className={cn(
          "grid gap-4",
          timetable && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        )}
      >
        {timetable && (
          <Card data-testid="my-day">
            <CardHeader>
              <CardTitle className="text-title-md">My day</CardTitle>
              {manages("my-timetable") && (
                <CardAction>
                  <Link
                    href={`${manage}/my-timetable`}
                    className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
                  >
                    My week <ArrowRightIcon className="size-3.5" />
                  </Link>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {data.periods.length === 0 ? (
                <Empty className="border border-dashed border-hairline">
                  <EmptyHeader>
                    <EmptyTitle>No lessons on the timetable today</EmptyTitle>
                    <EmptyDescription>Your classes are below.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ol className="grid gap-1">
                  {data.periods.map((p, i) => (
                    <li
                      key={i}
                      className={cn(
                        "grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]",
                        p.isBreak && "text-muted-foreground"
                      )}
                    >
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {p.time}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-body-sm font-semibold">
                          {p.title}
                        </span>
                        {p.detail && (
                          <span className="block text-xs text-muted-foreground">
                            {p.detail}
                          </span>
                        )}
                      </span>
                      {p.groupId &&
                        data.attendanceOn &&
                        manages("attendance") && (
                          <span className="col-start-2 sm:col-start-auto">
                            {p.taken ? (
                              <Badge variant="secondary">Register taken</Badge>
                            ) : (
                              <Link
                                href={`${manage}/attendance`}
                                className={buttonVariants({ size: "sm" })}
                              >
                                Take register
                              </Link>
                            )}
                          </span>
                        )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="teacher-todo">
          <CardHeader>
            <CardTitle className="text-title-md">To do</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList base={manage} items={data.todo} empty="All caught up." />
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="my-classes" className="grid gap-3">
        <h2 id="my-classes" className="text-title-md text-ink">
          My {terms.groups.toLowerCase()}
        </h2>
        {data.classes.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No {terms.groups.toLowerCase()} with {terms.learners.toLowerCase()}{" "}
            are given to you yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {data.classes.map((c) => (
              <Card key={c.id} size="sm" data-testid="my-class-card">
                <CardHeader>
                  <CardTitle className="text-title-sm">{c.name}</CardTitle>
                  <CardDescription>{c.students} students</CardDescription>
                  {data.attendanceOn && (
                    <CardAction>
                      <Badge variant={c.taken ? "secondary" : "outline"}>
                        {c.taken ? "Taken today" : "Not taken"}
                      </Badge>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="grid gap-3">
                  {c.attendance != null && (
                    <div className="grid gap-1.5 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Attendance</span>
                        <span className="tabular-nums">{c.attendance}%</span>
                      </div>
                      <Meter value={c.attendance} bad={c.attendance < 85} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {data.attendanceOn && (
                      <Link
                        href={`${manage}/attendance`}
                        className={buttonVariants({ size: "sm" })}
                      >
                        Register
                      </Link>
                    )}
                    <Link
                      href={orgPages(slug).cls(c.id)}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Open class
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ---------- a student ---------- */

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })

/** Whether a lesson "HH:MM"–"HH:MM" is on now, by this device's clock. */
function isNow(starts: string, ends: string) {
  const d = new Date()
  const m = d.getHours() * 60 + d.getMinutes()
  const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return m >= at(starts) && m < at(ends)
}

/** A community member in no group yet: where to find one. */
function FindAGroup({ slug }: { slug: string }) {
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
function UpcomingEvents({
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
function MyTrainingCard({ items }: { items: MyTrainingItem[] }) {
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
function TeamTrainingCard({
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
function MyRuns({ runs }: { runs: Runs }) {
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
function LeadingRuns({ slug, runs }: { slug: string; runs: Runs }) {
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

function StudentHome({
  slug,
  data,
  runs,
  training,
  events,
  openGroups,
}: {
  slug: string
  data: StudentData
  runs: Runs | null
  training: MyTrainingItem[] | null
  events: EventView[] | null
  openGroups: boolean
}) {
  const terms = useTerms()
  const { data: viewer } = useViewer()
  const { has } = useOrgReach(slug)
  const first = (viewer?.user?.name ?? "").split(" ")[0]
  const attendance = has("attendance")
  const timetable = has("timetable")
  const work = has("exams") ? "Assignments and exams" : "Assignments"
  // Library, bus or hostel: shown beside the notices only when there's something.
  const hasCampus = Boolean(
    data.campus.library ||
    data.campus.transport?.ride ||
    data.campus.hostel?.stay
  )
  return (
    <div className="grid gap-5" data-testid="student-home">
      <Greeting
        day={data.day}
        title={first ? `Hi ${first}, here's your week` : "Your week"}
      />

      <div
        className={cn(
          "grid grid-cols-2 gap-3 sm:gap-4",
          attendance ? "lg:grid-cols-4" : "lg:grid-cols-3"
        )}
      >
        {attendance && (
          <Card size="sm" data-testid="home-tile">
            <CardHeader>
              <CardDescription>Attendance</CardDescription>
              <div className="text-3xl leading-tight font-semibold tracking-tight text-primary-active tabular-nums">
                {data.tiles.attendance == null
                  ? "—"
                  : `${data.tiles.attendance}%`}
              </div>
            </CardHeader>
            <CardContent className="grid gap-2">
              {data.tiles.attendance != null && (
                <Meter
                  value={data.tiles.attendance}
                  bad={data.tiles.attendance < 75}
                />
              )}
              <span className="text-xs text-muted-foreground">
                Late counts as present
              </span>
            </CardContent>
          </Card>
        )}
        <Tile
          label="Due this week"
          value={String(data.tiles.dueThisWeek)}
          hint={work}
        />
        <Tile
          label={`My ${terms.groups.toLowerCase()}`}
          value={String(data.tiles.classes)}
          hint={data.classes.map((c) => c.name).join(", ")}
        />
        {data.tiles.booksOut != null ? (
          <Tile
            label="Library books"
            value={String(data.tiles.booksOut)}
            hint="Out with you now"
          />
        ) : (
          <Tile
            label="Notices"
            value={String(data.notices.length)}
            hint={`In your ${terms.groups.toLowerCase()}`}
          />
        )}
      </div>

      {runs && runs.learning.length > 0 && <MyRuns runs={runs} />}
      {training && training.length > 0 && <MyTrainingCard items={training} />}
      {openGroups && data.classes.length === 0 && <FindAGroup slug={slug} />}
      {events && (events.length > 0 || openGroups) && (
        <UpcomingEvents slug={slug} events={events} />
      )}

      {attendance && <MyCourseAttendance slug={slug} />}

      <div
        className={cn(
          "grid gap-4",
          timetable && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        )}
      >
        {timetable && (
          <Card data-testid="student-today">
            <CardHeader>
              <CardTitle className="text-title-md">Today</CardTitle>
              {data.classes[0] && (
                <CardAction>
                  <Link
                    href={orgPages(slug).cls(data.classes[0].id, "timetable")}
                    className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
                  >
                    My week <ArrowRightIcon className="size-3.5" />
                  </Link>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {data.lessons.length === 0 ? (
                <Empty className="border border-dashed border-hairline">
                  <EmptyHeader>
                    <EmptyTitle>No lessons on the timetable today</EmptyTitle>
                    <EmptyDescription>
                      Your {terms.groups.toLowerCase()}&apos; pages have their
                      work and notices.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ol className="grid gap-1">
                  {data.lessons.map((l, i) => {
                    const now = !l.isBreak && isNow(l.starts, l.ends)
                    return (
                      <li
                        key={i}
                        className={cn(
                          "grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5",
                          now && "bg-primary/10",
                          l.isBreak && "text-muted-foreground"
                        )}
                      >
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {l.starts}
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-body-sm font-semibold">
                            {l.subject}
                          </span>
                          {now && <Badge>Now</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {l.teacher}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="coming-up">
          <CardHeader>
            <CardTitle className="text-title-md">Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            {data.coming.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                Nothing due. Enjoy it.
              </p>
            ) : (
              <ul className="grid">
                {data.coming.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 border-t border-hairline-soft py-2.5 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">{c.kind}</Badge>
                        <span className="truncate text-body-sm font-medium">
                          {c.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.detail} · {shortDate(c.at)}
                      </span>
                    </span>
                    <Link
                      href={c.href}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      {c.action}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "grid gap-4",
          hasCampus && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Notices</CardTitle>
          </CardHeader>
          <CardContent>
            {data.notices.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No notices in your {terms.groups.toLowerCase()} yet.
              </p>
            ) : (
              <ul className="grid">
                {data.notices.map((n) => (
                  <li
                    key={n.id}
                    className="border-t border-hairline-soft py-2.5 first:border-t-0"
                  >
                    <p className="text-xs text-muted-foreground">
                      {n.group}
                      {n.by && ` · ${n.by}`} · {shortDate(n.at)}
                    </p>
                    <p className="text-body-sm whitespace-pre-wrap">{n.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {hasCampus && (
          <div className="[&_[data-testid=campus]]:grid-cols-1">
            <CampusSummary data={data.campus} slug={slug} own />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- a parent ---------- */

function ParentHome({ slug, data }: { slug: string; data: ParentData }) {
  const terms = useTerms()
  return (
    <div className="grid gap-5" data-testid="parent-home">
      <Greeting day={data.day} title="My children" />
      {data.children.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No children linked here</EmptyTitle>
            <EmptyDescription>
              The school links parents to their children.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.children.map((c) => (
            <Card key={c.id} data-testid="child-card">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary-active"
                  >
                    {c.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-title-md">{c.name}</CardTitle>
                    <CardDescription className="truncate">
                      {c.classes.join(", ") ||
                        `Not in a ${terms.group.toLowerCase()} yet`}
                    </CardDescription>
                  </div>
                </div>
                {c.absentToday && (
                  <CardAction>
                    <Badge variant="destructive">Absent today</Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label: "Attendance",
                      value: c.attendance == null ? "—" : `${c.attendance}%`,
                      tone:
                        c.attendance != null && c.attendance < 75
                          ? "text-destructive"
                          : "text-ink",
                    },
                    {
                      label: "Open work",
                      value: String(c.work),
                      tone: "text-ink",
                    },
                    { label: "Bus", value: c.bus ?? "—", tone: "text-ink" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="min-w-0 rounded-lg bg-muted/60 px-3 py-2.5"
                    >
                      <div className="text-xs text-muted-foreground">
                        {s.label}
                      </div>
                      <div className={cn("truncate text-title-sm", s.tone)}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>
                {c.news.length > 0 && (
                  <ul className="grid">
                    {c.news.map((n, i) => (
                      <li
                        key={i}
                        className="flex items-baseline gap-3 border-t border-hairline-soft py-2 text-body-sm first:border-t-0"
                      >
                        <Badge
                          variant={
                            n.tone === "bad" ? "destructive" : "secondary"
                          }
                        >
                          {n.kind}
                        </Badge>
                        <span className="min-w-0 flex-1">{n.text}</span>
                        <span className="text-xs whitespace-nowrap text-muted-foreground">
                          {shortDate(n.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={orgPages(slug).child(c.id)}
                    className={buttonVariants({ size: "sm" })}
                  >
                    Open
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** What each page is for, on the staff home's cards, in the kind's words. */
function pageHints(t: KindTerms): Record<string, string> {
  const group = t.group.toLowerCase()
  const groups = t.groups.toLowerCase()
  const learners = t.learners.toLowerCase()
  const guardians = (t.guardians ?? "Parents").toLowerCase()
  return {
    "staff-attendance": "Mark today's staff register, see the month",
    leave: "Ask for leave, decide requests",
    admissions: `Review applications and admit ${learners}`,
    students: `Records, admission numbers, ${groups}`,
    "academic-years": `${t.periods}, ${t.groupLead.toLowerCase()}s, promotion`,
    exams: `${t.assessments}, marks and report cards`,
    members: "Everyone here",
    groups: `${t.groups} and how they nest`,
    parents: `Link ${guardians} to ${learners}`,
    attendance: `Take a ${group}'s register`,
    "attendance-report": `A ${group}'s month`,
    timetable: `Periods and ${group} timetables`,
    subjects: `What each ${group} takes, and who teaches it`,
    books: "Books and loans",
    transport: "Routes, stops and riders",
    hostel: "Rooms, beds and residents",
    notices: `Post to a ${group} or everyone`,
    reports: "Attendance and marks",
    roles: "Who may do what",
    invites: "Links to join",
    import: "Add people from a spreadsheet",
  }
}

const PAGE_ICONS: Record<string, Icon> = {
  "staff-attendance": IdentificationBadgeIcon,
  leave: AirplaneTiltIcon,
  admissions: ClipboardTextIcon,
  students: StudentIcon,
  "academic-years": CalendarCheckIcon,
  exams: ExamIcon,
  members: UsersIcon,
  attendance: CheckSquareIcon,
  timetable: CalendarDotsIcon,
  notices: MegaphoneIcon,
  reports: ChartBarIcon,
}

/** Office staff (no class to teach, not running the school): today, what waits, their pages. */
function StaffHome({
  slug,
  data,
}: {
  slug: string
  data: NonNullable<Home["staff"]>
}) {
  const hints = pageHints(useTerms())
  const { data: viewer } = useViewer()
  const first = (viewer?.user?.name ?? "").split(" ")[0]
  const t = data.staffToday
  const tiles = [
    ...(data.waiting.leave != null
      ? [
          {
            label: "Leave to decide",
            value: String(data.waiting.leave),
            hint: data.waiting.leave ? "Waiting for you" : "Nothing waiting",
            tone: data.waiting.leave ? ("primary" as const) : undefined,
            href: orgPages(slug).leave,
          },
        ]
      : []),
    ...(data.waiting.applications != null
      ? [
          {
            label: "New applications",
            value: String(data.waiting.applications),
            hint: "Admissions",
            tone: data.waiting.applications ? ("primary" as const) : undefined,
            href: orgPages(slug).manage(`/admissions`),
          },
        ]
      : []),
    ...(t
      ? [
          {
            label: "Staff present today",
            value: `${t.present + t.late + t.half} of ${t.total}`,
            hint:
              [
                t.late && `${t.late} late`,
                t.absent && `${t.absent} absent`,
                t.leave && `${t.leave} on leave`,
                t.unmarked && `${t.unmarked} not marked`,
              ]
                .filter(Boolean)
                .join(" · ") || "Everyone's in",
            tone: t.unmarked ? ("primary" as const) : undefined,
            href: orgPages(slug).manage(`/staff-attendance`),
          },
        ]
      : []),
  ]
  const groups = [...new Set(data.links.map((l) => l.group))]
  return (
    <div className="grid gap-5" data-testid="staff-home">
      <Greeting
        day={data.day}
        title={first ? `${greeting()}, ${first}` : greeting()}
      />
      {data.checkIn && <CheckInCard slug={slug} />}
      {tiles.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="block"
              data-testid="staff-tile"
            >
              <Tile
                label={tile.label}
                value={tile.value}
                hint={tile.hint}
                tone={tile.tone}
              />
            </Link>
          ))}
        </div>
      )}
      {groups.map((g) => (
        <section key={g} aria-label={g} className="grid gap-2.5">
          <h2 className="text-body-sm font-medium text-muted-foreground">
            {g}
          </h2>
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {data.links
              .filter((l) => l.group === g)
              .map((l) => {
                const I = PAGE_ICONS[l.key] ?? ArrowRightIcon
                return (
                  <Link
                    key={l.key}
                    href={l.href}
                    className="group/short"
                    data-testid="staff-page"
                  >
                    <Card
                      size="sm"
                      className="flex-row items-center gap-3 px-4 transition-colors group-hover/short:ring-foreground/20"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-ink">
                        <I className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-body-sm font-semibold text-ink">
                          {l.label}
                        </span>
                        {hints[l.key] && (
                          <span className="block text-xs text-muted-foreground">
                            {hints[l.key]}
                          </span>
                        )}
                      </span>
                    </Card>
                  </Link>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
