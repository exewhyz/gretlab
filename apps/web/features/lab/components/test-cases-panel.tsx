"use client"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { ConfirmButton } from "@/components/confirm"

import {
  MAX_RUN_CASES,
  useQuestionSession,
} from "../hooks/use-question-session"
import styles from "./workbench.module.scss"

export function TestCasesPanel() {
  const {
    cases,
    activeCase,
    caseActions,
    labelForCases,
    detail,
    isPlayground,
  } = useQuestionSession()
  const labelled = labelForCases()
  const current = labelled[activeCase]
  const isChecked = current ? current.sample >= 0 : false
  const expected = current ? detail?.samples[current.sample]?.[1] : undefined

  return (
    <>
      <div className={styles.caseChips} role="tablist" aria-label="Test cases">
        {labelled.map((item, index) => (
          <span
            key={index}
            role="tab"
            tabIndex={0}
            aria-selected={index === activeCase}
            className={styles.caseChip}
            onClick={() => caseActions.select(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter") caseActions.select(index)
            }}
          >
            {item.label}
            {cases.length > 1 && (
              <ConfirmButton
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${item.label}`}
                className="size-auto p-0 text-muted-foreground hover:bg-transparent hover:text-ink"
                title={`Remove ${item.label}?`}
                description="Its input goes; samples come back with Reset to samples."
                confirmLabel="Remove"
                onConfirm={() => caseActions.remove(index)}
              >
                ×
              </ConfirmButton>
            )}
          </span>
        ))}
        {cases.length < MAX_RUN_CASES && (
          <Button
            variant="ghost"
            size="xs"
            aria-label="Add a test case"
            onClick={caseActions.add}
          >
            + Add
          </Button>
        )}
        {!isPlayground && (
          <Button variant="ghost" size="xs" onClick={caseActions.reset}>
            Reset to samples
          </Button>
        )}
      </div>

      <label htmlFor="stdin" className="mb-1 block text-xs text-body">
        Input
      </label>
      <Textarea
        id="stdin"
        className={styles.stdin}
        spellCheck={false}
        placeholder="Type what your program reads, one value per line"
        value={cases[activeCase] ?? ""}
        onChange={(event) => caseActions.edit(event.target.value)}
      />

      {!isPlayground &&
        (isChecked ? (
          <>
            <div className="mt-2.5 mb-1 text-xs text-body">Expected output</div>
            <pre className={styles.output}>{expected}</pre>
          </>
        ) : (
          <p className="mt-2 text-xs text-body">
            This is your own input, so Run will show what your program prints
            but can&apos;t say whether it&apos;s correct.
          </p>
        ))}
    </>
  )
}
