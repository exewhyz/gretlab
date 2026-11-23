import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_PRICE_LIST,
  planIncludes,
  planModulePolicy,
  gstSplit,
  invoiceNumber,
  limitState,
  periodEnd,
  priceOfPlan,
  upgradeDue,
  validGstin,
  withNeeds,
  type PlanChoice,
  type PriceList,
} from "./billing.ts"

// A small price list, so the arithmetic is easy to follow.
const list: PriceList = {
  features: [
    { key: "core", price: 10, always: true },
    { key: "coding", price: 50 },
    { key: "exams_lab", price: 20, needs: ["coding"] },
    { key: "records", price: 10 },
    { key: "results", price: 20, needs: ["records"] },
  ],
  staffPrice: 300,
  freeStaffPer: 15,
  steps: [
    [300, 0],
    [1000, 10],
    [3000, 15],
    [null, 20],
  ],
  periods: { year: 0, semester: 10, month: 25 },
  quoteAbove: 10_000,
  judgePrice: 72_000,
  storagePrice: 500,
}
const plan = (over: Partial<PlanChoice> = {}): PlanChoice => ({
  features: ["coding"],
  students: 100,
  staff: 5,
  judges: 0,
  storagePacks: 0,
  period: "year",
  ...over,
})

test("the yearly price: each feature (and what's always in) times students", () => {
  const p = priceOfPlan(list, plan())
  // core 10 + coding 50 = 60 a student; 100 students; staff within the free 7.
  assert.equal(p.perStudent, 60)
  assert.equal(p.yearly, 6_000)
  assert.equal(p.price, 6_000)
  assert.equal(p.quote, false)
})

test("volume steps lower the student part like tax slabs", () => {
  const p = priceOfPlan(list, plan({ students: 1_200, staff: 1 }))
  // 300 at 60, 700 at 54, 200 at 51 = 18,000 + 37,800 + 10,200
  assert.equal(p.studentsPart, 66_000)
  assert.equal(p.discount, 72_000 - 66_000)
  // Adding a student never makes the total go down.
  assert.ok(
    priceOfPlan(list, plan({ students: 1_201, staff: 1 })).yearly > p.yearly
  )
})

test("staff: one free per 15 students, then each one charged", () => {
  const p = priceOfPlan(list, plan({ students: 100, staff: 10 }))
  assert.equal(p.freeStaff, 7)
  assert.equal(p.paidStaff, 3)
  assert.equal(p.staffPart, 900)
})

test("extras: judge machines and storage packs, a year each", () => {
  const p = priceOfPlan(list, plan({ judges: 1, storagePacks: 2 }))
  assert.equal(p.extras, 73_000)
})

test("periods: a semester is half a year plus 10%, a month a twelfth plus 25%", () => {
  assert.equal(priceOfPlan(list, plan({ period: "semester" })).price, 3_300)
  assert.equal(priceOfPlan(list, plan({ period: "month" })).price, 625)
})

test("over 10,000 students is a custom quote", () => {
  assert.equal(priceOfPlan(list, plan({ students: 10_001 })).quote, true)
  assert.equal(priceOfPlan(list, plan({ students: 10_000 })).quote, false)
})

test("a feature brings what it needs; unknown ones are dropped", () => {
  assert.deepEqual(withNeeds(list, ["results", "exams_lab", "nope"]).sort(), [
    "coding",
    "core",
    "exams_lab",
    "records",
    "results",
  ])
})

test("prices are whole rupees", () => {
  const p = priceOfPlan(list, plan({ students: 7, period: "month" }))
  assert.equal(Number.isInteger(p.price), true)
})

test("a period ends a month, six months or a year on", () => {
  const start = new Date("2026-06-15T00:00:00Z")
  assert.equal(
    periodEnd(start, "month").toISOString(),
    "2026-07-15T00:00:00.000Z"
  )
  assert.equal(
    periodEnd(start, "semester").toISOString(),
    "2026-12-15T00:00:00.000Z"
  )
  assert.equal(
    periodEnd(start, "year").toISOString(),
    "2027-06-15T00:00:00.000Z"
  )
})

test("adding mid-period: the difference for the days left; removals cost nothing now", () => {
  const start = new Date("2026-06-01T00:00:00Z")
  const end = periodEnd(start, "year")
  const halfway = new Date(
    start.getTime() + (end.getTime() - start.getTime()) / 2
  )
  const more = upgradeDue(
    list,
    plan(),
    plan({ students: 200 }),
    start,
    end,
    halfway
  )
  // 6,000 a year becomes 12,000: half a year left, so 3,000.
  assert.equal(more, 3_000)
  assert.equal(
    upgradeDue(list, plan({ students: 200 }), plan(), start, end, halfway),
    0
  )
  // Nothing is due once the period is over.
  assert.equal(
    upgradeDue(list, plan(), plan({ students: 200 }), start, end, end),
    0
  )
})

test("GSTIN: the format India uses", () => {
  assert.equal(validGstin("27AAPFU0939F1ZV"), true)
  assert.equal(validGstin("27aapfu0939f1zv"), true, "any case")
  assert.equal(validGstin("27AAPFU0939F1Z"), false)
  assert.equal(validGstin("99AAPFU0939F1ZV"), false, "no state 99")
  assert.equal(validGstin(""), false)
})

test("GST: CGST and SGST in the same state, IGST across states", () => {
  assert.deepEqual(
    gstSplit(
      1_000,
      { registered: true, rate: 18, sellerGstin: "27AAPFU0939F1ZV" },
      "27ABCDE1234F1Z5"
    ),
    {
      taxable: 1_000,
      cgst: 90,
      sgst: 90,
      igst: 0,
      total: 1_180,
    }
  )
  assert.deepEqual(
    gstSplit(
      1_000,
      { registered: true, rate: 18, sellerGstin: "27AAPFU0939F1ZV" },
      "29ABCDE1234F1Z5"
    ),
    {
      taxable: 1_000,
      cgst: 0,
      sgst: 0,
      igst: 180,
      total: 1_180,
    }
  )
  // No buyer GSTIN: taxed as within the seller's state.
  assert.equal(
    gstSplit(
      1_000,
      { registered: true, rate: 18, sellerGstin: "27AAPFU0939F1ZV" },
      null
    ).cgst,
    90
  )
  // Not registered: no GST at all.
  assert.deepEqual(
    gstSplit(1_000, { registered: false, rate: 18, sellerGstin: "" }, null),
    {
      taxable: 1_000,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 1_000,
    }
  )
})

test("invoice numbers count within India's financial year (April to March)", () => {
  assert.equal(
    invoiceNumber(new Date("2026-11-24T10:00:00Z"), 123),
    "GL/2026-27/000123"
  )
  assert.equal(
    invoiceNumber(new Date("2027-03-31T10:00:00Z"), 1),
    "GL/2026-27/000001"
  )
  assert.equal(
    invoiceNumber(new Date("2027-04-01T10:00:00Z"), 1),
    "GL/2027-28/000001"
  )
})

test("limits: fine, near at 90%, over with 30 days' grace, then paused", () => {
  const now = new Date("2026-11-24T00:00:00Z")
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
  assert.equal(limitState(80, 100, null, now), "ok")
  assert.equal(limitState(90, 100, null, now), "near")
  assert.equal(limitState(101, 100, daysAgo(10), now), "over")
  assert.equal(limitState(101, 100, daysAgo(30), now), "paused")
  // Back under: fine again, whatever happened before.
  assert.equal(limitState(99, 100, daysAgo(40), now), "near")
})

test("the launch price list is complete and sensible", () => {
  const keys = DEFAULT_PRICE_LIST.features.map((f) => f.key)
  assert.equal(new Set(keys).size, keys.length, "no feature twice")
  for (const f of DEFAULT_PRICE_LIST.features) {
    for (const n of f.needs ?? [])
      assert.ok(keys.includes(n), `${f.key} needs ${n}`)
    assert.ok(f.price >= 0)
  }
  assert.equal(DEFAULT_PRICE_LIST.features.filter((f) => f.always).length, 1)
})

test("a plan switches off the modules its features don't include", () => {
  const policy = planModulePolicy(["core", "coding", "results"])
  assert.equal(policy.coding, undefined, "bought")
  assert.equal(policy.exams, undefined, "report cards are the exams module")
  assert.equal(policy.attendance, "off")
  assert.equal(policy.transport, "off")
  // No plan limits: nothing is switched off.
  assert.deepEqual(planModulePolicy(null), {})
  assert.deepEqual(planModulePolicy("nonsense"), {})
})

test("features that aren't modules are checked by name", () => {
  assert.equal(planIncludes(["core", "lti"], "lti"), true)
  assert.equal(planIncludes(["core"], "api"), false)
  assert.equal(planIncludes(null, "api"), true, "no plan limits")
})
