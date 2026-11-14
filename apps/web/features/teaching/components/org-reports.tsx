"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  Loading,
  PageTitle,
  PercentBar,
  Stats,
  Table,
  Pager,
} from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import type { orgReportPage } from "@/features/teaching/server"
import { TextInput } from "@/components/form"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { ProgressBar } from "./teaching-parts"

/** What the reports route answers (features/teaching/server.ts). */
export type Report = ApiResult<typeof orgReportPage>

/** With `fixedGroup`, one class's insights: no title or group picker. */
export function OrgReports({
  slug,
  fixedGroup,
}: {
  slug: string
  fixedGroup?: string
}) {
  const [chosen, setGroup] = useState("")
  const [onlyInactive, setOnlyInactive] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const group = fixedGroup ?? chosen
  // The figures cover everyone; the student table comes a page at a time from the server.
  const { data, error, isFetching, isPlaceholderData } = useQuery({
    queryKey: [
      "org",
      slug,
      "reports",
      group,
      onlyInactive,
      search.trim(),
      page,
    ],
    queryFn: () =>
      api<Report>(
        `/orgs/${slug}/reports?${new URLSearchParams({
          group,
          page: String(page),
          inactive: String(onlyInactive),
          q: search.trim(),
        })}`
      ),
    placeholderData: keepPreviousData,
  })
  if (!data) return <Loading error={error} />
  const inactive = data.summary.students - data.summary.activeThisWeek
  const pct = (n: number) =>
    data.summary.students ? Math.round((100 * n) / data.summary.students) : 0
  const students = data.students
  const show = (inactiveOnly: boolean) => {
    setOnlyInactive(inactiveOnly)
    setPage(1)
  }

  return (
    <>
      {fixedGroup ? (
        <div className="mb-4 flex justify-end">
          <a
            href={`/api/v1/orgs/${slug}/reports?group=${group}&format=csv`}
            download
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Download CSV
          </a>
        </div>
      ) : (
        <PageTitle
          action={
            <a
              href={`/api/v1/orgs/${slug}/reports?group=${group}&format=csv`}
              download
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Download CSV
            </a>
          }
        >
          Reports
        </PageTitle>
      )}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center gap-2",
          fixedGroup && "hidden"
        )}
      >
        <GroupPicker
          label="Group"
          className="w-72"
          heading="Report on this group and the groups inside it."
          groups={data.groups}
          levels={data.levels}
          extra={[{ value: "", label: "Everyone you can see" }]}
          value={group}
          onChange={setGroup}
        />
        {isFetching && (
          <span className="text-caption text-body">Updating…</span>
        )}
      </div>
      <Stats
        items={[
          { label: "Students", value: data.summary.students },
          {
            label: "Active this week",
            value: data.summary.activeThisWeek,
            hint: `${pct(data.summary.activeThisWeek)}%`,
          },
          {
            label: "Did no work this week",
            value: inactive,
            hint: `${pct(inactive)}%`,
            tone: inactive > 0 ? "bad" : undefined,
          },
          {
            label: "Assignment average",
            value:
              data.summary.averageAssignment === null
                ? "—"
                : `${data.summary.averageAssignment}%`,
          },
          {
            label: "Sharing practice",
            value: data.summary.sharing,
            hint: `of ${data.summary.students}`,
          },
        ]}
      />
      <p className="mb-5 text-caption text-body">
        Activity counts work on this organization&apos;s assignments and
        contests, plus general practice for students who chose to share it.
      </p>

      {data.assignments.length > 0 && (
        <>
          <h2 className="mb-2 text-title-sm text-ink">Assignments</h2>
          <div className="mb-6">
            <Table headers={["Assignment", "Due", "Started", "Average"]}>
              {data.assignments.map((a) => (
                <tr key={a.title + a.dueAt}>
                  <td className="text-ink">{a.title}</td>
                  <td>{formatDate(a.dueAt)}</td>
                  <td className="tabular-nums">
                    {a.started} / {a.students}
                  </td>
                  <td>
                    <PercentBar value={a.averagePercent} />
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}

      {(data.teaching.groups.length > 0 ||
        data.teaching.teachers.length > 0) && (
        <div className="mb-6 grid gap-4 min-[1100px]:grid-cols-2">
          <div>
            <h2 className="mb-2 text-title-sm text-ink">Syllabus progress</h2>
            <Table headers={["Group", "Progress", "Classes (30 days)"]}>
              {data.teaching.groups.map((g) => (
                <tr key={g.path}>
                  <td className="text-ink">{g.path}</td>
                  <td>
                    <ProgressBar progress={g.progress} />
                  </td>
                  <td className="tabular-nums">{g.classes}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <h2 className="mb-2 text-title-sm text-ink">Teachers (30 days)</h2>
            <Table headers={["Teacher", "Classes", "Hours", "Rating"]}>
              {data.teaching.teachers.map((t) => (
                <tr key={t.name}>
                  <td className="text-ink">{t.name}</td>
                  <td className="tabular-nums">{t.classes}</td>
                  <td className="tabular-nums">
                    {(t.minutes / 60).toFixed(1)}
                  </td>
                  <td className="tabular-nums">
                    {t.rating === null ? "—" : `★ ${t.rating} (${t.ratings})`}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title-sm text-ink">Students</h2>
        {inactive > 0 && (
          <div role="group" aria-label="Show" className="flex gap-1.5">
            <Button
              size="sm"
              variant={onlyInactive ? "outline" : "default"}
              aria-pressed={!onlyInactive}
              onClick={() => show(false)}
            >
              Everyone{" "}
              <span className="tabular-nums opacity-70">
                {data.summary.students}
              </span>
            </Button>
            <Button
              size="sm"
              variant={onlyInactive ? "default" : "outline"}
              aria-pressed={onlyInactive}
              onClick={() => show(true)}
            >
              No work this week{" "}
              <span className="tabular-nums opacity-70">{inactive}</span>
            </Button>
          </div>
        )}
      </div>
      <div className="mb-3 max-w-sm">
        <TextInput
          aria-label="Search students"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>
      <div className={isPlaceholderData ? "opacity-60" : undefined}>
        <Table
          headers={[
            "Student",
            "Groups",
            "Last active",
            "Assignments",
            "Practice solved",
          ]}
        >
          {students.map((s) => (
            <tr key={s.email} data-testid="report-student">
              <td>
                <div className="text-ink">{s.name ?? s.email}</div>
                <div className="text-xs">{s.email}</div>
              </td>
              <td className="text-xs">{s.groups.join(", ") || "—"}</td>
              <td className={cn(!s.activeThisWeek && "text-primary")}>
                {s.lastActive ? formatDate(s.lastActive) : "Not in 30 days"}
              </td>
              <td>
                <PercentBar value={s.assignmentPercent} />
              </td>
              <td
                className="tabular-nums"
                title={
                  s.practiceSolved === null
                    ? "Not shared by the student"
                    : undefined
                }
              >
                {s.practiceSolved ?? "Private"}
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <Pager
        page={data.studentsPage.page}
        pages={data.studentsPage.pages}
        total={data.studentsPage.total}
        onPage={setPage}
      />
    </>
  )
}
