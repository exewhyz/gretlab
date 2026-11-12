"use client"

import {
  ArrowRightIcon,
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
import { useState } from "react"
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
import { api } from "@/lib/api/client"

import { useShell } from "./org-shell"

type Tone = "bad" | "plain"

interface AdminData {
  day: string
  tiles: {
    students: number
    teachers: number
    classes: number
    present: { present: number; of: number; open: number } | null
  }
  steps: { key: string; label: string; done: boolean; href: string }[]
  classes: {
    id: string
    name: string
    students: number
    taken: boolean
    present: number
  }[]
  trend: { day: string; percent: number }[]
  attention: {
    kind: string
    tone: Tone
    text: string
    action: string
    href: string
  }[]
  coverage: { label: string; value: number; of: number }[]
}

interface TeacherData {
  day: string
  tiles: { lessons: number; toTake: number; students: number; low: number }
  periods: {
    time: string
    title: string
    detail: string
    groupId: string | null
    isBreak: boolean
    taken: boolean
  }[]
  todo: {
    kind: string
    tone: Tone
    text: string
    action: string
    href: string
  }[]
  classes: {
    id: string
    name: string
    students: number
    attendance: number | null
    taken: boolean
  }[]
  attendanceOn: boolean
}

interface Home {
  views: ("admin" | "teacher" | "student" | "parent")[]
  admin: AdminData | null
  teacher: TeacherData | null
}

const LABEL = { admin: "School", teacher: "Teaching" } as const

/** The school's home: the admin and teaching dashboards, as this person's roles allow. */
export function OrgHome({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "home"],
    queryFn: () => api<Home>(`/orgs/${slug}/home`),
  })
  const shown = (data?.views ?? []).filter(
    (v): v is "admin" | "teacher" => v === "admin" || v === "teacher"
  )
  const [picked, setPicked] = useState<"admin" | "teacher" | null>(null)
  if (error)
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    )
  if (!data) return <HomeSkeleton />
  const view = picked && shown.includes(picked) ? picked : shown[0]
  return (
    <div className="grid gap-5" data-testid="org-home">
      {shown.length > 1 && (
        <Tabs
          value={view}
          onValueChange={(v) => setPicked(v as "admin" | "teacher")}
        >
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
        <TeacherHome slug={slug} data={data.teacher} />
      )}
    </div>
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
}: {
  day: string
  title: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-body-sm text-muted-foreground">{longDay(day)}</p>
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
            href={`${base}${t.href}`}
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
  const { data: viewer } = useViewer()
  const { data: shell } = useShell(slug)
  const manage = `/orgs/${slug}/manage`
  const may = (p: string) => shell?.permissions.includes(p) ?? false
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
      show: may("attendance.mark"),
    },
    {
      title: "Add students",
      hint: "One by one or a list",
      href: "/import",
      icon: UserPlusIcon,
      show: may("org.members.import"),
    },
    {
      title: "Post a notice",
      hint: "A class or everyone",
      href: "/notices",
      icon: MegaphoneIcon,
      show: may("notices.manage"),
    },
    {
      title: "Timetable",
      hint: "Periods and weeks",
      href: "/timetable",
      icon: CalendarDotsIcon,
      show: may("timetable.periods") || may("timetable.edit"),
    },
    {
      title: "Set an assignment",
      hint: "Coding lab",
      href: "/assignments",
      icon: CodeIcon,
      show: may("assignments.manage"),
    },
    {
      title: "Reports",
      hint: "Attendance and marks",
      href: "/reports",
      icon: ChartBarIcon,
      show: may("reports.view"),
    },
  ]
  return (
    <div className="grid gap-5" data-testid="admin-home">
      <Greeting
        day={data.day}
        title={first ? `${greeting()}, ${first}` : greeting()}
        actions={
          <>
            {may("org.members.import") && (
              <Link
                href={`${manage}/import`}
                className={buttonVariants({ variant: "outline" })}
              >
                Add students
              </Link>
            )}
            {may("attendance.mark") && (
              <Link href={`${manage}/attendance`} className={buttonVariants()}>
                Take attendance
              </Link>
            )}
          </>
        }
      />

      {done < data.steps.length && (
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
          label="Students"
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
        <Tile label="Teachers" value={String(data.tiles.teachers)} />
        <Tile
          label="Classes"
          value={String(data.tiles.classes)}
          hint="Where students sit"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Attendance today</CardTitle>
            <CardDescription>Class by class</CardDescription>
            <CardAction>
              <Link
                href={`${manage}/attendance`}
                className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
              >
                Registers <ArrowRightIcon className="size-3.5" />
              </Link>
            </CardAction>
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

function TeacherHome({ slug, data }: { slug: string; data: TeacherData }) {
  const manage = `/orgs/${slug}/manage`
  return (
    <div className="grid gap-5" data-testid="teacher-home">
      <Greeting day={data.day} title="Teaching today" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile
          label="Lessons today"
          value={String(data.tiles.lessons)}
          hint="From the timetable"
        />
        <Tile
          label="Registers to take"
          value={String(data.tiles.toTake)}
          tone={data.tiles.toTake ? "primary" : undefined}
        />
        <Tile label="My students" value={String(data.tiles.students)} />
        <Tile
          label="Below 75%"
          value={String(data.tiles.low)}
          hint="Attendance in my classes"
          tone={data.tiles.low ? "bad" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card data-testid="my-day">
          <CardHeader>
            <CardTitle className="text-title-md">My day</CardTitle>
            <CardAction>
              <Link
                href={`${manage}/my-timetable`}
                className="inline-flex items-center gap-1 text-body-sm font-medium hover:text-primary-active"
              >
                My week <ArrowRightIcon className="size-3.5" />
              </Link>
            </CardAction>
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
                    {p.groupId && data.attendanceOn && (
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
          My classes
        </h2>
        {data.classes.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No classes with students are given to you yet.
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
                      href={`/orgs/${slug}/classes/${c.id}`}
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
