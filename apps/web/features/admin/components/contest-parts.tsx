"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

import { SelectInput, TextInput } from "@/components/form"
import { useOwner } from "@/features/admin/owner"

import { NewProblemDialog } from "./problem-editor"
import { ImportProblemsDialog } from "./problem-import"
import type { StaffProblemList } from "./problems"

/** datetime-local works in the viewer's own timezone. */
export function toLocalInput(value: Date | string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

export function ProblemPicker({
  problems,
  selected,
  onChange,
  error,
  orderLabel = "In the contest, in this order",
  marker = (index) => String.fromCharCode(65 + index),
  extra,
}: {
  problems: StaffProblemList["problems"]
  selected: string[]
  onChange: (ids: string[]) => void
  error?: string
  orderLabel?: string
  marker?: (index: number) => string
  /** Extra controls on each chosen problem, such as its points. */
  extra?: (id: string) => ReactNode
}) {
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState("")
  const [writing, setWriting] = useState(false)
  const [importing, setImporting] = useState(false)
  const owner = useOwner()
  const client = useQueryClient()
  // New problems are added at once; the list catches up when the picker reloads.
  const added = (ids: string[]) => {
    void client.invalidateQueries({ queryKey: owner.key("problems") })
    onChange([...selected, ...ids.filter((id) => !selected.includes(id))])
  }
  const byId = useMemo(
    () => new Map(problems.map((problem) => [problem.id, problem])),
    [problems]
  )
  const available = problems.filter(
    (problem) =>
      !selected.includes(problem.id) &&
      (!level || problem.level === level) &&
      problem.title.toLowerCase().includes(search.trim().toLowerCase())
  )
  const move = (index: number, delta: -1 | 1) => {
    const next = [...selected]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-caption font-semibold text-ink">
          Problems ({selected.length})
        </div>
        <span className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setWriting(true)}
          >
            Write a problem
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setImporting(true)}
          >
            Import problems
          </Button>
        </span>
      </div>
      <NewProblemDialog
        open={writing}
        onOpenChange={setWriting}
        onCreated={(problem) => added([problem.id])}
      />
      <ImportProblemsDialog
        open={importing}
        onOpenChange={setImporting}
        forAssessment
        onImported={(problems) => added(problems.map((p) => p.id))}
      />
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 flex gap-2">
            <TextInput
              aria-label="Search problems"
              placeholder="Search problems"
              className="py-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectInput
              aria-label="Filter by level"
              className="w-28 py-1"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="">Any level</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </SelectInput>
          </div>
          <ul className="grid max-h-64 gap-0.5 overflow-auto">
            {available.map((problem) => (
              <li key={problem.id}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Add ${problem.title}`}
                  className="h-auto w-full justify-start gap-2 rounded-sm px-2 py-1 text-left text-body-sm font-normal whitespace-normal"
                  onClick={() => onChange([...selected, problem.id])}
                >
                  <span className="flex-none text-muted-foreground">+</span>
                  <span className="min-w-0 flex-1 text-ink">
                    {problem.title}
                  </span>
                  <span className="text-xs capitalize">{problem.level}</span>
                  {!problem.published && (
                    <span
                      className="text-xs"
                      title="Only visible through this contest"
                    >
                      Draft
                    </span>
                  )}
                  {problem.published && !problem.listed && (
                    <span
                      className="text-xs"
                      title="Not in the problem library: only through work that uses it"
                    >
                      Own
                    </span>
                  )}
                </Button>
              </li>
            ))}
            {available.length === 0 && (
              <li className="px-2 py-1 text-caption">Nothing matches.</li>
            )}
          </ul>
        </div>

        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 text-caption">{orderLabel}</div>
          {selected.length === 0 && (
            <p className="px-2 py-1 text-caption">
              Add problems from the list.
            </p>
          )}
          <ol className="grid gap-0.5">
            {selected.map((id, index) => (
              <li
                key={id}
                data-testid="selected-problem"
                className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-muted"
              >
                <b className="w-5 flex-none text-ink">{marker(index)}</b>
                <span className="min-w-0 flex-1 text-ink">
                  {byId.get(id)?.title ?? "Unknown problem"}
                </span>
                {extra?.(id)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move down"
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${byId.get(id)?.title ?? ""}`}
                  onClick={() =>
                    onChange(selected.filter((item) => item !== id))
                  }
                >
                  ✕
                </Button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <FieldError message={error} />
    </div>
  )
}
