import assert from "node:assert/strict"
import { test } from "node:test"

import {
  admissionPrefix,
  isNoLoginEmail,
  nextAdmissionNo,
  noLoginEmail,
  yearProblem,
  yearsOverlap,
} from "./records.ts"

test("a year needs a name and must end after it starts", () => {
  assert.equal(yearProblem({ name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31" }), null)
  assert.match(yearProblem({ name: "x", startsOn: "2026-06-01", endsOn: "2027-05-31" }) ?? "", /2 to 40/)
  assert.match(yearProblem({ name: "2026", startsOn: "2026-06-01", endsOn: "2026-06-01" }) ?? "", /end after/)
  assert.match(yearProblem({ name: "2026", startsOn: "June", endsOn: "2027-05-31" }) ?? "", /start and end/)
})

test("years overlap when they share a day", () => {
  const a = { startsOn: "2026-06-01", endsOn: "2027-05-31" }
  assert.ok(yearsOverlap(a, { startsOn: "2027-05-31", endsOn: "2028-05-30" }))
  assert.ok(!yearsOverlap(a, { startsOn: "2027-06-01", endsOn: "2028-05-31" }))
})

test("admission numbers count up from the highest with the prefix", () => {
  assert.equal(nextAdmissionNo("GF-2026-", []), "GF-2026-0001")
  assert.equal(nextAdmissionNo("GF-2026-", ["GF-2026-0006", "GF-2026-0002", "GF-2025-0099", "custom"]), "GF-2026-0007")
  assert.equal(nextAdmissionNo("GF-2026-", ["GF-2026-12345"]), "GF-2026-12346")
})

test("a prefix from the school's name and the year", () => {
  assert.equal(admissionPrefix("Greenfield International School", 2026), "GIS-2026-")
  assert.equal(admissionPrefix("St. Mary's", 2026), "SMS-2026-")
  assert.equal(admissionPrefix("123", 2026), "S-2026-")
})

test("students who don't sign in have an address that can't receive mail", () => {
  const e = noLoginEmail("abc")
  assert.ok(e.endsWith(".invalid") && isNoLoginEmail(e))
  assert.ok(!isNoLoginEmail("asha@gmail.com"))
})
