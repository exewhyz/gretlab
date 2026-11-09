"use client"

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

import { Field, FormMessage, SelectInput, TextArea } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { Card, Loading, Table } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { CommentedCode } from "@/features/feedback/components/commented-code"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

/*
 * Peer review: the teacher's panel in the gradebook (hand out reviews, read them, hide
 * one), and the student's on the assignment page (reviews to write, reviews received).
 */

interface Settings {
  reviews: number
  anonymous: boolean
  dueAt: string | null
}

interface Criterion {
  id: string
  label: string
  points: number
}

interface LineNote {
  path: string
  line: number
  body: string
}

export function PeerReviewPanel({ id }: { id: string }) {
  const owner = useOwner()
  const client = useQueryClient()
  const key = owner.key("assignment", id, "peer")
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{
        settings: Settings | null
        started: boolean
        canStart: boolean
        dueAt: string
        reviews: {
          id: string
          problem: string
          reviewer: string
          author: string
          submitted: boolean
          score: number | null
          outOf: number
          comment: string
          lineComments: number
          hidden: boolean
        }[]
      }>(owner.api(`/assignments/${id}/peer`)),
  })
  const start = useMutation({
    mutationFn: () =>
      api<{ reviews: number; reviewers: number }>(
        owner.api(`/assignments/${id}/peer`),
        { body: {} }
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const hide = useMutation({
    mutationFn: ({ reviewId, hidden }: { reviewId: string; hidden: boolean }) =>
      api(owner.api(`/assignments/${id}/peer/${reviewId}`), {
        method: "PATCH",
        body: { hidden },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const [open, setOpen] = useState<string | null>(null)
  if (!data) return <Loading error={error} />
  if (!data.settings) return null
  const done = data.reviews.filter((r) => r.submitted).length
  const shown = data.reviews.find((r) => r.id === open)
  return (
    <div data-testid="peer-panel">
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-ink">Peer review</h2>
            <p className="text-caption">
              {data.started
                ? `${done} of ${data.reviews.length} reviews written${data.settings.dueAt ? `, due ${formatDateTime(data.settings.dueAt)}` : ""}.`
                : data.canStart
                  ? `Each student who submitted reviews ${data.settings.reviews} classmates per problem${data.settings.anonymous ? ", anonymously" : ""}.`
                  : `Starts after the due time (${formatDateTime(data.dueAt)}), when the work is final.`}
            </p>
          </div>
          {!data.started && (
            <Button
              size="sm"
              disabled={!data.canStart || start.isPending}
              onClick={() => start.mutate()}
            >
              Start peer review
            </Button>
          )}
        </div>
        {start.data && (
          <FormMessage
            message={{
              text:
                start.data.reviews === 0
                  ? "Nobody submitted work to review."
                  : `Handed out ${start.data.reviews} reviews to ${start.data.reviewers} students.`,
              kind: "ok",
            }}
          />
        )}
        {(start.error ?? hide.error) && (
          <FormMessage
            message={{
              text: (start.error ?? hide.error)!.message,
              kind: "err",
            }}
          />
        )}
        {data.reviews.length > 0 && (
          <Table headers={["Problem", "Reviewer", "Of", "Score", "Status", ""]}>
            {data.reviews.map((r) => (
              <tr
                key={r.id}
                data-testid="peer-row"
                className={r.hidden ? "opacity-60" : undefined}
              >
                <td>{r.problem}</td>
                <td>{r.reviewer}</td>
                <td>{r.author}</td>
                <td className="tabular-nums">
                  {r.score === null ? "—" : `${r.score} / ${r.outOf}`}
                </td>
                <td className="text-caption">
                  {r.submitted
                    ? r.hidden
                      ? "Hidden from author"
                      : "Written"
                    : "Not yet"}
                </td>
                <td className="text-right whitespace-nowrap">
                  {r.submitted && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setOpen(r.id)}
                    >
                      Read
                    </Button>
                  )}
                  {r.submitted && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        hide.mutate({ reviewId: r.id, hidden: !r.hidden })
                      }
                    >
                      {r.hidden ? "Show" : "Hide"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {shown && (
          <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {shown.reviewer} on {shown.author}&apos;s {shown.problem}
                </DialogTitle>
                <DialogDescription>
                  {shown.score} / {shown.outOf} · {shown.lineComments} line
                  comments
                </DialogDescription>
              </DialogHeader>
              <Markdown text={shown.comment || "_No summary._"} />
            </DialogContent>
          </Dialog>
        )}
      </Card>
    </div>
  )
}

interface Mine {
  settings: Settings | null
  open: boolean
  toDo: { id: string; problem: string; label: string; submitted: boolean }[]
  received: {
    id: string
    problem: string
    reviewer: string
    criteria: Criterion[]
    scores: Record<string, number>
    comment: string
    lineComments: LineNote[]
  }[]
}

export function StudentPeerReview({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ["assignment", slug, "peer"],
    queryFn: () => api<Mine>(`/assignments/${slug}/peer`),
  })
  const [writing, setWriting] = useState<string | null>(null)
  if (!data?.settings || (data.toDo.length === 0 && data.received.length === 0))
    return null
  return (
    <section
      className="grid gap-3 rounded-lg border border-hairline bg-card p-4"
      data-testid="student-peer"
    >
      <div>
        <h2 className="font-semibold text-ink">Peer review</h2>
        <p className="text-caption">
          {data.open
            ? data.settings.dueAt
              ? `Review your classmates' work by ${formatDateTime(data.settings.dueAt)}. It doesn't change anyone's marks.`
              : "Review your classmates' work. It doesn't change anyone's marks."
            : "Reviews are closed."}
        </p>
      </div>
      {data.toDo.length > 0 && (
        <ul className="grid gap-1">
          {data.toDo.map((t) => (
            <li
              key={t.id}
              data-testid="review-task"
              className="flex flex-wrap items-center gap-2 text-body-sm"
            >
              <span className="min-w-48 text-ink">
                {t.problem} · {t.label}
              </span>
              <span className="text-caption">
                {t.submitted ? "Handed in" : "To do"}
              </span>
              <Button
                size="xs"
                variant={t.submitted ? "ghost" : "outline"}
                onClick={() => setWriting(t.id)}
              >
                {t.submitted ? (data.open ? "Edit" : "Read") : "Review"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.received.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-body-sm font-semibold text-ink">
            Reviews of your work
          </h3>
          {data.received.map((r) => (
            <article
              key={r.id}
              data-testid="received-review"
              className="grid gap-1 rounded-md border border-hairline p-3"
            >
              <div className="text-caption">
                {r.problem} · {r.reviewer}
              </div>
              <ul className="flex flex-wrap gap-x-4 text-body-sm">
                {r.criteria.map((c) => (
                  <li key={c.id}>
                    {c.label}:{" "}
                    <span className="tabular-nums">
                      {r.scores[c.id] ?? "—"} / {c.points}
                    </span>
                  </li>
                ))}
              </ul>
              <Markdown text={r.comment} />
              {r.lineComments.length > 0 && (
                <ul className="grid gap-0.5 text-caption">
                  {r.lineComments.map((c, i) => (
                    <li key={i}>
                      {c.path}, line {c.line}: {c.body}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
      {writing && (
        <ReviewDialog
          slug={slug}
          reviewId={writing}
          onDone={() => setWriting(null)}
        />
      )}
    </section>
  )
}

function ReviewDialog({
  slug,
  reviewId,
  onDone,
}: {
  slug: string
  reviewId: string
  onDone: () => void
}) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["assignment", slug, "peer", reviewId],
    queryFn: () =>
      api<{
        problem: { title: string }
        author: string
        language: string | null
        files: { path: string; content: string }[]
        criteria: Criterion[]
        scores: Record<string, number>
        comment: string
        lineComments: LineNote[]
        submittedAt: string | null
        open: boolean
      }>(`/assignments/${slug}/peer/${reviewId}`),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent
        className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl"
        data-testid="review-dialog"
      >
        {!data ? (
          <Loading error={error} />
        ) : (
          <ReviewForm
            key={reviewId}
            data={data}
            onSave={async (body) => {
              await api(`/assignments/${slug}/peer/${reviewId}`, {
                method: "PUT",
                body,
              })
              void client.invalidateQueries({
                queryKey: ["assignment", slug, "peer"],
              })
            }}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReviewForm({
  data,
  onSave,
  onDone,
}: {
  data: {
    problem: { title: string }
    author: string
    files: { path: string; content: string }[]
    criteria: Criterion[]
    scores: Record<string, number>
    comment: string
    lineComments: LineNote[]
    submittedAt: string | null
    open: boolean
  }
  onSave: (body: {
    scores: Record<string, number>
    comment: string
    lineComments: LineNote[]
    submit: boolean
  }) => Promise<void>
  onDone: () => void
}) {
  const [scores, setScores] = useState(data.scores)
  const [comment, setComment] = useState(data.comment)
  const [notes, setNotes] = useState(data.lineComments)
  const [file, setFile] = useState(data.files[0]?.path ?? "")
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const current = data.files.find((f) => f.path === file)
  const save = async (submit: boolean) => {
    setBusy(true)
    try {
      await onSave({ scores, comment, lineComments: notes, submit })
      if (submit) onDone()
      else setMessage({ text: "Draft saved.", kind: "ok" })
    } catch (e) {
      setMessage({ text: (e as Error).message, kind: "err" })
    } finally {
      setBusy(false)
    }
  }
  const editable = data.open
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Review: {data.problem.title} by {data.author}
        </DialogTitle>
        <DialogDescription>
          Read their final code, comment on lines (select a line number), score
          each criterion and sum up what works and what to improve. Be kind and
          specific.
        </DialogDescription>
      </DialogHeader>
      {data.files.length > 1 && (
        <SelectInput
          aria-label="File"
          className="w-60"
          value={file}
          onChange={(e) => setFile(e.target.value)}
        >
          {data.files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </SelectInput>
      )}
      {current ? (
        <CommentedCode
          content={current.content}
          comments={notes
            .map((n, i) => ({
              ...n,
              id: String(i),
              createdAt: "",
              author: "Your comment",
            }))
            .filter((n) => n.path === current.path)}
          onAdd={
            editable
              ? async (line, body) =>
                  setNotes([...notes, { path: current.path, line, body }])
              : undefined
          }
          onDelete={
            editable
              ? (id) => setNotes(notes.filter((_, i) => String(i) !== id))
              : undefined
          }
        />
      ) : (
        <p className="text-body-sm">Their code isn&apos;t available.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {data.criteria.map((c) => (
          <Field key={c.id} label={`${c.label} (out of ${c.points})`}>
            <SelectInput
              aria-label={c.label}
              disabled={!editable}
              value={scores[c.id] === undefined ? "" : String(scores[c.id])}
              onChange={(e) =>
                setScores((all) => {
                  const next = { ...all }
                  if (e.target.value === "") delete next[c.id]
                  else next[c.id] = Number(e.target.value)
                  return next
                })
              }
            >
              <option value="">Choose…</option>
              {Array.from({ length: c.points + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectInput>
          </Field>
        ))}
      </div>
      <Field label="Summary">
        <TextArea
          rows={4}
          aria-label="Summary"
          disabled={!editable}
          placeholder="What works well, and one or two things to improve."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      {message && <FormMessage message={message} />}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Close
        </Button>
        {editable && (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => save(false)}
            >
              Save draft
            </Button>
            <Button disabled={busy} onClick={() => save(true)}>
              {data.submittedAt ? "Save changes" : "Hand in review"}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}
