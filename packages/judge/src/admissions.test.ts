import assert from "node:assert/strict"
import { test } from "node:test"

import {
  ageOn,
  applicationProblem,
  canMoveTo,
  DEFAULT_ADMISSIONS,
  nextApplicationNo,
  readAdmissionSettings,
} from "./admissions.ts"

test("where an application can go", () => {
  assert.ok(canMoveTo("submitted", "reviewing"))
  assert.ok(canMoveTo("reviewing", "waitlisted"))
  assert.ok(canMoveTo("waitlisted", "rejected"))
  assert.ok(!canMoveTo("submitted", "submitted"))
  assert.ok(!canMoveTo("submitted", "admitted"))
  assert.ok(!canMoveTo("rejected", "reviewing"))
  assert.ok(!canMoveTo("admitted", "rejected"))
  assert.ok(!canMoveTo("withdrawn", "reviewing"))
})

test("settings", () => {
  assert.deepEqual(readAdmissionSettings({}), DEFAULT_ADMISSIONS)
  assert.deepEqual(readAdmissionSettings({ admissions: { open: true, yearId: "y", gradeIds: ["a", 3] } }), {
    open: true,
    yearId: "y",
    gradeIds: ["a"],
    instructions: "",
  })
})

test("age and checking an application", () => {
  assert.equal(ageOn("2020-06-15", "2026-06-14"), 5)
  assert.equal(ageOn("2020-06-15", "2026-06-15"), 6)
  const ok = { studentName: "Asha Rao", birthDate: "2020-06-15", phone: "+91 98450 12345", parentName: "Ravi Rao" }
  assert.equal(applicationProblem(ok, "2026-11-12"), null)
  assert.match(applicationProblem({ ...ok, studentName: "A" }, "2026-11-12")!, /full name/)
  assert.match(applicationProblem({ ...ok, birthDate: "2027-01-01" }, "2026-11-12")!, /past/)
  assert.match(applicationProblem({ ...ok, birthDate: "2026-01-01" }, "2026-11-12")!, /Check/)
  assert.match(applicationProblem({ ...ok, phone: "call me" }, "2026-11-12")!, /phone/)
  assert.match(applicationProblem({ ...ok, parentName: "" }, "2026-11-12")!, /guardian/)
})

test("application numbers", () => {
  assert.equal(nextApplicationNo(2026, []), "APP-2026-0001")
  assert.equal(nextApplicationNo(2026, ["APP-2026-0009", "APP-2025-0042", "APP-2026-0002"]), "APP-2026-0010")
})
