"use client"

import { CalendarCheckIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import { Loading } from "@/features/admin/components/shell"
import type { classAttendance, classGrades } from "@/features/classes/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */
import { useClasswork } from "./class-work"

export function ClassGrades({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "grades"],
    queryFn: () =>
      api<ApiResult<typeof classGrades>>(
        `/orgs/${slug}/classes/${groupId}/grades`
      ),
  })
  if (!data) return <Loading error={error} />
  if (data.assignments.length === 0) {
    return (
      <p className="text-body-sm text-body">
        No published assignments for this class yet, so nothing to grade.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
      <table data-testid="class-gradebook" className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-hairline text-start text-caption text-body">
            <th className="sticky start-0 bg-card px-3 py-2 text-start font-medium">
              Student
            </th>
            {data.assignments.map((a) => (
              <th key={a.id} className="px-3 py-2 text-end font-medium">
                <Link
                  href={orgPages(slug).manage(`/assignments/${a.id}/grades`)}
                  className="hover:text-ink hover:underline"
                >
                  {a.title}
                </Link>
                <div className="text-xs font-normal">out of {a.total}</div>
              </th>
            ))}
            <th className="px-3 py-2 text-end font-medium">Overall</th>
          </tr>
        </thead>
        <tbody>
          {data.students.map((s) => (
            <tr
              key={s.email}
              className="border-b border-hairline last:border-0"
            >
              <td className="sticky start-0 bg-card px-3 py-2">
                <div className="text-ink">{s.name}</div>
                <div className="text-xs text-body">{s.email}</div>
              </td>
              {s.marks.map((m, i) => (
                <td key={i} className="px-3 py-2 text-end tabular-nums">
                  {m === null ? <span className="text-body">—</span> : m}
                </td>
              ))}
              <td className="px-3 py-2 text-end font-medium text-ink tabular-nums">
                {s.percent === null ? "—" : `${s.percent}%`}
              </td>
            </tr>
          ))}
          <tr className="bg-canvas-soft text-caption text-body">
            <td className="sticky start-0 bg-canvas-soft px-3 py-2">
              Class average
            </td>
            {data.assignments.map((a) => (
              <td key={a.id} className="px-3 py-2 text-end tabular-nums">
                {a.average ?? "—"}
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function MyGrades({ slug, groupId }: { slug: string; groupId: string }) {
  const { data, error } = useClasswork(slug, groupId)
  if (!data) return <Loading error={error} />
  const graded = data.assignments.filter((a) => a.phase !== "upcoming")
  const earned = graded.reduce((s, a) => s + a.earned, 0)
  const total = graded.reduce((s, a) => s + a.total, 0)
  return (
    <div className="grid gap-2">
      <p className="text-body-sm text-ink">
        Overall:{" "}
        <strong className="font-semibold">
          {total ? `${Math.round((100 * earned) / total)}%` : "—"}
        </strong>{" "}
        <span className="text-body">
          ({earned} of {total} points so far)
        </span>
      </p>
      {graded.length === 0 && (
        <p className="text-body-sm text-body">Nothing graded yet.</p>
      )}
      {graded.map((a) => (
        <Link
          key={a.id}
          href={`/assignments/${a.slug}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-card p-3 hover:border-hairline-strong"
        >
          <span className="text-body-sm text-ink">{a.title}</span>
          <span className="text-caption text-body tabular-nums">
            {a.earned} / {a.total}
          </span>
        </Link>
      ))}
    </div>
  )
}

export type AttendanceData = ApiResult<typeof classAttendance>

export function useAttendance(slug: string, groupId: string) {
  return useQuery({
    queryKey: ["org", slug, "class", groupId, "attendance"],
    queryFn: () =>
      api<AttendanceData>(`/orgs/${slug}/classes/${groupId}/attendance`),
  })
}

/** Below this, a student is flagged. Colleges commonly require 75%. */
export const LOW_ATTENDANCE = 75

export function AttendanceTable({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const { data } = useAttendance(slug, groupId)
  if (!data || data.students.length === 0) return null
  const marked = data.students.some((s) => s.marked > 0)
  return (
    <section className="grid gap-2">
      <h2 className="flex items-center gap-2 text-title-sm text-ink">
        <CalendarCheckIcon className="size-4" /> Attendance
      </h2>
      {!marked ? (
        <p className="text-body-sm text-body">
          Mark who was there when you log a class, and each student&apos;s
          attendance shows here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
          <table data-testid="attendance-table" className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-hairline text-caption text-body">
                <th className="px-3 py-2 text-start font-medium">Student</th>
                <th className="px-3 py-2 text-end font-medium">Present</th>
                <th className="px-3 py-2 text-end font-medium">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr
                  key={s.email}
                  className="border-b border-hairline last:border-0"
                >
                  <td className="px-3 py-2 text-ink">{s.name}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {s.present} / {s.marked}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-end tabular-nums",
                      s.percent !== null && s.percent < LOW_ATTENDANCE
                        ? "font-medium text-destructive"
                        : "text-ink"
                    )}
                  >
                    {s.percent === null ? "—" : `${s.percent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function MySyllabus({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const work = useClasswork(slug, groupId)
  const attendance = useAttendance(slug, groupId)
  if (!work.data) return <Loading error={work.error} />
  const mine = attendance.data?.mine
  return (
    <div className="grid gap-4">
      {mine && mine.marked > 0 && (
        <p
          data-testid="my-attendance"
          className={cn(
            "rounded-md border px-3 py-2 text-body-sm",
            mine.percent !== null && mine.percent < LOW_ATTENDANCE
              ? "border-destructive/40 bg-destructive/5 text-ink"
              : "border-hairline bg-card text-ink"
          )}
        >
          Your attendance: <strong>{mine.percent}%</strong>{" "}
          <span className="text-body">
            ({mine.present} of {mine.marked} classes)
          </span>
        </p>
      )}
      {work.data.topics.length === 0 ? (
        <p className="text-body-sm text-body">No syllabus yet.</p>
      ) : (
        <ol className="grid gap-1 rounded-lg border border-hairline bg-card p-3.5 text-body-sm">
          {work.data.topics.map((t, i) => (
            <li key={t.id} className="flex justify-between gap-3">
              <span className="text-ink">
                {i + 1}. {t.title}
              </span>
              {t.plannedFor && (
                <span className="text-caption text-body">{t.plannedFor}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
