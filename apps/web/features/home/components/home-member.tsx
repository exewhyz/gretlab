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

import { Figures } from "@/components/figures"
import { useViewer } from "@/features/account/use-viewer"
import { CampusSummary } from "@/features/campus/components/campus"
import { MyCourseAttendance } from "@/features/attendance/components/attendance"
import { type EventView } from "@/features/events/components/events"

import { useOrgReach } from "./org-shell"
import { orgPages } from "@/lib/paths"
import {
  FindAGroup,
  Greeting,
  Meter,
  MyRuns,
  MyTrainingCard,
  MyTrainingItem,
  ParentData,
  Runs,
  StudentData,
  Tile,
  UpcomingEvents,
  isNow,
  shortDate,
  useTerms,
} from "./home-parts"

export function StudentHome({
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
        dayOff={data.dayOff}
        title={first ? `Hi ${first}, here's your week` : "Your week"}
      />

      <Figures>
        {attendance && (
          <Tile
            label="Attendance"
            value={
              data.tiles.attendance == null ? "—" : `${data.tiles.attendance}%`
            }
            hint="Late counts as present"
            tone={
              data.tiles.attendance != null && data.tiles.attendance < 75
                ? "bad"
                : undefined
            }
          />
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
      </Figures>

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
                    <EmptyTitle>
                      {data.dayOff
                        ? `No lessons: ${data.dayOff.toLowerCase()}`
                        : "No lessons on the timetable today"}
                    </EmptyTitle>
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

export function ParentHome({ slug, data }: { slug: string; data: ParentData }) {
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
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
                      {/* Wraps rather than cutting off: a bus is "Route 12 · Stop 4". */}
                      <div
                        className={cn(
                          "text-title-sm break-words tabular-nums",
                          s.tone
                        )}
                      >
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
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Open {c.name.split(/\s+/)[0]}&apos;s page
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
