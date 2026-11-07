import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

import type { ProblemDetail } from "../types"
import { Markdown } from "@/components/markdown"
import { TagChip } from "@/features/catalog/components/difficulty"
import { HideDuringExam } from "@/features/exams/components/exam"
import { AssignmentChips } from "@/features/assignments/components/assignment-chips"
import { SaveMenu } from "@/features/catalog/components/save-menu"

import { InlineCode } from "./inline-code"
import styles from "./problem-view.module.scss"
import { SampleCard } from "./sample-card"

const LEVEL_COLORS: Record<string, string> = {
  easy: "text-success",
  medium: "text-body",
  hard: "text-destructive",
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** Renders on the server for public pages and on the client for contests. */
export function ProblemView({
  question,
  footer,
}: {
  question: ProblemDetail
  /** Shown after the problem has been read, never between it and its samples. */
  footer?: ReactNode
}) {
  const ownNotes = question.notes
  // The problem's structure, kept apart from its statement.
  const sections: [string, string[]][] = [
    ["Input Format", question.input],
    ["Output Format", question.output],
    ["Constraints", question.constraints],
  ]

  return (
    <div className={styles.body}>
      <div className="flex flex-wrap items-center gap-2 text-caption text-body">
        <span
          className={cn(
            "rounded-full bg-muted px-2.5 py-1 text-caption-upper uppercase",
            LEVEL_COLORS[question.level]
          )}
        >
          {question.level}
        </span>
        {question.unitNo > 0 && (
          <span>
            Unit {question.unitNo} · {question.unit}
          </span>
        )}
      </div>
      <h1>
        {question.label}. {question.title}
      </h1>
      {(question.tags.length > 0 || question.unitNo > 0) && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5">
          {question.tags.map((tag) => (
            <TagChip key={tag.slug} name={tag.name} />
          ))}
          {question.unitNo > 0 && (
            <span className="ml-auto">
              <SaveMenu problemSlug={question.id} />
            </span>
          )}
        </div>
      )}

      {question.unitNo > 0 && <AssignmentChips problemSlug={question.id} />}

      {ownNotes.length > 0 && (
        <div className={styles.teacherNote}>
          <div className={styles.label}>Teacher&apos;s note</div>
          {ownNotes.map((note) => (
            <div key={note.id} className="wrap-anywhere whitespace-pre-wrap">
              {note.text}
            </div>
          ))}
        </div>
      )}

      <Markdown text={question.description} className="mb-2" />

      {sections.map(
        ([heading, items]) =>
          items.length > 0 && (
            <section key={heading} data-testid="problem-section">
              <h2>{heading}</h2>
              <ul>
                {items.map((item, index) => (
                  <li key={index}>
                    <InlineCode text={item} />
                  </li>
                ))}
              </ul>
            </section>
          )
      )}

      {question.samples.length > 0 && (
        <section>
          <h2>Sample Test Cases</h2>
          <div className="grid gap-3">
            {question.samples.map(([input, output], index) => (
              <SampleCard
                key={index}
                number={index + 1}
                input={input}
                output={output}
              />
            ))}
          </div>
        </section>
      )}

      <p className={styles.hint}>
        Submitting checks {plural(question.samples.length, "sample case")} and{" "}
        {plural(question.hiddenTestCount, "hidden test case")}.
      </p>

      {question.hints.length > 0 && (
        <HideDuringExam problemSlug={question.id}>
        <section>
          <h2>Hints</h2>
          <div className="grid gap-1.5">
            {question.hints.map((hint, index) => (
              <Collapsible key={index} className={styles.hintCard}>
                <CollapsibleTrigger className={styles.hintTrigger}>
                  Hint {index + 1}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Markdown text={hint} />
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </section>
        </HideDuringExam>
      )}

      {footer}
    </div>
  )
}
