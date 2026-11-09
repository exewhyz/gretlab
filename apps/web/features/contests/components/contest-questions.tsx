"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { api } from "@/lib/api/client"

export interface ContestQuestion {
  id: string
  label: string
  title: string
  kind: "single" | "multiple" | "short" | "written"
  prompt: string
  options: { id: string; text: string }[]
  points: number
  answer: { value: string[] | string; correct: boolean } | null
  solution: { correct: string[]; accepted: string[]; explanation: string } | null
}

/** A contest's questions: one answer each, marked at once; right answers after it ends. */
export function ContestQuestions({
  slug,
  questions,
  canAnswer,
}: {
  slug: string
  questions: ContestQuestion[]
  canAnswer: boolean
}) {
  if (questions.length === 0) return null
  return (
    <section className="mt-6 grid gap-3" data-testid="contest-questions">
      <h2 className="text-title-sm text-ink">Questions</h2>
      <p className="text-caption">
        One answer each, marked at once. A right answer counts like a solved problem.
      </p>
      {questions.map((q) => (
        <QuestionCard key={q.id} slug={slug} q={q} canAnswer={canAnswer} />
      ))}
    </section>
  )
}

function QuestionCard({
  slug,
  q,
  canAnswer,
}: {
  slug: string
  q: ContestQuestion
  canAnswer: boolean
}) {
  const client = useQueryClient()
  const [value, setValue] = useState<string[] | string>(
    q.answer?.value ?? (q.kind === "short" ? "" : [])
  )
  const [error, setError] = useState<string | null>(null)
  const answer = useMutation({
    mutationFn: () =>
      api<{ correct: boolean }>(`/contests/${slug}/questions/${q.id}`, {
        body: { answer: value },
      }),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) => query.queryKey.includes(slug),
      }),
    onError: (e) => setError(e.message),
  })
  const locked = q.answer !== null || !canAnswer
  const chosen = Array.isArray(value) ? value : []
  const empty = Array.isArray(value) ? value.length === 0 : value.trim() === ""
  const tone = (id: string) =>
    cn(
      "inline-flex items-center gap-2 rounded-md px-2 py-1 text-body-sm text-ink",
      q.solution?.correct.includes(id) && "bg-success/10 text-success"
    )
  return (
    <div
      data-testid="contest-question"
      className="grid gap-2 rounded-lg border border-hairline bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm font-semibold text-ink">
          {q.label}. {q.title}
        </span>
        <span className="text-caption">
          {q.answer
            ? q.answer.correct
              ? <span className="text-success">Right · {q.points} pts</span>
              : <span className="text-destructive">Wrong</span>
            : `${q.points} pts`}
        </span>
      </div>
      <Markdown text={q.prompt} />
      {q.kind === "single" && (
        <RadioGroup
          value={chosen[0] ?? ""}
          onValueChange={(v) => setValue([String(v)])}
          disabled={locked}
          className="gap-2"
        >
          {q.options.map((o) => (
            <label key={o.id} className={tone(o.id)}>
              <RadioGroupItem value={o.id} aria-label={o.text} />
              {o.text}
            </label>
          ))}
        </RadioGroup>
      )}
      {q.kind === "multiple" && (
        <div className="grid gap-2">
          {q.options.map((o) => (
            <label key={o.id} className={tone(o.id)}>
              <Checkbox
                checked={chosen.includes(o.id)}
                disabled={locked}
                onCheckedChange={(checked) =>
                  setValue(checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))
                }
              />
              {o.text}
            </label>
          ))}
        </div>
      )}
      {q.kind === "short" && (
        <TextInput
          aria-label={`Answer to ${q.label}`}
          value={typeof value === "string" ? value : ""}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {!locked && (
        <ConfirmButton
          size="sm"
          className="justify-self-start"
          tone="default"
          disabled={empty || answer.isPending}
          title={`Answer ${q.label}?`}
          description="You get one answer per question. It's marked at once."
          confirmLabel="Answer"
          onConfirm={() => answer.mutate()}
        >
          Answer
        </ConfirmButton>
      )}
      {error && <p className="text-caption text-destructive">{error}</p>}
      {q.solution?.accepted.length ? (
        <p className="text-caption">Accepted: {q.solution.accepted.join(" · ")}</p>
      ) : null}
      {q.solution?.explanation && (
        <div className="rounded-md bg-canvas-soft p-2 text-body-sm">
          <Markdown text={q.solution.explanation} />
        </div>
      )}
    </div>
  )
}

