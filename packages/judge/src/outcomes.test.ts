import assert from "node:assert/strict"
import { test } from "node:test"

import {
  attainmentLevel,
  coAttainment,
  DEFAULT_ATTAINMENT,
  poAttainment,
  validRules,
} from "./outcomes.ts"

test("levels follow the share of students reaching a CO", () => {
  const levels = DEFAULT_ATTAINMENT.levels
  assert.equal(attainmentLevel(70, levels), 3)
  assert.equal(attainmentLevel(69.9, levels), 2)
  assert.equal(attainmentLevel(60, levels), 2)
  assert.equal(attainmentLevel(50, levels), 1)
  assert.equal(attainmentLevel(49, levels), 0)
})

test("a CO counts students who reach the threshold among those assessed", () => {
  const result = coAttainment(
    [
      { earned: 60, max: 100 }, // exactly the threshold
      { earned: 90, max: 150 }, // 60%
      { earned: 59, max: 100 },
      { earned: 0, max: 100 },
      { earned: 0, max: 0 }, // nothing tagged reached them: not assessed
    ],
    DEFAULT_ATTAINMENT
  )
  assert.deepEqual(result, { assessed: 4, reached: 2, percent: 50, level: 1 })
})

test("nobody assessed means no attainment yet, not zero", () => {
  assert.deepEqual(coAttainment([], DEFAULT_ATTAINMENT), {
    assessed: 0,
    reached: 0,
    percent: null,
    level: null,
  })
})

test("a PO averages its COs' levels by mapping strength", () => {
  const cos = [
    { level: 3, mapping: { po1: 3, po2: 1 } },
    { level: 1, mapping: { po1: 1 } },
    { level: null, mapping: { po1: 3, po2: 3 } }, // not assessed: left out
  ]
  assert.equal(poAttainment(cos, "po1"), 2.5) // (3×3 + 1×1) / 4
  assert.equal(poAttainment(cos, "po2"), 3)
  assert.equal(poAttainment(cos, "po3"), null)
})

test("rules need a sensible threshold and rising levels", () => {
  assert.ok(validRules(DEFAULT_ATTAINMENT))
  assert.ok(!validRules({ threshold: 0, levels: [50, 60, 70] }))
  assert.ok(!validRules({ threshold: 60, levels: [60, 60, 70] }))
  assert.ok(!validRules({ threshold: 60, levels: [50, 60, 101] }))
})
