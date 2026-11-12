import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_SCALE,
  examProblem,
  gradeFor,
  markProblem,
  paperOutcome,
  paperProblem,
  ranks,
  readExamSettings,
  scaleProblem,
  summarize,
  weighted,
} from "./results.ts"

test("grades by the band a percentage falls in", () => {
  assert.equal(gradeFor(DEFAULT_SCALE, 100), "A1")
  assert.equal(gradeFor(DEFAULT_SCALE, 91), "A1")
  assert.equal(gradeFor(DEFAULT_SCALE, 90.9), "A2")
  assert.equal(gradeFor(DEFAULT_SCALE, 33), "D")
  assert.equal(gradeFor(DEFAULT_SCALE, 0), "E")
  // Order in storage doesn't matter.
  assert.equal(gradeFor([{ min: 0, grade: "F" }, { min: 50, grade: "P" }], 60), "P")
})

test("checks a scale", () => {
  assert.equal(scaleProblem(DEFAULT_SCALE), null)
  assert.match(scaleProblem([{ min: 0, grade: "A" }])!, /2 to 20/)
  assert.match(scaleProblem([{ min: 10, grade: "A" }, { min: 50, grade: "B" }])!, /0%/)
  assert.match(scaleProblem([{ min: 0, grade: "A" }, { min: 50, grade: "a" }])!, /twice/)
  assert.match(scaleProblem([{ min: 0, grade: "A" }, { min: 0, grade: "B" }])!, /Two grades/)
  assert.match(scaleProblem([{ min: 0, grade: "" }, { min: 50, grade: "B" }])!, /Name every/)
  assert.match(scaleProblem([{ min: 0, grade: "A" }, { min: 120, grade: "B" }])!, /0 to 100/)
})

test("reads settings, falling back to the default scale", () => {
  assert.deepEqual(readExamSettings({}).scale, DEFAULT_SCALE)
  assert.deepEqual(readExamSettings({ exams: { scale: [{ min: 0, grade: "X" }] } }).scale, DEFAULT_SCALE)
  const mine = readExamSettings({ exams: { scale: [{ min: 0, grade: "F" }, { min: 40, grade: "P" }] } })
  assert.deepEqual(mine.scale.map((b) => b.grade), ["P", "F"])
})

test("checks papers and marks", () => {
  assert.equal(paperProblem({ maxMarks: 80, passMarks: 27 }), null)
  assert.ok(paperProblem({ maxMarks: 0, passMarks: 0 }))
  assert.ok(paperProblem({ maxMarks: 50.5, passMarks: 10 }))
  assert.ok(paperProblem({ maxMarks: 50, passMarks: 51 }))
  assert.equal(markProblem(47.5, 80), null)
  assert.equal(markProblem(0, 80), null)
  assert.ok(markProblem(81, 80))
  assert.ok(markProblem(-1, 80))
  assert.ok(markProblem(47.25, 80))
})

test("a paper passes, fails, is missed or waits", () => {
  const p = { maxMarks: 100, passMarks: 33 }
  assert.equal(paperOutcome({ ...p, marks: 33, absent: false }), "pass")
  assert.equal(paperOutcome({ ...p, marks: 32.5, absent: false }), "fail")
  assert.equal(paperOutcome({ ...p, marks: null, absent: true }), "absent")
  assert.equal(paperOutcome({ ...p, marks: null, absent: false }), "pending")
})

test("sums an exam", () => {
  const p = (marks: number | null, absent = false) => ({ maxMarks: 50, passMarks: 17, marks, absent })
  assert.deepEqual(summarize([p(45), p(40)], DEFAULT_SCALE), {
    obtained: 85, maxMarks: 100, percent: 85, grade: "A2", result: "pass", failed: 0,
  })
  const missed = summarize([p(45), p(null, true)], DEFAULT_SCALE)
  assert.equal(missed.result, "fail")
  assert.equal(missed.percent, 45)
  assert.equal(missed.failed, 1)
  assert.equal(summarize([p(45), p(null)], DEFAULT_SCALE).result, "incomplete")
  assert.equal(summarize([p(10), p(50)], DEFAULT_SCALE).result, "fail")
  assert.equal(summarize([], DEFAULT_SCALE).result, "none")
  assert.equal(summarize([{ maxMarks: 3, passMarks: 1, marks: 1, absent: false }], DEFAULT_SCALE).percent, 33.3)
})

test("weights exams into the year", () => {
  assert.equal(weighted([{ weight: 30, percent: 60 }, { weight: 70, percent: 80 }]), 74)
  assert.equal(weighted([{ weight: 3, percent: 60 }, { weight: 7, percent: 80 }]), 74)
  // An exam not sat drops out; one with no weight doesn't count.
  assert.equal(weighted([{ weight: 30, percent: null }, { weight: 70, percent: 80 }, { weight: 0, percent: 10 }]), 80)
  assert.equal(weighted([{ weight: 0, percent: 50 }]), null)
})

test("ranks with ties", () => {
  const r = ranks([
    { id: "a", score: 90 },
    { id: "b", score: 95 },
    { id: "c", score: 90 },
    { id: "d", score: 70 },
    { id: "e", score: null },
  ])
  assert.deepEqual([...r.entries()].sort(), [["a", 2], ["b", 1], ["c", 2], ["d", 4]])
})

test("checks an exam", () => {
  assert.equal(examProblem({ name: "Half-yearly", startsOn: "2026-09-10", endsOn: "2026-09-20", weight: 40 }), null)
  assert.ok(examProblem({ name: "H", startsOn: null, endsOn: null, weight: 0 }))
  assert.ok(examProblem({ name: "Final", startsOn: null, endsOn: null, weight: 101 }))
  assert.ok(examProblem({ name: "Final", startsOn: "2026-09-20", endsOn: "2026-09-10", weight: 0 }))
})
