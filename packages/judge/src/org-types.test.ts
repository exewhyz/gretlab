import assert from "node:assert/strict"
import { test } from "node:test"

import {
  enabledModules,
  isModuleKey,
  KINDS,
  kindCan,
  kindTerms,
  MODULE_KEYS,
  MODULES,
  moduleAvailable,
  moduleLevel,
  ORG_TYPE_CONFIG,
  ORG_TYPES,
  readKindPolicy,
  readModuleChoices,
} from "./org-types.ts"
import { ORG_NAV, visibleOrgNav } from "./navigation.ts"

test("every kind is defined once, in the order offered", () => {
  assert.deepEqual(Object.keys(KINDS), [...ORG_TYPES])
  for (const t of ORG_TYPES) assert.equal(KINDS[t].key, t)
})

test("each kind's modules are real, and its defaults are ones it can use", () => {
  for (const t of ORG_TYPES) {
    for (const m of KINDS[t].capabilities) assert.ok(isModuleKey(m), `${t}: unknown module ${m}`)
    for (const m of KINDS[t].defaults)
      assert.ok((KINDS[t].capabilities as readonly string[]).includes(m), `${t} defaults to ${m}, which it can't use`)
  }
})

test("each kind explains itself and names its people", () => {
  for (const t of ORG_TYPES) {
    const k = KINDS[t]
    assert.ok(k.description && k.decides.length >= 2 && k.examples, t)
    assert.ok(k.terms.learners && k.terms.instructors && k.terms.groups && k.groupLevels.length >= 1, t)
    // A kind has guardians only when it can run parent accounts.
    assert.equal(k.terms.guardian != null, kindCan(t, "parents"), `${t} guardians vs the parents module`)
  }
  assert.equal(kindTerms("cohort").learners, "Learners")
  assert.equal(kindTerms("college").instructors, "Faculty")
  assert.equal(ORG_TYPE_CONFIG.coaching.groupsLabel, "Batches")
})

test("only known, boolean choices are read", () => {
  assert.deepEqual(readModuleChoices({ attendance: true, nope: true, library: "yes" }), { attendance: true })
  assert.deepEqual(readModuleChoices(null), {})
  assert.deepEqual(readModuleChoices("x"), {})
})

test("a module that isn't ready is never on, whatever is chosen", () => {
  for (const key of MODULE_KEYS) {
    if (MODULES[key].ready) continue
    assert.equal(enabledModules("school", { [key]: true }).has(key), false)
  }
})

test("the kind, then the platform, then the organization decide", () => {
  // The kind's defaults with no policy and no choices.
  assert.equal(enabledModules("school", {}).has("attendance"), true)
  assert.equal(enabledModules("college", {}).has("parents"), false)
  // The organization turns a default off, or an optional one on.
  assert.equal(enabledModules("school", { attendance: false }).has("attendance"), false)
  assert.equal(enabledModules("college", { parents: true }).has("parents"), true)
  // A kind can't have what it can't support, whatever is chosen or set.
  assert.equal(enabledModules("company", { records: true }, { records: "default" }).has("records"), false)
  assert.equal(moduleLevel("community", "attendance", { attendance: "default" }), "off")
  // The platform switches a module off for a kind: off for everyone, whatever they chose.
  assert.equal(enabledModules("school", { library: true }, { library: "off" }).has("library"), false)
  assert.equal(moduleAvailable("school", "library", { library: "off" }), false)
  // ...or makes an optional one on by default.
  assert.equal(enabledModules("college", {}, { parents: "default" }).has("parents"), true)
  // An organization's own "off" still wins over a default.
  assert.equal(enabledModules("college", { parents: false }, { parents: "default" }).has("parents"), false)
})

test("a stored policy keeps only what the kind can use", () => {
  assert.deepEqual(readKindPolicy("company", { attendance: "default", records: "default", library: "nah" }), {
    attendance: "default",
  })
  assert.deepEqual(readKindPolicy("school", null), {})
})

test("the Groups page is named for the kind", () => {
  const label = (type: (typeof ORG_TYPES)[number]) =>
    visibleOrgNav(ORG_NAV, { orgType: type, can: () => true })
      .flatMap((g) => g.items)
      .find((i) => i.key === "groups")?.label
  assert.equal(label("school"), "Classes")
  assert.equal(label("company"), "Teams")
  assert.equal(label("college"), "Batches")
  assert.equal(label("cohort"), "Cohorts")
  assert.equal(label("other"), "Groups")
})
