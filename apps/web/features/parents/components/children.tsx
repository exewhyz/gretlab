"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { Card, Loading } from "@/features/admin/components/shell"
import {
  CampusSummary,
  type CampusData,
} from "@/features/campus/components/campus"
import { WeekGrid } from "@/features/timetable/components/timetable"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

interface Child {
  id: string
  name: string
  relation: string
  org: { slug: string; name: string }
}

/** /children: everyone this person is a parent of. */
export function MyChildren() {
  const { data, error } = useQuery({
    queryKey: ["me", "children"],
    queryFn: () => api<Child[]>("/me/children"),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <h1 className="mb-4 text-display-sm text-ink">My children</h1>
      {data.length === 0 ? (
        <p className="text-body-sm text-body">
          No children are linked to your account. Ask the school to add you as a
          parent, using this email.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="children">
          {data.map((c) => (
            <li key={`${c.org.slug}/${c.id}`}>
              <Link
                href={`/orgs/${c.org.slug}/children/${c.id}`}
                className="block rounded-lg border border-hairline bg-card p-4 hover:border-ink/30"
              >
                <div className="text-title-sm text-ink">{c.name}</div>
                <div className="text-body-sm text-body">{c.org.name}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

interface Period {
  id: string
  name: string
  starts: string
  ends: string
  isBreak: boolean
}

interface Overview {
  results?: boolean
  child: { name: string }
  org: { name: string }
  active: boolean
  classes: {
    id: string
    name: string
    attendance: {
      marked: number
      present: number
      percent: number | null
    } | null
    timetable: {
      days: number[]
      periods: Period[]
      slots: {
        day: number
        periodId: string
        subject: string
        code: string
        teacher?: string | null
        room: string
      }[]
    } | null
    notices: { id: string; at: string; text: string; by: string | null }[]
  }[]
  absences: { day: string; period: string; group: string; status: string }[]
  campus?: CampusData
  work: {
    slug: string
    title: string
    exam: boolean
    dueAt: string
    phase: string
    earned: number
    total: number
  }[]
}

/** One child, as their parent sees them. Read only. */
export function ChildPage({
  slug,
  studentId,
}: {
  slug: string
  studentId: string
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "child", studentId],
    queryFn: () => api<Overview>(`/orgs/${slug}/children/${studentId}`),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0" data-testid="child-page">
      <header>
        <Link
          href="/children"
          className="text-caption text-body hover:text-ink"
        >
          ‹ My children
        </Link>
        <h1 className="text-display-sm text-ink">{data.child.name}</h1>
        <p className="text-body-sm text-body">
          {data.org.name}
          {data.classes.length > 0 &&
            ` · ${data.classes.map((c) => c.name).join(", ")}`}
        </p>
        {data.results && (
          <Link
            href={`/orgs/${slug}/results/${studentId}`}
            className="mt-2 inline-block text-body-sm font-medium text-primary hover:underline"
          >
            Report card ›
          </Link>
        )}
      </header>
      {!data.active && (
        <p className="text-body-sm text-body">
          {data.child.name} isn&apos;t an active member of {data.org.name} now.
        </p>
      )}

      {data.classes.some((c) => c.attendance) && (
        <section aria-labelledby="att">
          <h2 id="att" className="mb-2 text-title-sm text-ink">
            Attendance
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.classes.map(
              (c) =>
                c.attendance && (
                  <Card key={c.id} data-testid="attendance-card">
                    <div className="text-caption text-body">{c.name}</div>
                    <div className="text-display-sm text-ink">
                      {c.attendance.percent === null
                        ? "—"
                        : `${c.attendance.percent}%`}
                    </div>
                    <div className="text-xs text-body">
                      {c.attendance.present} of {c.attendance.marked} classes
                    </div>
                  </Card>
                )
            )}
          </div>
          {data.absences.length > 0 && (
            <ul
              className="mt-3 grid gap-1 text-body-sm"
              aria-label="Recent absences"
            >
              {data.absences.map((a, i) => (
                <li key={i} className="text-body">
                  <span className="text-ink">{a.day}</span> ·{" "}
                  {a.status === "late" ? "Late" : "Absent"} · {a.group}
                  {a.period && ` (${a.period})`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.classes.map(
        (c) =>
          c.timetable && (
            <section key={c.id} aria-label={`Timetable, ${c.name}`}>
              <h2 className="mb-2 text-title-sm text-ink">
                Timetable · {c.name}
              </h2>
              <WeekGrid
                days={c.timetable.days}
                periods={c.timetable.periods}
                cells={c.timetable.slots}
                show={(cell) => cell.teacher}
              />
            </section>
          )
      )}

      {data.campus && (
        <CampusSummary data={data.campus} slug={slug} own={false} />
      )}

      <section aria-labelledby="work">
        <h2 id="work" className="mb-2 text-title-sm text-ink">
          Work and marks
        </h2>
        {data.work.length === 0 ? (
          <p className="text-body-sm text-body">Nothing set yet.</p>
        ) : (
          <ul
            className="divide-y divide-hairline rounded-lg border border-hairline bg-card"
            data-testid="child-work"
          >
            {data.work.map((w) => (
              <li
                key={w.slug}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-body-sm"
              >
                <div className="min-w-0">
                  <div className="text-ink">
                    {w.title}
                    {w.exam && <span className="text-caption"> · exam</span>}
                  </div>
                  <div className="text-xs text-body">
                    {w.phase === "open"
                      ? "Due"
                      : w.phase === "upcoming"
                        ? "Opens before"
                        : "Was due"}{" "}
                    {formatDateTime(w.dueAt)}
                  </div>
                </div>
                <div className="text-ink tabular-nums">
                  {w.total > 0 ? `${w.earned} / ${w.total}` : "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.classes.some((c) => c.notices.length) && (
        <section aria-labelledby="notices">
          <h2 id="notices" className="mb-2 text-title-sm text-ink">
            Class notices
          </h2>
          <ul className="grid gap-2">
            {data.classes.flatMap((c) =>
              c.notices.map((n) => (
                <li key={n.id}>
                  <Card>
                    <div className="mb-1 text-caption text-body">
                      {c.name} · {formatDateTime(n.at)}
                      {n.by && ` · ${n.by}`}
                    </div>
                    <p className="text-body-sm whitespace-pre-wrap text-ink">
                      {n.text}
                    </p>
                  </Card>
                </li>
              ))
            )}
          </ul>
        </section>
      )}
    </div>
  )
}
