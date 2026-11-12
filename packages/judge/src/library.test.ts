import assert from "node:assert/strict"
import { test } from "node:test"

import { addDays } from "./course.ts"
import {
  available,
  cannotBorrow,
  isDay,
  loanStatus,
  readLibrarySettings,
} from "./library.ts"

test("settings fall back to 14 days and 3 books, and ignore nonsense", () => {
  assert.deepEqual(readLibrarySettings(null), { loanDays: 14, maxLoans: 3 })
  assert.deepEqual(readLibrarySettings({ library: { loanDays: 7, maxLoans: 5 } }), { loanDays: 7, maxLoans: 5 })
  assert.deepEqual(readLibrarySettings({ library: { loanDays: 0, maxLoans: "9" } }), { loanDays: 14, maxLoans: 3 })
})

test("days add across months and years", () => {
  assert.equal(addDays("2026-01-25", 14), "2026-02-08")
  assert.equal(addDays("2026-12-30", 3), "2027-01-02")
  assert.ok(isDay("2026-02-28"))
  assert.ok(!isDay("2026-2-28"))
  assert.ok(!isDay("tomorrow"))
})

test("a loan is overdue only after its due day", () => {
  assert.equal(loanStatus({ status: "out", dueOn: "2026-03-10" }, "2026-03-10"), "out")
  assert.equal(loanStatus({ status: "out", dueOn: "2026-03-10" }, "2026-03-11"), "overdue")
  assert.equal(loanStatus({ status: "returned", dueOn: "2026-03-10" }, "2026-04-01"), "returned")
  assert.equal(loanStatus({ status: "lost", dueOn: "2026-03-10" }, "2026-04-01"), "lost")
})

test("availability never goes below zero", () => {
  assert.equal(available(3, 1), 2)
  assert.equal(available(1, 2), 0)
})

test("borrowing: the same book twice, none on the shelf, then the limit", () => {
  const ok = { holding: 0, maxLoans: 3, copiesFree: 1, alreadyHasIt: false }
  assert.equal(cannotBorrow(ok), null)
  assert.equal(cannotBorrow({ ...ok, alreadyHasIt: true }), "has_it")
  assert.equal(cannotBorrow({ ...ok, copiesFree: 0 }), "unavailable")
  assert.equal(cannotBorrow({ ...ok, holding: 3 }), "limit")
})
