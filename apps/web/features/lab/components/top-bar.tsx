"use client"

import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { PageHeader } from "@/components/page-header"

import type { ProblemSummary, QuestionStatus } from "../types"
import { EngineStatusIndicator } from "./engine-status"

/** Groups questions by unit, for the phone-width picker that replaces the list. */
function groupByUnit(questions: ProblemSummary[]) {
  const groups = new Map<string, ProblemSummary[]>()
  for (const question of questions) {
    const title = `${question.unitNo}. ${question.unit}`
    groups.set(title, [...(groups.get(title) ?? []), question])
  }
  return [...groups]
}

export function TopBar({
  questions,
  status,
  activeId,
  onNavigate,
}: {
  questions: ProblemSummary[]
  status: Record<string, QuestionStatus>
  activeId: string
  onNavigate: (id: string) => void
}) {
  const solved = questions.filter((q) => status[q.id] === "solved").length

  return (
    <>
      <PageHeader>
        <div
          title="Problems solved"
          className="ml-2 hidden items-center gap-2.5 text-caption text-body tabular-nums lg:flex"
        >
          <div
            aria-hidden
            className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-strong"
          >
            <div
              className="h-full bg-success transition-[width] duration-300 motion-reduce:transition-none"
              style={{
                width: `${(100 * solved) / Math.max(1, questions.length)}%`,
              }}
            />
          </div>
          {solved} / {questions.length} solved
        </div>
        <EngineStatusIndicator className="ml-2 hidden lg:flex" />
      </PageHeader>
      <div className="flex-none border-b border-hairline bg-canvas px-4 py-2 min-[901px]:hidden">
        <label htmlFor="question-picker" className="text-caption text-body">
          Problem
        </label>
        <NativeSelect
          id="question-picker"
          value={activeId}
          onChange={(event) => onNavigate(event.target.value)}
          className="w-full text-body-sm"
        >
          {groupByUnit(questions).map(([unitTitle, unitQuestions]) => (
            <NativeSelectOptGroup key={unitTitle} label={unitTitle}>
              {unitQuestions.map((question) => (
                <NativeSelectOption key={question.id} value={question.id}>
                  {question.label}. {question.title}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
      </div>
    </>
  )
}
