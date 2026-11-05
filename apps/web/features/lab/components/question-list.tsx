"use client"

import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import type { ProblemSummary, QuestionStatus } from "../types"

const STATUS_TITLES = {
  solved: "Solved",
  tried: "Attempted",
  none: "Not started",
}

function StatusDot({ status }: { status?: QuestionStatus }) {
  return (
    <span
      title={STATUS_TITLES[status ?? "none"]}
      className={cn(
        "grid size-4 flex-none place-items-center rounded-full border-[1.5px] border-hairline-strong text-[10px] leading-none",
        status === "solved" && "border-success bg-success text-card",
        status === "tried" && "border-muted-foreground"
      )}
    >
      {status === "solved" && "✓"}
      {status === "tried" && (
        <span className="size-1.5 rounded-full bg-muted-foreground" />
      )}
    </span>
  )
}

export function QuestionList({
  questions,
  activeId,
  hrefFor,
  status,
  showUnits,
}: {
  questions: ProblemSummary[]
  activeId: string
  hrefFor: (id: string) => string
  status: Record<string, QuestionStatus>
  showUnits: boolean
}) {
  return (
    <>
      {questions.map((question, index) => (
        <div key={question.id}>
          {showUnits && question.unitNo !== questions[index - 1]?.unitNo && (
            <div className="px-3.5 pt-3 pb-1 text-caption-upper text-body uppercase">
              {question.unitNo}. {question.unit}
            </div>
          )}
          <Link
            href={hrefFor(question.id)}
            aria-current={question.id === activeId ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 border-l-[3px] border-transparent px-3.5 py-1.5 text-body-sm text-ink hover:bg-muted",
              question.id === activeId && "border-ink bg-muted font-semibold"
            )}
          >
            <span className="w-7.5 flex-none font-mono text-xs text-body tabular-nums">
              {question.label}
            </span>
            <span className="min-w-0 flex-1">{question.title}</span>
            <StatusDot status={status[question.id]} />
          </Link>
        </div>
      ))}
    </>
  )
}
