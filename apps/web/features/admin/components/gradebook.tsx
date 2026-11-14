"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { rubricTotal, type RubricCriterion } from "@workspace/judge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { DetailSheet } from "@/components/detail-sheet"
import { ConfirmButton } from "@/components/confirm"
import { Markdown } from "@/components/markdown"
import { Field, FormMessage, TextInput } from "@/components/form"
import {
  PhaseBadge,
  STATUS,
} from "@/features/assignments/components/assignments"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { useOwner } from "@/features/admin/owner"
import { LiveCode, Playback } from "@/features/drafts/components/student-work"
import { formatLeft, type SittingView } from "@/features/exams/components/exam"
import {
  CommentedCode,
  type LineComment,
} from "@/features/feedback/components/commented-code"
import { SendGrades } from "@/features/lti/components/send-grades"
import { PeerReviewPanel } from "@/features/peer/components/peer"
import { ProjectMarking } from "@/features/projects/components/projects"

import { toLocalInput } from "./contests"
import { Card, Loading, PageTitle, Stats, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { orgGradebook } from "@/features/orgs/content"
import type { orgRejudgeSystemErrors } from "@/features/orgs/content"

/** The JSON form of the gradebook (the same route also answers CSV). */
export type Gradebook = Exclude<
  ApiResult<typeof orgGradebook>,
  { filename: string }
>

export function AssignmentGradebook({ id }: { id: string }) {
  const owner = useOwner()
  const [viewing, setViewing] = useState<{
    email: string
    problemId: string
  } | null>(null)
  const [now] = useState(() => Date.now())
  const [marking, setMarking] = useState<string | null>(null)
  const [markingProjects, setMarkingProjects] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const client = useQueryClient()
  const [rejudged, setRejudged] = useState<string | null>(null)
  const rejudge = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof orgRejudgeSystemErrors>>(
        owner.api(`/assignments/${id}/rejudge`),
        {
          method: "POST",
        }
      ),
    onSuccess: ({ queued }) => {
      setRejudged(
        queued
          ? `${queued} ${queued === 1 ? "submission is" : "submissions are"} being judged again. Marks update as they finish.`
          : "No system errors to re-judge."
      )
      void client.invalidateQueries({ queryKey: owner.key("gradebook", id) })
    },
    onError: (e) => setRejudged(e.message),
  })
  const release = useMutation({
    mutationFn: () =>
      api(owner.api(`/assignments/${id}/release`), { method: "POST" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: owner.key("gradebook", id) }),
  })
  const { data, error } = useQuery({
    queryKey: owner.key("gradebook", id),
    queryFn: () => api<Gradebook>(owner.api(`/assignments/${id}/gradebook`)),
    refetchInterval: 30_000,
  })
  if (!data) return <Loading error={error} />

  const query = search.trim().toLowerCase()
  const rows = data.rows.filter(
    (row) =>
      !query ||
      row.email.toLowerCase().includes(query) ||
      (row.name ?? "").toLowerCase().includes(query)
  )
  const { students, started, fullMarks, average } = data.summary
  const notStarted = students - started
  const averagePercent = data.total
    ? Math.round((100 * average) / data.total)
    : null

  return (
    <>
      <PageTitle
        action={
          <span className="flex gap-2">
            {data.can.rejudge && (
              <Button
                size="sm"
                variant="outline"
                disabled={rejudge.isPending}
                title="After a runner outage: judge every submission that ended in a system error again, keeping when it was submitted."
                onClick={() => rejudge.mutate()}
              >
                Re-judge system errors
              </Button>
            )}
            {data.assignment.exam && data.can.forgetAddresses && (
              <ConfirmButton
                size="sm"
                variant="outline"
                title="Forget network addresses?"
                description="The addresses each sitting started from, and of refused submissions, are deleted. Everything else stays. This can't be undone."
                confirmLabel="Forget addresses"
                onConfirm={() =>
                  void api(owner.api(`/assignments/${id}/forget-addresses`), {
                    method: "POST",
                  }).then(() =>
                    client.invalidateQueries({ queryKey: ["attempts"] })
                  )
                }
              >
                Forget addresses
              </ConfirmButton>
            )}
            {data.assignment.holdFeedback && data.can.release && (
              <ConfirmButton
                size="sm"
                disabled={release.isPending}
                title="Release results?"
                description="Every student sees their marks: quiz answers with the right answers, rubric marks and comments. New marks show at once from then on."
                confirmLabel="Release results"
                tone="default"
                onConfirm={() => release.mutate()}
              >
                Release results
              </ConfirmButton>
            )}
            {data.can.edit && (
              <Link
                href={owner.page(`/assignments/${id}`)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
              >
                Edit
              </Link>
            )}
            {data.can.export && (
              <a
                href={`/api/v1${owner.api(`/assignments/${id}/gradebook`)}?format=csv`}
                download
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Download CSV
              </a>
            )}
          </span>
        }
      >
        Gradebook: {data.assignment.title}
      </PageTitle>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-caption text-body">
        <PhaseBadge phase={data.assignment.phase} />
        Due {formatDateTime(data.assignment.dueAt)}. Marks update as students
        submit.
        {data.assignment.holdFeedback &&
          " Results are held: students don't see quiz marks, rubric marks or comments yet."}
        {rejudged && <span data-testid="rejudge-result"> {rejudged}</span>}
      </p>
      <div className="mb-3 grid gap-3 empty:hidden">
        {data.can.sendGrades && <SendGrades id={id} />}
        {data.can.peer && <PeerReviewPanel id={id} />}
      </div>
      <Stats
        items={[
          { label: "Students", value: students },
          {
            label: "Started",
            value: started,
            hint: students
              ? `${Math.round((100 * started) / students)}%`
              : undefined,
          },
          {
            label: "Not started",
            value: notStarted,
            tone: notStarted > 0 ? "bad" : undefined,
          },
          { label: "Full marks", value: fullMarks },
          {
            label: "Average",
            value: averagePercent === null ? "—" : `${averagePercent}%`,
            hint: `${Math.round(average * 10) / 10} of ${data.total}`,
          },
        ]}
      />
      <TextInput
        aria-label="Search students"
        placeholder="Search by name or email"
        className="mb-3 w-72"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Table
        headers={[
          "Student",
          ...(data.assignment.exam ? ["Exam"] : []),
          ...data.problems.map((p) => `${p.title} (${p.points})`),
          ...(data.assignment.quiz
            ? [`Quiz (${data.assignment.quiz.points})`]
            : []),
          ...(data.assignment.projects
            ? [
                `Projects (${data.assignment.projects.reduce((n, p) => n + p.points, 0)})`,
              ]
            : []),
          `Total (${data.total})`,
        ]}
      >
        {rows.map((row) => (
          <tr key={row.email} data-testid="grade-row">
            <td>
              <div className="text-ink">{row.name ?? row.handle}</div>
              <div className="text-xs">{row.email}</div>
              <ExtensionControl
                assignmentId={id}
                student={row.email}
                name={row.name ?? row.handle ?? row.email}
                dueAt={data.assignment.dueAt}
                problems={data.problems}
                extension={row.extension}
              />
            </td>
            {row.exam && (
              <td className="text-caption" data-testid="exam-cell">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-caption font-normal text-ink"
                  aria-label={`See ${row.email}'s exam`}
                  disabled={!data.problems[0]}
                  onClick={() =>
                    setViewing({
                      email: row.email,
                      problemId: data.problems[0]!.problemId,
                    })
                  }
                >
                  {row.exam.status === "not_started"
                    ? "Not started"
                    : row.exam.status === "in_progress"
                      ? `In progress, ${formatLeft(new Date(row.exam.endsAt!).getTime() - now)} left`
                      : row.exam.finishedEarly
                        ? "Finished"
                        : "Time ran out"}
                </Button>
                {row.exam.warnings > 0 && (
                  <div className="text-destructive">
                    {row.exam.warnings}{" "}
                    {row.exam.warnings === 1 ? "warning" : "warnings"}
                  </div>
                )}
              </td>
            )}
            {row.cells.map((cell) => (
              <td
                key={cell.problemId}
                title={STATUS[cell.status].label}
                className={cn("tabular-nums", STATUS[cell.status].tone)}
              >
                {cell.status === "missing" ? (
                  "—"
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    data-testid="grade-cell"
                    className="h-auto p-0 font-normal text-inherit no-underline hover:text-inherit hover:underline"
                    aria-label={`See ${row.email}'s code`}
                    onClick={() =>
                      setViewing({
                        email: row.email,
                        problemId: cell.problemId,
                      })
                    }
                  >
                    {cell.earned}
                    {cell.status === "late" && " (late)"}
                  </Button>
                )}
              </td>
            ))}
            {data.assignment.quiz && (
              <td className="tabular-nums" data-testid="quiz-cell">
                {row.quiz?.answered ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-normal text-inherit"
                    aria-label={`Mark ${row.email}'s answers`}
                    onClick={() => setMarking(row.email)}
                  >
                    {row.quiz.earned}
                  </Button>
                ) : (
                  "—"
                )}
                {(row.quiz?.needsMarking ?? 0) > 0 && (
                  <div className="text-xs text-primary">
                    {row.quiz!.needsMarking} to mark
                  </div>
                )}
              </td>
            )}
            {data.assignment.projects && (
              <td className="tabular-nums" data-testid="projects-cell">
                {row.projects?.submitted ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-normal text-inherit"
                    aria-label={`Mark ${row.email}'s projects`}
                    onClick={() => setMarkingProjects(row.email)}
                  >
                    {row.projects.earned}
                  </Button>
                ) : (
                  "—"
                )}
                {(row.projects?.needsMarking ?? 0) > 0 && (
                  <div className="text-xs text-primary">
                    {row.projects!.needsMarking} to mark
                  </div>
                )}
              </td>
            )}
            <td className="font-semibold text-ink tabular-nums">
              {row.earned}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No students match.</p>
      )}
      {markingProjects && (
        <ProjectMarking
          key={markingProjects}
          assignmentId={id}
          student={markingProjects}
          onClose={() => setMarkingProjects(null)}
        />
      )}
      {marking && (
        <QuizMarking
          key={marking}
          assignmentId={id}
          student={marking}
          onClose={() => setMarking(null)}
        />
      )}
      {viewing && (
        <StudentCode
          key={`${viewing.email} ${viewing.problemId}`}
          assignmentId={id}
          student={viewing.email}
          problemId={viewing.problemId}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

export interface Attempts {
  exam:
    | (SittingView & {
        ip: string | null
        events: { kind: string; detail: string; at: string }[]
      })
    | null
  student: { name: string | null; email: string }
  problem: { title: string; points: number; rubric: RubricCriterion[] }
  marks: Record<string, number>
  holdFeedback: boolean
  attempts: {
    id: string
    language: string
    files: { path: string; content: string }[]
    verdict: string | null
    score: number | null
    maxScore: number | null
    passedTests: number | null
    totalTests: number | null
    createdAt: string
    late: boolean
    outside: boolean
    comments: LineComment[]
  }[]
}

/**
 * One student on one problem: their graded submissions (with rubric marks and line
 * comments), the code they're writing now, and how that code grew.
 */
export function StudentCode({
  assignmentId,
  student,
  problemId,
  onClose,
}: {
  assignmentId: string
  student: string
  problemId: string
  onClose: () => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const path = `${owner.api(`/assignments/${assignmentId}/attempts`)}?student=${encodeURIComponent(student)}&problem=${problemId}`
  const { data, error } = useQuery({
    queryKey: ["attempts", path],
    queryFn: () => api<Attempts>(path),
  })
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["attempts", path] }),
      client.invalidateQueries({
        queryKey: owner.key("gradebook", assignmentId),
      }),
    ])
  const addComment =
    (submissionId: string, file: string) => (line: number, body: string) =>
      api(owner.api(`/assignments/${assignmentId}/comments`), {
        body: { student, submissionId, path: file, line, body },
      }).then(refresh)
  const removeComment = (commentId: string) =>
    api(owner.api(`/assignments/${assignmentId}/comments/${commentId}`), {
      method: "DELETE",
    }).then(refresh)
  return (
    // Beside the gradebook, not below it: it opens where the cell was clicked.
    <DetailSheet
      testId="student-code"
      onClose={onClose}
      title={
        data
          ? `${data.student.name ?? data.student.email}: ${data.problem.title}`
          : "Code"
      }
    >
        {data?.exam && (
          <ExamRecord
            exam={data.exam}
            onExtend={(minutes) =>
              api(owner.api(`/assignments/${assignmentId}/extend`), {
                body: { student, minutes },
              }).then(refresh)
            }
          />
        )}
        {data && data.problem.rubric.length > 0 && (
          <RubricMarking
            rubric={data.problem.rubric}
            marks={data.marks}
            held={data.holdFeedback}
            onSave={(marks) =>
              api(owner.api(`/assignments/${assignmentId}/marks`), {
                method: "PUT",
                body: { student, problemId, marks },
              }).then(refresh)
            }
          />
        )}
        <Tabs defaultValue="submissions">
          <TabsList variant="line">
            <TabsTrigger value="submissions">
              Submissions{data ? ` (${data.attempts.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="live">Working copy</TabsTrigger>
            <TabsTrigger value="playback">Playback</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="pt-3">
            <LiveCode path={path} />
          </TabsContent>
          <TabsContent value="playback" className="pt-3">
            <Playback path={path} />
          </TabsContent>
          <TabsContent value="submissions" className="grid gap-3 pt-3">
            {!data && <Loading error={error} />}
            {data?.attempts.length === 0 && (
              <p className="text-body-sm text-body">
                No graded submissions since it opened.
              </p>
            )}
            {data && data.attempts.length > 0 && (
              <p className="text-caption">
                Select a line number to comment on that line
                {data.holdFeedback
                  ? ". Students see comments once you release feedback."
                  : "; the student sees it with the submission."}
              </p>
            )}
            {data?.attempts.map((a) => (
              <div
                key={a.id}
                className="grid gap-1.5 border-t border-hairline pt-3"
              >
                <div className="flex flex-wrap gap-x-3 text-caption text-body">
                  <span
                    className={
                      a.verdict === "AC" ? "text-success" : "text-destructive"
                    }
                  >
                    {a.verdict === "AC" ? "Accepted" : (a.verdict ?? "—")}
                  </span>
                  {a.totalTests !== null && (
                    <span className="tabular-nums">
                      {a.passedTests} / {a.totalTests} tests
                    </span>
                  )}
                  <span>{a.language}</span>
                  <span>{formatDateTime(a.createdAt)}</span>
                  {a.late && <span className="text-primary">Late</span>}
                  {a.outside && (
                    <span className="text-primary">
                      Outside the exam: doesn&apos;t count
                    </span>
                  )}
                </div>
                {a.files.map((f) => (
                  <div
                    key={f.path}
                    className="overflow-hidden rounded-md border border-hairline"
                  >
                    {a.files.length > 1 && (
                      <div className="px-3 pt-2 text-xs text-body">
                        {f.path}
                      </div>
                    )}
                    <CommentedCode
                      content={f.content}
                      comments={a.comments.filter((c) => c.path === f.path)}
                      onAdd={addComment(a.id, f.path)}
                      onDelete={removeComment}
                    />
                  </div>
                ))}
              </div>
            ))}
          </TabsContent>
        </Tabs>
    </DetailSheet>
  )
}

export const EVENT_LABEL: Record<string, string> = {
  left_tab: "Left the page",
  left_fullscreen: "Left fullscreen",
  pasted: "Pasted from elsewhere",
  other_network: "Tried to submit from another network",
}

/** A student's exam sitting: when, from where, what the browser noticed, and more time. */
export function ExamRecord({
  exam,
  onExtend,
}: {
  exam: NonNullable<Attempts["exam"]>
  onExtend: (minutes: number) => Promise<unknown>
}) {
  const [minutes, setMinutes] = useState("10")
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const extend = useMutation({
    mutationFn: () => onExtend(Number(minutes)),
    onSuccess: () => setMessage({ text: "More time given.", kind: "ok" }),
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  return (
    <div
      className="grid gap-2 rounded-md border border-hairline p-3"
      data-testid="exam-record"
    >
      <h3 className="text-body-sm font-semibold text-ink">Exam</h3>
      {exam.status === "not_started" ? (
        <p className="text-caption">Hasn&apos;t started.</p>
      ) : (
        <>
          <p className="text-caption">
            Started {formatDateTime(exam.startedAt!)}
            {exam.ip ? ` from ${exam.ip}` : ""};{" "}
            {exam.status === "in_progress" ? "ends" : "ended"}{" "}
            {formatDateTime(exam.endsAt!)}
            {exam.finishedEarly ? " (finished early)" : ""}.
          </p>
          {exam.events.length === 0 ? (
            <p className="text-caption">Nothing noticed during the exam.</p>
          ) : (
            <ul className="grid gap-0.5 text-caption" data-testid="exam-events">
              {exam.events.map((e, i) => (
                <li key={i}>
                  <span className="tabular-nums">{formatDateTime(e.at)}</span>
                  {" · "}
                  <span className="text-ink">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                  </span>
                  {e.detail && ` (${e.detail})`}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="number"
              min={1}
              max={600}
              aria-label="Extra minutes"
              className="w-20 py-0.5"
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value)
                setMessage(null)
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={extend.isPending || !(Number(minutes) >= 1)}
              onClick={() => extend.mutate()}
            >
              Give more time
            </Button>
            {message && <FormMessage message={message} />}
          </div>
        </>
      )}
    </div>
  )
}

/** Marks for each rubric criterion, saved together. */
export function RubricMarking({
  rubric,
  marks,
  held,
  onSave,
}: {
  rubric: RubricCriterion[]
  marks: Record<string, number>
  held: boolean
  onSave: (marks: Record<string, number>) => Promise<unknown>
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rubric.map((c) => [c.id, c.id in marks ? String(marks[c.id]) : ""])
    )
  )
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const out: Record<string, number> = {}
      for (const c of rubric) {
        const text = values[c.id]?.trim() ?? ""
        if (text === "") continue
        const n = Number(text)
        if (!Number.isFinite(n) || n < 0 || n > c.points) {
          throw new Error(`${c.label}: give 0 to ${c.points}.`)
        }
        out[c.id] = n
      }
      return onSave(out)
    },
    onSuccess: () =>
      setMessage({
        text: held ? "Saved. Held until you release feedback." : "Saved.",
        kind: "ok",
      }),
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const earned = rubric.reduce(
    (t, c) => t + Math.min(c.points, Math.max(0, Number(values[c.id]) || 0)),
    0
  )
  return (
    <div
      className="grid gap-2 rounded-md border border-hairline p-3"
      data-testid="rubric-marking"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-ink">Rubric</h3>
        <span className="text-caption tabular-nums">
          {earned} / {rubricTotal(rubric)} by hand
        </span>
      </div>
      {rubric.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-body-sm">
          <span className="flex-1 text-ink">{c.label}</span>
          <TextInput
            type="number"
            min={0}
            max={c.points}
            aria-label={`Marks for ${c.label}`}
            className="w-20 py-0.5"
            value={values[c.id] ?? ""}
            onChange={(event) => {
              setValues((v) => ({ ...v, [c.id]: event.target.value }))
              setMessage(null)
            }}
          />
          <span className="w-12 text-caption tabular-nums">/ {c.points}</span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          Save marks
        </Button>
        {message && <FormMessage message={message} />}
      </div>
    </div>
  )
}

/** A later due date for one student, or reopening some problems after feedback. */
export function ExtensionControl({
  assignmentId,
  student,
  name,
  dueAt,
  problems,
  extension,
}: {
  assignmentId: string
  student: string
  name: string
  dueAt: string
  problems: { problemId: string; title: string }[]
  extension: {
    dueAt: string
    problemIds: readonly string[]
    reason: string
  } | null
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const suggested = new Date(
    Math.max(new Date(dueAt).getTime(), Date.now()) + 3 * 86_400_000
  )
  const [until, setUntil] = useState(
    toLocalInput(extension?.dueAt ?? suggested.toISOString())
  )
  const [chosen, setChosen] = useState<string[]>([
    ...(extension?.problemIds ?? []),
  ])
  const [reason, setReason] = useState(extension?.reason ?? "")
  const [message, setMessage] = useState<string | null>(null)
  const path = owner.api(`/assignments/${assignmentId}/extensions`)
  const refresh = () =>
    client.invalidateQueries({ queryKey: owner.key("gradebook", assignmentId) })
  const save = useMutation({
    mutationFn: () =>
      api(path, {
        method: "PUT",
        body: {
          student,
          dueAt: new Date(until).toISOString(),
          problemIds: chosen,
          reason,
        },
      }),
    onSuccess: () => {
      setOpen(false)
      void refresh()
    },
    onError: (e) => setMessage(e.message),
  })
  const labelOf = (id: string) => {
    const index = problems.findIndex((p) => p.problemId === id)
    return index < 0 ? "" : `Q${index + 1}`
  }
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {extension && (
          <span
            data-testid="extension-chip"
            className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            title={extension.reason || undefined}
          >
            Until {formatDateTime(extension.dueAt)}
            {extension.problemIds.length > 0 &&
              ` · ${extension.problemIds.map(labelOf).join(", ")}`}
          </span>
        )}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 text-xs"
          aria-label={`Extend for ${student}`}
          onClick={() => setOpen(true)}
        >
          {extension ? "Change" : "Extend"}
        </Button>
        {extension && (
          <ConfirmButton
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs text-destructive"
            title={`Remove ${name}'s extension?`}
            description="Their work is graded against the assignment's own due time again."
            confirmLabel="Remove extension"
            onConfirm={() =>
              void api(`${path}?student=${encodeURIComponent(student)}`, {
                method: "DELETE",
              }).then(refresh)
            }
          >
            Remove
          </ConfirmButton>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend for {name}</DialogTitle>
            <DialogDescription>
              A later due time for this student only. Choose problems to reopen
              just those, for example after feedback; choose none for the whole
              assignment.
            </DialogDescription>
          </DialogHeader>
          <Field label="New due time">
            <TextInput
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </Field>
          <div className="grid gap-1.5">
            <div className="text-caption font-medium text-ink">Problems</div>
            {problems.map((p, index) => (
              <label
                key={p.problemId}
                className="inline-flex items-center gap-2 text-body-sm"
              >
                <Checkbox
                  checked={chosen.includes(p.problemId)}
                  onCheckedChange={(checked) =>
                    setChosen((all) =>
                      checked
                        ? [...all, p.problemId]
                        : all.filter((x) => x !== p.problemId)
                    )
                  }
                />
                Q{index + 1}. {p.title}
              </label>
            ))}
            <p className="text-caption">
              {chosen.length === 0
                ? "None chosen: the whole assignment."
                : "Only these reopen."}
            </p>
          </div>
          <Field label="Reason (optional, for your records)">
            <TextInput
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {message && <FormMessage message={{ text: message, kind: "err" }} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save extension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export interface StudentQuiz {
  student: { name: string | null; email: string }
  savedAt: string | null
  earned: number
  max: number
  held: boolean
  questions: {
    id: string
    kind: "single" | "multiple" | "short" | "written"
    prompt: string
    options: { id: string; text: string }[]
    correct: string[]
    accepted: string[]
    points: number
    answer: string[] | string | null
    earned: number | null
    needsMarking: boolean
    byTeacher: boolean
    automatic: number | null
  }[]
}

/** One student's answers: the automatic marks, and a teacher's mark to replace any of them. */
export function QuizMarking({
  assignmentId,
  student,
  onClose,
}: {
  assignmentId: string
  student: string
  onClose: () => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const path = `${owner.api(`/assignments/${assignmentId}/quiz`)}?student=${encodeURIComponent(student)}`
  const { data, error } = useQuery({
    queryKey: ["quiz-marking", path],
    queryFn: () => api<StudentQuiz>(path),
  })
  const [given, setGiven] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const marks: Record<string, number | null> = {}
      for (const [id, text] of Object.entries(given)) {
        marks[id] = text.trim() === "" ? null : Number(text)
      }
      return api(owner.api(`/assignments/${assignmentId}/quiz`), {
        method: "PUT",
        body: { student, marks },
      })
    },
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      setGiven({})
      void client.invalidateQueries({ queryKey: ["quiz-marking", path] })
      void client.invalidateQueries({
        queryKey: owner.key("gradebook", assignmentId),
      })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const show = (q: StudentQuiz["questions"][number]) => {
    if (q.answer === null) return "No answer"
    if (Array.isArray(q.answer)) {
      return (
        q.answer
          .map((id) => q.options.find((o) => o.id === id)?.text ?? id)
          .join(", ") || "No answer"
      )
    }
    return q.answer.trim() || "No answer"
  }
  return (
    // Beside the gradebook, where the Quiz cell was clicked.
    <DetailSheet
      testId="quiz-marking"
      onClose={onClose}
      width="40rem"
      title={
        <>
          {data ? `${data.student.name ?? data.student.email}: quiz` : "Quiz"}
          {data && (
            <span className="ml-2 text-caption tabular-nums">
              {data.earned} / {data.max}
            </span>
          )}
        </>
      }
    >
        {!data && <Loading error={error} />}
        {data?.questions.map((q, index) => (
          <div
            key={q.id}
            className="grid gap-1.5 border-t border-hairline pt-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-body-sm font-semibold text-ink">
                Q{index + 1}
              </span>
              <span className="text-caption">
                {q.needsMarking
                  ? "Needs marking"
                  : q.byTeacher
                    ? `Marked ${q.earned} (automatic: ${q.automatic ?? "none"})`
                    : `Automatic: ${q.earned}`}{" "}
                / {q.points}
              </span>
            </div>
            <div className="text-body-sm text-body">
              <Markdown text={q.prompt} />
            </div>
            <div className="rounded-md bg-canvas-soft p-2 font-sans text-body-sm whitespace-pre-wrap text-ink">
              {show(q)}
            </div>
            {(q.kind === "single" || q.kind === "multiple") && (
              <p className="text-caption">
                Right:{" "}
                {q.correct
                  .map((id) => q.options.find((o) => o.id === id)?.text ?? id)
                  .join(", ")}
              </p>
            )}
            {q.kind === "short" && q.accepted.length > 0 && (
              <p className="text-caption">Accepted: {q.accepted.join(" · ")}</p>
            )}
            <label className="flex items-center gap-2 text-caption">
              Your mark
              <TextInput
                type="number"
                min={0}
                max={q.points}
                aria-label={`Mark for Q${index + 1}`}
                placeholder={q.byTeacher ? String(q.earned) : "automatic"}
                className="w-24 py-0.5"
                value={given[q.id] ?? (q.byTeacher ? String(q.earned) : "")}
                onChange={(event) => {
                  setGiven((g) => ({ ...g, [q.id]: event.target.value }))
                  setMessage(null)
                }}
              />
              / {q.points} (empty: automatic)
            </label>
          </div>
        ))}
        {data && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={save.isPending || Object.keys(given).length === 0}
              onClick={() => save.mutate()}
            >
              Save marks
            </Button>
            {message && <FormMessage message={message} />}
            {data.held && (
              <span className="text-caption">
                Held: the student sees these once you release results.
              </span>
            )}
          </div>
        )}
    </DetailSheet>
  )
}

/** The address the server sees for this teacher, to check lab networks against. */
export function YourAddress() {
  const { data } = useQuery({
    queryKey: ["me", "address"],
    queryFn: () =>
      api<{ address: string | null; source: string }>("/me/address"),
    staleTime: 60_000,
  })
  if (!data) return null
  return (
    <p className="text-caption text-body" data-testid="your-address">
      {data.address ? (
        <>
          Your address right now:{" "}
          <span className="font-mono">{data.address}</span>
        </>
      ) : (
        "This server can't confirm where people connect from, so exams can't be limited to a network yet (docs/deploy-exams.md)."
      )}
    </p>
  )
}
