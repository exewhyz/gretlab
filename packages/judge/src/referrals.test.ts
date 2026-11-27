import assert from "node:assert/strict"
import { test } from "node:test"

import {
  codeProblem,
  discountOf,
  earningOf,
  inReferralWindow,
  newReferralCode,
  normalizeCode,
  audienceProblem,
  codesDiscount,
  orgStanding,
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

test("where an organization stands: new until it pays, then existing while active, else inactive", () => {
  assert.equal(orgStanding(false, "free"), "new")
  assert.equal(orgStanding(false, "custom"), "new")
  assert.equal(orgStanding(true, "active"), "existing")
  assert.equal(orgStanding(true, "past_due"), "inactive")
  assert.equal(orgStanding(true, "paused"), "inactive")
  assert.equal(orgStanding(true, "free"), "inactive")
})

test("a code for some organizations refuses the others, saying who it's for", () => {
  assert.equal(audienceProblem([], "inactive"), null)
  assert.equal(audienceProblem(["new"], "new"), null)
  assert.equal(
    audienceProblem(["new"], "existing"),
    "This code is for new organizations."
  )
  assert.equal(
    audienceProblem(["new", "inactive"], "existing"),
    "This code is for new or inactive organizations."
  )
  assert.equal(audienceProblem(["existing", "inactive"], "inactive"), null)
})

test("with no promo code, the referral discount alone", () => {
  assert.deepEqual(codesDiscount(1000, { code: "REF", percent: 10 }, null), {
    discount: 100,
    lines: [{ code: "REF", label: "Referral discount", amount: 100 }],
    replaced: false,
  })
  assert.deepEqual(codesDiscount(1000, null, null), {
    discount: 0,
    lines: [],
    replaced: false,
  })
})

test("a promo code that combines adds to the referral discount, never past the price", () => {
  const both = codesDiscount(
    1000,
    { code: "REF", percent: 10 },
    { code: "SALE", percent: 20, combines: true }
  )
  assert.equal(both.discount, 300)
  assert.deepEqual(
    both.lines.map((l) => l.code),
    ["REF", "SALE"]
  )
  assert.equal(
    codesDiscount(
      1000,
      { code: "REF", percent: 60 },
      { code: "SALE", percent: 70, combines: true }
    ).discount,
    1000
  )
})

test("a promo code that doesn't combine replaces the referral discount", () => {
  const one = codesDiscount(
    1000,
    { code: "REF", percent: 10 },
    { code: "SALE", percent: 5, combines: false }
  )
  assert.equal(one.discount, 50)
  assert.deepEqual(one.lines, [
    { code: "SALE", label: "Promo code", amount: 50 },
  ])
  assert.equal(one.replaced, true)
  // Without a referral discount there's nothing to replace.
  assert.equal(
    codesDiscount(1000, null, { code: "SALE", percent: 5, combines: false })
      .replaced,
    false
  )
})

test("the referral code typed again counts once", () => {
  const same = codesDiscount(
    1000,
    { code: "REF", percent: 10 },
    { code: "REF", percent: 10, combines: true }
  )
  assert.equal(same.discount, 100)
  assert.equal(same.lines.length, 1)
})

test("a typed code with no discount of its own leaves the referral discount alone", () => {
  const r = codesDiscount(
    1000,
    { code: "REF", percent: 10 },
    { code: "CREATOR", percent: 0, combines: false }
  )
  assert.equal(r.discount, 100)
  assert.equal(r.replaced, false)
})
