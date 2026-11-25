/**
 * How a problem's output is checked (the owner's decisions, 25 November 2026): built-in,
 * combinable comparers. With none, output is compared exactly (ignoring trailing spaces and
 * blank lines), as it always was. Numbers are read as numbers, whatever their spelling ("2.5E+3"
 * is 2500); everything else is a word, compared exactly unless case is ignored, which never
 * touches numbers. Used by the judge, browser grading and browser Runs alike.
 */
import { z } from "zod"

import { normalizeOutput } from "./output.ts"

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
  })
  .strict()

/** How a problem's output is checked, as its schema describes it. */
export type Checker = z.infer<typeof checkerSchema>

/** A plain decimal number: digits, a point, an exponent. Hex, infinity and NaN are words. */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** No comparer set: the exact comparison. */
export function isExact(checker: Checker | null | undefined): boolean {
  return (
    !checker ||
    (!checker.spacing &&
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
