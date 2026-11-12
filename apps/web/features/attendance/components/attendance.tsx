"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AttendanceStatus } from "@workspace/judge"
import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Field, FormMessage, TextInput } from "@/components/form"
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
          key={`${groupId}|${day}|${period.trim()}`}
          slug={slug}
          groupId={groupId}
          day={day}
          period={period.trim()}
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
}: {
  slug: string
  groupId: string
  day: string
  period: string
}) {
  const client = useQueryClient()
  const query = new URLSearchParams({ groupId, day, period }).toString()
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
      <Card className="mb-4 grid gap-3 min-[701px]:grid-cols-[2fr_1fr]">
        <Field label="Class">
          <ClassPicker
            data={groups.data}
            value={groupId}
            onChange={setGroupId}
          />
        </Field>
        <Field label="Month">
          <TextInput
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </Card>
      {!groupId ? (
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
