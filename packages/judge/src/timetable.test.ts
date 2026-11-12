import assert from "node:assert/strict"
import { test } from "node:test"

import { readTimetableSettings, teacherClash, validPeriod } from "./timetable.ts"

test("school days default to Monday to Friday and are cleaned", () => {
  assert.deepEqual(readTimetableSettings({}).days, [1, 2, 3, 4, 5])
  assert.deepEqual(readTimetableSettings({ timetable: { days: [6, 1, 1, 9, "x", 2] } }).days, [1, 2, 6])
  assert.deepEqual(readTimetableSettings({ timetable: { days: [] } }).days, [1, 2, 3, 4, 5])
  assert.deepEqual(readTimetableSettings(null).days, [1, 2, 3, 4, 5])
})

test("periods need valid 24-hour times in order", () => {
  assert.equal(validPeriod("09:00", "09:45"), true)
  assert.equal(validPeriod("09:45", "09:00"), false)
  assert.equal(validPeriod("09:00", "09:00"), false)
  assert.equal(validPeriod("9:00", "10:00"), false)
  assert.equal(validPeriod("24:00", "25:00"), false)
})

test("a teacher can't be in two classes at once", () => {
  const existing = [{ groupId: "A", day: 1, periodId: "p1", teacherId: "t1" }]
  assert.ok(teacherClash(existing, { groupId: "B", day: 1, periodId: "p1", teacherId: "t1" }))
  assert.equal(teacherClash(existing, { groupId: "B", day: 1, periodId: "p2", teacherId: "t1" }), null)
  assert.equal(teacherClash(existing, { groupId: "B", day: 2, periodId: "p1", teacherId: "t1" }), null)
  assert.equal(teacherClash(existing, { groupId: "B", day: 1, periodId: "p1", teacherId: "t2" }), null)
  // Its own cell is being replaced, not clashed with.
  assert.equal(teacherClash(existing, { groupId: "A", day: 1, periodId: "p1", teacherId: "t1" }), null)
  // No teacher yet: nothing to clash.
  assert.equal(teacherClash(existing, { groupId: "B", day: 1, periodId: "p1", teacherId: null }), null)
})
