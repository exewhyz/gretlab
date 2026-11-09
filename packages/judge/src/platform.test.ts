import assert from "node:assert/strict"
import { test } from "node:test"

import { mayGrantPlatformRole, PLATFORM_PERMISSION_KEYS, PLATFORM_ROLES } from "./platform.ts"

test("the owner role has every platform permission", () => {
  assert.deepEqual([...PLATFORM_ROLES.owner.permissions].sort(), [...PLATFORM_PERMISSION_KEYS].sort())
})

test("nobody grants more than they hold", () => {
  const content = PLATFORM_ROLES.content_admin.permissions
  assert.ok(mayGrantPlatformRole(content, PLATFORM_ROLES.reviewer.permissions, false, false))
  assert.ok(!mayGrantPlatformRole(PLATFORM_ROLES.reviewer.permissions, content, false, false))
})

test("only owners make owners", () => {
  const all = PLATFORM_PERMISSION_KEYS
  assert.ok(!mayGrantPlatformRole(all, all, true, false))
  assert.ok(mayGrantPlatformRole(all, all, true, true))
})
