"use client"

import { HandedInRepo } from "@/features/projects/components/handed-in"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Loading, Stats } from "@/features/admin/components/shell"
import {
  QuizSection,
  type QuizQuestionView,
} from "@/features/assignments/components/quiz"
import { api } from "@/lib/api/client"
import { formatDate } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { checkpointView } from "@/features/courses/checkpoints"

/*
 * A module's quiz, lab or project, as a student takes it: instructions, then Start (one
 * attempt, timed when it has a limit), the questions or problems while it runs, and the
 * score once it's over. A project is handed in as a GitHub link and marked by a teacher.
 * Teachers see the same page with every question and its answer, and a link to grades.
 */

type View = ApiResult<typeof checkpointView>

export const KIND_NAME = {
  quiz: "Quiz",
  lab: "Lab",
  project: "Project",
} as const

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`

/** Time left, by the server's clock (the device's may be off), ticking each second. */
function useRemaining(
  closesAt: string | null | undefined,
  serverNow: string,
  onOut: () => void
) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now())
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!closesAt) return setLeft(null)
    const end = new Date(closesAt).getTime()
    let fired = false
    const tick = () => {
      const ms = end - (Date.now() + offset)
      setLeft(Math.max(0, ms))
      if (ms <= 0 && !fired) {
        fired = true
        onOut()
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
    // onOut only refreshes the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closesAt, offset])
  return left
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

export function CheckpointPage({
  slug,
  groupId,
  courseId,
  checkpointId,
}: {
  slug: string
  groupId: string
  courseId: string
  checkpointId: string
}) {
  const pages = orgPages(slug)
  const base = `/orgs/${slug}/classes/${groupId}/courses/${courseId}/checkpoints/${checkpointId}`
  const key = ["org", slug, "class", groupId, "checkpoint", checkpointId]
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<View>(base),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({
      queryKey: ["org", slug, "class", groupId, "courses"],
    })
  }
  const start = useMutation({
    mutationFn: () => api(`${base}/start`, { body: {} }),
    onSuccess: refresh,
  })
  const finish = useMutation({
    mutationFn: () => api(`${base}/finish`, { body: {} }),
    onSuccess: refresh,
  })
  const left = useRemaining(
    data?.state === "running"
      ? (data.attempt?.closesAt as string | null | undefined)
      : null,
    (data?.now as string | undefined) ?? new Date().toISOString(),
    refresh
  )
  if (!data) return <Loading error={error} />
  const c = data.checkpoint
  const running = data.state === "running"
  const over = data.state === "finished"
  const failure = start.error ?? finish.error

  return (
    <div className="grid gap-4" data-testid="checkpoint-page">
      <nav className="flex flex-wrap gap-1 text-caption">
        <Link href={pages.cls(groupId, "course")} className="hover:text-ink">
          {data.course.title}
        </Link>
        <span aria-hidden>›</span>
        <span>{data.module.title}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{KIND_NAME[c.kind]}</Badge>
            <h1 className="text-display-sm text-ink">{c.title}</h1>
          </div>
          <p className="text-caption">
            {c.kind === "quiz" &&
              `${c.count} ${c.count === 1 ? "question" : "questions"} · `}
            {c.kind === "lab" &&
              `${c.count} ${c.count === 1 ? "problem" : "problems"} · `}
            {c.kind !== "project" &&
              (c.timeLimit ? `${minutes(c.timeLimit)} · ` : "No time limit · ")}
            Out of {c.max}
            {c.kind !== "project" && " · One attempt"}
          </p>
        </div>
        {data.teacher && (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={pages.courseGrades(groupId, courseId)} />}
          >
            Grades
          </Button>
        )}
      </div>

      {data.teacher && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-body-sm"
          data-testid="teacher-note"
        >
          You&apos;re seeing this as a teacher: every question with its answer.
          Students see the questions once they start, and the answers once their
          attempt is over.
        </p>
      )}

      {c.instructions && (
        <div className="rounded-lg border border-hairline bg-card p-4">
          <Markdown text={c.instructions} />
        </div>
      )}

      {failure && (
        <FormMessage message={{ text: failure.message, kind: "err" }} />
      )}

      {c.kind !== "project" && !data.teacher && (
        <Stats
          items={[
            {
              label: "Status",
              value: running
                ? "In progress"
                : over
                  ? "Finished"
                  : "Not started",
            },
            ...(running && left !== null
              ? [
                  {
                    label: "Time left",
                    value: <span data-testid="time-left">{clock(left)}</span>,
                    tone: left < 60_000 ? ("bad" as const) : undefined,
                  },
                ]
              : []),
            ...(over
              ? [
                  {
                    label: "Score",
                    value: (
                      <span data-testid="checkpoint-score">{`${data.earned ?? 0} / ${c.max}`}</span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {c.kind !== "project" &&
        !data.teacher &&
        data.state === "not_started" && (
          <div className="grid justify-items-start gap-2">
            <p className="text-body-sm">
              You get one attempt.{" "}
              {c.timeLimit
                ? `The ${minutes(c.timeLimit)} start when you press Start and keep running if you leave the page.`
                : "There's no time limit: it ends when you press Finish."}
              {c.kind === "lab" &&
                " Solve the problems on their own pages; graded submissions you make during the attempt count."}
            </p>
            <Button disabled={start.isPending} onClick={() => start.mutate()}>
              Start {KIND_NAME[c.kind].toLowerCase()}
            </Button>
          </div>
        )}

      {data.quiz && (
        <QuizSection
          slug=""
          questions={data.quiz as QuizQuestionView[]}
          open={running && !data.teacher}
          resultsOut={over || data.teacher}
          held={false}
          endpoint={`${base}/answers`}
          queryKey={key}
          closedText="Answers show here once your attempt is over."
        />
      )}

      {data.lab && (
        <section className="grid gap-2" data-testid="lab-problems">
          <h2 className="text-title-sm text-ink">Problems</h2>
          <ol className="grid gap-1.5">
            {data.lab.map((p, i) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2"
              >
                <span className="w-6 text-caption tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 font-medium text-ink">
                  {p.title}
                </span>
                <span className="text-caption capitalize">{p.level}</span>
                <span className="text-caption tabular-nums">
                  {p.points} pts
                </span>
                {p.href && (running || data.teacher) && (
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={p.href} target="_blank" />}
                  >
                    Solve
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {running && (
            <p className="text-caption">
              Problems open in a new tab. Press Submit there: Run doesn&apos;t
              count.
            </p>
          )}
        </section>
      )}

      {running && !data.teacher && (
        <div>
          <ConfirmButton
            tone="default"
            title={`Finish ${c.title}?`}
            description={
              c.kind === "quiz"
                ? "Your saved answers are marked and you can't change them after this."
                : "Submissions after this don't count toward the lab."
            }
            confirmLabel="Finish"
            disabled={finish.isPending}
            onConfirm={() => finish.mutate()}
          >
            Finish {KIND_NAME[c.kind].toLowerCase()}
          </ConfirmButton>
        </div>
      )}

      {c.kind === "project" && !data.teacher && (
        <ProjectHandIn
          base={base}
          project={data.project}
          max={c.max}
          onDone={refresh}
        />
      )}
    </div>
  )
}

function ProjectHandIn({
  base,
  project,
  max,
  onDone,
}: {
  base: string
  project: View["project"]
  max: number
  onDone: () => void
}) {
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "")
  const [note, setNote] = useState(project?.note ?? "")
  const handIn = useMutation({
    mutationFn: () =>
      api<{ pinned: boolean }>(`${base}/project`, { body: { repoUrl, note } }),
    onSuccess: onDone,
  })
  return (
    <section className="grid gap-3" data-testid="project-hand-in">
      {project && (
        <div className="grid gap-1 rounded-lg border border-hairline bg-card p-4 text-body-sm">
          <HandedInRepo submission={project} />
          <div data-testid="project-mark">
            {project.mark === null
              ? "Waiting to be marked."
              : `Mark: ${project.mark} / ${max}`}
          </div>
          {project.feedback && <Markdown text={project.feedback} />}
        </div>
      )}
      <Field
        label="Your GitHub repository"
        help="A link like https://github.com/you/project; add /tree/branch for a branch."
      >
        <TextInput
          aria-label="Repository link"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
      </Field>
      <Field label="A note for your teacher (optional)">
        <TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {handIn.error && (
        <FormMessage message={{ text: handIn.error.message, kind: "err" }} />
      )}
      <div>
        <Button
          disabled={!repoUrl.trim() || handIn.isPending}
          onClick={() => handIn.mutate()}
        >
          {project ? "Hand in again" : "Hand in"}
        </Button>
        {project && (
          <p className="mt-1 text-caption">
            Handing in again replaces your work and its mark.
          </p>
        )}
      </div>
    </section>
  )
}
