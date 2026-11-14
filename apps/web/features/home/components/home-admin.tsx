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
import Link from "next/link"

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
import { cn } from "@workspace/ui/lib/utils"

import { Figures } from "@/components/figures"
import { useViewer } from "@/features/account/use-viewer"

import { useOrgReach, useShell } from "./org-shell"
import {
  AdminData,
  Greeting,
  Meter,
  TaskList,
  Tile,
  greeting,
  useTerms,
} from "./home-parts"

export const trendConfig = {
  percent: { label: "Present", color: "var(--chart-3)" },
} satisfies ChartConfig

export function AdminHome({ slug, data }: { slug: string; data: AdminData }) {
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
        dayOff={data.dayOff}
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
            {manages("attendance") && !data.dayOff && (
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

      <Figures>
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
            hint={
              data.dayOff
                ? data.dayOff
                : `${present.present} of ${present.of}${present.open ? ` · ${present.open} registers open` : ""}`
            }
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
      </Figures>

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
            {data.dayOff ? (
              <p
                className="text-body-sm text-muted-foreground"
                data-testid="no-registers"
              >
                No registers today: {data.dayOff.toLowerCase()}.
              </p>
            ) : data.classes.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No classes with students yet.
              </p>
            ) : !data.classes.some((c) => c.taken) ? (
              // Ten empty bars say less than one line: nothing is taken yet.
              <div
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid="attendance-today"
              >
                <p className="text-body-sm text-body">
                  No registers taken yet today.{" "}
                  <span className="text-muted-foreground">
                    {data.classes.length}{" "}
                    {data.classes.length === 1
                      ? terms.group.toLowerCase()
                      : terms.groups.toLowerCase()}{" "}
                    to take.
                  </span>
                </p>
                {manages("attendance") && (
                  <Link
                    href={`${manage}/attendance`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Open registers
                  </Link>
                )}
              </div>
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
                        c.taken ? "text-ink" : "text-muted-foreground"
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
                    // Slim ink bars: ten full-width dark blocks outweighed the page.
                    maxBarSize={18}
                    radius={[4, 4, 0, 0]}
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
