import assert from "node:assert/strict"
import { test } from "node:test"

import {
  groupName,
  groupSummary,
  scoreCases,
  skipsCase,
} from "./test-groups.ts"
import type { Verdict } from "./verdicts.ts"

const cases = (...list: [string | null, number, Verdict][]) =>
  list.map(([group, points, verdict]) => ({ group, points, verdict }))

test("without groups, each passing test earns its own points", () => {
  const scored = scoreCases(
    cases([null, 1, "AC"], [null, 3, "WA"], [null, 2, "AC"])
  )
  assert.deepEqual(scored.points, [1, 0, 2])
  assert.equal(scored.score, 3)
  assert.equal(scored.maxScore, 6)
  assert.deepEqual(scored.groups, [])
})

test("a group earns the sum of its tests only when every test passes", () => {
  const scored = scoreCases(
    cases(
      ["Subtask 1", 10, "AC"],
      ["Subtask 1", 10, "AC"],
      ["Subtask 2", 15, "AC"],
      ["Subtask 2", 15, "WA"],
      ["Subtask 2", 15, "SK"]
    )
  )
  assert.deepEqual(scored.points, [10, 10, 0, 0, 0])
  assert.equal(scored.score, 20)
  assert.equal(scored.maxScore, 65)
  assert.deepEqual(scored.groups, [
    { name: "Subtask 1", points: 20, earned: 20, passed: true, tests: 2 },
    { name: "Subtask 2", points: 45, earned: 0, passed: false, tests: 3 },
  ])
})

test("grouped and ungrouped tests mix; a group needn't be consecutive", () => {
  const scored = scoreCases(
    cases(["A", 5, "AC"], [null, 1, "AC"], ["A", 5, "AC"], [null, 1, "TLE"])
  )
  assert.deepEqual(scored.points, [5, 1, 5, 0])
  assert.equal(scored.score, 11)
  assert.equal(scored.groups[0]!.tests, 2)
})

test("Finished (nothing to compare) never earns a group's points", () => {
  assert.equal(scoreCases(cases(["A", 5, "OK"])).score, 0)
})

test("a test whose group already failed is skipped; others aren't", () => {
  const list = [
    { group: "A" },
    { group: "A" },
    { group: null },
    { group: "B" },
    { group: "A" },
  ]
  const verdicts: Verdict[] = ["WA"]
  assert.equal(skipsCase(list, 1, verdicts), true)
  assert.equal(skipsCase(list, 2, [...verdicts, "SK"]), false)
  assert.equal(skipsCase(list, 3, [...verdicts, "SK", "WA"]), false)
  assert.equal(skipsCase(list, 4, [...verdicts, "SK", "WA", "AC"]), true)
  assert.equal(skipsCase(list, 1, ["AC"]), false)
  assert.equal(skipsCase([{ group: null }, { group: null }], 1, ["WA"]), false)
})

test("group names are trimmed; blank means no group", () => {
  assert.equal(groupName("  Subtask 1 "), "Subtask 1")
  assert.equal(groupName("   "), null)
  assert.equal(groupName(null), null)
  assert.equal(groupName(undefined), null)
})

test("a submission's groups, read back from its stored results", () => {
  const summary = groupSummary([
    { group: null, points: 0, verdict: "AC" },
    { group: "A", points: 10, worth: 10, verdict: "AC" },
    { group: "A", points: 10, worth: 10, verdict: "AC" },
    { group: "B", points: 0, worth: 15, verdict: "AC" },
    { group: "B", points: 0, worth: 15, verdict: "WA" },
    { group: "B", points: 0, worth: 15, verdict: "SK" },
  ])
  assert.deepEqual(summary, [
    { name: "A", points: 20, earned: 20, passed: true, tests: 2 },
    { name: "B", points: 45, earned: 0, passed: false, tests: 3 },
  ])
  assert.deepEqual(
    groupSummary([{ group: null, points: 1, verdict: "AC" }]),
    []
  )
})
