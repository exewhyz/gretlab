import assert from "node:assert/strict"
import { test } from "node:test"

import {
  admissionPrefix,
  isNoLoginEmail,
  nextAdmissionNo,
  nextSerial,
  noLoginEmail,
  yearProblem,
  yearsOverlap,
} from "./records.ts"

test("a year needs a name and must end after it starts", () => {
  assert.equal(
    yearProblem({
      name: "2026-2027",
      startsOn: "2026-06-01",
      endsOn: "2027-05-31",
    }),
    null
  )
  assert.match(
    yearProblem({ name: "x", startsOn: "2026-06-01", endsOn: "2027-05-31" }) ??
      "",
    /2 to 40/
  )
  assert.match(
    yearProblem({
      name: "2026",
      startsOn: "2026-06-01",
      endsOn: "2026-06-01",
    }) ?? "",
    /end after/
  )
  assert.match(
    yearProblem({ name: "2026", startsOn: "June", endsOn: "2027-05-31" }) ?? "",
    /start and end/
  )
})

test("years overlap when they share a day", () => {
  const a = { startsOn: "2026-06-01", endsOn: "2027-05-31" }
  assert.ok(yearsOverlap(a, { startsOn: "2027-05-31", endsOn: "2028-05-30" }))
  assert.ok(!yearsOverlap(a, { startsOn: "2027-06-01", endsOn: "2028-05-31" }))
})

test("admission numbers count up from the highest with the prefix", () => {
  assert.equal(nextAdmissionNo("GF-2026-", []), "GF-2026-0001")
  assert.equal(
    nextAdmissionNo("GF-2026-", [
      "GF-2026-0006",
      "GF-2026-0002",
      "GF-2025-0099",
      "custom",
    ]),
    "GF-2026-0007"
  )
  assert.equal(nextAdmissionNo("GF-2026-", ["GF-2026-12345"]), "GF-2026-12346")
})

test("a prefix from the school's name and the year", () => {
  assert.equal(
    admissionPrefix("Greenfield International School", 2026),
    "GIS-2026-"
  )
  assert.equal(admissionPrefix("St. Mary's", 2026), "SMS-2026-")
  assert.equal(admissionPrefix("123", 2026), "S-2026-")
})

test("students who don't sign in have an address that can't receive mail", () => {
  const e = noLoginEmail("abc")
  assert.ok(e.endsWith(".invalid") && isNoLoginEmail(e))
  assert.ok(!isNoLoginEmail("asha@gmail.com"))
})

test("promotion: the same section of the next grade, the top grade graduates", async () => {
  const { suggestPromotion } = await import("./records.ts")
  const g = (id: string, name: string, parentId: string | null = null) => ({
    id,
    name,
    parentId,
  })
  const groups = [
    g("g2", "Grade 2"),
    g("g10", "Grade 10"),
    g("g9", "Grade 9"),
    g("g2a", "A", "g2"),
    g("g2b", "B", "g2"),
    g("g9a", "A", "g9"),
    g("g9b", "B", "g9"),
    g("g10a", "A", "g10"),
    g("solo", "Club"),
  ]
  assert.deepEqual(suggestPromotion(groups, ["g2a", "g9b", "g10a", "solo"]), {
    g2a: "g9a", // Grade 2 → Grade 9 is next in natural order here (no 3..8)
    g9b: "g10a", // no B in Grade 10: its first section
    g10a: "graduate",
    solo: "solo",
  })
})

test("numbered series", () => {
  assert.equal(nextSerial("TC-2026-", []), "TC-2026-0001")
  assert.equal(
    nextSerial("TC-2026-", ["TC-2026-0009", "TC-2025-0040", "X"]),
    "TC-2026-0010"
  )
})
