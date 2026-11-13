import assert from "node:assert/strict"
import { test } from "node:test"

import { eventProblem, placeFor, promote } from "./events.ts"

test("places until it's full, then the waitlist", () => {
  assert.equal(placeFor(null, 500), "going")
  assert.equal(placeFor(2, 1), "going")
  assert.equal(placeFor(2, 2), "waitlist")
})

test("the longest waiting move up into free places", () => {
  const w = [
    { userId: "c", at: new Date("2026-01-03") },
    { userId: "a", at: new Date("2026-01-01") },
    { userId: "b", at: new Date("2026-01-02") },
  ]
  assert.deepEqual(promote(3, 2, w), ["a"])
  assert.deepEqual(promote(5, 2, w), ["a", "b", "c"])
  assert.deepEqual(promote(2, 2, w), [])
  assert.deepEqual(promote(null, 9, w), ["a", "b", "c"])
})

test("event times", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h))
  assert.equal(eventProblem(t(10), t(12)), null)
  assert.ok(eventProblem(t(12), t(10)))
  assert.ok(eventProblem(t(10), t(10)))
  assert.ok(eventProblem(t(0), new Date(Date.UTC(2026, 0, 20))))
})
