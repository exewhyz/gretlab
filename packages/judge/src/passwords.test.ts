import assert from "node:assert/strict"
import { test } from "node:test"

import { passwordProblem } from "./passwords.ts"

test("password rules", () => {
  assert.equal(passwordProblem("correct horse battery"), null)
  assert.equal(passwordProblem("Tr0ub4dor&3x"), null)
  assert.ok(passwordProblem("short1!"))
  assert.ok(passwordProblem("x".repeat(129)))
  assert.ok(passwordProblem("Password123"))
  assert.ok(passwordProblem("aaaaaaaaaaaa"))
  assert.ok(passwordProblem("abababababab"))
  assert.ok(passwordProblem("abcdefghijkl"))
  assert.ok(passwordProblem("9876543210"))
  assert.ok(passwordProblem("priya.sharma2026", "priya.sharma@example.com"))
  assert.equal(passwordProblem("blue kettle sings", "priya@example.com"), null)
})
