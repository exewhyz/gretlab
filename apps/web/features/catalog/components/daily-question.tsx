"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { cn } from "@workspace/ui/lib/utils"

import { TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { api } from "@/lib/api/client"

export interface DailyQuestionData {
  id: string
  title: string
  kind: "single" | "multiple" | "short" | "written"
  prompt: string
  options: { id: string; text: string }[]
  answer: { value: string[] | string; correct: boolean; tries?: number } | null
  solution: { correct: string[]; accepted: string[]; explanation: string } | null
}

/**
 * One of today's questions: one answer, marked at once, with the explanation after. Also
 * a course's practice question (`endpoint`, `retry`): wrong answers can be tried again.
 */
export function DailyQuestion({
  q,
  number,
  signedIn,
  endpoint = "/daily/answer",
  queryKey = ["daily"],
  retry = false,
}: {
  q: DailyQuestionData
  number: number
  signedIn: boolean
  endpoint?: string
  queryKey?: unknown[]
  retry?: boolean
}) {
  const client = useQueryClient()
  const [value, setValue] = useState<string[] | string>(
    q.answer?.value ?? (q.kind === "short" ? "" : [])
  )
  const answer = useMutation({
    mutationFn: () => api(endpoint, { body: { questionId: q.id, answer: value } }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  })
  const again = retry && q.answer !== null && !q.answer.correct
  const locked = (q.answer !== null && !again) || !signedIn
  const chosen = Array.isArray(value) ? value : []
  const empty = Array.isArray(value) ? value.length === 0 : value.trim() === ""
  const tone = (id: string) =>
    cn(
      "inline-flex items-center gap-2 rounded-md px-2 py-1 text-body-sm text-ink",
      q.solution?.correct.includes(id) && "bg-success/10 text-success"
    )
  return (
    <div className="grid gap-2 border-t border-hairline pt-3" data-testid="daily-question">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm font-semibold text-ink">
          Q{number} · {q.title}
        </span>
        {q.answer && (
          <span className={q.answer.correct ? "text-success" : "text-destructive"}>
            {q.answer.correct ? "Right" : "Not quite"}
          </span>
        )}
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
          aria-label="Your answer"
          value={typeof value === "string" ? value : ""}
          disabled={locked}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {(!q.answer || again) && signedIn && (
        <Button
          size="sm"
          className="justify-self-start"
          disabled={empty || answer.isPending}
          onClick={() => answer.mutate()}
        >
          {again ? "Try again" : "Answer"}
        </Button>
      )}
      {!signedIn && <p className="text-caption">Sign in to answer.</p>}
      {answer.error && <p className="text-caption text-destructive">{answer.error.message}</p>}
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
