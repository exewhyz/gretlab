"use client"

import {
  CalendarCheckIcon,
  ChalkboardTeacherIcon,
  ClipboardTextIcon,
  MegaphoneIcon,
  TrophyIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { NeedsAttention } from "@/features/classes/components/needs-attention"
import { Discussion } from "@/features/discussions/components/discussion"
import { ClassCourses } from "@/features/courses/components/class-courses"
import { ClassOutcomes } from "@/features/outcomes/components/class-outcomes"
import { ClassTimetable } from "@/features/timetable/components/timetable"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage } from "@/components/form"
import { Card, Loading } from "@/features/admin/components/shell"
import { GroupPeople } from "@/features/orgs/components/groups"
import {
  useGroups,
  type Message,
} from "@/features/orgs/components/manage-shared"
import {
  GroupTeachingView,
  OrgReports,
} from "@/features/teaching/components/teaching"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { orgPages } from "@/lib/paths"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */

interface Reach {
  kind: "class" | "above" | "narrow" | "org"
  label: string
}

interface Overview {
  org: { slug: string; name: string }
  group: {
    id: string
    name: string
    level: string | null
    path: { id: string; name: string }[]
  }
  children: { id: string; name: string; members: number }[]
  students: number
  teachers: { name: string; roles: string[] }[]
  viewer: { teaches: boolean; sits: boolean }
  modules: string[]
  can: {
    assignments: boolean
    contests: boolean
    notices: boolean
    grades: boolean
    people: boolean
    log: boolean
    reports: boolean
  }
}

interface Work {
  topics: { id: string; title: string; plannedFor: string | null }[]
  assignments: {
    id: string
    slug: string
    title: string
    dueAt: string
    phase: "upcoming" | "open" | "late" | "closed"
    published: boolean
    problemCount: number
    solved: number
    earned: number
    total: number
    reach: Reach
    canManage: boolean
  }[]
  contests: {
    id: string
    slug: string
    title: string
    phase: string
    published: boolean
    startsAt: string
    endsAt: string
    reach: Reach
    canManage: boolean
  }[]
}

type StreamItem =
  | {
      kind: "notice"
      id: string
      at: string
      text: string
      by: string | null
      reach: Reach
      canDelete: boolean
    }
  | {
      kind: "class"
      id: string
      at: string
      day: string
      minutes: number
      group: string | null
      topics: string[]
      note: string
      by: string | null
    }
  | {
      kind: "assignment"
      id: string
      at: string
      slug: string
      title: string
      dueAt: string
      reach: Reach
    }
  | {
      kind: "contest"
      id: string
      at: string
      slug: string
      title: string
      startsAt: string
      reach: Reach
    }

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
                  href={orgPages(slug).manage(`/assignments/new?for=${groupId}`)}
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
          <Discussion slug={slug} groupId={groupId} initialThread={thread ?? null} />
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

/* ---------- stream ---------- */

function ReachChip({ reach }: { reach: Reach }) {
  if (reach.kind === "class") return null
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
      {reach.label}
    </span>
  )
}

function StreamCard({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <li
      data-testid="stream-item"
      className="flex gap-3 rounded-lg border border-hairline bg-card p-3.5"
    >
      <span className="mt-0.5 shrink-0 text-body">{icon}</span>
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
    </li>
  )
}

function Stream({
  slug,
  groupId,
  canPost,
}: {
  slug: string
  groupId: string
  canPost: boolean
}) {
  const queryClient = useQueryClient()
  const key = ["org", slug, "class", groupId, "stream"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<StreamItem[]>(`/orgs/${slug}/classes/${groupId}/stream`),
  })
  const [text, setText] = useState("")
  const [message, setMessage] = useState<Message>(null)
  const act = useMutation({
    mutationFn: (call: () => Promise<unknown>) => call(),
    onSuccess: () => {
      setText("")
      setMessage(null)
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ["org", slug, "feed"] })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })

  return (
    <div className="grid gap-3">
      {canPost && (
        <Card className="grid gap-2">
          <Textarea
            aria-label="Notice for this class"
            placeholder="Tell the class something: a room change, a reminder, a link."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <FormMessage message={message} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-body">
              Everyone in this class sees it, including groups inside it.
            </span>
            <Button
              size="sm"
              disabled={!text.trim() || act.isPending}
              onClick={() =>
                act.mutate(() =>
                  api(`/orgs/${slug}/classes/${groupId}/stream`, {
                    body: { text },
                  })
                )
              }
            >
              Post
            </Button>
          </div>
        </Card>
      )}
      {!data && <Loading error={error} />}
      {data?.length === 0 && (
        <p className="text-body-sm text-body">
          Nothing here yet. Notices, logged classes and new work for this class
          show up here.
        </p>
      )}
      <ul className="grid gap-2">
        {data?.map((item) => {
          if (item.kind === "notice") {
            return (
              <StreamCard
                key={`n${item.id}`}
                icon={<MegaphoneIcon className="size-4" />}
              >
                <div className="flex flex-wrap items-center gap-2 text-caption text-body">
                  <span className="text-ink">{item.by ?? "Notice"}</span>
                  <span>{formatDateTime(item.at)}</span>
                  <ReachChip reach={item.reach} />
                  {item.canDelete && (
                    <ConfirmButton
                      size="xs"
                      variant="ghost"
                      className="ms-auto"
                      title="Remove this notice?"
                      description="Nobody will see it any more."
                      confirmLabel="Remove"
                      onConfirm={() =>
                        act.mutate(() =>
                          api(`/orgs/${slug}/notes/${item.id}`, {
                            method: "DELETE",
                          })
                        )
                      }
                    >
                      Remove
                    </ConfirmButton>
                  )}
                </div>
                <p className="text-body-sm whitespace-pre-wrap text-ink">
                  {item.text}
                </p>
              </StreamCard>
            )
          }
          if (item.kind === "class") {
            return (
              <StreamCard
                key={`c${item.id}`}
                icon={<ChalkboardTeacherIcon className="size-4" />}
              >
                <div className="text-body-sm text-ink">
                  Class on {item.day} · {item.minutes} min
                  {item.group && (
                    <span className="text-body"> · {item.group}</span>
                  )}
                </div>
                <div className="text-caption text-body">
                  {item.topics.length > 0
                    ? `Covered ${item.topics.join(", ")}`
                    : "No syllabus topics marked"}
                  {item.by && ` · ${item.by}`}
                </div>
                {item.note && (
                  <p className="text-caption text-ink">{item.note}</p>
                )}
              </StreamCard>
            )
          }
          if (item.kind === "assignment") {
            return (
              <StreamCard
                key={`a${item.id}`}
                icon={<ClipboardTextIcon className="size-4" />}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/assignments/${item.slug}`}
                    className="text-body-sm text-ink hover:underline"
                  >
                    New assignment: {item.title}
                  </Link>
                  <ReachChip reach={item.reach} />
                </div>
                <div className="text-caption text-body">
                  Due {formatDateTime(item.dueAt)}
                </div>
              </StreamCard>
            )
          }
          return (
            <StreamCard
              key={`k${item.id}`}
              icon={<TrophyIcon className="size-4" />}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/contests/${item.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  Contest: {item.title}
                </Link>
                <ReachChip reach={item.reach} />
              </div>
              <div className="text-caption text-body">
                Starts {formatDateTime(item.startsAt)}
              </div>
            </StreamCard>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------- classwork ---------- */

function useClasswork(slug: string, groupId: string) {
  return useQuery({
    queryKey: ["org", slug, "class", groupId, "classwork"],
    queryFn: () => api<Work>(`/orgs/${slug}/classes/${groupId}/classwork`),
  })
}

const PHASE_LABEL: Record<string, string> = {
  upcoming: "Opens soon",
  open: "Open",
  late: "Late work allowed",
  closed: "Closed",
  live: "Live now",
  ended: "Ended",
  frozen: "Live (board frozen)",
}

function Classwork({
  slug,
  groupId,
  teacher,
  can,
}: {
  slug: string
  groupId: string
  teacher: boolean
  can: Overview["can"]
}) {
  const { data, error } = useClasswork(slug, groupId)
  if (!data) return <Loading error={error} />
  const manage = `/orgs/${slug}/manage`
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">Assignments</h2>
          {teacher && can.assignments && (
            <Link
              href={`${manage}/assignments/new?for=${groupId}`}
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              New assignment
            </Link>
          )}
        </div>
        {data.assignments.length === 0 && (
          <p className="text-body-sm text-body">
            No assignments for this class yet.
          </p>
        )}
        {data.assignments.map((a) => (
          <div
            key={a.id}
            data-testid="class-assignment"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-card p-3.5"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/assignments/${a.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  {a.title}
                </Link>
                {!a.published && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Draft
                  </span>
                )}
                <ReachChip reach={a.reach} />
              </div>
              <div className="text-caption text-body">
                {PHASE_LABEL[a.phase] ?? a.phase} · due{" "}
                {formatDateTime(a.dueAt)} · {a.problemCount}{" "}
                {a.problemCount === 1 ? "problem" : "problems"}
                {!teacher && ` · ${a.earned} / ${a.total} points`}
              </div>
            </div>
            {a.canManage && (
              <span className="flex gap-1">
                <Link
                  href={`${manage}/assignments/${a.id}/grades`}
                  className={buttonVariants({ variant: "ghost", size: "xs" })}
                >
                  Grades
                </Link>
                <Link
                  href={`${manage}/assignments/${a.id}`}
                  className={buttonVariants({ variant: "ghost", size: "xs" })}
                >
                  Edit
                </Link>
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">Contests</h2>
          {teacher && can.contests && (
            <Link
              href={`${manage}/contests/new?for=${groupId}`}
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              New contest
            </Link>
          )}
        </div>
        {data.contests.length === 0 && (
          <p className="text-body-sm text-body">
            No contests for this class yet.
          </p>
        )}
        {data.contests.map((c) => (
          <div
            key={c.id}
            data-testid="class-contest"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-card p-3.5"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/contests/${c.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  {c.title}
                </Link>
                {!c.published && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Draft
                  </span>
                )}
                <ReachChip reach={c.reach} />
              </div>
              <div className="text-caption text-body">
                {PHASE_LABEL[c.phase] ?? c.phase} · {formatDateTime(c.startsAt)}
              </div>
            </div>
            {c.canManage && (
              <Link
                href={`${manage}/contests/${c.id}`}
                className={buttonVariants({ variant: "ghost", size: "xs" })}
              >
                Edit
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Syllabus</h2>
        {data.topics.length === 0 ? (
          <p className="text-body-sm text-body">
            No syllabus yet.
            {teacher && " Add topics under Syllabus and log."}
          </p>
        ) : (
          <ol className="grid gap-1 rounded-lg border border-hairline bg-card p-3.5 text-body-sm">
            {data.topics.map((t, i) => (
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
      </section>
    </div>
  )
}

/* ---------- people ---------- */

function TeacherPeople({
  slug,
  groupId,
  teachers,
}: {
  slug: string
  groupId: string
  teachers: Overview["teachers"]
}) {
  const router = useRouter()
  const { data, error } = useGroups(slug)
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <Teachers teachers={teachers} />
      <GroupPeople
        inline
        slug={slug}
        groupId={groupId}
        groups={data.groups}
        levels={data.levels}
        onClose={() => {}}
        onOpen={(id) => router.push(orgPages(slug).cls(id, "people"))}
      />
    </div>
  )
}

function Teachers({ teachers }: { teachers: Overview["teachers"] }) {
  return (
    <section className="grid gap-1.5">
      <h2 className="text-title-sm text-ink">Teachers</h2>
      {teachers.length === 0 ? (
        <p className="text-body-sm text-body">
          Nobody has a teaching role for this class yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {teachers.map((t) => (
            <li
              key={t.name}
              className="rounded-md border border-hairline bg-card px-3 py-1.5 text-body-sm text-ink"
            >
              {t.name}
              <span className="ms-1.5 text-caption text-body">
                {t.roles.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StudentPeople({ slug, groupId }: { slug: string; groupId: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "people"],
    queryFn: () =>
      api<{
        teachers: Overview["teachers"]
        students: { name: string; handle: string | null; me: boolean }[]
      }>(`/orgs/${slug}/classes/${groupId}/people`),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <Teachers teachers={data.teachers} />
      <section className="grid gap-1.5">
        <h2 className="text-title-sm text-ink">
          Classmates ({data.students.length})
        </h2>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.students.map((s, i) => (
            <li
              key={s.handle ?? i}
              className="rounded-md border border-hairline bg-card px-3 py-1.5 text-body-sm text-ink"
            >
              {s.handle ? (
                <Link href={`/u/${s.handle}`} className="hover:underline">
                  {s.name}
                </Link>
              ) : (
                s.name
              )}
              {s.me && (
                <span className="ms-1.5 text-caption text-body">you</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ---------- grades ---------- */

function ClassGrades({ slug, groupId }: { slug: string; groupId: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "grades"],
    queryFn: () =>
      api<{
        assignments: {
          id: string
          title: string
          dueAt: string
          total: number
          average: number | null
        }[]
        students: {
          name: string
          email: string
          marks: (number | null)[]
          percent: number | null
        }[]
      }>(`/orgs/${slug}/classes/${groupId}/grades`),
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

function MyGrades({ slug, groupId }: { slug: string; groupId: string }) {
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

/* ---------- syllabus and attendance ---------- */

interface AttendanceData {
  mine: { marked: number; present: number; percent: number | null } | null
  students: {
    name: string
    email: string
    marked: number
    present: number
    percent: number | null
  }[]
}

function useAttendance(slug: string, groupId: string) {
  return useQuery({
    queryKey: ["org", slug, "class", groupId, "attendance"],
    queryFn: () =>
      api<AttendanceData>(`/orgs/${slug}/classes/${groupId}/attendance`),
  })
}

/** Below this, a student is flagged. Colleges commonly require 75%. */
const LOW_ATTENDANCE = 75

function AttendanceTable({ slug, groupId }: { slug: string; groupId: string }) {
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

function MySyllabus({ slug, groupId }: { slug: string; groupId: string }) {
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
