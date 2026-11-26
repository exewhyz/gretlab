import assert from "node:assert/strict"
import { test } from "node:test"

import {
  codeProblem,
  discountOf,
  earningOf,
  inReferralWindow,
  newReferralCode,
  normalizeCode,
} from "./referrals.ts"

const NOW = new Date("2026-11-26T10:00:00Z")
const code = (over = {}) => ({
  active: true,
  validFrom: null,
  validTo: null,
  maxUses: null,
  uses: 0,
  ...over,
})

test("codes are compared in capitals, without spaces", () => {
  assert.equal(normalizeCode("  diwali25 "), "DIWALI25")
  assert.equal(normalizeCode("ab-12"), "AB-12")
})

test("a code works while it's on, started, not expired and not used up", () => {
  assert.equal(codeProblem(code(), NOW), null)
  assert.match(codeProblem(code({ active: false }), NOW) ?? "", /paused/)
  assert.match(
    codeProblem(code({ validFrom: new Date("2026-12-01") }), NOW) ?? "",
    /isn't valid yet/
  )
  assert.match(
    codeProblem(code({ validTo: new Date("2026-11-01") }), NOW) ?? "",
    /expired/
  )
  assert.match(codeProblem(code({ maxUses: 3, uses: 3 }), NOW) ?? "", /used up/)
  assert.equal(codeProblem(code({ maxUses: 3, uses: 2 }), NOW), null)
})

test("the window runs N months from the organization's first payment", () => {
  const first = new Date("2026-01-31T00:00:00Z")
  assert.equal(
    inReferralWindow(null, NOW, 3),
    true,
    "the first payment opens it"
  )
  assert.equal(
    inReferralWindow(first, new Date("2026-04-29T00:00:00Z"), 3),
    true
  )
  assert.equal(
    inReferralWindow(first, new Date("2026-05-01T00:00:00Z"), 3),
    false
  )
  // Month ends don't spill: 31 January plus one month is the end of February.
  assert.equal(
    inReferralWindow(first, new Date("2026-02-28T12:00:00Z"), 1),
    true
  )
  assert.equal(
    inReferralWindow(first, new Date("2026-03-01T00:00:01Z"), 1),
    false
  )
})

test("the earning is a share of the amount before GST, in whole rupees, rounded down", () => {
  assert.equal(earningOf(7_800, 5), 390)
  assert.equal(earningOf(999, 5), 49)
  assert.equal(earningOf(1000, 0), 0)
})

test("the discount is a share off, rounded to the rupee, never more than the amount", () => {
  assert.equal(discountOf(7_800, 10), 780)
  assert.equal(discountOf(995, 10), 100)
  assert.equal(discountOf(500, 100), 500)
  assert.equal(discountOf(500, 0), 0)
})

test("new codes: eight characters, no look-alikes (0, O, 1, I, L)", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const c = newReferralCode()
    assert.match(c, /^[A-HJKMNP-Z2-9]{8}$/)
    seen.add(c)
  }
  assert.ok(seen.size > 190)
})
