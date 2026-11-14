import assert from "node:assert/strict"
import { test } from "node:test"

import {
  grantsPlatformPermission,
  platformParent,
  platformWithAncestors,
  PLATFORM_PERMISSION_KEYS,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
} from "./platform.ts"

test("every platform child's parent exists and shares its module", () => {
  for (const key of PLATFORM_PERMISSION_KEYS) {
    const parent = platformParent(key)
    if (!parent) continue
    assert.ok(PLATFORM_PERMISSION_KEYS.includes(parent))
    assert.equal(
      PLATFORM_PERMISSIONS[key].module,
      PLATFORM_PERMISSIONS[parent].module
    )
    assert.equal(platformParent(parent), null)
  }
})

test("holding a platform parent grants its actions", () => {
  assert.deepEqual(platformWithAncestors("platform.work.grade"), [
    "platform.work.grade",
    "platform.work.manage",
  ])
  assert.equal(
    grantsPlatformPermission(["platform.work.manage"], "platform.work.grade"),
    true
  )
  assert.equal(
    grantsPlatformPermission(["platform.work.manage"], "platform.work.delete"),
    true
  )
  assert.equal(
    grantsPlatformPermission(["platform.work.grade"], "platform.work.delete"),
    false
  )
  assert.equal(
    grantsPlatformPermission(
      ["platform.library.create"],
      "platform.library.manage"
    ),
    false
  )
})

test("built-in platform roles keep their reach through parents", () => {
  for (const child of [
    "platform.work.grade",
    "platform.work.create",
    "platform.library.edit",
  ] as const) {
    assert.equal(
      grantsPlatformPermission(PLATFORM_ROLES.owner.permissions, child),
      true
    )
    assert.equal(
      grantsPlatformPermission(PLATFORM_ROLES.content_admin.permissions, child),
      true
    )
  }
  assert.equal(
    grantsPlatformPermission(
      PLATFORM_ROLES.reviewer.permissions,
      "platform.work.create"
    ),
    false
  )
})
