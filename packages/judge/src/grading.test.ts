import assert from "node:assert/strict"
import { test } from "node:test"

import {
  extendedDue,
  gradeProblem,
  personalDue,
  rubricEarned,
  rubricTotal,
} from "./grading.ts"

const rubric = [
  { id: "names", label: "Readable names", points: 5 },
  { id: "approach", label: "Approach", points: 10 },
]

test("rubric total adds every criterion", () => {
  assert.equal(rubricTotal(rubric), 15)
  assert.equal(rubricTotal([]), 0)
})

test("no rubric or no marks yet means nothing marked by hand", () => {
  assert.equal(rubricEarned([], { names: 3 }), null)
  assert.equal(rubricEarned(rubric, undefined), null)
  assert.equal(rubricEarned(rubric, {}), null)
})

test("rubric marks add up, partly marked counts what's given", () => {
  assert.equal(rubricEarned(rubric, { names: 4, approach: 7.5 }), 11.5)
  assert.equal(rubricEarned(rubric, { approach: 6 }), 6)
})

test("marks stay within each criterion and ignore unknown ones", () => {
  assert.equal(rubricEarned(rubric, { names: 50, approach: -3 }), 5)
  assert.equal(rubricEarned(rubric, { gone: 9 }), null)
})

const due = new Date("2026-11-10T18:00:00Z")
const later = new Date("2026-11-13T18:00:00Z")

test("an extension for the whole assignment moves every problem's due time", () => {
  const ext = { dueAt: later, problemIds: [] }
  assert.equal(extendedDue(due, ext, "p1").getTime(), later.getTime())
  assert.equal(personalDue(due, ext).getTime(), later.getTime())
})

test("reopening some problems moves only theirs", () => {
  const ext = { dueAt: later, problemIds: ["p2"] }
  assert.equal(extendedDue(due, ext, "p1").getTime(), due.getTime())
  assert.equal(extendedDue(due, ext, "p2").getTime(), later.getTime())
})

test("an extension never makes a due time earlier", () => {
  const earlier = { dueAt: new Date("2026-11-09T00:00:00Z"), problemIds: [] }
  assert.equal(extendedDue(due, earlier, "p1").getTime(), due.getTime())
  assert.equal(personalDue(due, null).getTime(), due.getTime())
})

test("work before an extended due time is on time, without the late penalty", () => {
  const policy = { opensAt: new Date("2026-11-01T00:00:00Z"), dueAt: due, allowLate: true, latePenaltyPercent: 50 }
  const attempt = { verdict: "AC" as const, score: null, maxScore: null, createdAt: new Date("2026-11-12T00:00:00Z") }
  assert.equal(gradeProblem(10, [attempt], policy).earned, 5)
  assert.equal(gradeProblem(10, [attempt], { ...policy, dueAt: extendedDue(due, { dueAt: later, problemIds: [] }, "p1") }).earned, 10)
})
