import assert from "node:assert/strict"
import { test } from "node:test"

import { ORG_TYPES } from "./org-types.ts"
import { isPermission } from "./permissions.ts"
import { readRoleTemplates, ROLE_TEMPLATES, roleTemplatesFor } from "./role-templates.ts"

test("every kind has suggested roles, each sound", () => {
  for (const type of ORG_TYPES) {
    const list = ROLE_TEMPLATES[type]
    assert.ok(list.length >= 2, type)
    assert.equal(new Set(list.map((r) => r.key)).size, list.length, `${type} keys`)
    assert.equal(new Set(list.map((r) => r.name)).size, list.length, `${type} names`)
    for (const r of list) {
      assert.ok(r.permissions.length > 0 && r.permissions.every(isPermission), `${type}.${r.key}`)
      // Settings and roles stay with owners and admins.
      assert.ok(!r.permissions.includes("org.settings.manage") && !r.permissions.includes("org.roles.manage"), `${type}.${r.key}`)
    }
  }
})

test("a stored list replaces the default, cleaned", () => {
  assert.equal(roleTemplatesFor("school", null), ROLE_TEMPLATES.school)
  const read = readRoleTemplates([
    { key: "nurse", name: " Nurse ", permissions: ["students.view", "made.up"], scope: "organization" },
    { key: "nurse", name: "Duplicate", permissions: [] },
    { key: "Bad Key", name: "x" },
    "nonsense",
  ])
  assert.deepEqual(read, [{ key: "nurse", name: "Nurse", description: "", permissions: ["students.view"], scope: "organization" }])
  assert.deepEqual(roleTemplatesFor("school", []), [])
})
