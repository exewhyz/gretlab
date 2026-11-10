"use client"

import { GithubLogoIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Loading } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

/*
 * Projects: written in the assignment form, handed in as GitHub repositories on the
 * assignment page, marked from the gradebook.
 */

export interface ProjectDraft {
  key: string
  id?: string
  title: string
  instructions: string
  points: string
}

let nextKey = 0
export const projectKey = () => `p${nextKey++}`

/** The assignment form's Projects section: a compact list, each edited in a dialog. */
export function ProjectsEditor({
  projects,
  onChange,
  error,
}: {
  projects: ProjectDraft[]
  onChange: (projects: ProjectDraft[]) => void
  error?: string
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const move = (index: number, by: number) => {
    const next = [...projects]
    const [p] = next.splice(index, 1)
    next.splice(index + by, 0, p!)
    onChange(next)
  }
  return (
    <div className="grid gap-2 rounded-md border border-hairline p-3" data-testid="projects-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-ink">Projects ({projects.length})</div>
          <p className="text-caption">
            Handed in as a GitHub repository, pinned to its commit at hand-in, and marked by you.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          Add a project
        </Button>
      </div>
      {projects.length > 0 && (
        <ol className="grid gap-1">
          {projects.map((p, index) => (
            <li key={p.key} className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted">
              <span className="w-6 text-caption tabular-nums">P{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{p.title}</span>
              <span className="text-xs tabular-nums">{p.points} pts</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${p.title} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${p.title} down`}
                disabled={index === projects.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setEditing(index)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${p.title}`}
                onClick={() => onChange(projects.filter((_, i) => i !== index))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="text-caption text-destructive">{error}</p>}
      {editing !== null && (
        <ProjectDialog
          project={editing === "new" ? null : projects[editing]!}
          onCancel={() => setEditing(null)}
          onSave={(p) => {
            onChange(editing === "new" ? [...projects, p] : projects.map((x, i) => (i === editing ? p : x)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ProjectDialog({
  project,
  onCancel,
  onSave,
}: {
  project: ProjectDraft | null
  onCancel: () => void
  onSave: (p: ProjectDraft) => void
}) {
  const [title, setTitle] = useState(project?.title ?? "")
  const [points, setPoints] = useState(project?.points ?? "20")
  const [instructions, setInstructions] = useState(project?.instructions ?? "")
  const pointsOk = /^\d+$/.test(points) && Number(points) >= 1 && Number(points) <= 1000
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl" data-testid="project-dialog">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>Changes apply when you save the assignment.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Title">
            <TextInput aria-label="Project title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Points">
            <TextInput aria-label="Project points" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
          </Field>
        </div>
        <Field label="What to build, and how it's marked (markdown)">
          <TextArea
            rows={6}
            aria-label="Project instructions"
            placeholder={"Build a command-line library manager.\n\n- Add, lend and return books\n- Tests for each command\n- A README with how to run it"}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !pointsOk}
            onClick={() =>
              onSave({ key: project?.key ?? projectKey(), id: project?.id, title: title.trim(), instructions, points })
            }
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface StudentProject {
  id: string
  title: string
  instructions: string
  points: number
  submission: {
    repoUrl: string
    ref: string | null
    commitSha: string | null
    note: string
    submittedAt: string
    late: boolean
    mark: number | null
    feedback: string
  } | null
}

const atCommit = (s: { repoUrl: string; commitSha: string | null; ref: string | null }) =>
  s.commitSha ? `${s.repoUrl}/tree/${s.commitSha}` : s.ref ? `${s.repoUrl}/tree/${s.ref}` : s.repoUrl

/** The assignment page's projects: instructions, handing in, and the mark once out. */
export function StudentProjects({
  slug,
  projects,
  open,
}: {
  slug: string
  projects: StudentProject[]
  /** Whether handing in is still possible (open, or late work allowed). */
  open: boolean
}) {
  if (projects.length === 0) return null
  return (
    <section className="grid gap-3" data-testid="student-projects">
      <h2 className="text-display-sm text-ink">Projects</h2>
      {projects.map((p, index) => (
        <ProjectCard key={p.id} slug={slug} project={p} number={index + 1} open={open} />
      ))}
    </section>
  )
}

function ProjectCard({
  slug,
  project: p,
  number,
  open,
}: {
  slug: string
  project: StudentProject
  number: number
  open: boolean
}) {
  const client = useQueryClient()
  const [url, setUrl] = useState(p.submission ? (p.submission.ref ? `${p.submission.repoUrl}/tree/${p.submission.ref}` : p.submission.repoUrl) : "")
  const [note, setNote] = useState(p.submission?.note ?? "")
  const hand = useMutation({
    mutationFn: () => api(`/assignments/${slug}/projects/${p.id}`, { body: { url, note } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["assignment", slug] }),
  })
  const s = p.submission
  return (
    <article className="grid gap-2 rounded-lg border border-hairline bg-card p-4" data-testid="student-project">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">
          P{number} · {p.title}
        </h3>
        <span className="text-caption tabular-nums">
          {s?.mark != null ? `${s.mark} / ${p.points}` : `${p.points} points`}
        </span>
      </div>
      {p.instructions && <Markdown text={p.instructions} />}
      {s && (
        <div className="grid gap-1 rounded-md bg-canvas-soft p-2 text-body-sm" data-testid="project-submission">
          <a href={atCommit(s)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-ink underline-offset-2 hover:underline">
            <GithubLogoIcon className="size-4" />
            {s.repoUrl.replace("https://github.com/", "")}
            {s.ref && ` · ${s.ref}`}
            {s.commitSha && <span className="font-mono text-xs text-body">@{s.commitSha.slice(0, 7)}</span>}
          </a>
          <span className="text-caption">
            Handed in {formatDateTime(s.submittedAt)}
            {s.late && " · late"}
            {!s.commitSha && " · couldn't pin a commit (GitHub didn't answer); your teacher sees the branch as it is"}
          </span>
          {s.feedback && (
            <div className="border-t border-hairline pt-1">
              <Markdown text={s.feedback} />
            </div>
          )}
        </div>
      )}
      {open ? (
        <div className="grid gap-2">
          <Field label="Repository link" help="Your GitHub repository, or a branch (…/tree/main) or commit (…/commit/abc123) in it. It must be public, or shared with your teacher.">
            <TextInput
              aria-label={`Repository for ${p.title}`}
              placeholder="https://github.com/you/project"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label="Note for your teacher (optional)">
            <TextInput aria-label={`Note for ${p.title}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {hand.error && <FormMessage message={{ text: hand.error.message, kind: "err" }} />}
          <Button className="justify-self-start" size="sm" disabled={!url.trim() || hand.isPending} onClick={() => hand.mutate()}>
            {s ? "Hand in again" : "Hand in"}
          </Button>
          {s && <p className="text-caption">Handing in again replaces this and its mark.</p>}
        </div>
      ) : (
        !s && <p className="text-caption">Not handed in, and the due time has passed.</p>
      )}
    </article>
  )
}

/** A student's projects in the gradebook: open the code at its commit, mark it, comment. */
export function ProjectMarking({
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
  const key = owner.key("assignment", assignmentId, "projects", student)
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{
        student: { name: string | null; email: string }
        holdFeedback: boolean
        projects: (Omit<StudentProject, "instructions">)[]
      }>(`${owner.api(`/assignments/${assignmentId}/projects`)}?student=${encodeURIComponent(student)}`),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" data-testid="project-marking">
        <DialogHeader>
          <DialogTitle>Projects: {data?.student.name ?? student}</DialogTitle>
          <DialogDescription>
            {data?.holdFeedback
              ? "Results are held: they see marks and feedback when you release them."
              : "They see the mark and feedback as soon as you save."}
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading error={error} />
        ) : (
          data.projects.map((p) => (
            <MarkOne
              key={p.id}
              project={p}
              onSave={async (mark, feedback) => {
                await api(owner.api(`/assignments/${assignmentId}/projects`), {
                  method: "PUT",
                  body: { student, projectId: p.id, mark, feedback },
                })
                void client.invalidateQueries({ queryKey: key })
                void client.invalidateQueries({ queryKey: owner.key("assignment", assignmentId, "gradebook") })
                void client.invalidateQueries({ queryKey: ["admin"] })
              }}
            />
          ))
        )}
      </DialogContent>
    </Dialog>
  )
}

function MarkOne({
  project: p,
  onSave,
}: {
  project: Omit<StudentProject, "instructions">
  onSave: (mark: number | null, feedback: string) => Promise<void>
}) {
  const s = p.submission
  const [mark, setMark] = useState(s?.mark == null ? "" : String(s.mark))
  const [feedback, setFeedback] = useState(s?.feedback ?? "")
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const valid = mark === "" || (/^\d+$/.test(mark) && Number(mark) <= p.points)
  return (
    <section className="grid gap-2 border-t border-hairline pt-3" data-testid="mark-project">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">{p.title}</h3>
        <span className="text-caption">out of {p.points}</span>
      </div>
      {!s ? (
        <p className="text-body-sm text-body">Not handed in.</p>
      ) : (
        <>
          <a href={atCommit(s)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-body-sm text-ink underline underline-offset-2">
            <GithubLogoIcon className="size-4" />
            {s.repoUrl.replace("https://github.com/", "")}
            {s.commitSha ? ` @${s.commitSha.slice(0, 7)}` : s.ref ? ` · ${s.ref}` : ""}
          </a>
          <span className="text-caption">
            Handed in {formatDateTime(s.submittedAt)}
            {s.late && " · late"}
            {s.note && ` · “${s.note}”`}
          </span>
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <Field label="Mark">
              <TextInput aria-label={`Mark for ${p.title}`} inputMode="numeric" value={mark} onChange={(e) => setMark(e.target.value)} />
            </Field>
            <Field label="Feedback (markdown)">
              <TextArea rows={3} aria-label={`Feedback for ${p.title}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </Field>
          </div>
          {message && <FormMessage message={message} />}
          <Button
            size="sm"
            className="justify-self-start"
            disabled={!valid}
            onClick={async () => {
              try {
                await onSave(mark === "" ? null : Number(mark), feedback)
                setMessage({ text: "Saved.", kind: "ok" })
              } catch (e) {
                setMessage({ text: (e as Error).message, kind: "err" })
              }
            }}
          >
            Save mark
          </Button>
        </>
      )}
    </section>
  )
}
