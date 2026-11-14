"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { SelectInput, TextInput } from "@/components/form"
import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"

import { ImportQuestionsDialog } from "./question-import"
import { KIND_LABEL, NewQuestionDialog } from "./question-editor"
import type { ApiResult } from "@/lib/api/types"
import type { orgQuestions } from "@/features/orgs/content"

export type BankQuestion = ApiResult<typeof orgQuestions>[number]

/** The bank's questions an assignment or contest of this owner may use. */
export function useQuestionBank() {
  const owner = useOwner()
  return useQuery({
    queryKey: owner.key("questions", "picker"),
    queryFn: () => api<BankQuestion[]>(`${owner.api("/questions")}?for=picker`),
  })
}

/**
 * Choosing quiz questions from the bank, like the problem picker: search on the left, the
 * chosen ones with their points on the right. New ones can be written or imported here.
 * `autoOnly` (contests, the daily challenge) offers only questions that mark themselves.
 */
export function QuestionPicker({
  selected,
  onChange,
  error,
  autoOnly = false,
  label = "Quiz questions",
  showPoints = true,
  max = 100,
}: {
  selected: { questionId: string; points: string }[]
  onChange: (questions: { questionId: string; points: string }[]) => void
  error?: string
  autoOnly?: boolean
  label?: string
  /** Off where questions carry no points (the daily challenge). */
  showPoints?: boolean
  max?: number
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const { data: bank } = useQuestionBank()
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState("")
  const [writing, setWriting] = useState(false)
  const [importing, setImporting] = useState(false)
  const byId = useMemo(
    () => new Map((bank ?? []).map((q) => [q.id, q])),
    [bank]
  )
  const chosen = new Set(selected.map((s) => s.questionId))
  const query = search.trim().toLowerCase()
  const available = (bank ?? []).filter(
    (q) =>
      !chosen.has(q.id) &&
      q.published &&
      (!autoOnly || q.marksItself) &&
      (!kind || q.kind === kind) &&
      (!query ||
        q.title.toLowerCase().includes(query) ||
        q.tags.some((t) => t.toLowerCase().includes(query)))
  )
  const full = selected.length >= max
  const add = (items: { id: string; points: number }[]) => {
    void client.invalidateQueries({ queryKey: owner.key("questions") })
    onChange(
      [
        ...selected,
        ...items
          .filter((q) => !chosen.has(q.id))
          .map((q) => ({ questionId: q.id, points: String(q.points) })),
      ].slice(0, max)
    )
  }
  const move = (index: number, delta: -1 | 1) => {
    const next = [...selected]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + delta, 0, item)
    onChange(next)
  }
  const total = selected.reduce((t, s) => t + (Number(s.points) || 0), 0)

  return (
    <div className="grid gap-2" data-testid="question-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-caption font-semibold text-ink">
          {label} ({selected.length})
        </div>
        <span className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setWriting(true)}
          >
            Write a question
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setImporting(true)}
          >
            Import questions
          </Button>
        </span>
      </div>
      <NewQuestionDialog
        open={writing}
        onOpenChange={setWriting}
        onCreated={(q) => add([q])}
      />
      <ImportQuestionsDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={(qs) => {
          setImporting(false)
          void api<BankQuestion[]>(
            `${owner.api("/questions")}?for=picker`
          ).then((all) =>
            add(
              qs.map((q) => ({
                id: q.id,
                points: all.find((x) => x.id === q.id)?.points ?? 1,
              }))
            )
          )
        }}
      />
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 flex gap-2">
            <TextInput
              aria-label="Search questions"
              placeholder="Search questions or tags"
              className="py-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectInput
              aria-label="Filter by type"
              className="w-40 py-1"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">Any type</option>
              {Object.entries(KIND_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </SelectInput>
          </div>
          <ul className="grid max-h-56 gap-0.5 overflow-auto">
            {available.map((q) => (
              <li key={q.id}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Add ${q.title}`}
                  disabled={full}
                  className="h-auto w-full justify-start gap-2 rounded-sm px-2 py-1 text-left text-body-sm font-normal whitespace-normal"
                  onClick={() => add([{ id: q.id, points: q.points }])}
                >
                  <span className="flex-none text-muted-foreground">+</span>
                  <span className="min-w-0 flex-1 text-ink">{q.title}</span>
                  <span className="text-xs">{KIND_LABEL[q.kind]}</span>
                </Button>
              </li>
            ))}
            {bank && available.length === 0 && (
              <li className="px-2 py-1 text-caption">
                {bank.length === 0
                  ? "No questions yet: write or import some."
                  : autoOnly
                    ? "Nothing matches. Only questions that mark themselves can be used here."
                    : "Nothing matches."}
              </li>
            )}
          </ul>
        </div>
        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 text-caption">
            In this order
            {showPoints
              ? ` · ${total} points`
              : ` · ${selected.length} of ${max}`}
          </div>
          {selected.length === 0 && (
            <p className="px-2 py-1 text-caption">
              Optional. Add questions from the list.
            </p>
          )}
          <ol className="grid gap-0.5">
            {selected.map((s, index) => {
              const q = byId.get(s.questionId)
              return (
                <li
                  key={s.questionId}
                  data-testid="selected-question"
                  className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-muted"
                >
                  <span className="w-6 text-caption">Q{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                    {q?.title ?? "…"}
                  </span>
                  {showPoints && (
                    <label className="flex items-center gap-1 text-xs">
                      <TextInput
                        type="number"
                        min={1}
                        aria-label={`Points for ${q?.title ?? "question"}`}
                        className="w-16 py-0.5"
                        value={s.points}
                        onChange={(event) =>
                          onChange(
                            selected.map((x) =>
                              x.questionId === s.questionId
                                ? { ...x, points: event.target.value }
                                : x
                            )
                          )
                        }
                      />
                      pts
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={index === selected.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${q?.title ?? "question"}`}
                    onClick={() =>
                      onChange(
                        selected.filter((x) => x.questionId !== s.questionId)
                      )
                    }
                  >
                    ✕
                  </Button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  )
}
