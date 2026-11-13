"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AttendanceStatus } from "@workspace/judge"
import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { api } from "@/lib/api/client"

interface Groups {
  levels: string[]
  choosable: string[]
  groups: { id: string; name: string; parentId: string | null }[]
  today: string
}

interface Register {
  courses?: { id: string; name: string; code: string }[]
  canMark: boolean
  taken: boolean
  takenBy: string | null
  students: {
    id: string
    name: string
    status: AttendanceStatus | null
    onLeave?: string | null
  }[]
}

const STATUSES: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: "present", label: "Present", short: "P" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "late", label: "Late", short: "L" },
  { value: "excused", label: "Excused", short: "E" },
]

function useAttendanceGroups(slug: string) {
  return useQuery({
    queryKey: ["org", slug, "attendance", "groups"],
    queryFn: () => api<Groups>(`/orgs/${slug}/attendance`),
  })
}

/** The group picker, limited to groups this person may take or see attendance for. */
function ClassPicker({
  data,
  value,
  onChange,
}: {
  data: Groups
  value: string
  onChange: (id: string) => void
}) {
  return (
    <GroupPicker
      label="Class"
      groups={data.groups}
      levels={data.levels}
      value={value}
      onChange={onChange}
      placeholder="Choose a class"
      isDisabled={(id) => !data.choosable.includes(id)}
    />
  )
}

/** Manage › Attendance: take or correct a class's register for a day (and period). */
export function AttendanceRegister({ slug }: { slug: string }) {
  const groups = useAttendanceGroups(slug)
  const [groupId, setGroupId] = useState("")
  const [day, setDay] = useState("")
  const [period, setPeriod] = useState("")
  const [course, setCourse] = useState("")
  useEffect(() => {
    if (groups.data && !day) setDay(groups.data.today)
    if (groups.data?.choosable.length === 1 && !groupId) {
      setGroupId(groups.data.choosable[0]!)
    }
  }, [groups.data, day, groupId])
  if (!groups.data) return <Loading error={groups.error} />
  return (
    <>
      <PageTitle>Attendance</PageTitle>
      <Card className="mb-4 grid gap-3 min-[701px]:grid-cols-[2fr_1fr_1fr]">
        <Field label="Class">
          <ClassPicker
            data={groups.data}
            value={groupId}
            onChange={setGroupId}
          />
        </Field>
        <Field label="Day">
          <TextInput
            type="date"
            value={day}
            max={groups.data.today}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field label="Period (optional)">
          <TextInput
            value={period}
            placeholder="Whole day"
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
      </Card>
      {groupId && day ? (
        <RegisterSheet
          key={`${groupId}|${day}|${period.trim()}|${course}`}
          slug={slug}
          groupId={groupId}
          day={day}
          period={period.trim()}
          course={course}
          onCourse={setCourse}
        />
      ) : (
        <p className="text-body-sm text-body">
          Choose a class to take its register.
        </p>
      )}
    </>
  )
}

function RegisterSheet({
  slug,
  groupId,
  day,
  period,
  course = "",
  onCourse,
}: {
  slug: string
  course?: string
  onCourse?: (id: string) => void
  groupId: string
  day: string
  period: string
}) {
  const client = useQueryClient()
  const query = new URLSearchParams({
    groupId,
    day,
    period,
    subjectId: course,
  }).toString()
  const key = ["org", slug, "attendance", "register", query]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Register>(`/orgs/${slug}/attendance/register?${query}`),
  })
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({})
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  useEffect(() => {
    if (!data) return
    // A register not taken yet starts with everyone present, and those on leave excused.
    setMarks(
      Object.fromEntries(
        data.students.map((s) => [
          s.id,
          s.status ?? (s.onLeave ? "excused" : "present"),
        ])
      )
    )
  }, [data])
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/attendance/register`, {
        method: "PUT",
        body: {
          groupId,
          day,
          period,
          subjectId: course || null,
          marks: Object.entries(marks).map(([userId, status]) => ({
            userId,
            status,
          })),
        },
      }),
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      void client.invalidateQueries({ queryKey: ["org", slug, "attendance"] })
    },
    onError: (e: Error) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!data) return <Loading error={error} />
  if (data.students.length === 0) {
    return (
      <p className="text-body-sm text-body">This class has no students yet.</p>
    )
  }
  const count = (s: AttendanceStatus) =>
    Object.values(marks).filter((m) => m === s).length
  const setAll = (status: AttendanceStatus) => {
    setMarks(Object.fromEntries(data.students.map((s) => [s.id, status])))
    setMessage(null)
  }
  return (
    <Card className="grid gap-3" data-testid="register">
      {(data.courses?.length ?? 0) > 0 && onCourse && (
        <div className="w-full max-w-xs">
          <Field
            label="Course"
            help="Registers by course count toward each course's attendance."
          >
            <SelectInput
              value={course}
              onChange={(e) => onCourse(e.target.value)}
            >
              <option value="">Whole class (no course)</option>
              {data.courses!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ` : ""}
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-body">
          {data.taken
            ? `Taken${data.takenBy ? ` by ${data.takenBy}` : ""}. Changes replace it.`
            : "Not taken yet. Everyone starts as present."}
        </p>
        <p className="text-caption" data-testid="register-counts">
          {STATUSES.map(
            (s) => `${count(s.value)} ${s.label.toLowerCase()}`
          ).join(" · ")}
        </p>
      </div>
      {data.canMark && (
        <div className="flex gap-2">
          <Button size="xs" variant="outline" onClick={() => setAll("present")}>
            All present
          </Button>
          <Button size="xs" variant="outline" onClick={() => setAll("absent")}>
            All absent
          </Button>
        </div>
      )}
      <ul className="grid">
        {data.students.map((s) => (
          <li
            key={s.id}
            data-testid="register-row"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline py-2"
          >
            <span className="text-body-sm text-ink">
              {s.name}
              {s.onLeave && (
                <span
                  className="ml-2 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground"
                  data-testid="on-leave"
                >
                  On leave · {s.onLeave}
                </span>
              )}
            </span>
            <span
              className="flex gap-1"
              role="group"
              aria-label={`${s.name}'s attendance`}
            >
              {STATUSES.map((st) => {
                const on = marks[s.id] === st.value
                return (
                  <Button
                    key={st.value}
                    size="xs"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    aria-label={`${s.name}: ${st.label}`}
                    title={st.label}
                    disabled={!data.canMark}
                    className={cn("w-9", !on && "text-body")}
                    onClick={() => {
                      setMarks({ ...marks, [s.id]: st.value })
                      setMessage(null)
                    }}
                  >
                    {st.short}
                  </Button>
                )
              })}
            </span>
          </li>
        ))}
      </ul>
      {data.canMark && (
        <div className="flex items-center justify-end gap-3 border-t border-hairline pt-3">
          <FormMessage message={message} />
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save register
          </Button>
        </div>
      )}
    </Card>
  )
}

interface Month {
  columns: { id: string; day: string; period: string; kind: string }[]
  students: {
    id: string
    name: string
    marks: Record<string, AttendanceStatus>
    summary: {
      present: number
      late: number
      absent: number
      excused: number
      percent: number | null
    }
  }[]
}

const SHORT: Record<AttendanceStatus, string> = {
  present: "P",
  absent: "A",
  late: "L",
  excused: "E",
}

/** Manage › Attendance report: a class's month, one column per register. */
export function AttendanceReport({ slug }: { slug: string }) {
  const groups = useAttendanceGroups(slug)
  const [view, setView] = useState<"month" | "course">("month")
  const [groupId, setGroupId] = useState("")
  const [month, setMonth] = useState("")
  useEffect(() => {
    if (groups.data && !month) setMonth(groups.data.today.slice(0, 7))
    if (groups.data?.choosable.length === 1 && !groupId)
      setGroupId(groups.data.choosable[0]!)
  }, [groups.data, month, groupId])
  const query = new URLSearchParams({ groupId, month }).toString()
  const report = useQuery({
    queryKey: ["org", slug, "attendance", "month", query],
    queryFn: () => api<Month>(`/orgs/${slug}/attendance/month?${query}`),
    enabled: Boolean(groupId && month),
  })
  if (!groups.data) return <Loading error={groups.error} />
  return (
    <>
      <PageTitle>Attendance report</PageTitle>
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Report">
        {(["month", "course"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            role="tab"
            aria-selected={view === v}
            variant={view === v ? "default" : "outline"}
            onClick={() => setView(v)}
          >
            {v === "month" ? "Month" : "By course"}
          </Button>
        ))}
      </div>
      <Card className="mb-4 grid gap-3 min-[701px]:grid-cols-[2fr_1fr]">
        <Field label="Class">
          <ClassPicker
            data={groups.data}
            value={groupId}
            onChange={setGroupId}
          />
        </Field>
        {view === "month" && (
          <Field label="Month">
            <TextInput
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        )}
      </Card>
      {view === "course" ? (
        groupId ? (
          <CourseReport slug={slug} groupId={groupId} />
        ) : (
          <p className="text-body-sm text-body">
            Choose a class to see its courses.
          </p>
        )
      ) : !groupId ? (
        <p className="text-body-sm text-body">
          Choose a class to see its month.
        </p>
      ) : !report.data ? (
        <Loading error={report.error} />
      ) : report.data.columns.length === 0 ? (
        <p className="text-body-sm text-body">
          No attendance taken in this month yet.
        </p>
      ) : (
        <div data-testid="attendance-report">
          <Table
            headers={[
              "Student",
              ...report.data.columns.map(
                (c) =>
                  `${Number(c.day.slice(8))}${c.period ? ` ${c.period}` : ""}`
              ),
              "%",
            ]}
          >
            {report.data.students.map((s) => (
              <tr key={s.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">{s.name}</td>
                {report.data!.columns.map((c) => {
                  const m = s.marks[c.id]
                  return (
                    <td
                      key={c.id}
                      className={cn(
                        "px-2 py-2 text-center text-caption",
                        m === "absent" && "font-semibold text-destructive"
                      )}
                    >
                      {m ? SHORT[m] : "·"}
                    </td>
                  )
                })}
                <td
                  className="px-3 py-2 text-right font-medium"
                  data-testid="report-percent"
                >
                  {s.summary.percent === null ? "—" : `${s.summary.percent}%`}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-caption">
            P present · A absent · L late · E excused (left out of %).
          </p>
        </div>
      )}
    </>
  )
}

/* ---------- course-wise attendance ---------- */

interface CourseData {
  minPercent: number
  span: { from: string; to: string; label: string }
  courses: { id: string; name: string; code: string }[]
  students: {
    id: string
    name: string
    courses: Record<
      string,
      {
        percent: number | null
        attended: number
        held: number
        status: "eligible" | "at_risk" | "short" | "none"
        toReach: number | null
      }
    >
    short: number
  }[]
  shortStudents: number
}

const STATUS_TONE = {
  eligible: "",
  at_risk: "text-primary-active",
  short: "font-semibold text-destructive",
  none: "text-muted-foreground",
} as const

/** Each student's attendance in each course this term, and who's short of the minimum. */
function CourseReport({ slug, groupId }: { slug: string; groupId: string }) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "attendance", "courses", groupId],
    queryFn: () =>
      api<CourseData>(`/orgs/${slug}/attendance/courses?groupId=${groupId}`),
  })
  const settings = useQuery({
    queryKey: ["org", slug, "attendance", "settings"],
    queryFn: () =>
      api<{ minPercent: number; canEdit: boolean }>(
        `/orgs/${slug}/attendance/settings`
      ),
  })
  const [min, setMin] = useState("")
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/attendance/settings`, {
        method: "PUT",
        body: { minPercent: Number(min) },
      }),
    onSuccess: () => {
      setMin("")
      void client.invalidateQueries({ queryKey: ["org", slug, "attendance"] })
    },
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-3" data-testid="course-report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-body-sm text-body">
          {data.span.label} · minimum {data.minPercent}% to sit exams ·{" "}
          <span
            className={
              data.shortStudents ? "font-semibold text-destructive" : ""
            }
            data-testid="short-count"
          >
            {data.shortStudents} short
          </span>
        </p>
        {settings.data?.canEdit && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => (e.preventDefault(), min && save.mutate())}
          >
            <Field label="Minimum %">
              <TextInput
                type="number"
                min={0}
                max={100}
                className="w-24"
                placeholder={String(data.minPercent)}
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={!min || save.isPending}
            >
              Set
            </Button>
          </form>
        )}
      </div>
      {save.error && (
        <FormMessage message={{ text: save.error.message, kind: "err" }} />
      )}
      {data.courses.length === 0 ? (
        <p className="text-body-sm text-body">
          No registers taken by course yet. Choose a course when taking a
          register.
        </p>
      ) : (
        <Table
          headers={[
            "Student",
            ...data.courses.map((c) => c.code || c.name),
            "Short in",
          ]}
        >
          {data.students.map((s) => (
            <tr
              key={s.id}
              className="border-b border-hairline last:border-0"
              data-testid="course-row"
            >
              <td className="px-3 py-2 whitespace-nowrap">{s.name}</td>
              {data.courses.map((c) => {
                const r = s.courses[c.id]
                return (
                  <td
                    key={c.id}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      r && STATUS_TONE[r.status]
                    )}
                    title={
                      r
                        ? `${r.attended} of ${r.held}${r.toReach ? `; ${r.toReach} more in a row to reach ${data.minPercent}%` : ""}`
                        : undefined
                    }
                  >
                    {r?.percent == null ? "—" : `${r.percent}%`}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right">{s.short || "—"}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-caption">
        Red: below {data.minPercent}%, not eligible yet. Orange: within five
        points of it.
      </p>
    </div>
  )
}

/** A student's own attendance by course, with how many classes would bring them to the minimum. */
export function MyCourseAttendance({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ["org", slug, "attendance", "me"],
    queryFn: () =>
      api<{
        minPercent: number
        span: { label: string }
        courses: {
          course: string
          code: string
          percent: number | null
          attended: number
          held: number
          status: "eligible" | "at_risk" | "short" | "none"
          toReach: number | null
        }[]
      }>(`/orgs/${slug}/attendance/me`),
    retry: false,
  })
  if (!data || data.courses.length === 0) return null
  return (
    <Card data-testid="my-course-attendance">
      <h2 className="mb-1 text-title-sm text-ink">Attendance by course</h2>
      <p className="mb-3 text-caption">
        {data.span.label} · at least {data.minPercent}% in each course to sit
        the exams
      </p>
      <ul className="grid gap-2">
        {data.courses.map((c) => (
          <li key={c.code + c.course} className="grid gap-0.5 text-body-sm">
            <div className="flex justify-between gap-2">
              <span className="text-ink">
                {c.code && (
                  <span className="mr-1 font-mono text-xs text-muted-foreground">
                    {c.code}
                  </span>
                )}
                {c.course}
              </span>
              <span className={cn("tabular-nums", STATUS_TONE[c.status])}>
                {c.percent == null ? "—" : `${c.percent}%`} ({c.attended}/
                {c.held})
              </span>
            </div>
            {c.status === "short" && c.toReach != null && (
              <span
                className="text-caption text-destructive"
                data-testid="to-reach"
              >
                Attend the next {c.toReach} class{c.toReach === 1 ? "" : "es"}{" "}
                to reach {data.minPercent}%.
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
