"use client"

import { useMemo, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Check, Field, TextArea, TextInput } from "@/components/form"
import type { ApiResult } from "@/lib/api/types"
import type { orgLibrary } from "@/features/library/org"

import { KIND_NAME } from "./checkpoint-page"

/*
 * A module's quiz, lab and project, attached while writing the module when they fit: each
 * is optional, at most one of a kind. A quiz holds questions that mark themselves, a lab
 * ready library problems (scored by graded submissions during the attempt), a project a
 * brief a teacher marks. Each has a weight in the course grade.
 */

export type CheckpointKind = "quiz" | "lab" | "project"

export interface CheckpointDraft {
  kind: CheckpointKind
  title: string
  instructions: string
  timeLimit: number | null
  weight: number
  points: number
  items: { id: string; title: string; detail: string; points: number }[]
}

type LibraryData = ApiResult<typeof orgLibrary>

const KINDS: CheckpointKind[] = ["quiz", "lab", "project"]

const HINT: Record<CheckpointKind, string> = {
  quiz: "Questions that mark themselves, taken in one attempt; right answers show once it's over.",
  lab: "Library problems solved in one attempt; graded submissions made during it count.",
  project:
    "A brief students hand in as a GitHub repository; a teacher marks it.",
}

export const blankCheckpoint = (
  kind: CheckpointKind,
  moduleTitle: string
): CheckpointDraft => ({
  kind,
  title: `${KIND_NAME[kind]}${moduleTitle ? ` – ${moduleTitle}` : ""}`,
  instructions: "",
  timeLimit: null,
  weight: 1,
  points: 100,
  items: [],
})

/** Whether a draft can be saved, and why not. */
export function checkpointProblem(c: CheckpointDraft): string | null {
  if (!c.title.trim()) return `Name the ${KIND_NAME[c.kind].toLowerCase()}`
  if (c.kind === "quiz" && c.items.length === 0)
    return "Add questions to the quiz"
  if (c.kind === "lab" && c.items.length === 0) return "Add problems to the lab"
  if (
    c.timeLimit !== null &&
    (!Number.isInteger(c.timeLimit) || c.timeLimit < 1 || c.timeLimit > 600)
  )
    return "A time limit is 1 to 600 minutes"
  if (!Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100)
    return "Weight is 0 to 100"
  if (
    c.items.some(
      (i) => !Number.isInteger(i.points) || i.points < 1 || i.points > 1000
    )
  )
    return "Points are 1 to 1000"
  if (
    c.kind === "project" &&
    (!Number.isInteger(c.points) || c.points < 1 || c.points > 1000)
  )
    return "A project is out of 1 to 1000"
  return null
}

const numberOr = (text: string, empty: number | null) =>
  text.trim() === "" ? empty : Number(text)

export function CheckpointsEditor({
  value,
  onChange,
  moduleTitle,
  library,
  readOnly,
}: {
  value: CheckpointDraft[]
  onChange: (next: CheckpointDraft[]) => void
  moduleTitle: string
  library: LibraryData | undefined
  readOnly: boolean
}) {
  const set = (kind: CheckpointKind, next: CheckpointDraft | null) => {
    const others = value.filter((c) => c.kind !== kind)
    onChange(
      next
        ? [...others, next].sort(
            (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
          )
        : others
    )
  }
  if (readOnly && value.length === 0) return null
  return (
    <section className="grid gap-2" data-testid="module-checkpoints-editor">
      <div className="text-caption font-medium text-ink">
        Quiz, lab and project
      </div>
      {!readOnly && (
        <p className="text-caption">
          Attach the ones that fit this module. Each counts toward the course
          grade by its weight.
        </p>
      )}
      {KINDS.map((kind) => {
        const c = value.find((x) => x.kind === kind)
        if (readOnly && !c) return null
        return (
          <div
            key={kind}
            className="grid gap-2 rounded-md border border-hairline p-2"
          >
            {readOnly ? (
              <div className="flex items-center gap-2 text-body-sm">
                <Badge variant="secondary">{KIND_NAME[kind]}</Badge>
                <span className="text-ink">{c!.title}</span>
              </div>
            ) : (
              <Check
                checked={Boolean(c)}
                onCheckedChange={(on) =>
                  set(kind, on ? blankCheckpoint(kind, moduleTitle) : null)
                }
                label={`Add a ${KIND_NAME[kind].toLowerCase()}`}
              />
            )}
            {c && !readOnly && (
              <CheckpointFields
                checkpoint={c}
                library={library}
                onChange={(next) => set(kind, next)}
              />
            )}
            {c && readOnly && (
              <p className="text-caption">
                {c.kind === "project"
                  ? `Out of ${c.points}`
                  : `${c.items.length} ${c.kind === "quiz" ? "questions" : "problems"}${c.timeLimit ? ` · ${c.timeLimit} min` : ""}`}{" "}
                · weight {c.weight}
              </p>
            )}
            {!c && !readOnly && <p className="text-caption">{HINT[kind]}</p>}
          </div>
        )
      })}
    </section>
  )
}

function CheckpointFields({
  checkpoint: c,
  library,
  onChange,
}: {
  checkpoint: CheckpointDraft
  library: LibraryData | undefined
  onChange: (next: CheckpointDraft) => void
}) {
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState(
    c.timeLimit === null ? "" : String(c.timeLimit)
  )
  const [weight, setWeight] = useState(String(c.weight))
  const [points, setPoints] = useState(String(c.points))
  const chosen = new Set(c.items.map((i) => i.id))
  const candidates = useMemo(() => {
    if (!library || c.kind === "project") return []
    const q = search.trim().toLowerCase()
    const pool =
      c.kind === "quiz"
        ? library.questions
            .filter((x) => x.published && x.marksItself)
            .map((x) => ({
              id: x.id,
              title: x.title,
              detail: x.kind,
              points: x.points,
              tags: x.tags,
            }))
        : library.problems
            .filter((p) => p.published && p.listed)
            .map((p) => ({
              id: p.id,
              title: p.title,
              detail: p.level,
              points: 100,
              tags: p.tags,
            }))
    return pool
      .filter(
        (i) =>
          !chosen.has(i.id) &&
          (!q ||
            i.title.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)))
      )
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, search, c.items, c.kind])
  const noun = c.kind === "quiz" ? "questions" : "problems"
  const total =
    c.kind === "project" ? c.points : c.items.reduce((n, i) => n + i.points, 0)

  return (
    <div className="grid gap-2" data-testid={`checkpoint-${c.kind}`}>
      <Field label="Name">
        <TextInput
          aria-label={`${KIND_NAME[c.kind]} name`}
          value={c.title}
          onChange={(e) => onChange({ ...c, title: e.target.value })}
        />
      </Field>
      <Field label="Instructions (markdown, optional)">
        <TextArea
          aria-label={`${KIND_NAME[c.kind]} instructions`}
          rows={c.kind === "project" ? 5 : 2}
          value={c.instructions}
          onChange={(e) => onChange({ ...c, instructions: e.target.value })}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {c.kind === "project" ? (
          <Field label="Out of (points)">
            <TextInput
              aria-label="Project points"
              inputMode="numeric"
              value={points}
              onChange={(e) => {
                setPoints(e.target.value)
                onChange({ ...c, points: Number(e.target.value) })
              }}
            />
          </Field>
        ) : (
          <Field label="Time limit (minutes)" help="Empty: no limit.">
            <TextInput
              aria-label={`${KIND_NAME[c.kind]} time limit`}
              inputMode="numeric"
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value)
                onChange({ ...c, timeLimit: numberOr(e.target.value, null) })
              }}
            />
          </Field>
        )}
        <Field
          label="Weight in the course grade"
          help="0 to leave it out of the grade."
        >
          <TextInput
            aria-label={`${KIND_NAME[c.kind]} weight`}
            inputMode="numeric"
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value)
              onChange({ ...c, weight: Number(numberOr(e.target.value, 1)) })
            }}
          />
        </Field>
      </div>
      {c.kind !== "project" && (
        <>
          <ol
            className="grid gap-0.5 rounded-md border border-hairline p-1"
            data-testid="checkpoint-items"
          >
            {c.items.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-muted"
              >
                <span className="w-6 text-caption tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                  {item.title}
                </span>
                <span className="text-xs text-body capitalize">
                  {item.detail}
                </span>
                <TextInput
                  aria-label={`Points for ${item.title}`}
                  inputMode="numeric"
                  className="h-7 w-16"
                  value={String(item.points)}
                  onChange={(e) =>
                    onChange({
                      ...c,
                      items: c.items.map((x, i) =>
                        i === index
                          ? { ...x, points: Number(e.target.value) }
                          : x
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${item.title} from the ${KIND_NAME[c.kind].toLowerCase()}`}
                  onClick={() =>
                    onChange({
                      ...c,
                      items: c.items.filter((_, i) => i !== index),
                    })
                  }
                >
                  ✕
                </Button>
              </li>
            ))}
            {c.items.length === 0 && (
              <li className="px-1.5 py-1 text-caption">No {noun} yet.</li>
            )}
          </ol>
          <TextInput
            aria-label={`Search ${noun} for the ${KIND_NAME[c.kind].toLowerCase()}`}
            placeholder={`Search ${noun} by title or tag`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="grid max-h-40 gap-0.5 overflow-y-auto rounded-md border border-hairline p-1">
            {!library && <li className="px-1.5 py-1 text-caption">Loading…</li>}
            {candidates.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                  {item.title}
                </span>
                <span className="text-xs text-body capitalize">
                  {item.detail}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  aria-label={`Add ${item.title} to the ${KIND_NAME[c.kind].toLowerCase()}`}
                  onClick={() =>
                    onChange({
                      ...c,
                      items: [
                        ...c.items,
                        {
                          id: item.id,
                          title: item.title,
                          detail: item.detail,
                          points: item.points || 1,
                        },
                      ],
                    })
                  }
                >
                  Add
                </Button>
              </li>
            ))}
            {library && candidates.length === 0 && (
              <li className="px-1.5 py-1 text-caption">Nothing matches.</li>
            )}
          </ul>
        </>
      )}
      <p className="text-caption">
        Out of {total}
        {checkpointProblem(c) && (
          <span className="text-destructive"> · {checkpointProblem(c)}</span>
        )}
      </p>
    </div>
  )
}
