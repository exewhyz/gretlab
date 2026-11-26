/**
 * How a problem's output is checked (the owner's decisions, 25 November 2026): built-in,
 * combinable comparers. With none, output is compared exactly (ignoring trailing spaces and
 * blank lines), as it always was. Numbers are read as numbers, whatever their spelling ("2.5E+3"
 * is 2500); everything else is a word, compared exactly unless case is ignored, which never
 * touches numbers. Used by the judge, browser grading and browser Runs alike.
 */
import { z } from "zod"

import { LANGUAGE_IDS, type LanguageId } from "./languages.ts"
import { normalizeOutput } from "./output.ts"
import type { Verdict } from "./verdicts.ts"

/** How long a checker program may take for one test. */
export const CHECKER_TIME_MS = 10_000
/** The longest a checker program's source may be. */
export const CHECKER_CODE_CHARS = 20_000
/** Memory a checker program's own sandbox may use, on top of the student's. */
export const CHECKER_MEMORY_MB = 512

/** What a submission takes of a judge's memory: the student's limit, plus its checker's. */
export function jobMemoryMb(
  memoryLimitMb: number,
  checker: Checker | null | undefined
) {
  return memoryLimitMb + (checker?.program ? CHECKER_MEMORY_MB : 0)
}

/** What's kept of a checker's message, per test. */
export const CHECKER_MESSAGE_CHARS = 500

/**
 * A checker program written by a teacher (the owner's decisions, 26 November 2026), for answers
 * that need real checking: any valid shortest path, any order of a set. It runs in its own
 * sandbox, never the student's, with three files: input.txt (the test's input), output.txt (what
 * the student printed) and answer.txt (the expected output). Exit 0: right; 1: wrong; 3: partly
 * right, with the share (0 to 1) on the first line. Anything else is the checker failing. Later
 * lines (or all of it, for 0 and 1) are a message for staff.
 */
const programSchema = z.object({
  language: z.enum(LANGUAGE_IDS as [LanguageId, ...LanguageId[]]),
  code: z
    .string()
    .max(CHECKER_CODE_CHARS)
    .refine((code) => code.trim().length > 0, "Write the checker's code"),
})

export const checkerSchema = z
  .object({
    /** Compare word by word: spacing and line breaks between values don't matter. */
    spacing: z.boolean().optional(),
    /** Read numbers as numbers and accept any within either tolerance. */
    numbers: z
      .object({
        absolute: z.number().min(0).max(1e6).optional(),
        relative: z.number().min(0).max(1).optional(),
      })
      .refine(
        (n) => n.absolute !== undefined || n.relative !== undefined,
        "Give an absolute or a relative tolerance"
      )
      .optional(),
    /** The same lines in any order. */
    unordered: z.boolean().optional(),
    /** Upper and lower case count as the same, in words. */
    ignoreCase: z.boolean().optional(),
    /** A program decides instead (it runs in the sandbox); it can't be combined with the rest. */
    program: programSchema.optional(),
  })
  .strict()
  .refine(
    (c) =>
      !c.program || (!c.spacing && !c.numbers && !c.unordered && !c.ignoreCase),
    "A checker program decides on its own: turn the other options off"
  )

/** How a problem's output is checked, as its schema describes it. */
export type Checker = z.infer<typeof checkerSchema>

/** A plain decimal number: digits, a point, an exponent. Hex, infinity and NaN are words. */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** A checker program: only the judge's sandbox can check, never the browser or this file. */
export function needsSandbox(checker: Checker | null | undefined): boolean {
  return Boolean(checker?.program)
}

/**
 * A checker as students' pages get it: a checker program's code stays with staff (it may hold
 * the solution); its language and that there is one are enough for the editor.
 */
export function withoutProgramCode(
  checker: Checker | null | undefined
): Checker | null {
  if (!checker) return null
  return checker.program
    ? { program: { language: checker.program.language, code: "" } }
    : checker
}

/** No comparer set: the exact comparison. */
export function isExact(checker: Checker | null | undefined): boolean {
  return (
    !checker ||
    (!checker.program &&
      !checker.spacing &&
      !checker.numbers &&
      !checker.unordered &&
      !checker.ignoreCase)
  )
}

function sameToken(actual: string, expected: string, checker: Checker) {
  const tol = checker.numbers
  if (tol && NUMBER.test(expected) && NUMBER.test(actual)) {
    const a = Number(actual)
    const e = Number(expected)
    const diff = Math.abs(a - e)
    // A hair of slack, so 0.1 + 0.2 against 0.3 within 0 isn't refused for binary rounding.
    const eps = 1e-12 * Math.max(1, Math.abs(e))
    return (
      diff <= (tol.absolute ?? -1) + eps ||
      diff <= (tol.relative ?? -1) * Math.abs(e) + eps
    )
  }
  return checker.ignoreCase
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected
}

const tokens = (text: string) => text.split(/\s+/).filter(Boolean)

function sameSequence(actual: string[], expected: string[], checker: Checker) {
  return (
    actual.length === expected.length &&
    expected.every((e, i) => sameToken(actual[i]!, e, checker))
  )
}

/** One line against another: word by word when numbers or spacing are in play, else as text. */
function sameLine(actual: string, expected: string, checker: Checker) {
  if (checker.numbers || checker.spacing)
    return sameSequence(tokens(actual), tokens(expected), checker)
  return checker.ignoreCase
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected
}

export function compareOutputs(
  actual: string,
  expected: string,
  checker: Checker | null | undefined
): boolean {
  if (needsSandbox(checker))
    throw new Error("A checker program runs only in the judge's sandbox")
  const a = normalizeOutput(actual)
  const e = normalizeOutput(expected)
  if (isExact(checker)) return a === e
  const c = checker!
  if (c.unordered) {
    const left = a.split("\n")
    const want = e.split("\n")
    if (left.length !== want.length) return false
    // Each expected line takes one matching line the program printed, once.
    const used = new Array<boolean>(left.length).fill(false)
    return want.every((line) => {
      const i = left.findIndex((got, j) => !used[j] && sameLine(got, line, c))
      if (i < 0) return false
      used[i] = true
      return true
    })
  }
  if (c.spacing) return sameSequence(tokens(a), tokens(e), c)
  const left = a.split("\n")
  const want = e.split("\n")
  return (
    left.length === want.length &&
    want.every((line, i) => sameLine(left[i]!, line, c))
  )
}

const shown = (n: number) =>
  n !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e6)
    ? n
        .toExponential()
        .replace("e-", "e-")
        .replace(/\.?0+e/, "e")
    : String(n)

/** What students are told about how their output is checked; null when it's exact. */
export function describeChecker(
  checker: Checker | null | undefined
): string | null {
  if (isExact(checker)) return null
  const c = checker!
  if (c.program)
    return "A program written for this problem checks your output, so any correct answer is accepted."
  const parts: string[] = []
  if (c.spacing)
    parts.push("Spacing and line breaks between values don't matter.")
  if (c.numbers) {
    const { absolute, relative } = c.numbers
    parts.push(
      absolute !== undefined && relative !== undefined
        ? `Numbers within ${shown(absolute)}, or within ${shown(relative)} of the expected value relatively, are accepted.`
        : absolute !== undefined
          ? `Numbers within ${shown(absolute)} are accepted.`
          : `Numbers within ${shown(relative!)} of the expected value, relatively, are accepted.`
    )
  }
  if (c.unordered) parts.push("Lines may be in any order.")
  if (c.ignoreCase) parts.push("Upper and lower case count as the same.")
  return parts.join(" ")
}

export interface CheckerResult {
  verdict: Extract<Verdict, "AC" | "WA" | "PC" | "SE">
  /** The share of the test's points it earned. */
  fraction: number
  /** For staff: what the checker said. */
  message: string
}

/** What a checker program's exit and output mean (see programSchema above). */
export function readCheckerResult(run: {
  exitCode: number | null
  stdout: string
  timedOut: boolean
}): CheckerResult {
  const fail = (message: string): CheckerResult => ({
    verdict: "SE",
    fraction: 0,
    message,
  })
  const short = (text: string) => text.trim().slice(0, CHECKER_MESSAGE_CHARS)
  if (run.timedOut) return fail("The checker took too long.")
  if (run.exitCode === 0)
    return { verdict: "AC", fraction: 1, message: short(run.stdout) }
  if (run.exitCode === 1)
    return { verdict: "WA", fraction: 0, message: short(run.stdout) }
  if (run.exitCode === 3) {
    const [first = "", ...rest] = run.stdout.split("\n")
    const share = first.trim() === "" ? NaN : Number(first.trim())
    if (!Number.isFinite(share) || share < 0 || share > 1)
      return fail(
        "The checker exited 3 without a share from 0 to 1 on its first line."
      )
    const message = short(rest.join("\n"))
    if (share === 1) return { verdict: "AC", fraction: 1, message }
    if (share === 0) return { verdict: "WA", fraction: 0, message }
    return { verdict: "PC", fraction: share, message }
  }
  return fail(`The checker failed (exit ${run.exitCode ?? "unknown"}).`)
}
