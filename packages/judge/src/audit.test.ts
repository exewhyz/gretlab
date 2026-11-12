import assert from "node:assert/strict"
import { test } from "node:test"

import {
  auditCategory,
  categoryLabel,
  changesBetween,
  describeDevice,
  listChanges,
} from "./audit.ts"

test("an action's area is its first word, with a label", () => {
  assert.equal(auditCategory("role.update"), "role")
  assert.equal(categoryLabel("role"), "Roles")
  assert.equal(categoryLabel("syllabus"), "Classes")
  assert.equal(categoryLabel("newthing"), "Newthing")
})

test("only fields that changed, and only those given", () => {
  const changes = changesBetween(
    { name: "Old", listed: true, domains: ["a.edu"], description: "" },
    { name: "New", listed: true, domains: ["a.edu", "b.edu"], description: null },
    { name: "Name", listed: "Listed", domains: "Email domains", description: "About" }
  )
  assert.deepEqual(changes, [
    { field: "Name", from: "Old", to: "New" },
    { field: "Email domains", from: "a.edu", to: "a.edu, b.edu" },
  ])
})

test("a field not sent isn't a change", () => {
  assert.deepEqual(changesBetween({ name: "A" }, {}, { name: "Name" }), [])
})

test("booleans and blanks read as words", () => {
  assert.deepEqual(changesBetween({ open: false }, { open: true }, { open: "Open" }), [
    { field: "Open", from: "No", to: "Yes" },
  ])
})

test("lists: what was added and removed, or nothing", () => {
  assert.deepEqual(listChanges("Permissions", ["a", "b"], ["b", "c"]), {
    label: "Permissions",
    added: ["c"],
    removed: ["a"],
  })
  assert.equal(listChanges("Permissions", ["a"], ["a"]), null)
})

test("long text is shortened", () => {
  const [change] = changesBetween({ d: "x" }, { d: "y".repeat(200) }, { d: "About" })
  assert.equal(change?.to.length, 118)
})

test("devices in plain words", () => {
  assert.equal(
    describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
    "Chrome on macOS"
  )
  assert.equal(
    describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    "Safari on iPhone"
  )
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge on Windows")
  assert.equal(describeDevice("node"), "Another app")
  assert.equal(describeDevice(null), null)
})
