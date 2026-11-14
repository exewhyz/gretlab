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
  CheckSquareIcon,
  ChartBarIcon,
  MegaphoneIcon,
  type Icon,
} from "@phosphor-icons/react"
import Link from "next/link"

import { type KindTerms } from "@workspace/judge"

import { Card } from "@workspace/ui/components/card"

import { Figures } from "@/components/figures"
import { useViewer } from "@/features/account/use-viewer"
import { CheckInCard } from "@/features/staff-attendance/components/staff-attendance"

import { orgPages } from "@/lib/paths"
import { Greeting, Home, Tile, greeting, useTerms } from "./home-parts"

/** What each page is for, on the staff home's cards, in the kind's words. */
export function pageHints(t: KindTerms): Record<string, string> {
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

export const PAGE_ICONS: Record<string, Icon> = {
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
export function StaffHome({
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
        <Figures>
          {tiles.map((tile) => (
            <Tile
              key={tile.label}
              label={tile.label}
              value={tile.value}
              hint={tile.hint}
              href={tile.href}
              testId="staff-tile"
            />
          ))}
        </Figures>
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
