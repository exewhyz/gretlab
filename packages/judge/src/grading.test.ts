import assert from "node:assert/strict"
import { test } from "node:test"

import { rubricEarned, rubricTotal } from "./grading.ts"

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
