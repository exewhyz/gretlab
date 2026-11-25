import assert from "node:assert/strict"
import { test } from "node:test"

import { checkerSchema, compareOutputs, describeChecker } from "./checker.ts"

test("no checker: exact, ignoring trailing spaces and blank lines, as before", () => {
  assert.equal(compareOutputs("a b  \n\n", "a b", null), true)
  assert.equal(compareOutputs("a  b", "a b", null), false)
  assert.equal(compareOutputs("A", "a", null), false)
  assert.equal(compareOutputs("1.0", "1", null), false)
})

test("ignore spacing: word by word, line breaks included", () => {
  const c = { spacing: true }
  assert.equal(compareOutputs("  1   2\n3 ", "1 2 3", c), true)
  assert.equal(compareOutputs("1 2", "1 2 3", c), false)
  assert.equal(compareOutputs("12 3", "1 23", c), false)
})

test("numbers within a tolerance: read as numbers, whatever the spelling", () => {
  const c = { numbers: { absolute: 1e-6 } }
  assert.equal(compareOutputs("0.3333333", "0.333333333", c), true)
  assert.equal(compareOutputs("0.334", "0.333", c), false)
  assert.equal(compareOutputs("2.5E+3", "2500", c), true)
  assert.equal(compareOutputs("1e-05", "1.0E-5", c), true)
  assert.equal(compareOutputs("-0", "0", c), true)
  assert.equal(compareOutputs("Area: 3.1415927", "Area: 3.14159265", c), true)
  assert.equal(
    compareOutputs("area: 3.1415927", "Area: 3.14159265", c),
    false,
    "words stay exact"
  )
  assert.equal(compareOutputs("x", "1", c), false)
  assert.equal(
    compareOutputs("1 2", "1\n2", c),
    false,
    "line structure kept without ignore spacing"
  )
})

test("a relative tolerance scales with the expected number; either tolerance is enough", () => {
  const c = { numbers: { relative: 1e-6 } }
  assert.equal(compareOutputs("1000000.5", "1000000", c), true)
  assert.equal(compareOutputs("0.0000015", "0.000001", c), false)
  const both = { numbers: { absolute: 1e-9, relative: 1e-6 } }
  assert.equal(compareOutputs("1000000.5", "1000000", both), true)
})

test("things that aren't decimal numbers are words: hex, infinity, NaN", () => {
  const c = { numbers: { absolute: 1e-6 } }
  assert.equal(compareOutputs("0XFF", "0xff", c), false)
  assert.equal(compareOutputs("0xff", "0xff", c), true)
  assert.equal(compareOutputs("NaN", "NaN", c), true)
  assert.equal(compareOutputs("Infinity", "inf", c), false)
  assert.equal(compareOutputs("0XFF", "0xff", { ...c, ignoreCase: true }), true)
})

test("ignore case: words only, so it never changes how numbers compare", () => {
  const c = { ignoreCase: true }
  assert.equal(compareOutputs("YES", "yes", c), true)
  assert.equal(
    compareOutputs("Yes no", "yes  no", c),
    false,
    "spacing still counts"
  )
  assert.equal(compareOutputs("1E5", "1e5", c), true)
})

test("lines in any order: the same lines, each compared by the other rules", () => {
  const c = { unordered: true }
  assert.equal(compareOutputs("b\na\nc", "a\nb\nc", c), true)
  assert.equal(
    compareOutputs("a\na\nb", "a\nb\nb", c),
    false,
    "each line as often as expected"
  )
  assert.equal(compareOutputs("a\nb", "a\nb\nc", c), false)
  const mixed = {
    unordered: true,
    numbers: { absolute: 0.01 },
    ignoreCase: true,
    spacing: true,
  }
  assert.equal(
    compareOutputs("BOB  2.001\nann 1", "Ann 1.0\nbob 2", mixed),
    true
  )
})

test("the checker a problem stores is checked: tolerances in range, at least one", () => {
  assert.equal(
    checkerSchema.safeParse({ numbers: { absolute: 1e-6 } }).success,
    true
  )
  assert.equal(checkerSchema.safeParse({ numbers: {} }).success, false)
  assert.equal(
    checkerSchema.safeParse({ numbers: { absolute: -1 } }).success,
    false
  )
  assert.equal(
    checkerSchema.safeParse({ numbers: { relative: 2 } }).success,
    false
  )
  assert.equal(checkerSchema.safeParse({ spacing: "yes" }).success, false)
})

test("what students are told about how output is checked", () => {
  assert.equal(describeChecker(null), null)
  assert.equal(describeChecker({}), null)
  assert.equal(
    describeChecker({
      numbers: { absolute: 1e-6 },
      unordered: true,
      ignoreCase: true,
    }),
    "Numbers within 1e-6 are accepted. Lines may be in any order. Upper and lower case count as the same."
  )
  assert.equal(
    describeChecker({
      spacing: true,
      numbers: { absolute: 0.001, relative: 1e-9 },
    }),
    "Spacing and line breaks between values don't matter. Numbers within 0.001, or within 1e-9 of the expected value relatively, are accepted."
  )
})
