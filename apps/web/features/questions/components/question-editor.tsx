"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextArea, TextInput } from "@/components/form"
import { MarkdownEditor } from "@/components/markdown-editor"
import { SaveConflict } from "@/components/save-conflict"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { api, ApiRequestError } from "@/lib/api/client"

import type { QuestionInput } from "../schemas"

type Kind = QuestionInput["kind"]

export const KIND_LABEL: Record<Kind, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  short: "Short answer",
  written: "Written answer",
}

const KIND_HELP: Record<Kind, string> = {
  single: "One right option. Marked automatically.",
  multiple: "Students tick exactly the right options. Marked automatically.",
  short:
    "A word or a phrase. Marked automatically when it matches an accepted answer; anything else waits for the teacher.",
  written: "A few sentences or more. A teacher marks it. Not for contests or the daily challenge.",
}

interface Draft {
  title: string
  kind: Kind
  prompt: string
  options: { id: string; text: string }[]
  correct: string[]
  /** One per line. */
  accepted: string
  explanation: string
  points: string
  tags: string
  published: boolean
}

const BLANK: Draft = {
  title: "",
  kind: "single",
  prompt: "",
  options: [
    { id: "a", text: "" },
    { id: "b", text: "" },
  ],
  correct: [],
  accepted: "",
  explanation: "",
  points: "1",
  tags: "",
  published: true,
}

type Stored = Omit<QuestionInput, "expectedUpdatedAt"> & { id: string; updatedAt: string }

const toDraft = (q: Stored): Draft => ({
  ...q,
  options: q.options.length ? q.options : BLANK.options,
  accepted: q.accepted.join("\n"),
  points: String(q.points),
  tags: q.tags.join(", "),
})

function toBody(d: Draft) {
  const choice = d.kind === "single" || d.kind === "multiple"
  return {
    title: d.title,
    kind: d.kind,
    prompt: d.prompt,
    options: choice ? d.options : [],
    correct: choice ? d.correct : [],
    accepted:
      d.kind === "short"
        ? d.accepted
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    explanation: d.explanation,
    points: d.points.trim() === "" ? NaN : Number(d.points),
    tags: d.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    published: d.published,
  }
}

/** One question's fields. */
function QuestionFields({
  draft,
  onChange,
}: {
  draft: Draft
  onChange: (change: Partial<Draft>) => void
}) {
  const choice = draft.kind === "single" || draft.kind === "multiple"
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 min-[901px]:grid-cols-[2fr_1fr_120px]">
        <Field label="Title" help="A short name for lists and pickers.">
          <TextInput
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Field>
        <Field label="Type">
          <SelectInput
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as Kind
              onChange({ kind, correct: kind === "single" ? draft.correct.slice(0, 1) : draft.correct })
            }}
          >
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Points">
          <TextInput
            type="number"
            min={1}
            value={draft.points}
            onChange={(event) => onChange({ points: event.target.value })}
          />
        </Field>
      </div>
      <p className="text-caption">{KIND_HELP[draft.kind]}</p>
      <Field label="Question">
        <MarkdownEditor
          value={draft.prompt}
          onChange={(prompt) => onChange({ prompt })}
          label="Question"
          rows={6}
        />
      </Field>
      {choice && (
        <div className="grid gap-1.5">
          <div className="text-caption font-medium text-ink">
            Options: tick the right {draft.kind === "single" ? "one" : "ones"}
          </div>
          {draft.options.map((o, oi) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox
                aria-label={`Option ${o.id.toUpperCase()} is right`}
                checked={draft.correct.includes(o.id)}
                onCheckedChange={(checked) =>
                  onChange({
                    correct: checked
                      ? draft.kind === "single"
                        ? [o.id]
                        : [...draft.correct, o.id]
                      : draft.correct.filter((c) => c !== o.id),
                  })
                }
              />
              <span className="w-4 text-caption">{o.id.toUpperCase()}</span>
              <TextInput
                aria-label={`Option ${o.id.toUpperCase()}`}
                className="flex-1 py-1"
                value={o.text}
                onChange={(event) =>
                  onChange({
                    options: draft.options.map((x, xi) =>
                      xi === oi ? { ...x, text: event.target.value } : x
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove option ${o.id.toUpperCase()}`}
                disabled={draft.options.length <= 2}
                onClick={() =>
                  onChange({
                    options: draft.options.filter((x) => x.id !== o.id),
                    correct: draft.correct.filter((c) => c !== o.id),
                  })
                }
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="justify-self-start"
            disabled={draft.options.length >= 10}
            onClick={() => {
              const used = new Set(draft.options.map((o) => o.id))
              const id = "abcdefghij".split("").find((c) => !used.has(c)) ?? "z"
              onChange({ options: [...draft.options, { id, text: "" }] })
            }}
          >
            Add option
          </Button>
        </div>
      )}
      {draft.kind === "short" && (
        <Field
          label="Accepted answers (one per line)"
          help="Case, extra spaces and a final full stop don't matter. Empty: a teacher marks every answer."
        >
          <TextArea
            aria-label="Accepted answers"
            rows={3}
            value={draft.accepted}
            onChange={(event) => onChange({ accepted: event.target.value })}
          />
        </Field>
      )}
      <Field label="Explanation (optional)" help="Shown with the right answer once results are out.">
        <TextArea
          aria-label="Explanation"
          rows={3}
          value={draft.explanation}
          onChange={(event) => onChange({ explanation: event.target.value })}
        />
      </Field>
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <Field label="Tags (comma separated)">
          <TextInput
            value={draft.tags}
            onChange={(event) => onChange({ tags: event.target.value })}
          />
        </Field>
        <label className="inline-flex items-center gap-2 self-end pb-2 text-ink">
          <Checkbox
            checked={draft.published}
            onCheckedChange={(published) => onChange({ published })}
          />
          Ready to use (a draft is only for its writers)
        </label>
      </div>
    </div>
  )
}

/** The bank's page for one question: new (id null) or editing. */
export function QuestionEditorPage({ id }: { id: string | null }) {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("question", id),
    queryFn: () => api<Stored>(owner.api(`/questions/${id}`)),
    enabled: id !== null,
  })
  if (id && !data) return <Loading error={error} />
  return <QuestionEditor key={id ?? "new"} id={id} stored={data ?? null} />
}

function QuestionEditor({
  id,
  stored,
  onSaved,
}: {
  id: string | null
  stored: Stored | null
  /** In a dialog: hand the new question back instead of opening its page. */
  onSaved?: (q: { id: string; title: string; points: number }) => void
}) {
  const owner = useOwner()
  const router = useRouter()
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft>(stored ? toDraft(stored) : BLANK)
  const [version, setVersion] = useState(stored?.updatedAt)
  const [conflict, setConflict] = useState(false)
  const overwrite = useRef(false)
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const change = (c: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...c }))
    setMessage(null)
  }
  const save = useMutation({
    mutationFn: () => {
      const expectedUpdatedAt = overwrite.current ? undefined : version
      overwrite.current = false
      const body = { ...toBody(draft), expectedUpdatedAt }
      return id
        ? api<Stored>(owner.api(`/questions/${id}`), { method: "PUT", body })
        : api<Stored>(owner.api("/questions"), { body })
    },
    onSuccess: (saved) => {
      setVersion(saved.updatedAt)
      setConflict(false)
      setMessage({ text: "Saved.", kind: "ok" })
      void client.invalidateQueries({ queryKey: ["admin"] })
      if (onSaved) onSaved({ id: saved.id, title: saved.title, points: saved.points })
      else if (!id) router.push(owner.page(`/questions/${saved.id}`))
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === "edited_elsewhere") setConflict(true)
      setMessage({ text: e.message, kind: "err" })
    },
  })
  const remove = useMutation({
    mutationFn: () => api(owner.api(`/questions/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin"] })
      router.push(owner.page("/questions"))
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  return (
    <>
      {!onSaved && <PageTitle>{id ? "Edit question" : "New question"}</PageTitle>}
      <div data-testid="question-editor">
      <Card className="grid gap-4">
        <QuestionFields draft={draft} onChange={change} />
        {conflict && (
          <SaveConflict
            onKeepMine={() => {
              overwrite.current = true
              save.mutate()
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3.5">
          <span className="min-w-45 flex-1">
            <FormMessage message={message} />
          </span>
          {id && !onSaved && (
            <ConfirmButton
              variant="destructive"
              title={`Delete ${draft.title || "this question"}?`}
              description="It's removed from the bank. Assignments and contests that use it must drop it first. This can't be undone."
              confirmLabel="Delete question"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save question
          </Button>
        </div>
      </Card>
      </div>
    </>
  )
}

/** Writing a question without leaving an assignment or contest form. */
export function NewQuestionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (q: { id: string; title: string; points: number }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Write a question</DialogTitle>
          <DialogDescription>
            It&apos;s saved in your question bank, so you can use it again elsewhere.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <QuestionEditor
            id={null}
            stored={null}
            onSaved={(q) => {
              onCreated(q)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
