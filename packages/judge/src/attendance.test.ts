import assert from "node:assert/strict"
import { test } from "node:test"

import {
  classesToReach,
  countsAsPresent,
  eligibility,
  readAttendanceSettings,
  summarizeAttendance,
} from "./attendance.ts"

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

test("the minimum attendance to sit exams", () => {
  assert.equal(readAttendanceSettings({}).minPercent, 75)
  assert.equal(readAttendanceSettings({ attendance: { minPercent: 80 } }).minPercent, 80)
  assert.equal(readAttendanceSettings({ attendance: { minPercent: 120 } }).minPercent, 75)
  assert.equal(eligibility(null, 75), "none")
  assert.equal(eligibility(74, 75), "short")
  assert.equal(eligibility(75, 75), "at_risk")
  assert.equal(eligibility(79, 75), "at_risk")
  assert.equal(eligibility(80, 75), "eligible")
})

test("classes needed to reach the minimum", () => {
  // 12 of 20 (60%): (12 + k) / (20 + k) ≥ 0.75 → k ≥ 12.
  assert.equal(classesToReach(12, 20, 75), 12)
  assert.equal(classesToReach(15, 20, 75), 0)
  assert.equal(classesToReach(0, 0, 75), 0)
  assert.equal(classesToReach(9, 10, 100), null)
  // 2 of 4 (50%) to 75%: k = ceil((300 - 200) / 25) = 4 → 6 of 8.
  assert.equal(classesToReach(2, 4, 75), 4)
})
