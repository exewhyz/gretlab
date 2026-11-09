import assert from "node:assert/strict"
import { test } from "node:test"

import { describeReason, warningFor } from "./warnings.ts"

const now = new Date("2026-11-10T12:00:00Z")
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
const base = { finished: [], openUnfinished: 0, lastActive: daysAgo(1), attendance: null }
const done = (earned: number, total = 100, missed = false) => ({ earned, total, missed })

test("a student doing fine has no warning", () => {
  assert.deepEqual(warningFor({ ...base, finished: [done(80), done(90)] }, now), { level: null, reasons: [] })
})

test("one missed assignment: watch; two: at risk", () => {
  assert.equal(warningFor({ ...base, finished: [done(0, 100, true)] }, now).level, "watch")
  const two = warningFor({ ...base, finished: [done(0, 100, true), done(0, 100, true), done(100)] }, now)
  assert.equal(two.level, "risk")
  assert.equal(describeReason(two.reasons[0]!), "Missed 2 assignments")
})

test("low marks count only after enough finished work", () => {
  assert.equal(warningFor({ ...base, finished: [done(10)] }, now).level, null)
  const low = warningFor({ ...base, finished: [done(10), done(30)] }, now)
  assert.deepEqual(low.reasons, [{ kind: "low", percent: 20 }])
  // Weighted by points, not averaged per assignment.
  assert.equal(warningFor({ ...base, finished: [done(5, 10), done(30, 190)] }, now).reasons[0]?.kind, "low")
})

test("quiet only matters while work is open", () => {
  assert.equal(warningFor({ ...base, lastActive: daysAgo(30) }, now).level, null)
  const quiet = warningFor({ ...base, openUnfinished: 1, lastActive: daysAgo(9) }, now)
  assert.equal(describeReason(quiet.reasons[0]!), "Nothing submitted in 9 days")
  assert.equal(warningFor({ ...base, openUnfinished: 1, lastActive: daysAgo(3) }, now).level, null)
  assert.equal(describeReason(warningFor({ ...base, openUnfinished: 2, lastActive: null }, now).reasons[0]!), "Hasn't submitted anything yet")
})

test("attendance needs enough marked classes", () => {
  assert.equal(warningFor({ ...base, attendance: { present: 1, total: 3 } }, now).level, null)
  assert.deepEqual(warningFor({ ...base, attendance: { present: 2, total: 4 } }, now).reasons, [{ kind: "attendance", percent: 50 }])
  assert.equal(warningFor({ ...base, attendance: { present: 3, total: 4 } }, now).level, null)
})

test("two different reasons make it at risk", () => {
  const w = warningFor({ ...base, finished: [done(0, 100, true)], attendance: { present: 1, total: 5 } }, now)
  assert.equal(w.level, "risk")
  assert.deepEqual(w.reasons.map((r) => r.kind), ["missed", "attendance"])
})
