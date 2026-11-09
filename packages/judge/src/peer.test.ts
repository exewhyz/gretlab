import assert from "node:assert/strict"
import { test } from "node:test"

import { allocateReviews, checkScores, criteriaFor, OVERALL } from "./peer.ts"

const people = ["a", "b", "c", "d", "e"]

test("nobody reviews themselves; everyone gives and gets the same number", () => {
  const pairs = allocateReviews(people, 2, "seed")
  assert.equal(pairs.length, 10)
  assert.ok(pairs.every((p) => p.reviewer !== p.author))
  for (const x of people) {
    assert.equal(pairs.filter((p) => p.reviewer === x).length, 2)
    assert.equal(pairs.filter((p) => p.author === x).length, 2)
  }
  assert.equal(new Set(pairs.map((p) => `${p.reviewer}>${p.author}`)).size, 10, "no pair twice")
})

test("the same seed gives the same pairs; another seed, others", () => {
  assert.deepEqual(allocateReviews(people, 1, "x"), allocateReviews([...people].reverse(), 1, "x"))
  const many = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
  assert.notDeepEqual(allocateReviews(many, 1, "x"), allocateReviews(many, 1, "y"))
})

test("small classes: at most everyone else, nobody alone gets any", () => {
  assert.equal(allocateReviews(["a", "b"], 3, "s").length, 2)
  assert.deepEqual(allocateReviews(["a"], 2, "s"), [])
  assert.deepEqual(allocateReviews([], 2, "s"), [])
})

test("scores: every criterion, whole points in range, nothing unknown", () => {
  const criteria = [{ id: "r1", label: "Style", points: 5 }, { id: "r2", label: "Tests", points: 3 }]
  assert.deepEqual(checkScores(criteria, { r1: 5, r2: 0 }), [])
  assert.deepEqual(checkScores(criteria, { r1: 5 }), ['Score "Tests"'])
  assert.deepEqual(checkScores(criteria, { r1: 6, r2: 1.5 }), ['"Style" is out of 5', '"Tests" is out of 3'])
  assert.deepEqual(checkScores(criteria, { r1: 1, r2: 1, x: 1 }), ["A score for an unknown criterion"])
})

test("no rubric: one overall score", () => {
  assert.deepEqual(criteriaFor([]), [OVERALL])
})
