import assert from "node:assert/strict"
import { test } from "node:test"

import { runProblem, runState } from "./runs.ts"

test("where a run is", () => {
  // Twelve weeks from Monday 5 Jan to Sunday 29 Mar 2026.
  assert.deepEqual(runState("2026-01-05", "2026-03-29", "2026-01-01"), { status: "upcoming", week: null, weeks: 12, days: 4 })
  assert.deepEqual(runState("2026-01-05", "2026-03-29", "2026-01-05"), { status: "running", week: 1, weeks: 12, days: 83 })
  assert.equal(runState("2026-01-05", "2026-03-29", "2026-01-12").week, 2)
  assert.equal(runState("2026-01-05", "2026-03-29", "2026-03-29").week, 12)
  assert.deepEqual(runState("2026-01-05", "2026-03-29", "2026-04-01"), { status: "finished", week: null, weeks: 12, days: 0 })
  // A part week counts as one.
  assert.equal(runState("2026-01-05", "2026-01-15", "2026-01-05").weeks, 2)
})

test("run dates", () => {
  assert.equal(runProblem(null, null), null)
  assert.equal(runProblem("2026-01-05", "2026-03-29"), null)
  assert.ok(runProblem("2026-01-05", null))
  assert.ok(runProblem("2026-03-29", "2026-01-05"))
  assert.ok(runProblem("2026-01-01", "2030-01-01"))
})
