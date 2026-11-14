"use client"

import { CheckCircleIcon, LockSimpleIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { ClassCertificates } from "@/features/certificates/components/class-certificates"
import {
  DailyQuestion,
  type DailyQuestionData,
} from "@/features/catalog/components/daily-question"
import { KIND_LABEL } from "@/features/questions/components/question-editor"
import { api } from "@/lib/api/client"
import { formatDate, formatDay } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { classCourses } from "@/features/courses/classes"

/*
 * A class's Course tab. Teachers give it courses (each from a start day) and see how far
 * students are per module; students work through modules as they open.
 */

interface CourseItem {
  kind: "problem" | "question"
  id: string
  title: string
  detail: string
  href: string | null
  done: boolean
}

interface ClassCourse {
  id: string
  title: string
  description: string
  startsOn: string
  /** Assigned training: finish by, and renewed every this many months. */
  dueOn?: string | null
  renewMonths?: number | null
  from: string | null
  canRemove: boolean
  modules: {
    id: string
    title: string
    summary: string
    opensOn: string
    afterPrevious: boolean
    open: boolean
    waiting: "date" | "previous" | null
    total: number
    done: number
    finishedBy: number | null
    items: CourseItem[]
  }[]
}

type View = ApiResult<typeof classCourses>

export function ClassCourses({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const base = `/orgs/${slug}/classes/${groupId}`
  const key = ["org", slug, "class", groupId, "courses"]
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<View>(`${base}/courses`),
  })
  const [adding, setAdding] = useState(false)
  const remove = useMutation({
    mutationFn: (courseId: string) =>
      api(`${base}/courses/${courseId}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />

  return (
    <div className="grid gap-4" data-testid="class-courses">
      {data.canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            Give a course
          </Button>
          <Link
            href={orgPages(slug).manage(`/courses`)}
            className="text-caption underline-offset-2 hover:underline"
          >
            Manage courses
          </Link>
        </div>
      )}
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      {data.courses.length === 0 && (
        <p className="text-body-sm text-body">
          {data.teacher
            ? "This class has no course yet."
            : "No course for this class yet."}
        </p>
      )}
      {data.courses.map((course) => {
        const total = course.modules.reduce((n, m) => n + m.total, 0)
        const done = course.modules.reduce((n, m) => n + m.done, 0)
        return (
          <section
            key={course.id}
            className="grid gap-2"
            data-testid="class-course"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-display-sm text-ink">{course.title}</h2>
                <p className="text-caption">
                  From {formatDate(`${course.startsOn}T00:00:00`)}
                  {course.from && ` · Given to ${course.from}`}
                  {course.dueOn && ` · Due ${formatDay(course.dueOn)}`}
                  {course.renewMonths &&
                    ` · Renewed every ${course.renewMonths} months`}
                  {!data.teacher && total > 0 && ` · ${done} of ${total} done`}
                </p>
                {course.description && (
                  <p className="mt-1 max-w-3xl text-body-sm">
                    {course.description}
                  </p>
                )}
              </div>
              {course.canRemove && (
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title={`Take ${course.title} off this class?`}
                  description="Students stop seeing it here. Their solved problems and answers stay."
                  confirmLabel="Take it off"
                  onConfirm={() => remove.mutate(course.id)}
                >
                  Take off
                </ConfirmButton>
              )}
            </div>
            <ol className="grid gap-1.5">
              {course.modules.map((m, index) => (
                <ModuleRow
                  key={m.id}
                  index={index}
                  module={m}
                  teacher={data.teacher}
                  students={data.students}
                  questions={data.questions}
                  practice={`${base}/practice`}
                  queryKey={key}
                />
              ))}
            </ol>
          </section>
        )
      })}
      {data.canAdd && (
        <ClassCertificates
          slug={slug}
          groupId={groupId}
          courses={data.courses.map((c) => ({ id: c.id, title: c.title }))}
        />
      )}
      {adding && (
        <AddCourseDialog
          base={base}
          available={data.available}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: key })
          }}
        />
      )}
    </div>
  )
}

function ModuleRow({
  index,
  module: m,
  teacher,
  students,
  questions,
  practice,
  queryKey,
}: {
  index: number
  module: ClassCourse["modules"][number]
  teacher: boolean
  students: number | null
  questions: Record<string, DailyQuestionData>
  practice: string
  queryKey: unknown[]
}) {
  const [open, setOpen] = useState(false)
  const locked = !teacher && !m.open
  const status = teacher
    ? `${m.open ? "Open" : `Opens ${formatDate(`${m.opensOn}T00:00:00`)}`}${m.afterPrevious ? " · after the module before" : ""} · ${m.finishedBy} of ${students} finished`
    : m.open
      ? `${m.done} of ${m.total} done`
      : m.waiting === "date"
        ? `Opens ${formatDate(`${m.opensOn}T00:00:00`)}`
        : "Opens when you finish the module before"
  let questionNumber = 0
  return (
    <li
      data-testid="class-module"
      className="rounded-md border border-hairline bg-card"
    >
      <Collapsible open={open && !locked} onOpenChange={setOpen}>
        <CollapsibleTrigger
          disabled={locked}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left",
            locked ? "cursor-default opacity-70" : "hover:bg-muted/50"
          )}
        >
          <span className="w-6 text-caption tabular-nums">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">
              {m.title}
            </span>
            <span className="block truncate text-caption">{status}</span>
          </span>
          {locked ? (
            <LockSimpleIcon
              aria-label="Not open yet"
              className="size-4 text-body"
            />
          ) : (
            !teacher &&
            m.total > 0 &&
            m.done === m.total && (
              <CheckCircleIcon
                aria-label="Finished"
                weight="fill"
                className="size-4 text-success"
              />
            )
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 border-t border-hairline px-3 py-2">
          {m.summary && <p className="text-body-sm">{m.summary}</p>}
          <ul className="grid gap-1">
            {m.items.map((item) => {
              if (item.kind === "question" && !teacher && questions[item.id]) {
                questionNumber += 1
                return (
                  <li key={item.id}>
                    <DailyQuestion
                      q={questions[item.id]!}
                      number={questionNumber}
                      signedIn
                      endpoint={practice}
                      queryKey={queryKey}
                      retry
                    />
                  </li>
                )
              }
              return (
                <li
                  key={item.id}
                  data-testid="module-item"
                  className="flex items-center gap-2 text-body-sm"
                >
                  {!teacher && (
                    <CheckCircleIcon
                      aria-label={item.done ? "Done" : "Not done"}
                      weight={item.done ? "fill" : "regular"}
                      className={cn(
                        "size-4",
                        item.done ? "text-success" : "text-body"
                      )}
                    />
                  )}
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span className="text-ink">{item.title}</span>
                  )}
                  <span className="text-xs text-body capitalize">
                    {item.kind === "problem"
                      ? item.detail
                      : (KIND_LABEL[item.detail as keyof typeof KIND_LABEL] ??
                        item.detail)}
                  </span>
                </li>
              )
            })}
            {m.items.length === 0 && (
              <li className="text-caption">Nothing in this module yet.</li>
            )}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function AddCourseDialog({
  base,
  available,
  onDone,
}: {
  base: string
  available: View["available"]
  onDone: () => void
}) {
  const [courseId, setCourseId] = useState(available[0]?.id ?? "")
  const [startsOn, setStartsOn] = useState(() =>
    new Date().toLocaleDateString("en-CA")
  )
  const add = useMutation({
    mutationFn: () => api(`${base}/courses`, { body: { courseId, startsOn } }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Give this class a course</DialogTitle>
          <DialogDescription>
            Modules open by their rules, counted from the start day. Groups
            inside this class get it too.
          </DialogDescription>
        </DialogHeader>
        {available.length === 0 ? (
          <p className="text-body-sm">
            No ready courses yet. Write one under Manage › Courses.
          </p>
        ) : (
          <>
            <Field label="Course">
              <SelectInput
                aria-label="Course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.orgId === null ? " (platform)" : ""}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Starts on">
              <TextInput
                aria-label="Starts on"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </Field>
          </>
        )}
        {add.error && (
          <FormMessage message={{ text: add.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!courseId || !startsOn || add.isPending}
            onClick={() => add.mutate()}
          >
            Give course
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
