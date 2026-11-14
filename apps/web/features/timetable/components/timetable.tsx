"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { WEEKDAYS } from "@workspace/judge"
import { useEffect, useState } from "react"

import { ScrollX } from "@workspace/ui/components/scroll-x"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type {
  classTimetable,
  timetableSetup,
} from "@/features/timetable/server"
import type { myTeachingWeek } from "@/features/timetable/server"

interface Period {
  id: string
  name: string
  starts: string
  ends: string
  isBreak: boolean
}

interface Cell {
  day: number
  periodId: string
  subject: string
  code: string
  teacher?: string | null
  group?: string
  room: string
  classSubjectId?: string
}

/** "HH:MM" plus some minutes, kept within the day. */
const later = (time: string, minutes: number) => {
  const [h = 0, m = 0] = time.split(":").map(Number)
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

const dayName = (d: number) =>
  WEEKDAYS.find((w) => w.day === d)?.short ?? String(d)

/** A week: periods down, days across. Cells show a subject, or a picker when editing. */
/** Narrower than a small tablet: the week grid becomes one day at a time. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)")
    const apply = () => setNarrow(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])
  return narrow
}

/** One day's periods, with the week's days to switch between: a timetable on a phone. */
function DayList({
  days,
  periods,
  cells,
  show,
}: {
  days: number[]
  periods: Period[]
  cells: Cell[]
  show: (cell: Cell) => string | null | undefined
}) {
  const today = ((new Date().getDay() + 6) % 7) + 1
  const [day, setDay] = useState(days.includes(today) ? today : days[0]!)
  return (
    <div className="grid gap-2" data-testid="day-list">
      <div role="group" aria-label="Day" className="flex gap-1 overflow-x-auto">
        {days.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === day ? "default" : "outline"}
            aria-pressed={d === day}
            onClick={() => setDay(d)}
          >
            {dayName(d)}
          </Button>
        ))}
      </div>
      <ol className="grid rounded-lg border border-hairline bg-card">
        {periods.map((p) => {
          const cell = cells.find((c) => c.day === day && c.periodId === p.id)
          return (
            <li
              key={p.id}
              className={cn(
                "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-hairline px-3 py-2.5 text-body-sm last:border-0",
                p.isBreak && "bg-muted/40 text-body"
              )}
            >
              <span className="text-xs text-body tabular-nums">
                {p.starts}–{p.ends}
              </span>
              <span className="min-w-0">
                {p.isBreak ? (
                  "Break"
                ) : cell ? (
                  <>
                    <span className="block font-medium text-ink">
                      {cell.subject}
                    </span>
                    {show(cell) && (
                      <span className="block text-xs text-body">
                        {show(cell)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-caption">Free</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function WeekGrid({
  days,
  periods,
  cells,
  show,
  edit,
}: {
  days: number[]
  periods: Period[]
  cells: Cell[]
  /** What a filled cell's second line says (its teacher, or its class). */
  show: (cell: Cell) => string | null | undefined
  edit?: {
    subjects: { id: string; name: string; teacher: string | null }[]
    onSet: (
      day: number,
      periodId: string,
      classSubjectId: string | null
    ) => void
    pending: boolean
  }
}) {
  const narrow = useNarrow()
  if (periods.length === 0)
    return <p className="text-body-sm text-body">No periods are set up yet.</p>
  if (narrow && !edit && days.length > 0)
    return <DayList days={days} periods={periods} cells={cells} show={show} />
  return (
    <ScrollX
      pinFirst
      className="overflow-hidden rounded-lg border border-hairline bg-card"
      data-testid="week-grid"
    >
      <table className="w-full min-w-[640px] text-left text-body-sm text-ink">
        <thead>
          <tr className="border-b border-hairline text-caption-upper text-body uppercase">
            <th className="px-3 py-2.5">Period</th>
            {days.map((d) => (
              <th key={d} className="px-3 py-2.5">
                {dayName(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr
              key={p.id}
              className={cn(
                "border-b border-hairline last:border-0",
                p.isBreak && "bg-muted/40"
              )}
            >
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-body">
                  {p.starts}–{p.ends}
                </div>
              </td>
              {p.isBreak ? (
                <td
                  colSpan={days.length}
                  className="px-3 py-2 text-center text-caption"
                >
                  Break
                </td>
              ) : (
                days.map((d) => {
                  const cell = cells.find(
                    (c) => c.day === d && c.periodId === p.id
                  )
                  return (
                    <td
                      key={d}
                      className="px-2 py-2 align-top"
                      data-testid={`cell-${d}-${p.name}`}
                    >
                      {edit ? (
                        <SelectInput
                          aria-label={`${dayName(d)} ${p.name}`}
                          value={cell?.classSubjectId ?? ""}
                          disabled={edit.pending}
                          onChange={(e) =>
                            edit.onSet(d, p.id, e.target.value || null)
                          }
                        >
                          <option value="">—</option>
                          {edit.subjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </SelectInput>
                      ) : cell ? (
                        <div>
                          <div className="font-medium">
                            {cell.code || cell.subject}
                          </div>
                          {show(cell) && (
                            <div className="text-xs text-body">
                              {show(cell)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-caption">—</span>
                      )}
                      {edit && cell && (
                        <div className="mt-1 truncate text-xs text-body">
                          {cell.teacher ?? "no teacher"}
                        </div>
                      )}
                    </td>
                  )
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  )
}

type Setup = ApiResult<typeof timetableSetup>

type ClassWeek = ApiResult<typeof classTimetable>

/** Manage › Timetable: set periods and days, then fill in each class's week. */
export function ManageTimetable({ slug }: { slug: string }) {
  const client = useQueryClient()
  const setup = useQuery({
    queryKey: ["org", slug, "timetable"],
    queryFn: () => api<Setup>(`/orgs/${slug}/timetable`),
  })
  const [groupId, setGroupId] = useState("")
  const [editingPeriods, setEditingPeriods] = useState(false)
  if (!setup.data) return <Loading error={setup.error} />
  const data = setup.data
  return (
    <>
      <PageTitle
        action={
          data.can.periods && (
            <Button variant="outline" onClick={() => setEditingPeriods(true)}>
              Periods and days
            </Button>
          )
        }
      >
        Timetable
      </PageTitle>
      {data.periods.length === 0 ? (
        <p className="text-body-sm text-body">
          {data.can.periods
            ? "Start by setting the day's periods and the school days."
            : "Periods haven't been set up yet."}
        </p>
      ) : data.can.edit ? (
        <>
          <div className="mb-4 max-w-md">
            <Field label="Class">
              <GroupPicker
                label="Class"
                groups={data.groups}
                levels={data.levels}
                value={groupId}
                onChange={setGroupId}
                placeholder="Choose a class"
                isDisabled={(id) => !data.choosable.includes(id)}
              />
            </Field>
          </div>
          {groupId ? (
            <ClassEditor key={groupId} slug={slug} groupId={groupId} />
          ) : (
            <p className="text-body-sm text-body">
              Choose a class to fill in its week.
            </p>
          )}
        </>
      ) : null}
      {editingPeriods && (
        <PeriodsDialog
          slug={slug}
          setup={data}
          onDone={() => {
            setEditingPeriods(false)
            void client.invalidateQueries({
              queryKey: ["org", slug, "timetable"],
            })
            void client.invalidateQueries({
              queryKey: ["org", slug, "class-timetable"],
            })
          }}
        />
      )}
    </>
  )
}

function ClassEditor({ slug, groupId }: { slug: string; groupId: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "class-timetable", groupId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<ClassWeek>(`/orgs/${slug}/classes/${groupId}/timetable`),
  })
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const set = useMutation({
    mutationFn: (v: {
      day: number
      periodId: string
      classSubjectId: string | null
    }) =>
      api(`/orgs/${slug}/timetable/slots`, {
        method: "PUT",
        body: { groupId, ...v },
      }),
    onSuccess: () => {
      setMessage(null)
      void client.invalidateQueries({ queryKey: key })
    },
    onError: (e: Error) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!data) return <Loading error={error} />
  if (data.subjects.length === 0) {
    return (
      <p className="text-body-sm text-body">
        {data.group} has no subjects yet. Add them under Subjects first.
      </p>
    )
  }
  return (
    <div className="grid gap-2">
      <FormMessage message={message} />
      <WeekGrid
        days={data.days}
        periods={data.periods}
        cells={data.slots}
        show={(c) => c.teacher}
        edit={{
          subjects: data.subjects,
          pending: set.isPending,
          onSet: (day, periodId, classSubjectId) =>
            set.mutate({ day, periodId, classSubjectId }),
        }}
      />
    </div>
  )
}

function PeriodsDialog({
  slug,
  setup,
  onDone,
}: {
  slug: string
  setup: Setup
  onDone: () => void
}) {
  const [days, setDays] = useState<number[]>(setup.days)
  const [periods, setPeriods] = useState<
    (Omit<Period, "id"> & { id?: string })[]
  >(
    setup.periods.length
      ? setup.periods
      : [{ name: "Period 1", starts: "09:00", ends: "09:45", isBreak: false }]
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/timetable/periods`, {
        method: "PUT",
        body: { days, periods },
      }),
    onSuccess: onDone,
  })
  const change = (i: number, patch: Partial<Period>) =>
    setPeriods(periods.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Periods and days</DialogTitle>
          <DialogDescription>
            The same periods apply to every class. Removing a period clears it
            from every timetable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset>
            <legend className="mb-2 text-body-sm font-medium text-ink">
              School days
            </legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((w) => (
                <label
                  key={w.day}
                  className="flex items-center gap-1.5 text-body-sm"
                >
                  <Checkbox
                    checked={days.includes(w.day)}
                    onCheckedChange={(on) =>
                      setDays(
                        on ? [...days, w.day] : days.filter((d) => d !== w.day)
                      )
                    }
                  />
                  {w.short}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2" data-testid="periods">
            {periods.map((p, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2"
              >
                <TextInput
                  aria-label={`Period ${i + 1} name`}
                  value={p.name}
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <TextInput
                  aria-label={`${p.name} starts`}
                  type="time"
                  value={p.starts}
                  onChange={(e) => change(i, { starts: e.target.value })}
                />
                <TextInput
                  aria-label={`${p.name} ends`}
                  type="time"
                  value={p.ends}
                  onChange={(e) => change(i, { ends: e.target.value })}
                />
                <label className="flex items-center gap-1 text-caption">
                  <Checkbox
                    checked={p.isBreak}
                    onCheckedChange={(on) => change(i, { isBreak: on })}
                  />
                  Break
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  className="rounded p-1 text-body hover:bg-muted"
                  onClick={() => setPeriods(periods.filter((_, j) => j !== i))}
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                const last = periods.at(-1)
                setPeriods([
                  ...periods,
                  {
                    name: `Period ${periods.filter((p) => !p.isBreak).length + 1}`,
                    starts: last?.ends ?? "09:00",
                    ends: later(last?.ends ?? "09:00", 45),
                    isBreak: false,
                  },
                ])
              }}
            >
              <PlusIcon /> Add period
            </Button>
          </div>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A class's week, read only (the class page's Timetable tab). */
export function ClassTimetable({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class-timetable", groupId],
    queryFn: () => api<ClassWeek>(`/orgs/${slug}/classes/${groupId}/timetable`),
  })
  if (!data) return <Loading error={error} />
  return (
    <WeekGrid
      days={data.days}
      periods={data.periods}
      cells={data.slots}
      show={(c) => c.teacher}
    />
  )
}

/** Manage › My timetable: where I teach each period. */
export function MyTimetable({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "timetable", "mine"],
    queryFn: () =>
      api<ApiResult<typeof myTeachingWeek>>(`/orgs/${slug}/timetable/mine`),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle>My timetable</PageTitle>
      {data.slots.length === 0 && data.periods.length > 0 && (
        <p className="mb-3 text-body-sm text-body">
          You aren't in any class's timetable yet.
        </p>
      )}
      <WeekGrid
        days={data.days}
        periods={data.periods}
        cells={data.slots}
        show={(c) => c.group}
      />
    </>
  )
}
