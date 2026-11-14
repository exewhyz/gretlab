"use client"

import { NeedsAttention } from "@/features/classes/components/needs-attention"
import { ClassCourses } from "@/features/courses/components/class-courses"
import { Discussion } from "@/features/discussions/components/discussion"
import { ClassOutcomes } from "@/features/outcomes/components/class-outcomes"
import { ClassTimetable } from "@/features/timetable/components/timetable"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { Loading } from "@/features/admin/components/shell"
import {
  GroupTeachingView,
  OrgReports,
} from "@/features/teaching/components/teaching"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */
import {
  AttendanceTable,
  ClassGrades,
  MyGrades,
  MySyllabus,
} from "./class-grades"
import { Overview } from "./class-parts"
import { StudentPeople, TeacherPeople } from "./class-people"
import { Stream } from "./class-stream"
import { Classwork } from "./class-work"

const TABS = [
  "stream",
  "classwork",
  "course",
  "discussion",
  "people",
  "grades",
  "classes",
  "timetable",
  "outcomes",
  "insights",
] as const

type Tab = (typeof TABS)[number]

export function ClassPage({
  slug,
  groupId,
  tab: initialTab,
  thread,
}: {
  slug: string
  groupId: string
  tab?: string
  /** A discussion thread to open, from a notification's link. */
  thread?: string
}) {
  const base = `/orgs/${slug}/classes/${groupId}`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId],
    queryFn: () => api<Overview>(base),
  })
  const [tab, setTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "stream"
  )
  if (!data) return <Loading error={error} />

  const teacher = data.viewer.teaches
  const shown: [Tab, string][] = [
    ["stream", "Stream"],
    ["classwork", "Classwork"],
    ["course", "Course"],
    ["discussion", "Discussion"],
    ["people", "People"],
    ["grades", "Grades"],
    ["classes", teacher ? "Syllabus and log" : "Syllabus"],
    ...(data.modules.includes("timetable")
      ? ([["timetable", "Timetable"]] as [Tab, string][])
      : []),
    ...(teacher && data.can.grades
      ? ([["outcomes", "Outcomes"]] as [Tab, string][])
      : []),
    ...(teacher && data.can.reports
      ? ([["insights", "Insights"]] as [Tab, string][])
      : []),
  ]
  const current = shown.some(([t]) => t === tab) ? tab : "stream"
  const choose = (next: Tab) => {
    setTab(next)
    // Kept in the address so a tab can be shared and survives a reload.
    window.history.replaceState(null, "", `?tab=${next}`)
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <nav
          aria-label="Where this class is"
          className="flex flex-wrap items-center gap-1 text-caption text-body"
        >
          <Link href={orgPages(slug).home} className="hover:text-ink">
            {data.org.name}
          </Link>
          {data.group.path.slice(0, -1).map((p) => (
            <span key={p.id}>› {p.name}</span>
          ))}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-display-lg text-ink">
              {data.group.name}
              {data.group.level && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-body">
                  {data.group.level}
                </span>
              )}
            </h1>
            <p className="text-body-sm text-body">
              {data.students} {data.students === 1 ? "student" : "students"}
              {data.teachers.length > 0 &&
                ` · Taught by ${data.teachers.map((t) => t.name).join(", ")}`}
            </p>
          </div>
          {teacher && (
            <div className="flex flex-wrap gap-2">
              {data.can.assignments && (
                <Link
                  href={orgPages(slug).manage(
                    `/assignments/new?for=${groupId}`
                  )}
                  className={buttonVariants({ size: "sm" })}
                >
                  New assignment
                </Link>
              )}
              {data.can.contests && (
                <Link
                  href={orgPages(slug).manage(`/contests/new?for=${groupId}`)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  New contest
                </Link>
              )}
            </div>
          )}
        </div>
        {teacher && data.children.length > 0 && (
          <div
            data-testid="sub-classes"
            className="flex flex-wrap items-center gap-1.5 text-caption text-body"
          >
            Inside:
            {data.children.map((c) => (
              <Link
                key={c.id}
                href={orgPages(slug).cls(c.id)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "xs" }),
                  "font-normal"
                )}
              >
                {c.name}
                <span className="text-body">· {c.members}</span>
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* A grid item grows to its widest child unless told not to: on a phone the tab row
          would otherwise stretch the whole page past the screen. */}
      <Tabs
        value={current}
        onValueChange={(v) => choose(v as Tab)}
        className="min-w-0"
      >
        <TabsList
          variant="line"
          className="max-w-full justify-start overflow-x-auto"
        >
          {shown.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="stream" className="pt-3">
          <Stream slug={slug} groupId={groupId} canPost={data.can.notices} />
        </TabsContent>
        <TabsContent value="classwork" className="pt-3">
          <Classwork
            slug={slug}
            groupId={groupId}
            teacher={teacher}
            can={data.can}
          />
        </TabsContent>
        <TabsContent value="course" className="pt-3">
          <ClassCourses slug={slug} groupId={groupId} />
        </TabsContent>
        <TabsContent value="discussion" className="pt-3">
          <Discussion
            slug={slug}
            groupId={groupId}
            initialThread={thread ?? null}
          />
        </TabsContent>
        <TabsContent value="people" className="pt-3">
          {teacher && data.can.people ? (
            <TeacherPeople
              slug={slug}
              groupId={groupId}
              teachers={data.teachers}
            />
          ) : (
            <StudentPeople slug={slug} groupId={groupId} />
          )}
        </TabsContent>
        <TabsContent value="grades" className="pt-3">
          {teacher && data.can.grades ? (
            <div className="grid gap-4">
              <NeedsAttention slug={slug} groupId={groupId} />
              <ClassGrades slug={slug} groupId={groupId} />
            </div>
          ) : (
            <MyGrades slug={slug} groupId={groupId} />
          )}
        </TabsContent>
        <TabsContent value="classes" className="pt-3">
          {teacher && (data.can.log || data.can.reports) ? (
            <div className="grid gap-4">
              <GroupTeachingView slug={slug} groupId={groupId} embedded />
              <AttendanceTable slug={slug} groupId={groupId} />
            </div>
          ) : (
            <MySyllabus slug={slug} groupId={groupId} />
          )}
        </TabsContent>
        {data.modules.includes("timetable") && (
          <TabsContent value="timetable" className="pt-3">
            <ClassTimetable slug={slug} groupId={groupId} />
          </TabsContent>
        )}
        {teacher && data.can.grades && (
          <TabsContent value="outcomes" className="pt-3">
            <ClassOutcomes slug={slug} groupId={groupId} />
          </TabsContent>
        )}
        {teacher && data.can.reports && (
          <TabsContent value="insights" className="pt-3">
            <OrgReports slug={slug} fixedGroup={groupId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
