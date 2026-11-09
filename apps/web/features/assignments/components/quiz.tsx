"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { cn } from "@workspace/ui/lib/utils"

import { TextArea, TextInput } from "@/components/form"
import { Markdown } from "@/components/markdown"
import { api } from "@/lib/api/client"

export interface QuizQuestionView {
  id: string
  kind: "single" | "multiple" | "short" | "written"
  prompt: string
  options: { id: string; text: string }[]
  points: number
  answer: string[] | string | null
  result: {
    earned: number | null
    needsMarking: boolean
    correct: string[]
    accepted: string[]
    explanation: string
  } | null
}

/** Saved this long after the last change, and at once when leaving the page. */
const SAVE_AFTER_MS = 800

/**
 * The assignment's questions. Answers save as the student goes and can be changed until
 * their time is up; whatever is saved then counts. Marks and right answers show once
 * results are out.
 */
export function QuizSection({
  slug,
  questions,
  open,
  resultsOut,
  held,
}: {
  slug: string
  questions: QuizQuestionView[]
  open: boolean
  resultsOut: boolean
  held: boolean
}) {
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, string[] | string>>(() =>
    Object.fromEntries(
      questions.filter((q) => q.answer !== null).map((q) => [q.id, q.answer!])
    )
  )
  const [state, setState] = useState<"saved" | "saving" | "edited" | "error">("saved")
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Record<string, string[] | string> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  async function flush() {
    clearTimeout(timer.current)
    const body = pending.current
    if (!body) return
    pending.current = null
    setState("saving")
    try {
      await api(`/assignments/${slug}/answers`, { method: "PUT", body: { answers: body } })
      setState(pending.current ? "edited" : "saved")
      setError(null)
    } catch (e) {
      setState("error")
      setError(e instanceof Error ? e.message : "Couldn't save your answers.")
      void client.invalidateQueries({ queryKey: ["assignment", slug] })
    }
  }

  useEffect(() => {
    const leave = () => void flush()
    window.addEventListener("pagehide", leave)
    return () => {
      window.removeEventListener("pagehide", leave)
      void flush()
    }
    // flush reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const answer = (id: string, value: string[] | string) => {
    const next = { ...answers, [id]: value }
    setAnswers(next)
    pending.current = next
    setState("edited")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS)
  }

  const answered = questions.filter((q) => {
    const a = answers[q.id]
    return a !== undefined && (Array.isArray(a) ? a.length > 0 : a.trim() !== "")
  }).length

  return (
    <section className="mt-6 grid gap-3" data-testid="quiz">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-sm text-ink">Questions</h2>
        <span className="text-caption" data-testid="quiz-state">
          {open
            ? state === "saving"
              ? "Saving…"
              : state === "edited"
                ? "Edited"
                : state === "error"
                  ? error
                  : `Saved · ${answered} of ${questions.length} answered`
            : resultsOut
              ? "Results"
              : held
                ? "Closed. Results come when your teacher releases them."
                : "Closed. Results come after the due time."}
        </span>
      </div>
      {open && (
        <p className="text-caption">
          Your answers save as you go and can be changed until your time is up; what&apos;s
          saved then counts.
        </p>
      )}
      {questions.map((q, index) => {
        const value = answers[q.id]
        const chosen = Array.isArray(value) ? value : []
        const text = typeof value === "string" ? value : ""
        const r = q.result
        return (
          <div
            key={q.id}
            data-testid="quiz-question"
            className="grid gap-2 rounded-lg border border-hairline bg-card p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-sm font-semibold text-ink">Q{index + 1}</span>
              <span className="text-caption tabular-nums" data-testid="quiz-mark">
                {r
                  ? r.needsMarking
                    ? `Being marked · ${q.points} pts`
                    : `${r.earned ?? 0} / ${q.points}`
                  : `${q.points} ${q.points === 1 ? "point" : "points"}`}
              </span>
            </div>
            <Markdown text={q.prompt} />
            {q.kind === "single" && (
              <RadioGroup
                value={chosen[0] ?? ""}
                onValueChange={(v) => answer(q.id, [String(v)])}
                disabled={!open}
                className="gap-2"
              >
                {q.options.map((o) => (
                  <label key={o.id} className={optionTone(o.id, chosen, r)}>
                    <RadioGroupItem value={o.id} aria-label={o.text} />
                    {o.text}
                  </label>
                ))}
              </RadioGroup>
            )}
            {q.kind === "multiple" && (
              <div className="grid gap-2">
                {q.options.map((o) => (
                  <label key={o.id} className={optionTone(o.id, chosen, r)}>
                    <Checkbox
                      checked={chosen.includes(o.id)}
                      disabled={!open}
                      onCheckedChange={(checked) =>
                        answer(
                          q.id,
                          checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id)
                        )
                      }
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            )}
            {q.kind === "short" && (
              <TextInput
                aria-label={`Answer to Q${index + 1}`}
                value={text}
                disabled={!open}
                onChange={(event) => answer(q.id, event.target.value)}
              />
            )}
            {q.kind === "written" && (
              <TextArea
                aria-label={`Answer to Q${index + 1}`}
                rows={5}
                value={text}
                disabled={!open}
                onChange={(event) => answer(q.id, event.target.value)}
              />
            )}
            {r && q.kind === "short" && r.accepted.length > 0 && (
              <p className="text-caption">Accepted: {r.accepted.join(" · ")}</p>
            )}
            {r?.explanation && (
              <div className="rounded-md bg-canvas-soft p-2 text-body-sm">
                <Markdown text={r.explanation} />
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** Once results are out, right options show green and wrong picks red. */
function optionTone(
  id: string,
  chosen: string[],
  result: QuizQuestionView["result"]
) {
  return cn(
    "inline-flex items-center gap-2 rounded-md px-2 py-1 text-body-sm text-ink",
    result?.correct.includes(id) && "bg-success/10 text-success",
    result && !result.correct.includes(id) && chosen.includes(id) && "bg-destructive/10 text-destructive"
  )
}
