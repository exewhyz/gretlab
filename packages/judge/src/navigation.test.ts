import assert from "node:assert/strict"
import { test } from "node:test"

import {
  NAV_GROUPS,
  ORG_NAV,
  visibleOrgNav,
  type NavItem,
} from "./navigation.ts"
import { MODULE_KEYS } from "./org-types.ts"

test("every nav item sits in a known group", () => {
  for (const item of ORG_NAV) {
    assert.ok(NAV_GROUPS.includes(item.group), `${item.key} -> ${item.group}`)
  }
})

test("an owner (holds everything, every module on) sees every group, Overview first", () => {
  const nav = visibleOrgNav(ORG_NAV, {
    orgType: "college",
    can: () => true,
    enabledModules: new Set(MODULE_KEYS),
  })
  assert.equal(nav[0]?.group, "Overview")
  assert.deepEqual(
    nav.map((g) => g.group),
    [...NAV_GROUPS]
  )
})

test("a student (no permissions) sees only Overview", () => {
  const nav = visibleOrgNav(ORG_NAV, { orgType: "college", can: () => false })
  assert.deepEqual(
    nav.map((g) => g.group),
    ["Overview"]
  )
})

test("permissions filter items, and empty groups disappear", () => {
  const held = new Set<string>(["notices.manage"])
  const nav = visibleOrgNav(ORG_NAV, {
    orgType: "college",
    can: (p) => held.has(p),
  })
  assert.deepEqual(
    nav.map((g) => g.group),
    ["Overview", "Every day"]
  )
  const comm = nav.find((g) => g.group === "Every day")
  assert.deepEqual(
    comm?.items.map((i) => i.key),
    ["notices"]
  )
})

test("org type gates an item; a module shows only when enabled", () => {
  const items: NavItem[] = [
    {
      key: "a",
      label: "A",
      path: "/a",
      group: "People",
      anyOf: [],
      orgTypes: ["company"],
    },
    {
      key: "b",
      label: "B",
      path: "/b",
      group: "People",
      anyOf: [],
      module: "attendance",
    },
  ]
  const college = visibleOrgNav(items, { orgType: "college", can: () => true })
  assert.deepEqual(college, []) // a is company-only, b's module is off
  const withModule = visibleOrgNav(items, {
    orgType: "college",
    can: () => true,
    enabledModules: new Set(["attendance"]),
  })
  assert.deepEqual(
    withModule[0]?.items.map((i) => i.key),
    ["b"]
  )
  const company = visibleOrgNav(items, { orgType: "company", can: () => true })
  assert.deepEqual(
    company[0]?.items.map((i) => i.key),
    ["a"]
  )
})

test("a whole-organization page needs its permission across the organization, not in one group", () => {
  const keys = (wholeOrg: boolean) =>
    visibleOrgNav(ORG_NAV, {
      orgType: "school",
      // A class teacher: sees their class's members, but nothing across the school.
      can: (p) => p === "org.members.view",
      canWholeOrg: () => wholeOrg,
    }).flatMap((g) => g.items.map((i) => i.key))
  assert.ok(keys(false).includes("members"))
  assert.ok(!keys(false).includes("roles"))
  assert.ok(keys(true).includes("roles"))
})
