import assert from "node:assert/strict"
import { test } from "node:test"

import {
  enabledModules,
  MODULE_KEYS,
  MODULES,
  ORG_TYPE_CONFIG,
  ORG_TYPES,
  readModuleChoices,
} from "./org-types.ts"
import { ORG_NAV, visibleOrgNav } from "./navigation.ts"

test("every type's default modules are ones that type may use", () => {
  for (const type of ORG_TYPES) {
    for (const key of ORG_TYPE_CONFIG[type].modules) {
      assert.ok(
        (MODULES[key].for as readonly string[]).includes(type),
        `${type} defaults to ${key}, which it can't use`
      )
    }
  }
})

test("only known, boolean choices are read", () => {
  assert.deepEqual(
    readModuleChoices({ attendance: true, nope: true, library: "yes" }),
    {
      attendance: true,
    }
  )
  assert.deepEqual(readModuleChoices(null), {})
  assert.deepEqual(readModuleChoices("x"), {})
})

test("a module that isn't ready is never on, whatever is chosen", () => {
  // Nothing is ready yet in this catalog.
  for (const key of MODULE_KEYS) {
    if (MODULES[key].ready) continue
    assert.equal(enabledModules("school", { [key]: true }).has(key), false)
  }
})

test("defaults, overrides and type limits (with a ready module)", () => {
  const ready = MODULES.attendance as { ready: boolean }
  const before = ready.ready
  ready.ready = true
  try {
    assert.equal(enabledModules("school", {}).has("attendance"), true) // type default
    assert.equal(
      enabledModules("school", { attendance: false }).has("attendance"),
      false
    ) // turned off
    assert.equal(enabledModules("company", {}).has("attendance"), false) // not a company default
    assert.equal(
      enabledModules("company", { attendance: true }).has("attendance"),
      false
    ) // companies can't use it
  } finally {
    ready.ready = before
  }
})

test("the Groups page is named for the org type", () => {
  const label = (type: (typeof ORG_TYPES)[number]) =>
    visibleOrgNav(ORG_NAV, { orgType: type, can: () => true })
      .flatMap((g) => g.items)
      .find((i) => i.key === "groups")?.label
  assert.equal(label("school"), "Classes")
  assert.equal(label("company"), "Teams")
  assert.equal(label("college"), "Batches")
  assert.equal(label("other"), "Groups")
})
