"use client"

import type { FeedbackQuestion } from "@workspace/judge"
import { Button } from "@workspace/ui/components/button"

import { SelectInput, TextInput } from "@/components/form"

/** A feedback form's questions: their wording and kind, added and removed (a round's, or the platform's). */
export function QuestionsEditor({
  questions,
  onChange,
}: {
  questions: FeedbackQuestion[]
  onChange: (questions: FeedbackQuestion[]) => void
}) {
  const set = (i: number, patch: Partial<FeedbackQuestion>) =>
    onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  return (
    <div className="grid gap-2" data-testid="round-questions">
      <div className="text-caption font-semibold text-ink">Questions</div>
      {questions.map((q, i) => (
        <div
          key={q.id}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
        >
          <TextInput
            aria-label={`Question ${i + 1}`}
            value={q.text}
            onChange={(e) => set(i, { text: e.target.value })}
          />
          <SelectInput
            aria-label={`Kind of question ${i + 1}`}
            value={q.kind}
            onChange={(e) =>
              set(i, {
                kind: e.target.value as FeedbackQuestion["kind"],
              })
            }
          >
            <option value="rating">Rating 1 to 5</option>
            <option value="comment">Comment</option>
          </SelectInput>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={questions.length === 1}
            onClick={() => onChange(questions.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={questions.length >= 20}
          onClick={() =>
            onChange([
              ...questions,
              { id: `q${Date.now().toString(36)}`, kind: "rating", text: "" },
            ])
          }
        >
          Add a question
        </Button>
      </div>
    </div>
  )
}
