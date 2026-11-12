import assert from "node:assert/strict"
import { test } from "node:test"

import {
  checkInStatus,
  DEFAULT_STAFF_ATTENDANCE,
  readStaffAttendanceSettings,
  summarizeStaff,
  timeIn,
  validTime,
} from "./staff-attendance.ts"

test("settings fall back to defaults", () => {
  assert.deepEqual(readStaffAttendanceSettings({}), DEFAULT_STAFF_ATTENDANCE)
  assert.deepEqual(readStaffAttendanceSettings({ staffAttendance: { lateAfter: "25:00", selfCheckIn: false } }), {
    lateAfter: "09:00",
    selfCheckIn: false,
  })
  assert.equal(readStaffAttendanceSettings({ staffAttendance: { lateAfter: "08:30" } }).lateAfter, "08:30")
})

test("times", () => {
  assert.ok(validTime("07:05"))
  assert.ok(!validTime("7:05"))
  assert.equal(timeIn("Asia/Kolkata", new Date("2026-11-12T03:00:00Z")), "08:30")
  assert.equal(timeIn("UTC", new Date("2026-11-12T00:05:00Z")), "00:05")
  assert.equal(checkInStatus("09:00", "09:00"), "present")
  assert.equal(checkInStatus("09:01", "09:00"), "late")
})

test("a month in numbers", () => {
  assert.deepEqual(summarizeStaff(["present", "late", "half_day", "absent", "on_leave"]), {
    present: 1, late: 1, half: 1, absent: 1, leave: 1, marked: 5, percent: 62.5,
  })
  assert.equal(summarizeStaff(["on_leave"]).percent, null)
})
