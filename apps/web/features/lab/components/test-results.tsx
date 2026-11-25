"use client"

import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react"
import {
  describeFirstDifference,
  VERDICTS,
  verdictLabel,
  type GroupScore,
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
  return outcome.verdict === "OK" || outcome.verdict === "SK"
    ? styles.dotNeutral
    : styles.dotFail
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
  if (outcome.verdict === "SK") {
    return (
      <p className="text-caption text-body">
        <b>Skipped.</b> An earlier test in {outcome.group ?? "its group"}{" "}
        failed, so the group can&apos;t earn its points and this test
        wasn&apos;t run.
      </p>
    )
  }
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

/**
 * Each test group (subtask): what it earned of what it's worth, and where it failed. A group
 * earns its points only when every test in it passes. Shared with the submission page.
 */
export function GroupScores({
  groups,
  outcomes,
}: {
  groups: GroupScore[]
  outcomes: TestOutcome[]
}) {
  if (!groups.length) return null
  return (
    <ul className="mb-2.5 grid gap-1" data-testid="group-scores">
      {groups.map((g) => {
        const mine = outcomes.filter((o) => o.group === g.name)
        const failure = mine.find((o) => failed(o) && o.verdict !== "SK")
        const skipped = mine.filter((o) => o.verdict === "SK").length
        return (
          <li
            key={g.name}
            className="flex flex-wrap items-center gap-x-2 text-body-sm"
          >
            {g.passed ? (
              <CheckCircleIcon
                aria-hidden
                weight="fill"
                className="text-success"
              />
            ) : (
              <XCircleIcon
                aria-hidden
                weight="fill"
                className="text-destructive"
              />
            )}
            <span className="font-medium text-ink">{g.name}</span>
            <span className="text-body tabular-nums">
              {g.earned} / {g.points} points
            </span>
            <span className="text-caption text-body">
              {g.passed
                ? "every test passed"
                : `failed on ${failure?.label ?? "a test"}${skipped ? `, ${skipped} skipped` : ""}`}
            </span>
          </li>
        )
      })}
    </ul>
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
      {outcome.wallMs !== undefined && outcome.verdict !== "SK" && (
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
  const { testRun, runError, mode, submitMode, viewer } = useQuestionSession()
  const nextStep =
    submitMode === "server" || submitMode === "browser"
      ? "Submit to grade it against every test."
      : viewer?.user
        ? "Submitting is paused while the server can't run code."
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
        {mode === "server" || submitMode === "browser"
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
        {kind === "submit" && testRun.provisional && (
          <span
            className="rounded-full border border-hairline px-2 text-caption text-body"
            title="Graded in your browser and checked on the server. The server judges it again once it can, and that result replaces this one."
          >
            Provisional
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
      <GroupScores groups={testRun.groups} outcomes={outcomes} />
      <OutcomeBrowser outcomes={outcomes} />
    </>
  )
}
