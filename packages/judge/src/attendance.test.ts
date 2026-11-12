import assert from "node:assert/strict"
import { test } from "node:test"

import { countsAsPresent, summarizeAttendance } from "./attendance.ts"

test("late counts as there; absent doesn't", () => {
  assert.equal(countsAsPresent("present"), true)
  assert.equal(countsAsPresent("late"), true)
  assert.equal(countsAsPresent("absent"), false)
  assert.equal(countsAsPresent("excused"), false)
})

test("excused is left out of the percentage", () => {
  const s = summarizeAttendance(["present", "late", "absent", "excused"])
  assert.deepEqual(s, {
    present: 1,
    late: 1,
    absent: 1,
    excused: 1,
    counted: 3,
    percent: 67,
  })
})

test("nothing counted means no percentage", () => {
  assert.equal(summarizeAttendance([]).percent, null)
  assert.equal(summarizeAttendance(["excused", "excused"]).percent, null)
})
