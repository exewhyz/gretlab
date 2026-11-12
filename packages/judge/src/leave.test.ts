import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_STAFF_LEAVE_TYPES,
  leaveBalances,
  leaveDays,
  leaveKey,
  leaveOverlaps,
  leaveProblem,
  leaveTypesProblem,
  readLeaveSettings,
  schoolDaysBetween,
} from "./leave.ts"

const MON_FRI = [1, 2, 3, 4, 5]

test("counts school days only", () => {
  // 2026-11-13 is a Friday; 16 a Monday.
  assert.deepEqual(schoolDaysBetween("2026-11-13", "2026-11-16", MON_FRI), ["2026-11-13", "2026-11-16"])
  assert.equal(leaveDays({ startsOn: "2026-11-09", endsOn: "2026-11-15", halfDay: false }, MON_FRI), 5)
  assert.equal(leaveDays({ startsOn: "2026-11-09", endsOn: "2026-11-15", halfDay: false }, [1, 2, 3, 4, 5, 6]), 6)
  assert.equal(leaveDays({ startsOn: "2026-11-10", endsOn: "2026-11-10", halfDay: true }, MON_FRI), 0.5)
  assert.equal(leaveDays({ startsOn: "2026-11-14", endsOn: "2026-11-15", halfDay: false }, MON_FRI), 0)
})

test("checks a request", () => {
  const ok = { startsOn: "2026-11-16", endsOn: "2026-11-17", halfDay: false, reason: "Fever" }
  assert.equal(leaveProblem(ok, "2026-11-12", MON_FRI), null)
  assert.match(leaveProblem({ ...ok, endsOn: "2026-11-15" }, "2026-11-12", MON_FRI)!, /before/)
  assert.match(leaveProblem({ ...ok, halfDay: true }, "2026-11-12", MON_FRI)!, /single day/)
  assert.match(leaveProblem({ ...ok, startsOn: "2026-11-14", endsOn: "2026-11-15" }, "2026-11-12", MON_FRI)!, /days off/)
  assert.match(leaveProblem({ ...ok, startsOn: "2026-09-01", endsOn: "2026-09-02" }, "2026-11-12", MON_FRI)!, /30 days/)
  assert.match(leaveProblem({ ...ok, endsOn: "2027-03-01" }, "2026-11-12", MON_FRI)!, /90 days/)
  // Asking afterwards (a sick note) is fine within 30 days.
  assert.equal(leaveProblem({ ...ok, startsOn: "2026-11-02", endsOn: "2026-11-03" }, "2026-11-12", MON_FRI), null)
})

test("leave types", () => {
  assert.equal(leaveTypesProblem(DEFAULT_STAFF_LEAVE_TYPES), null)
  assert.equal(leaveKey("Maternity  Leave!"), "maternity-leave")
  assert.match(leaveTypesProblem([])!, /1 to 20/)
  assert.match(leaveTypesProblem([{ key: "a", name: "A", days: 1 }, { key: "a", name: "B", days: 1 }])!, /twice/)
  assert.match(leaveTypesProblem([{ key: "a", name: "A", days: 1.5 }])!, /whole number/)
  assert.deepEqual(readLeaveSettings({}).types, DEFAULT_STAFF_LEAVE_TYPES)
  assert.deepEqual(readLeaveSettings({ leave: { types: [{ key: "x", name: "X", days: null }] } }).types, [{ key: "x", name: "X", days: null }])
})

test("overlaps and balances", () => {
  assert.ok(leaveOverlaps({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, { startsOn: "2026-11-12", endsOn: "2026-11-13" }))
  assert.ok(!leaveOverlaps({ startsOn: "2026-11-10", endsOn: "2026-11-11" }, { startsOn: "2026-11-12", endsOn: "2026-11-13" }))
  const b = leaveBalances(DEFAULT_STAFF_LEAVE_TYPES, new Map([["casual", 3.5], ["unpaid", 4]]))
  assert.deepEqual(b.find((x) => x.key === "casual"), { key: "casual", name: "Casual leave", days: 12, used: 3.5, left: 8.5 })
  assert.equal(b.find((x) => x.key === "unpaid")!.left, null)
})
