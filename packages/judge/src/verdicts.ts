export const VERDICTS = {
  AC: "Accepted",
  /** The program finished, but there was no expected output to compare it with. */
  OK: "Finished",
  WA: "Wrong answer",
  TLE: "Time limit exceeded",
  MLE: "Memory limit exceeded",
  OLE: "Output limit exceeded",
  RE: "Runtime error",
  CE: "Compilation error",
  SE: "System error",
} as const

export type Verdict = keyof typeof VERDICTS

const isPass = (verdict: Verdict) => verdict === "AC" || verdict === "OK"

/**
 * The verdict for a whole submission: the first failing test, as judges conventionally
 * report it. A system error always wins, because it says nothing about the student's code.
 * Accepted is only ever earned by comparing output: anything unchecked makes it Finished.
 */
export function overallVerdict(tests: { verdict: Verdict }[]): Verdict {
  if (tests.some((test) => test.verdict === "SE")) return "SE"
  const failure = tests.find((test) => !isPass(test.verdict))
  if (failure) return failure.verdict
  return tests.some((test) => test.verdict === "OK") ? "OK" : "AC"
}

/**
 * What to call a result on screen. "Accepted" means every test passed in a graded submission.
 * A Run only tried some cases, so however well it went, it must never be called that.
 */
export function verdictLabel(verdict: Verdict, kind: "run" | "submit"): string {
  return kind === "run" && verdict === "AC"
    ? "Sample cases passed"
    : VERDICTS[verdict]
}
