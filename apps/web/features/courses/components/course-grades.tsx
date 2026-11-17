"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { DetailSheet } from "@/components/detail-sheet"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import {
  Loading,
  PageTitle,
  PercentBar,
  Stats,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { courseGrades } from "@/features/courses/checkpoints"

import { KIND_NAME } from "./checkpoint-page"

/*
 * A class's grade sheet for one course: each student's score on every quiz, lab and
 * project, and the course grade (each checkpoint weighted; what isn't final counts 0).
 * A cell opens the student's work there: a project to mark, an attempt to reset.
 */

type Sheet = ApiResult<typeof courseGrades>
type Student = Sheet["students"][number]
type Score = Student["scores"][number]

const cell = (s: Score, max: number) => {
  if (s.earned !== null) return `${s.earned} / ${max}`
  switch (s.state) {
    case "running":
      return "In progress"
    case "handed_in":
      return "To mark"
    default:
      return "—"
  }
}

export function CourseGrades({
  slug,
  groupId,
  courseId,
}: {
  slug: string
  groupId: string
  courseId: string
}) {
  const pages = orgPages(slug)
  const base = `/orgs/${slug}/classes/${groupId}/courses/${courseId}`
  const key = ["org", slug, "class", groupId, "course-grades", courseId]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Sheet>(`${base}/grades`),
  })
  const [open, setOpen] = useState<{
    student: string
    checkpoint: string
  } | null>(null)
  if (!data) return <Loading error={error} />
  const toMark = data.students.reduce(
    (n, s) => n + s.scores.filter((x) => x.state === "handed_in").length,
    0
  )
  const graded = data.students.filter((s) => s.grade !== null)
  const average = graded.length
    ? Math.round(graded.reduce((n, s) => n + s.grade!, 0) / graded.length)
    : null
  const selected = open && data.students.find((s) => s.id === open.student)
  const checkpoint =
    open && data.checkpoints.find((c) => c.id === open.checkpoint)

  return (
    <div className="grid gap-4" data-testid="course-grades">
      <nav className="text-caption">
        <Link href={pages.cls(groupId, "course")} className="hover:text-ink">
          Course
        </Link>
      </nav>
      <PageTitle>{data.course.title}: grades</PageTitle>
      {data.checkpoints.length === 0 ? (
        <p className="text-body-sm">
          This course has no quizzes, labs or projects yet. Add them to its
          modules under Manage › Courses.
        </p>
      ) : (
        <>
          <Stats
            items={[
              { label: "Students", value: data.students.length },
              {
                label: "Average course grade",
                value: average === null ? "—" : `${average}%`,
              },
              {
                label: "Projects to mark",
                value: toMark,
                tone: toMark ? "bad" : undefined,
              },
            ]}
          />
          <p className="max-w-3xl text-caption" data-testid="grading-rule">
            How the course is graded:{" "}
            {data.checkpoints.map((c) => `${c.title} ${c.share}%`).join(" · ")}.
            A quiz or lab counts once its attempt is over, a project once
            marked; until then it counts 0 in the course grade. &quot;So
            far&quot; counts only what&apos;s final.
          </p>
          <Table
            headers={[
              "Student",
              "Course grade",
              "So far",
              ...data.checkpoints.map(
                (c) => `${KIND_NAME[c.kind]}: ${c.module}`
              ),
            ]}
          >
            {data.students.map((s) => (
              <tr key={s.id} data-testid="grade-row">
                <td>{s.name}</td>
                <td>
                  <PercentBar value={s.grade} />
                </td>
                <td className="tabular-nums">
                  {s.sofar === null ? "—" : `${s.sofar}%`}
                </td>
                {s.scores.map((score) => {
                  const c = data.checkpoints.find(
                    (x) => x.id === score.checkpointId
                  )!
                  const clickable = score.state !== "not_started"
                  return (
                    <td key={score.checkpointId} className="tabular-nums">
                      {clickable ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                          aria-label={`${s.name}: ${c.title}`}
                          onClick={() =>
                            setOpen({ student: s.id, checkpoint: c.id })
                          }
                        >
                          {cell(score, c.max)}
                        </Button>
                      ) : (
                        cell(score, c.max)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </Table>
          {data.students.length === 0 && (
            <p className="text-body-sm">No students in this class yet.</p>
          )}
        </>
      )}
      {selected && checkpoint && (
        <WorkSheet
          base={`${base}/checkpoints/${checkpoint.id}/students/${selected.id}`}
          student={selected}
          checkpoint={checkpoint}
          score={selected.scores.find((x) => x.checkpointId === checkpoint.id)!}
          canGrade={data.canGrade}
          queryKey={key}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function WorkSheet({
  base,
  student,
  checkpoint,
  score,
  canGrade,
  queryKey,
  onClose,
}: {
  base: string
  student: Student
  checkpoint: Sheet["checkpoints"][number]
  score: Score
  canGrade: boolean
  queryKey: unknown[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const project = score.project
  const [mark, setMark] = useState(
    project?.mark === null || project?.mark === undefined
      ? ""
      : String(project.mark)
  )
  const [feedback, setFeedback] = useState(project?.feedback ?? "")
  const done = () => {
    void client.invalidateQueries({ queryKey })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      api(`${base}/mark`, {
        method: "PUT",
        body: { mark: mark.trim() === "" ? null : Number(mark), feedback },
      }),
    onSuccess: done,
  })
  const reset = useMutation({
    mutationFn: () => api(`${base}/attempt`, { method: "DELETE" }),
    onSuccess: done,
  })
  const markValue = mark.trim() === "" ? null : Number(mark)
  const markOk =
    markValue === null ||
    (Number.isInteger(markValue) &&
      markValue >= 0 &&
      markValue <= checkpoint.max)
  const failure = save.error ?? reset.error
  return (
    <DetailSheet
      title={`${student.name}: ${checkpoint.title}`}
      description={`Out of ${checkpoint.max}`}
      onClose={onClose}
      testId="work-sheet"
    >
      <div className="grid gap-3">
        {failure && (
          <FormMessage message={{ text: failure.message, kind: "err" }} />
        )}
        {checkpoint.kind !== "project" && (
          <>
            <p className="text-body-sm">
              {score.state === "running"
                ? `In progress${score.sofar !== null ? `: ${score.sofar} so far` : ""}.`
                : `Finished: ${score.earned ?? 0} / ${checkpoint.max}.`}
            </p>
            {canGrade && (
              <div>
                <ConfirmButton
                  variant="outline"
                  title={`Let ${student.name} take ${checkpoint.title} again?`}
                  description="Their attempt and answers go, and they can start afresh."
                  confirmLabel="Reset attempt"
                  disabled={reset.isPending}
                  onConfirm={() => reset.mutate()}
                >
                  Reset attempt
                </ConfirmButton>
              </div>
            )}
          </>
        )}
        {project && (
          <>
            <div className="grid gap-1 text-body-sm">
              <div>
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline"
                >
                  {project.repoUrl.replace("https://github.com/", "")}
                </a>
                {project.commitSha && (
                  <span className="text-caption">
                    {" "}
                    at {project.commitSha.slice(0, 7)}
                  </span>
                )}
                {project.ref && (
                  <span className="text-caption"> ({project.ref})</span>
                )}
              </div>
              <div className="text-caption">
                Handed in {formatDate(String(project.submittedAt))}
              </div>
              {project.note && <Markdown text={project.note} />}
            </div>
            {canGrade ? (
              <>
                <Field
                  label={`Mark (out of ${checkpoint.max})`}
                  help="Empty takes the mark away."
                >
                  <TextInput
                    aria-label="Mark"
                    inputMode="numeric"
                    value={mark}
                    onChange={(e) => setMark(e.target.value)}
                  />
                </Field>
                <Field label="Feedback (markdown)">
                  <TextArea
                    aria-label="Feedback"
                    rows={6}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </Field>
                <div>
                  <Button
                    disabled={!markOk || save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Save mark
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-body-sm">
                {project.mark === null
                  ? "Not marked yet."
                  : `Mark: ${project.mark}`}
              </p>
            )}
          </>
        )}
      </div>
    </DetailSheet>
  )
}
