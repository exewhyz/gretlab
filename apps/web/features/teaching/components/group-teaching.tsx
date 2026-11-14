"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import type { classAttendance } from "@/features/classes/server"
import type { getGroupTeaching } from "@/features/teaching/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { ProgressBar } from "./teaching-parts"

export type GroupTeaching = ApiResult<typeof getGroupTeaching>

export const newId = () => Math.random().toString(36).slice(2, 10)

export function GroupTeachingView({
  slug,
  groupId,
  embedded = false,
}: {
  slug: string
  groupId: string
  /** Inside a class page, which already names the group. */
  embedded?: boolean
}) {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "teaching", groupId],
    queryFn: () => api<GroupTeaching>(`/orgs/${slug}/teaching/${groupId}`),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ["org", slug, "teaching", groupId],
    })
    void queryClient.invalidateQueries({ queryKey: ["teach"] })
    // The class page's stream and attendance show logged classes too.
    void queryClient.invalidateQueries({
      queryKey: ["org", slug, "class", groupId],
    })
  }
  if (!data) return <Loading error={error} />

  return (
    <>
      {!embedded && <PageTitle>{data.group}</PageTitle>}
      <div className="mb-4">
        <ProgressBar progress={data.progress} />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <SyllabusEditor
          key={JSON.stringify(data.topics)}
          slug={slug}
          groupId={groupId}
          topics={data.topics}
          canEdit={data.canEdit}
          onSaved={refresh}
        />
        {data.canEdit && (
          <LogClass
            slug={slug}
            groupId={groupId}
            today={data.today}
            topics={data.topics}
            onSaved={refresh}
          />
        )}
      </div>
      <h2 className="mt-6 mb-2 text-title-sm text-ink">Classes</h2>
      <SessionTable slug={slug} sessions={data.sessions} onChange={refresh} />
    </>
  )
}

export function SyllabusEditor({
  slug,
  groupId,
  topics: initial,
  canEdit,
  onSaved,
}: {
  slug: string
  groupId: string
  topics: GroupTeaching["topics"]
  canEdit: boolean
  onSaved: () => void
}) {
  const [topics, setTopics] = useState(initial)
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/teaching/${groupId}`, {
        method: "PUT",
        body: { topics: topics.filter((t) => t.title.trim()) },
      }),
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      onSaved()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const update = (
    i: number,
    change: Partial<GroupTeaching["topics"][number]>
  ) => {
    setTopics(topics.map((t, j) => (j === i ? { ...t, ...change } : t)))
    setMessage(null)
  }
  return (
    <Card className="grid content-start gap-3">
      <h2 className="text-title-sm text-ink">Syllabus</h2>
      {topics.length === 0 && (
        <p className="text-caption text-body">
          No topics yet.{canEdit && " Add them in the order you'll teach them."}
        </p>
      )}
      <ol className="grid gap-1.5">
        {topics.map((t, i) => (
          <li
            key={t.id}
            data-testid="topic"
            className="flex items-center gap-2"
          >
            <span className="w-6 text-right text-xs text-body tabular-nums">
              {i + 1}.
            </span>
            {canEdit ? (
              <>
                <TextInput
                  aria-label={`Topic ${i + 1}`}
                  className="py-1"
                  value={t.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
                <TextInput
                  type="date"
                  aria-label={`Topic ${i + 1} planned for`}
                  className="w-40 py-1"
                  value={t.plannedFor ?? ""}
                  onChange={(e) =>
                    update(i, { plannedFor: e.target.value || null })
                  }
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove topic ${i + 1}`}
                  onClick={() => setTopics(topics.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </>
            ) : (
              <span className="text-body-sm text-ink">
                {t.title}
                {t.plannedFor && (
                  <span className="ml-2 text-xs text-body">
                    by {formatDate(t.plannedFor)}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setTopics([
                ...topics,
                { id: newId(), title: "", plannedFor: null },
              ])
            }
          >
            Add topic
          </Button>
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Save syllabus
          </Button>
          <FormMessage message={message} />
        </div>
      )}
    </Card>
  )
}

export function LogClass({
  slug,
  groupId,
  today,
  topics,
  onSaved,
}: {
  slug: string
  groupId: string
  today: string
  topics: GroupTeaching["topics"]
  onSaved: () => void
}) {
  const [day, setDay] = useState(today)
  const [minutes, setMinutes] = useState("60")
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  // Attendance: everyone starts present; untick who wasn't there.
  const roster = useQuery({
    queryKey: ["org", slug, "class", groupId, "attendance"],
    queryFn: () =>
      api<ApiResult<typeof classAttendance>>(
        `/orgs/${slug}/classes/${groupId}/attendance`
      ),
  })
  const students = roster.data?.students ?? []
  const [takeAttendance, setTakeAttendance] = useState(true)
  const [absent, setAbsent] = useState<string[]>([])
  const [who, setWho] = useState("")
  const log = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/sessions`, {
        body: {
          groupId,
          day,
          minutes: Number(minutes),
          topicIds: picked,
          note,
          attendance: takeAttendance
            ? students.map((s) => ({
                userId: s.id,
                present: !absent.includes(s.id),
              }))
            : [],
        },
      }),
    onSuccess: () => {
      setPicked([])
      setNote("")
      setAbsent([])
      setMessage({ text: "Logged.", kind: "ok" })
      onSaved()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  return (
    <Card className="grid content-start gap-3">
      <h2 className="text-title-sm text-ink">Log a class</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day">
          <TextInput
            type="date"
            max={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field label="Minutes">
          <SelectInput
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          >
            {[30, 45, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {topics.length > 0 && (
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-caption font-semibold text-ink">
            Topics covered
          </legend>
          {topics.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 text-body-sm text-ink"
            >
              <Checkbox
                checked={picked.includes(t.id)}
                onCheckedChange={(checked) =>
                  setPicked(
                    checked
                      ? [...picked, t.id]
                      : picked.filter((x) => x !== t.id)
                  )
                }
              />
              {t.title}
            </label>
          ))}
        </fieldset>
      )}
      {students.length > 0 && (
        <fieldset className="grid gap-1.5" data-testid="attendance-picker">
          <legend className="mb-1 flex w-full flex-wrap items-center gap-2 text-caption font-semibold text-ink">
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Take attendance"
                checked={takeAttendance}
                onCheckedChange={(on) => setTakeAttendance(on === true)}
              />
              Take attendance
            </label>
            {takeAttendance && (
              <span className="font-normal text-body">
                {students.length - absent.length} of {students.length} present
              </span>
            )}
          </legend>
          {takeAttendance && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {students.length > 8 && (
                  <TextInput
                    aria-label="Find a student"
                    placeholder="Find a student"
                    className="h-7 max-w-48 text-xs"
                    value={who}
                    onChange={(e) => setWho(e.target.value)}
                  />
                )}
                <Button size="xs" variant="ghost" onClick={() => setAbsent([])}>
                  All present
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setAbsent(students.map((s) => s.id))}
                >
                  All absent
                </Button>
              </div>
              <div className="grid max-h-56 gap-0.5 overflow-auto rounded-sm border border-hairline p-1.5 sm:grid-cols-2">
                {students
                  .filter(
                    (s) =>
                      !who.trim() ||
                      `${s.name} ${s.email}`
                        .toLowerCase()
                        .includes(who.trim().toLowerCase())
                  )
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex min-w-0 items-center gap-2 text-body-sm text-ink"
                    >
                      <Checkbox
                        aria-label={`${s.email} was there`}
                        checked={!absent.includes(s.id)}
                        onCheckedChange={(on) =>
                          setAbsent((cur) =>
                            on === true
                              ? cur.filter((x) => x !== s.id)
                              : [...cur, s.id]
                          )
                        }
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
              </div>
            </>
          )}
        </fieldset>
      )}
      <Field label="Note">
        <TextInput
          value={note}
          placeholder="Optional"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button disabled={log.isPending} onClick={() => log.mutate()}>
          Log class
        </Button>
        <FormMessage message={message} />
      </div>
    </Card>
  )
}

export function SessionTable({
  slug,
  sessions,
  onChange,
}: {
  slug: string
  sessions: GroupTeaching["sessions"]
  onChange: () => void
}) {
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/sessions/${id}`, { method: "DELETE" }),
    onSuccess: onChange,
  })
  if (sessions.length === 0) {
    return <p className="text-body-sm text-body">No classes logged yet.</p>
  }
  return (
    <Table
      headers={["Day", "Teacher", "Minutes", "Topics", "Note", "Rating", ""]}
    >
      {sessions.map((s) => (
        <tr key={s.id} data-testid="session-row">
          <td className="whitespace-nowrap">{formatDate(s.day)}</td>
          <td>{s.teacher}</td>
          <td className="tabular-nums">{s.minutes}</td>
          <td>{s.topics.join(", ") || "—"}</td>
          <td>{s.note}</td>
          <td
            className="tabular-nums"
            title={
              s.rating?.comments.length
                ? s.rating.comments.join("\n")
                : undefined
            }
          >
            {s.rating ? `★ ${s.rating.average} (${s.rating.count})` : "—"}
          </td>
          <td className="text-right">
            {s.mine && (
              <ConfirmButton
                size="xs"
                variant="ghost"
                title="Remove this class from the log?"
                description="Its topics no longer count towards the syllabus, and any ratings on it go too."
                confirmLabel="Remove class"
                onConfirm={() => remove.mutate(s.id)}
              >
                Remove
              </ConfirmButton>
            )}
          </td>
        </tr>
      ))}
    </Table>
  )
}
