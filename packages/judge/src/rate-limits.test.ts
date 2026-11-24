import assert from "node:assert/strict"
import { test } from "node:test"

import { RATE_LIMITS, retryAfter, windowStart } from "./rate-limits.ts"

test("windows line up on the clock, so every server counts the same window", () => {
  const a = windowStart(new Date("2026-11-24T10:07:59Z"), 15 * 60)
  const b = windowStart(new Date("2026-11-24T10:00:00Z"), 15 * 60)
  assert.equal(a.toISOString(), "2026-11-24T10:00:00.000Z")
  assert.equal(b.toISOString(), "2026-11-24T10:00:00.000Z")
  assert.equal(
    windowStart(new Date("2026-11-24T10:15:00Z"), 15 * 60).toISOString(),
    "2026-11-24T10:15:00.000Z"
  )
})

test("retry after: the seconds to the window's end, never zero", () => {
  assert.equal(retryAfter(new Date("2026-11-24T10:14:30Z"), 15 * 60), 30)
  assert.equal(retryAfter(new Date("2026-11-24T10:14:59.900Z"), 15 * 60), 1)
  assert.equal(retryAfter(new Date("2026-11-24T10:00:00Z"), 60), 60)
})

test("every limit allows something and has a window", () => {
  for (const [action, l] of Object.entries(RATE_LIMITS)) {
    assert.ok(l.max >= 1 && l.seconds >= 60, action)
  }
})
