"use client"

import {
  describeFirstDifference,
  VERDICTS,
  verdictLabel,
} from "@workspace/judge"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

import type { TestOutcome } from "../hooks/use-question-session"
import { useQuestionSession } from "../hooks/use-question-session"
import styles from "./workbench.module.scss"

const failed = (outcome: TestOutcome) =>
  outcome.verdict !== "AC" && outcome.verdict !== "OK"

function dotClass(outcome: TestOutcome) {
  if (outcome.verdict === "AC") return styles.dotPass
  return outcome.verdict === "OK" ? styles.dotNeutral : styles.dotFail
}

const VERDICT_HELP: Partial<Record<TestOutcome["verdict"], string>> = {
  TLE: "Your program ran past the time limit and was stopped. Look for a loop that never ends.",
  MLE: "Your program used more memory than allowed and was stopped.",
  OLE: "Your program printed too much output and was stopped.",
  SE: "The server couldn't run this. It isn't your code's fault: please try again.",
}

function Block({
  label,
  value,
  tone,
  testId,
}: {
  label: string
  value: string
  tone?: "error" | "wrong"
  testId?: string
}) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 text-xs text-body">{label}</div>
      <pre
        data-testid={testId}
        className={cn(
          styles.output,
          tone === "error" && styles.outputError,
          tone === "wrong" && styles.outputWrong
        )}
      >
        {value}
      </pre>
    </div>
  )
}

/** Input, output and expected output, stacked so that long lines stay readable. */
export function OutcomeDetail({ outcome }: { outcome: TestOutcome }) {
  const help = VERDICT_HELP[outcome.verdict]
  if (outcome.hidden && outcome.stdout === null) {
    return (
      <div className="text-caption text-body">
        <b className={failed(outcome) ? "text-destructive" : "text-success"}>
          {VERDICTS[outcome.verdict]}
        </b>
        . This is a hidden test, so its input and output aren&apos;t shown.
        {help && ` ${help}`}
      </div>
    )
  }
  const wrong = outcome.verdict === "WA"
  return (
    <>
      {help && <p className="mb-2.5 text-caption text-destructive">{help}</p>}
      {/* What a student came to compare goes first, side by side. */}
      <div className="grid gap-x-2.5 min-[901px]:grid-cols-2">
        <Block
          label="Your output"
          testId="run-output"
          value={outcome.stdout || "(no output)"}
          tone={wrong ? "wrong" : undefined}
        />
        {outcome.expected !== null && (
          <Block label="Expected output" value={outcome.expected} />
        )}
      </div>
      {wrong && outcome.expected !== null && (
        <p className="mb-2.5 text-caption text-body">
          {describeFirstDifference(outcome.stdout ?? "", outcome.expected)}
        </p>
      )}
      {outcome.stderr && (
        <Block label="Error" value={outcome.stderr} tone="error" />
      )}
      {outcome.input !== null && (
        <Block label="Input" value={outcome.input || "(empty)"} />
      )}
    </>
  )
}

/** Chips for each test, opening on the first failure. Shared with the submission page. */
export function OutcomeBrowser({ outcomes }: { outcomes: TestOutcome[] }) {
  const firstFailure = outcomes.findIndex(failed)
  const [picked, setPicked] = useState<number | null>(null)
  const active = picked ?? Math.max(0, firstFailure)
  const outcome = outcomes[active]
  if (!outcome) return null
  return (
    <>
      <div
        className={styles.caseChips}
        role="tablist"
        aria-label="Test results"
      >
        {outcomes.map((item, index) => (
          <Button
            key={item.label + index}
            type="button"
            variant="ghost"
            role="tab"
            aria-selected={index === active}
            className={cn(styles.caseChip, "h-auto")}
            onClick={() => setPicked(index)}
          >
            <span aria-hidden className={dotClass(item)} />
            {item.label}
          </Button>
        ))}
      </div>
      <OutcomeDetail outcome={outcome} />
      {outcome.wallMs !== undefined && (
        <p className="text-xs text-body tabular-nums">
          {outcome.wallMs} ms
          {outcome.maxRssKb
            ? ` · ${(outcome.maxRssKb / 1024).toFixed(1)} MB`
            : ""}
        </p>
      )}
    </>
  )
}

export function TestResults() {
  const { testRun, runError, mode, viewer } = useQuestionSession()
  const nextStep =
    mode === "server"
      ? "Submit to grade it against every test."
      : viewer?.user
        ? "Submitting is paused while server execution is off."
        : "Sign in to submit it against the hidden tests."

  if (runError) {
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {runError}
      </p>
    )
  }
  if (!testRun) {
    return (
      <p className="text-body-sm text-body">
        <b>Run</b> tries your code on the test cases.{" "}
        {mode === "server"
          ? "Submit grades it against every test, including hidden ones."
          : nextStep}
      </p>
    )
  }
  if (testRun.phase === "running") {
    return <p className="text-body-sm text-body">{testRun.message}</p>
  }

  const { kind, verdict, outcomes, compileOutput } = testRun
  const compared = outcomes.filter((o) => o.verdict !== "OK")
  const passed = compared.filter((o) => o.verdict === "AC").length
  const isGood = verdict === "AC"
  const nothingChecked = verdict === "OK"
  const pointsMatter =
    kind === "submit" &&
    testRun.maxScore !== null &&
    testRun.maxScore > 0 &&
    testRun.maxScore !== outcomes.length

  const headline = verdictLabel(verdict, kind)

  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          data-testid="verdict"
          className={cn(
            "text-title-md",
            isGood && "text-success",
            nothingChecked && "text-ink",
            !isGood && !nothingChecked && "text-destructive"
          )}
        >
          {headline}
        </span>
        {compared.length > 0 && verdict !== "CE" && (
          <span className="text-caption text-body tabular-nums">
            {passed} / {compared.length} {kind === "submit" ? "tests" : "cases"}{" "}
            passed
          </span>
        )}
        {pointsMatter && (
          <span className="text-caption text-body tabular-nums">
            {testRun.score} / {testRun.maxScore} points
          </span>
        )}
      </div>

      {kind === "run" && verdict !== "CE" && (
        <p className="mb-2.5 text-caption text-body">
          {nothingChecked
            ? "This was your own input, so nothing was checked. "
            : "This only checks the cases shown here. "}
          {nextStep}
        </p>
      )}
      {kind === "submit" && (
        <p className="mb-2.5 text-caption text-body">
          Saved in the Submissions tab.
        </p>
      )}

      {verdict === "CE" && compileOutput && (
        <pre className={cn(styles.output, styles.outputError)}>
          {compileOutput}
        </pre>
      )}
      <OutcomeBrowser outcomes={outcomes} />
    </>
  )
}
