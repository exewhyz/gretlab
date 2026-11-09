import assert from "node:assert/strict"
import { test } from "node:test"

import { markQuestion, normalizeAnswer } from "./quiz.ts"

const single = { id: "q1", kind: "single" as const, points: 2, correct: ["b"], accepted: [] }
const multiple = { id: "q2", kind: "multiple" as const, points: 4, correct: ["a", "c"], accepted: [] }
const short = { id: "q3", kind: "short" as const, points: 3, correct: [], accepted: ["O(n log n)", "n log n"] }
const written = { id: "q4", kind: "written" as const, points: 5, correct: [], accepted: [] }

test("a single choice is right or wrong", () => {
  assert.equal(markQuestion(single, ["b"]).earned, 2)
  assert.equal(markQuestion(single, ["a"]).earned, 0)
})

test("multiple choice needs exactly the right options", () => {
  assert.equal(markQuestion(multiple, ["c", "a"]).earned, 4)
  assert.equal(markQuestion(multiple, ["a"]).earned, 0)
  assert.equal(markQuestion(multiple, ["a", "b", "c"]).earned, 0)
})

test("a short answer marks itself only when it matches an accepted answer", () => {
  assert.equal(markQuestion(short, "  N LOG N. ").earned, 3)
  const other = markQuestion(short, "It sorts by splitting the list in halves")
  assert.equal(other.earned, null)
  assert.equal(other.needsMarking, true)
})

test("written answers wait for the teacher", () => {
  assert.deepEqual(markQuestion(written, "Because recursion…"), {
    earned: null,
    needsMarking: true,
    byTeacher: false,
  })
})

test("nothing answered earns nothing and needs no marking", () => {
  assert.deepEqual(markQuestion(written, "  "), { earned: 0, needsMarking: false, byTeacher: false })
  assert.equal(markQuestion(multiple, []).earned, 0)
})

test("a teacher's mark replaces the automatic one, within the points", () => {
  assert.equal(markQuestion(single, ["a"], 1).earned, 1)
  assert.equal(markQuestion(written, "x", 9).earned, 5)
  assert.equal(markQuestion(short, "something else", 2).byTeacher, true)
})

test("answers compare without case, spacing or a final full stop", () => {
  assert.equal(normalizeAnswer("  Hello   World. "), "hello world")
})
