import assert from "node:assert/strict"
import { test } from "node:test"

import { addMonths, trainingState } from "./training.ts"

test("adding months keeps to the month's end", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29")
  assert.equal(addMonths("2026-11-15", 12), "2027-11-15")
  assert.equal(addMonths("2026-12-01", 3), "2027-03-01")
})

test("where someone is with a training", () => {
  const at = (doneSince: string | null, dueOn: string | null, renewMonths: number | null, today: string) =>
    trainingState({ doneSince, dueOn, renewMonths, today })
  assert.deepEqual(at(null, null, null, "2026-05-01"), { status: "todo", validUntil: null, needBy: null })
  assert.equal(at(null, "2026-06-01", null, "2026-05-01").status, "todo")
  assert.equal(at(null, "2026-05-05", null, "2026-05-01").status, "due")
  assert.deepEqual(at(null, "2026-04-30", null, "2026-05-01"), { status: "overdue", validUntil: null, needBy: "2026-04-30" })
  // Due today isn't overdue yet.
  assert.equal(at(null, "2026-05-01", null, "2026-05-01").status, "due")
  // Finished without renewal holds for good.
  assert.deepEqual(at("2020-01-01", "2019-12-01", null, "2026-05-01"), { status: "done", validUntil: null, needBy: null })
  // With yearly renewal.
  assert.deepEqual(at("2026-01-10", null, 12, "2026-05-01"), { status: "done", validUntil: "2027-01-10", needBy: null })
  assert.equal(at("2025-05-20", null, 12, "2026-05-01").status, "expiring")
  assert.deepEqual(at("2025-04-20", null, 12, "2026-05-01"), { status: "expired", validUntil: "2026-04-20", needBy: "2026-04-20" })
})
