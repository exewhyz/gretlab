import assert from "node:assert/strict"
import { test } from "node:test"

import { addDays, releaseModules } from "./course.ts"

const rule = (openAfterDays: number | null, afterPrevious = false, total = 2, done = 0) => ({
  openAfterDays,
  afterPrevious,
  total,
  done,
})

test("days count from the class's start, across months", () => {
  assert.equal(addDays("2026-01-30", 3), "2026-02-02")
  assert.equal(addDays("2026-11-10", 0), "2026-11-10")
})

test("a module opens on its day", () => {
  const [a, b] = releaseModules([rule(null), rule(7)], "2026-11-01", "2026-11-05")
  assert.equal(a!.open, true)
  assert.equal(b!.open, false)
  assert.equal(b!.waiting, "date")
  assert.equal(b!.opensOn, "2026-11-08")
  assert.equal(releaseModules([rule(null), rule(7)], "2026-11-01", "2026-11-08")[1]!.open, true)
})

test("nothing opens before the class starts", () => {
  assert.equal(releaseModules([rule(null)], "2026-12-01", "2026-11-30")[0]!.open, false)
})

test("after the previous one: waits until it's finished", () => {
  const waiting = releaseModules([rule(null, false, 2, 1), rule(null, true)], "2026-11-01", "2026-11-02")
  assert.equal(waiting[1]!.open, false)
  assert.equal(waiting[1]!.waiting, "previous")
  const done = releaseModules([rule(null, false, 2, 2), rule(null, true)], "2026-11-01", "2026-11-02")
  assert.equal(done[1]!.open, true)
})

test("a chain stays closed behind a closed module, even an empty one", () => {
  const r = releaseModules(
    [rule(null, false, 1, 0), rule(null, true, 0, 0), rule(null, true, 1, 0)],
    "2026-11-01",
    "2026-11-02"
  )
  assert.deepEqual(r.map((m) => m.open), [true, false, false])
})

test("an empty module that's open counts as finished", () => {
  const r = releaseModules([rule(null, false, 0, 0), rule(null, true)], "2026-11-01", "2026-11-01")
  assert.equal(r[1]!.open, true)
})

test("both rules: the day and the previous module", () => {
  const r = releaseModules([rule(null, false, 1, 1), rule(14, true)], "2026-11-01", "2026-11-05")
  assert.equal(r[1]!.waiting, "date")
})
