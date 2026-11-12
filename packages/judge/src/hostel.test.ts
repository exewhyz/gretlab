import assert from "node:assert/strict"
import { test } from "node:test"

import { bedLabel, bedLabels, bedsToRemove, roomRun } from "./hostel.ts"

test("beds are lettered, and go on past Z", () => {
  assert.deepEqual(bedLabels(3), ["A", "B", "C"])
  assert.equal(bedLabel(25), "Z")
  assert.equal(bedLabel(26), "AA")
  assert.equal(bedLabel(27), "AB")
})

test("a run of rooms", () => {
  assert.deepEqual(roomRun("A-", 101, 103), ["A-101", "A-102", "A-103"])
  assert.deepEqual(roomRun("", 7, 7), ["7"])
  assert.equal(roomRun("A-", 5, 4), null)
  assert.equal(roomRun("A-", 1, 500), null)
})

test("fewer beds removes the last ones, never an occupied one", () => {
  assert.deepEqual(bedsToRemove(["A", "B", "C"], 2, new Set(["A"])), ["C"])
  assert.deepEqual(bedsToRemove(["A", "B"], 3, new Set()), [])
  assert.equal(bedsToRemove(["A", "B", "C"], 1, new Set(["C"])), null)
})
