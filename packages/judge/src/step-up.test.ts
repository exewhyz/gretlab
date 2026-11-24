import assert from "node:assert/strict"
import { test } from "node:test"

import { STEP_UP_MS, stepUpDue } from "./step-up.ts"

const NOW = Date.parse("2026-11-24T10:00:00Z")

test("without two-factor, nothing to step up with: let through", () => {
  assert.equal(stepUpDue(false, null, NOW), false)
  assert.equal(stepUpDue(false, NOW - 3 * STEP_UP_MS, NOW), false)
})

test("a code within the last ten minutes is enough", () => {
  assert.equal(stepUpDue(true, NOW, NOW), false)
  assert.equal(stepUpDue(true, NOW - STEP_UP_MS, NOW), false)
})

test("an older code, or none (a trusted browser), asks again", () => {
  assert.equal(stepUpDue(true, NOW - STEP_UP_MS - 1, NOW), true)
  assert.equal(stepUpDue(true, null, NOW), true)
})

test("servers' clocks may differ by a minute; further ahead asks again", () => {
  assert.equal(stepUpDue(true, NOW + 30_000, NOW), false)
  assert.equal(stepUpDue(true, NOW + 60 * 60_000, NOW), true)
})
