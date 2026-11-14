"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { Check, Field, FormMessage, TextInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { myAttendance } from "@/features/staff-attendance/server"
import type { staffMonth } from "@/features/staff-attendance/server"
import type { staffRegister } from "@/features/staff-attendance/server"

type Status = "present" | "late" | "half_day" | "absent" | "on_leave"

const STATUSES: { value: Status; label: string; short: string }[] = [
  { value: "present", label: "Present", short: "P" },
  { value: "late", label: "Late", short: "L" },
  { value: "half_day", label: "Half day", short: "H" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "on_leave", label: "On leave", short: "OL" },
]
const SHORT = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.short])
) as Record<Status, string>
const LABEL = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label])
) as Record<Status, string>
const TONE: Record<Status, string> = {
  present: "text-success",
  late: "text-primary-active",
  half_day: "text-primary-active",
  absent: "text-destructive",
  on_leave: "text-muted-foreground",
}

interface Counts {
  present: number
  late: number
  half: number
  absent: number
  leave: number
  marked: number
  percent: number | null
}

type Register = ApiResult<typeof staffRegister>

/** Manage › Staff attendance: a day's register and the month. */
export function StaffAttendance({ slug }: { slug: string }) {
  return (
    <>
      <PageTitle>Staff attendance</PageTitle>
      <Tabs defaultValue="day">
        <TabsList>
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="day" className="mt-3">
          <DayRegister slug={slug} />
        </TabsContent>
        <TabsContent value="month" className="mt-3">
          <MonthReport slug={slug} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function DayRegister({ slug }: { slug: string }) {
  const client = useQueryClient()
  const [day, setDay] = useState("")
  const key = ["org", slug, "staff-attendance", day]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Register>(
        `/orgs/${slug}/staff-attendance${day ? `?day=${day}` : ""}`
      ),
  })
  const [draft, setDraft] = useState<
    Record<string, { status: Status; checkIn: string; note: string }>
  >({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (!data) return
    if (!day) setDay(data.day)
    // Not marked yet: present, or on leave if their leave is approved.
    setDraft(
      Object.fromEntries(
        data.staff.map((s) => [
          s.id,
          {
            status:
              s.status ?? (s.onLeave === "On leave" ? "on_leave" : "present"),
            checkIn: s.checkIn ?? "",
            note: s.note,
          },
        ])
      )
    )
  }, [data, day])
  const save = useMutation({
    mutationFn: () =>
      api<Register>(`/orgs/${slug}/staff-attendance`, {
        method: "PUT",
        body: {
          day: data!.day,
          marks: Object.entries(draft).map(([userId, m]) => ({ userId, ...m })),
        },
      }),
    onSuccess: (next) => {
      client.setQueryData(key, next)
      void client.invalidateQueries({ queryKey: ["org", slug, "staff-month"] })
    },
  })
  if (!data) return <Loading error={error} />
  const set = (id: string, patch: Partial<(typeof draft)[string]>) => {
    setDraft({ ...draft, [id]: { ...draft[id]!, ...patch } })
    save.reset()
  }
  const unmarked = data.staff.filter((s) => !s.status).length
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <Field label="Day">
            <TextInput
              type="date"
              value={day}
              max={data.today}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-caption text-muted-foreground"
            data-testid="staff-counts"
          >
            {data.counts.present} present · {data.counts.late} late ·{" "}
            {data.counts.half} half day · {data.counts.absent} absent ·{" "}
            {data.counts.leave} on leave
            {unmarked > 0 && ` · ${unmarked} not marked`}
          </span>
          {data.canMark && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
            >
              Late time
            </Button>
          )}
        </div>
      </div>
      {!data.schoolDay && (
        <p className="text-body-sm text-muted-foreground">
          {data.day} isn&apos;t a school day.
        </p>
      )}
      {data.staff.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No staff yet</EmptyTitle>
            <EmptyDescription>
              Staff are members with a role, like Teacher.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 py-0" data-testid="staff-register">
          {data.staff.map((s) => {
            const d = draft[s.id]
            if (!d) return null
            return (
              <div
                key={s.id}
                data-testid="staff-row"
                className="grid gap-2 border-b border-hairline px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_7rem_minmax(0,12rem)] md:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{s.name}</div>
                  <div className="flex flex-wrap gap-1 text-caption text-muted-foreground">
                    {s.roles.join(", ")}
                    {s.onLeave && (
                      <Badge variant="secondary" data-testid="staff-on-leave">
                        {s.onLeave}
                      </Badge>
                    )}
                    {s.selfCheckIn && (
                      <Badge variant="outline">Checked in</Badge>
                    )}
                  </div>
                </div>
                <span
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label={`${s.name}'s attendance`}
                >
                  {STATUSES.map((st) => {
                    const on = d.status === st.value
                    return (
                      <Button
                        key={st.value}
                        size="xs"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        aria-label={`${s.name}: ${st.label}`}
                        title={st.label}
                        disabled={!data.canMark}
                        className={cn("min-w-9", !on && "text-body")}
                        onClick={() => set(s.id, { status: st.value })}
                      >
                        {st.short}
                      </Button>
                    )
                  })}
                </span>
                <TextInput
                  type="time"
                  aria-label={`${s.name} came in at`}
                  disabled={
                    !data.canMark ||
                    d.status === "absent" ||
                    d.status === "on_leave"
                  }
                  value={d.checkIn}
                  onChange={(e) => set(s.id, { checkIn: e.target.value })}
                />
                <TextInput
                  aria-label={`Note for ${s.name}`}
                  placeholder="Note"
                  maxLength={200}
                  disabled={!data.canMark}
                  value={d.note}
                  onChange={(e) => set(s.id, { note: e.target.value })}
                />
              </div>
            )
          })}
        </Card>
      )}
      {data.canMark && data.staff.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          {save.isSuccess && (
            <FormMessage message={{ text: "Saved.", kind: "ok" }} />
          )}
          <Button
            variant="outline"
            onClick={() =>
              setDraft(
                Object.fromEntries(
                  Object.entries(draft).map(([id, m]) => [
                    id,
                    {
                      ...m,
                      status:
                        m.status === "on_leave"
                          ? m.status
                          : ("present" as Status),
                    },
                  ])
                )
              )
            }
          >
            All present
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save register
          </Button>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          slug={slug}
          settings={data.settings}
          onDone={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function SettingsDialog({
  slug,
  settings,
  onDone,
}: {
  slug: string
  settings: { lateAfter: string; selfCheckIn: boolean }
  onDone: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState(settings)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/staff-attendance/settings`, {
        method: "PUT",
        body: form,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Late time and check-in</DialogTitle>
          <DialogDescription>
            Staff checking in after this time are marked late.
          </DialogDescription>
        </DialogHeader>
        <Field label="Late after">
          <TextInput
            type="time"
            value={form.lateAfter}
            onChange={(e) => setForm({ ...form, lateAfter: e.target.value })}
          />
        </Field>
        <Check
          label="Staff can check themselves in"
          checked={form.selfCheckIn}
          onCheckedChange={(v) => setForm({ ...form, selfCheckIn: v })}
        />
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Month = ApiResult<typeof staffMonth>

function MonthReport({ slug }: { slug: string }) {
  const [month, setMonth] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", slug, "staff-month", month],
    queryFn: () =>
      api<Month>(
        `/orgs/${slug}/staff-attendance/month${month ? `?month=${month}` : ""}`
      ),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-3">
      <div className="w-44">
        <Field label="Month">
          <TextInput
            type="month"
            value={month || data.month}
            max={data.today.slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>
      <Card className="overflow-x-auto py-0">
        <Table data-testid="staff-month">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-card">
                Staff
              </TableHead>
              {data.days.map((d) => (
                <TableHead
                  key={d.day}
                  className={cn(
                    "px-1 text-center tabular-nums",
                    !d.school && "text-muted-foreground/50"
                  )}
                >
                  {Number(d.day.slice(8))}
                </TableHead>
              ))}
              <TableHead className="text-right">P</TableHead>
              <TableHead className="text-right">L</TableHead>
              <TableHead className="text-right">H</TableHead>
              <TableHead className="text-right">A</TableHead>
              <TableHead className="text-right">Leave</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.staff.map((s) => (
              <TableRow key={s.id} data-testid="staff-month-row">
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  {s.name}
                </TableCell>
                {data.days.map((d) => {
                  const st = s.cells[d.day]
                  return (
                    <TableCell
                      key={d.day}
                      title={st ? LABEL[st] : undefined}
                      className={cn(
                        "px-1 text-center text-caption",
                        st ? TONE[st] : "",
                        !d.school && "bg-muted/40"
                      )}
                    >
                      {st ? SHORT[st] : ""}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right tabular-nums">
                  {s.present}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.late}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.half}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.absent}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.leave}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.percent == null ? "–" : s.percent}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-caption text-muted-foreground">
        P present · L late · H half day · A absent · OL on leave (left out of
        %). Shaded days are days off.
      </p>
    </div>
  )
}

type Mine = ApiResult<typeof myAttendance>

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })

const myKey = (slug: string) => ["org", slug, "staff-attendance", "me"]

function useMine(slug: string) {
  return useQuery({
    queryKey: myKey(slug),
    queryFn: () => api<Mine>(`/orgs/${slug}/staff-attendance/me`),
  })
}

/** Today's status and a Check in button (on the staff member's pages and home). */
export function CheckInCard({
  slug,
  className,
}: {
  slug: string
  className?: string
}) {
  const client = useQueryClient()
  const { data, error } = useMine(slug)
  const checkIn = useMutation({
    mutationFn: () =>
      api<{ time: string; status: Status }>(
        `/orgs/${slug}/staff-attendance/me/check-in`,
        { body: {} }
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: myKey(slug) }),
  })
  if (!data) return error ? null : <Card className={cn("h-20", className)} />
  return (
    <Card
      className={cn(
        "flex-row flex-wrap items-center justify-between gap-3 px-4",
        className
      )}
      data-testid="check-in"
    >
      <div>
        <div className="text-caption text-muted-foreground">
          Today, {fmtDay(data.today)}
        </div>
        <div className="text-title-md text-ink" data-testid="today-status">
          {data.todays
            ? `${LABEL[data.todays.status]}${data.todays.checkIn ? ` · in at ${data.todays.checkIn}` : ""}`
            : data.onLeave
              ? "On leave"
              : "Not checked in"}
        </div>
        {data.settings.selfCheckIn && !data.todays && !data.onLeave && (
          <div className="text-caption text-muted-foreground">
            Late after {data.settings.lateAfter}
          </div>
        )}
      </div>
      {data.canCheckIn && (
        <Button
          size="lg"
          onClick={() => checkIn.mutate()}
          disabled={checkIn.isPending}
        >
          Check in
        </Button>
      )}
      {checkIn.error && (
        <FormMessage message={{ text: checkIn.error.message, kind: "err" }} />
      )}
    </Card>
  )
}

/** A staff member's own attendance, with a check-in for today. */
export function MyAttendance({ slug }: { slug: string }) {
  const { data, error } = useMine(slug)
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle>My attendance</PageTitle>
      <CheckInCard slug={slug} className="mb-4" />
      <div
        className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-6"
        data-testid="my-summary"
      >
        {[
          ["Present", data.summary.present],
          ["Late", data.summary.late],
          ["Half day", data.summary.half],
          ["Absent", data.summary.absent],
          ["On leave", data.summary.leave],
          [
            "Attendance",
            data.summary.percent == null ? "–" : `${data.summary.percent}%`,
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-hairline bg-card p-3"
          >
            <div className="text-caption text-muted-foreground">{label}</div>
            <div className="text-title-md text-ink tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      {data.days.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Nothing marked this month yet.
        </p>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In at</TableHead>
                <TableHead className="hidden sm:table-cell">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.days.map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{fmtDay(d.day)}</TableCell>
                  <TableCell className={TONE[d.status]}>
                    {LABEL[d.status]}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {d.checkIn ?? "–"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {d.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}
