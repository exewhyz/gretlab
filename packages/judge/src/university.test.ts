import assert from "node:assert/strict"
import { test } from "node:test"

import { affiliationNext, collegeCodeProblem, normalizeCollegeCode } from "./university.ts"

test("an affiliation is asked for, then approved or refused, and an active one can end", () => {
  assert.deepEqual(affiliationNext(null, "request"), { ok: true, status: "requested" })
  assert.deepEqual(affiliationNext("requested", "approve"), { ok: true, status: "active" })
  assert.deepEqual(affiliationNext("requested", "refuse"), { ok: true, status: "refused" })
  assert.deepEqual(affiliationNext("requested", "withdraw"), { ok: true, status: "withdrawn" })
  assert.deepEqual(affiliationNext("active", "end"), { ok: true, status: "ended" })
})

test("an affiliation can't skip a step or come back to life", () => {
  assert.equal(affiliationNext("active", "approve").ok, false)
  assert.equal(affiliationNext("requested", "end").ok, false)
  assert.equal(affiliationNext("ended", "approve").ok, false)
  assert.equal(affiliationNext("refused", "approve").ok, false)
  assert.deepEqual(affiliationNext("active", "request"), {
    ok: false,
    problem: "This college is already affiliated to a university.",
  })
  assert.deepEqual(affiliationNext("requested", "request"), {
    ok: false,
    problem: "This college has already asked to affiliate.",
  })
  // After refusal or ending, a college may ask again.
  assert.equal(affiliationNext("refused", "request").ok, true)
  assert.equal(affiliationNext("ended", "request").ok, true)
})

test("a college code is 2 to 10 capitals and digits", () => {
  assert.equal(normalizeCollegeCode(" 1rv "), "1RV")
  assert.equal(collegeCodeProblem("1RV"), null)
  assert.equal(collegeCodeProblem("A"), "A college code is 2 to 10 letters and digits.")
  assert.equal(collegeCodeProblem("TOO-LONG-CODE"), "A college code is 2 to 10 letters and digits.")
  assert.equal(collegeCodeProblem("R V"), "A college code is 2 to 10 letters and digits.")
})
