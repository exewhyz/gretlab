import assert from "node:assert/strict"
import { test } from "node:test"

import {
  affiliationNext,
  collegeCodeProblem,
  normalizeCollegeCode,
  admissionYearProblem,
  registrationNext,
  registrationNumber,
  semesterProblem,
  syllabusCourseProblem,
} from "./university.ts"

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

test("a syllabus course's marks: internal and external add up, pass marks within them", () => {
  const ok = { internalMax: 40, externalMax: 60, passExternal: 21, passTotal: 40 }
  assert.equal(syllabusCourseProblem(ok), null)
  assert.equal(syllabusCourseProblem({ ...ok, internalMax: 0 }), null) // a theory paper may be all external
  assert.equal(
    syllabusCourseProblem({ ...ok, internalMax: 0, externalMax: 0 }),
    "A course is out of more than 0 marks."
  )
  assert.equal(
    syllabusCourseProblem({ ...ok, passExternal: 61 }),
    "The external pass mark can't be more than the external marks."
  )
  assert.equal(
    syllabusCourseProblem({ ...ok, passTotal: 101 }),
    "The pass mark can't be more than the course's total."
  )
  assert.equal(
    syllabusCourseProblem({ ...ok, internalMax: 40.5 }),
    "Marks are whole numbers."
  )
  assert.equal(syllabusCourseProblem({ ...ok, externalMax: 1001 }), "A course is out of at most 1,000 marks.")
})

test("a semester is 1 to 12", () => {
  assert.equal(semesterProblem(1), null)
  assert.equal(semesterProblem(12), null)
  assert.equal(semesterProblem(0), "A semester is 1 to 12.")
  assert.equal(semesterProblem(2.5), "A semester is 1 to 12.")
})

test("a registration number is the college code, the admission year and a 4-digit sequence", () => {
  assert.equal(registrationNumber("FC1", 2026, 7), "FC120260007")
  assert.equal(registrationNumber("1RV", 2025, 1234), "1RV20251234")
  assert.equal(registrationNumber("FC1", 2026, 12345), "FC1202612345")
})

test("an admission year is a whole year from 2000 to 2100", () => {
  assert.equal(admissionYearProblem(2026), null)
  assert.equal(admissionYearProblem(1999), "An admission year is from 2000 to 2100.")
  assert.equal(admissionYearProblem(2026.5), "An admission year is from 2000 to 2100.")
})

test("a registration is asked for, then approved or rejected; only a waiting one can be cancelled", () => {
  assert.deepEqual(registrationNext("requested", "approve"), { ok: true, status: "approved" })
  assert.deepEqual(registrationNext("requested", "reject"), { ok: true, status: "rejected" })
  assert.deepEqual(registrationNext("requested", "cancel"), { ok: true, status: "cancelled" })
  assert.equal(registrationNext("approved", "reject").ok, false)
  assert.equal(registrationNext("rejected", "approve").ok, false)
  assert.equal(registrationNext("approved", "cancel").ok, false)
})
