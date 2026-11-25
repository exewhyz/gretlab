"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { DetailSheet } from "@/components/detail-sheet"
import { Loading, Table } from "@/features/admin/components/shell"
import type { platformSimilarity } from "@/features/plagiarism/server"
import type { ApiResult } from "@/lib/api/types"

type Pairs = Exclude<ApiResult<typeof platformSimilarity>, { pair: unknown }>
type Pair = Pairs["pairs"][number]
export type PairDetail = Extract<
  ApiResult<typeof platformSimilarity>,
  { pair: unknown }
>["pair"]

const who = (p: { name: string | null; email: string }) => p.name || p.email

/**
 * The pairs a check found, most similar first; Compare opens a pair side by side. `compare`
 * asks the server for one pair, within the same check, so nothing outside it can be opened.
 */
export function SimilarPairs({
  result,
  compare,
}: {
  result: Pairs
  compare: (a: string, b: string) => Promise<{ pair: PairDetail }>
}) {
  const [open, setOpen] = useState<Pair | null>(null)
  const detail = useMutation({
    mutationFn: (pair: Pair) =>
      compare(pair.a.submissionId, pair.b.submissionId),
    meta: { quiet: true },
  })
  return (
    <>
      <p className="mb-2 text-body-sm text-body">
        Compared the latest accepted code of {result.compared} students.{" "}
        {result.pairs.length === 0
          ? "No pairs at this level of similarity."
          : `${result.pairs.length} pair(s) to review.`}
      </p>
      {result.pairs.length > 0 && (
        <Table
          headers={[
            "Similarity",
            "First student",
            "Second student",
            "Language",
            "",
          ]}
        >
          {result.pairs.map((pair) => (
            <tr key={`${pair.a.submissionId}-${pair.b.submissionId}`}>
              <td className="font-semibold tabular-nums">{pair.score}%</td>
              <td>{who(pair.a)}</td>
              <td>{who(pair.b)}</td>
              <td>{pair.language}</td>
              <td>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpen(pair)
                    detail.mutate(pair)
                  }}
                >
                  Compare
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {open && (
        <DetailSheet
          title={`${who(open.a)} and ${who(open.b)}`}
          description={`${open.score}% similar · ${open.language}. Matching stretches share a colour and number. A match is a reason to talk to the students, not proof.`}
          onClose={() => {
            setOpen(null)
            detail.reset()
          }}
          width="90rem"
          testId="compare-sheet"
        >
          {detail.data ? (
            <SideBySide pair={detail.data.pair} />
          ) : (
            <Loading error={detail.error} />
          )}
        </DetailSheet>
      )}
    </>
  )
}

/** Colour for a matching stretch, cycling through the chart tokens (both themes define them). */
const tint = (id: number) => `var(--chart-${((id - 1) % 5) + 1})`

function SideBySide({ pair }: { pair: PairDetail }) {
  return (
    <div className="grid gap-3">
      <p className="text-caption text-body" data-testid="compare-summary">
        {pair.regions.length === 0
          ? "No stretch long enough to show: the similarity comes from many small pieces."
          : `${pair.regions.length} matching ${pair.regions.length === 1 ? "stretch" : "stretches"}.`}
      </p>
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <CodePane
          title={who(pair.a)}
          code={pair.a.code}
          ranges={pair.regions.map((r) => ({ id: r.id, ...r.a }))}
          side="a"
        />
        <CodePane
          title={who(pair.b)}
          code={pair.b.code}
          ranges={pair.regions.map((r) => ({ id: r.id, ...r.b }))}
          side="b"
        />
      </div>
    </div>
  )
}

function CodePane({
  title,
  code,
  ranges,
  side,
}: {
  title: string
  code: string
  ranges: { id: number; from: number; to: number }[]
  side: "a" | "b"
}) {
  const lines = code.replace(/\n$/, "").split("\n")
  return (
    <div
      className="min-w-0 rounded-lg ring-1 ring-foreground/10"
      data-testid={`pane-${side}`}
    >
      <div className="border-b border-hairline px-3 py-2 text-caption font-medium text-ink">
        {title}
      </div>
      <pre className="overflow-x-auto py-2 font-mono text-xs leading-5">
        {lines.map((line, index) => {
          const n = index + 1
          const range = ranges.find((r) => n >= r.from && n <= r.to)
          return (
            <div
              key={n}
              className="flex"
              data-match={range?.id}
              style={
                range
                  ? {
                      background: `color-mix(in oklab, ${tint(range.id)} 16%, transparent)`,
                      boxShadow: `inset 3px 0 0 ${tint(range.id)}`,
                    }
                  : undefined
              }
            >
              <span className="w-10 flex-none pr-2 text-right text-body tabular-nums select-none">
                {n}
              </span>
              <span className="w-6 flex-none text-center text-caption text-body">
                {range && n === range.from ? range.id : ""}
              </span>
              <code className="pr-3 whitespace-pre text-ink">
                {line || " "}
              </code>
            </div>
          )
        })}
      </pre>
    </div>
  )
}
