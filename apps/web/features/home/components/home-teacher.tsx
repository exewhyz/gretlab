"use client"

import { ArrowRightIcon } from "@phosphor-icons/react"
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
import { cn } from "@workspace/ui/lib/utils"

import { CheckInCard } from "@/features/staff-attendance/components/staff-attendance"

import { useOrgReach } from "./org-shell"
import { orgPages } from "@/lib/paths"
import {
  Greeting,
  LeadingRuns,
  Meter,
  Runs,
  TaskList,
  TeacherData,
  TeamTraining,
  TeamTrainingCard,
  Tile,
  useTerms,
} from "./home-parts"

export function TeacherHome({
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
        dayOff={data.dayOff}
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
