import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allows,
  grantsPermission,
  parentPermission,
  permissionWithAncestors,
  PERMISSION_KEYS,
  PERMISSIONS,
  SYSTEM_ROLES,
} from "./permissions.ts"

test("every child's parent exists and shares its module", () => {
  for (const key of PERMISSION_KEYS) {
    const parent = parentPermission(key)
    if (!parent) continue
    assert.ok(
      PERMISSION_KEYS.includes(parent),
      `${key} -> unknown parent ${parent}`
    )
    assert.equal(
      PERMISSIONS[key].module,
      PERMISSIONS[parent].module,
      `${key} module`
    )
    assert.equal(
      parentPermission(parent),
      null,
      `${parent} should be a top-level parent`
    )
  }
})

test("a permission resolves to itself then its ancestors", () => {
  assert.deepEqual(permissionWithAncestors("assignments.grade"), [
    "assignments.grade",
    "assignments.manage",
  ])
  assert.deepEqual(permissionWithAncestors("assignments.manage"), [
    "assignments.manage",
  ])
})

test("holding a parent grants every child; a child grants only itself", () => {
  assert.equal(
    grantsPermission(["assignments.manage"], "assignments.grade"),
    true
  )
  assert.equal(
    grantsPermission(["assignments.manage"], "assignments.delete"),
    true
  )
  assert.equal(
    grantsPermission(["assignments.grade"], "assignments.grade"),
    true
  )
  assert.equal(
    grantsPermission(["assignments.grade"], "assignments.publish"),
    false
  )
  assert.equal(
    grantsPermission(["assignments.grade"], "assignments.manage"),
    false
  )
  assert.equal(
    grantsPermission(["org.roles.manage"], "org.members.assign_roles"),
    true
  )
})

test("the built-in roles keep their reach through the parents they hold", () => {
  const children = [
    "assignments.create",
    "assignments.publish",
    "assignments.delete",
    "assignments.grade",
    "contests.create",
    "problems.delete",
    "notices.create",
  ] as const
  for (const child of children) {
    assert.equal(
      grantsPermission(SYSTEM_ROLES.owner.permissions, child),
      true,
      `owner ${child}`
    )
    assert.equal(
      grantsPermission(SYSTEM_ROLES.admin.permissions, child),
      true,
      `admin ${child}`
    )
    assert.equal(
      grantsPermission(SYSTEM_ROLES.teacher.permissions, child),
      true,
      `teacher ${child}`
    )
    assert.equal(
      grantsPermission(SYSTEM_ROLES.member.permissions, child),
      false,
      `member ${child}`
    )
  }
  // Members & roles children: the Teacher role has neither parent, so it can't.
  assert.equal(
    grantsPermission(SYSTEM_ROLES.teacher.permissions, "org.members.remove"),
    false
  )
})

test("allows() honours the parent across org-wide and group grants", () => {
  const orgWide = [{ permissions: ["assignments.manage"], groupId: null }]
  assert.equal(allows(orgWide, "assignments.grade", null), true)
  const inGroup = [{ permissions: ["assignments.grade"], groupId: "g1" }]
  assert.equal(allows(inGroup, "assignments.grade", ["g1"]), true)
  assert.equal(allows(inGroup, "assignments.publish", ["g1"]), false)
  assert.equal(allows(inGroup, "assignments.grade", ["g2"]), false)
})
