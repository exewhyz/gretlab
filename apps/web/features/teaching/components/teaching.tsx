"use client"

import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { api } from "@/lib/api/client"
import { formatDate, formatDateTime } from "@/lib/format"

interface Progress {
  total: number
  covered: number
  percent: number
  behind: string[]
  next: string | null
}

function ProgressBar({ progress }: { progress: Progress }) {
  if (progress.total === 0) {
    return <span className="text-xs text-body">No syllabus yet</span>
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-xs text-body tabular-nums">
        <div
          aria-hidden
          className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-strong"
        >
          <div
            className={cn(
              "h-full",
              progress.behind.length ? "bg-primary" : "bg-success"
            )}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {progress.covered} / {progress.total} topics
      </div>
      {progress.behind.length > 0 && (
        <span className="text-xs text-primary" data-testid="behind">
          Behind: {progress.behind.slice(0, 2).join(", ")}
          {progress.behind.length > 2 &&
            ` and ${progress.behind.length - 2} more`}
        </span>
      )}
    </div>
  )
}

/* ---------- teacher home ---------- */

interface Home {
  today: string
  orgs: {
    slug: string
    name: string
    type: string
    myClassesThisWeek: number
    can: {
      assignments: boolean
      contests: boolean
      grades: boolean
      reports: boolean
    }
    dueSoon: { id: string; slug: string; title: string; dueAt: string }[]
    groups: {
      id: string
      name: string
      parentId: string | null
      level: string | null
      path: string
      members: number
      progress: Progress
      classesThisWeek: number
      canLog: boolean
    }[]
  }[]
}

export function TeacherHome() {
  const { data, error } = useQuery({
    queryKey: ["teach"],
    queryFn: () => api<Home>("/teach"),
  })
  const { shows, orgs: mine } = useContentScope()
  if (!data) return <Loading error={error} />
  const orgs = data.orgs.filter((org) => shows(org.slug))
  const manages = (slug: string) =>
    mine.some((o) => o.slug === slug && o.canManage)
  const dueSoon = orgs.flatMap((org) => org.dueSoon.map((a) => ({ ...a, org })))
  const behind = orgs.flatMap((org) =>
    org.groups
      .filter((g) => g.progress.behind.length > 0)
      .map((g) => ({ ...g, org }))
  )

  return (
    <>
      <h1 className="mb-1 text-display-lg text-ink">My classes</h1>
      <p className="mb-5 text-body-sm text-body">
        Every class you teach, in every organization. Open one for its stream,
        classwork, people, grades and log.
      </p>
      <ScopeNote hidden={data.orgs.length - orgs.length} />
      {data.orgs.length === 0 && (
        <p className="text-body-sm text-body">
          You don&apos;t teach any groups yet. An organization gives you a
          teaching role from its Members page.
        </p>
      )}
      {(dueSoon.length > 0 || behind.length > 0) && (
        <section
          data-testid="today"
          className="mb-6 grid gap-3 min-[901px]:grid-cols-2"
        >
          <Card className="grid content-start gap-2">
            <h2 className="text-title-sm text-ink">Due this week</h2>
            {dueSoon.length === 0 && (
              <p className="text-caption text-body">Nothing due.</p>
            )}
            {dueSoon.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                href={`/orgs/${a.org.slug}/manage/assignments/${a.id}/grades`}
                className="flex items-baseline justify-between gap-3 text-body-sm hover:underline"
              >
                <span className="truncate text-ink">{a.title}</span>
                <span className="shrink-0 text-caption text-body">
                  {formatDateTime(a.dueAt)}
                </span>
              </Link>
            ))}
          </Card>
          <Card className="grid content-start gap-2">
            <h2 className="text-title-sm text-ink">Behind the syllabus</h2>
            {behind.length === 0 && (
              <p className="text-caption text-body">Every class is on plan.</p>
            )}
            {behind.slice(0, 6).map((g) => (
              <Link
                key={g.id}
                href={`/orgs/${g.org.slug}/classes/${g.id}?tab=classes`}
                className="flex items-baseline justify-between gap-3 text-body-sm hover:underline"
              >
                <span className="truncate text-ink">{g.path}</span>
                <span className="shrink-0 text-caption text-primary">
                  {g.progress.behind.length} behind
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}
      {orgs.map((org) => {
        const base = `/orgs/${org.slug}/manage`
        return (
          <section
            key={org.slug}
            data-testid="teach-org"
            className="mb-8 grid gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-title-md text-ink">{org.name}</h2>
                <p className="text-caption text-body">
                  {org.groups.length}{" "}
                  {org.groups.length === 1 ? "class" : "classes"} ·{" "}
                  {org.myClassesThisWeek}{" "}
                  {org.myClassesThisWeek === 1 ? "class" : "classes"} logged by
                  you this week
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {manages(org.slug) && (
                  <Link
                    href={base}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Manage organization
                  </Link>
                )}
                {org.can.assignments && (
                  <Link
                    href={`${base}/assignments`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    All assignments
                  </Link>
                )}
                {org.can.contests && (
                  <Link
                    href={`${base}/contests`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Contests
                  </Link>
                )}
                {org.can.reports && (
                  <Link
                    href={`${base}/reports`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Reports
                  </Link>
                )}
              </div>
            </div>
            {org.groups.length === 0 ? (
              <p className="text-body-sm text-body">
                No classes assigned to you here.
              </p>
            ) : (
              <ClassTree slug={org.slug} groups={org.groups} />
            )}
          </section>
        )
      })}
    </>
  )
}

/** A teacher's classes in one organization, as the group tree: folded, searchable. */
function ClassTree({
  slug,
  groups,
}: {
  slug: string
  groups: Home["orgs"][number]["groups"]
}) {
  const ids = new Set(groups.map((g) => g.id))
  const roots = groups.filter((g) => !g.parentId || !ids.has(g.parentId))
  const childrenOf = (id: string) => groups.filter((g) => g.parentId === id)
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        groups.length <= 15 ? groups.map((g) => g.id) : roots.map((g) => g.id)
      )
  )
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const matches = q
    ? groups.filter((g) => g.path.toLowerCase().includes(q))
    : []

  const row = (g: (typeof groups)[number], depth: number): ReactNode => {
    const kids = childrenOf(g.id)
    const expanded = open.has(g.id)
    return (
      <div key={g.id}>
        <div
          data-testid="class-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-2 py-2 last:border-0 hover:bg-muted/50"
          style={{ paddingInlineStart: 8 + depth * 22 }}
        >
          {kids.length > 0 && !q ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${g.name}`}
              onClick={() =>
                setOpen((cur) => {
                  const next = new Set(cur)
                  if (expanded) next.delete(g.id)
                  else next.add(g.id)
                  return next
                })
              }
            >
              {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
            </Button>
          ) : (
            <span aria-hidden className="w-6" />
          )}
          <Link
            href={`/orgs/${slug}/classes/${g.id}`}
            className="min-w-32 text-body-sm text-ink hover:underline"
          >
            {q ? g.path : g.name}
          </Link>
          {g.level && (
            <span className="rounded-full bg-muted px-1.5 py-px text-xs text-body">
              {g.level}
            </span>
          )}
          <span className="text-xs text-body">
            {g.members} {g.members === 1 ? "student" : "students"}
          </span>
          <span className="flex-1" />
          <ProgressBar progress={g.progress} />
          <span className="w-28 text-end text-xs text-body">
            {g.classesThisWeek} {g.classesThisWeek === 1 ? "class" : "classes"}{" "}
            this week
          </span>
        </div>
        {!q && expanded && kids.map((k) => row(k, depth + 1))}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {groups.length > 8 && (
        <TextInput
          aria-label={`Find a class`}
          placeholder={`Search ${groups.length} classes`}
          className="max-w-72"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <Card className="p-0">
        {q ? matches.map((g) => row(g, 0)) : roots.map((g) => row(g, 0))}
        {q && matches.length === 0 && (
          <p className="p-3 text-body-sm text-body">No class matches.</p>
        )}
      </Card>
    </div>
  )
}

/* ---------- one group: syllabus and classes ---------- */

interface GroupTeaching {
  group: string
  canEdit: boolean
  today: string
  topics: { id: string; title: string; plannedFor: string | null }[]
  progress: Progress
  sessions: {
    id: string
    day: string
    minutes: number
    topics: string[]
    note: string
    teacher: string
    mine: boolean
    rating: { average: number; count: number; comments: string[] } | null
  }[]
}

const newId = () => Math.random().toString(36).slice(2, 10)

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

function SyllabusEditor({
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

function LogClass({
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
      api<{ students: { id: string; name: string; email: string }[] }>(
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

function SessionTable({
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

/* ---------- organization reports ---------- */

interface Report {
  org: string
  levels: string[]
  groups: { id: string; name: string; parentId: string | null; path: string }[]
  summary: {
    students: number
    activeThisWeek: number
    sharing: number
    averageAssignment: number | null
  }
  assignments: {
    title: string
    dueAt: string
    students: number
    started: number
    averagePercent: number
  }[]
  teaching: {
    groups: { path: string; progress: Progress; classes: number }[]
    teachers: {
      name: string
      classes: number
      minutes: number
      rating: number | null
      ratings: number
    }[]
  }
  students: {
    name: string | null
    email: string
    groups: string[]
    lastActive: string | null
    activeThisWeek: boolean
    assignmentPercent: number | null
    practiceSolved: number | null
  }[]
}

/** With `fixedGroup`, one class's insights: no title or group picker. */
export function OrgReports({
  slug,
  fixedGroup,
}: {
  slug: string
  fixedGroup?: string
}) {
  const [chosen, setGroup] = useState("")
  const group = fixedGroup ?? chosen
  const { data, error, isFetching } = useQuery({
    queryKey: ["org", slug, "reports", group],
    queryFn: () => api<Report>(`/orgs/${slug}/reports?group=${group}`),
  })
  if (!data) return <Loading error={error} />
  const inactive = data.summary.students - data.summary.activeThisWeek
  const cards = [
    ["Students", data.summary.students],
    ["Active this week", data.summary.activeThisWeek],
    [
      "Assignment average",
      data.summary.averageAssignment === null
        ? "—"
        : `${data.summary.averageAssignment}%`,
    ],
    ["Sharing practice", `${data.summary.sharing} of ${data.summary.students}`],
  ] as const

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
      <div className="mb-4 grid grid-cols-2 gap-3 min-[901px]:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <div className="text-display-sm text-ink tabular-nums">{value}</div>
            <div className="text-caption">{label}</div>
          </Card>
        ))}
      </div>
      {inactive > 0 && data.summary.students > 0 && (
        <p
          role="status"
          data-testid="inactive-warning"
          className="mb-4 rounded-md border border-hairline-strong bg-canvas-soft p-3 text-body-sm text-ink"
        >
          {inactive} of {data.summary.students} students (
          {Math.round((100 * inactive) / data.summary.students)}%) did no work
          for this organization this week. They&apos;re at the top of the table
          below.
        </p>
      )}
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
                  <td className="tabular-nums">{a.averagePercent}%</td>
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

      <h2 className="mb-2 text-title-sm text-ink">Students</h2>
      <Table
        headers={[
          "Student",
          "Groups",
          "Last active",
          "Assignments",
          "Practice solved",
        ]}
      >
        {data.students.map((s) => (
          <tr key={s.email} data-testid="report-student">
            <td>
              <div className="text-ink">{s.name ?? s.email}</div>
              <div className="text-xs">{s.email}</div>
            </td>
            <td className="text-xs">{s.groups.join(", ") || "—"}</td>
            <td className={cn(!s.activeThisWeek && "text-primary")}>
              {s.lastActive ? formatDate(s.lastActive) : "Not in 30 days"}
            </td>
            <td className="tabular-nums">
              {s.assignmentPercent === null ? "—" : `${s.assignmentPercent}%`}
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
    </>
  )
}
