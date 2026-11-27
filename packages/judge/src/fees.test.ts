import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allocatePayment,
  feeLedger,
  receiptNumber,
  reminderStep,
  splitWithGst,
  type FeeHead,
  type FeeInstalment,
} from "./fees.ts"

const heads: FeeHead[] = [
  { id: "tuition", name: "Tuition", gstRate: 0, appliesTo: "everyone" },
  { id: "hostel", name: "Hostel", gstRate: 0, appliesTo: "hostel" },
  { id: "bus", name: "Transport", gstRate: 0, appliesTo: "transport" },
]
const instalments: FeeInstalment[] = [
  {
    id: "i1",
    label: "Term 1",
    dueOn: "2026-07-10",
    lines: [
      { headId: "tuition", amount: 30000 },
      { headId: "hostel", amount: 20000 },
    ],
    fine: { amount: 500, graceDays: 5 },
  },
  {
    id: "i2",
    label: "Term 2",
    dueOn: "2026-12-10",
    lines: [
      { headId: "tuition", amount: 30000 },
      { headId: "bus", amount: 6000 },
    ],
    fine: null,
  },
]
const dayStudent = { hostel: false, transport: false }
const ledger = (over: Partial<Parameters<typeof feeLedger>[0]> = {}) =>
  feeLedger({
    heads,
    instalments,
    concessions: [],
    payments: [],
    facts: dayStudent,
    today: "2026-08-01",
    ...over,
  })

test("only the heads that apply to the student are charged", () => {
  const day = ledger()
  assert.deepEqual(
    day.instalments.map((i) => i.gross),
    [30000, 30000]
  )
  const boarder = ledger({ facts: { hostel: true, transport: true } })
  assert.deepEqual(
    boarder.instalments.map((i) => i.gross),
    [50000, 36000]
  )
})

test("a concession on a head comes off that head; one on the plan comes off the rest", () => {
  const l = ledger({
    concessions: [
      { headId: "tuition", percent: 50, amount: null },
      { headId: null, percent: null, amount: 1000 },
    ],
  })
  // Tuition halved in both (15,000 each), then 1,000 off the plan, oldest instalment first.
  assert.deepEqual(
    l.instalments.map((i) => i.concession),
    [16000, 15000]
  )
  assert.deepEqual(
    l.instalments.map((i) => i.net),
    [14000, 15000]
  )
})

test("a concession never takes a line below zero", () => {
  const l = ledger({
    concessions: [{ headId: null, percent: null, amount: 999999 }],
  })
  assert.deepEqual(
    l.instalments.map((i) => i.net),
    [0, 0]
  )
})

test("the late fine applies when it wasn't paid by the end of the grace", () => {
  // Due 10 July, 5 days' grace: by 1 August it's late and unpaid.
  assert.equal(ledger().instalments[0]!.fine, 500)
  // Before the grace ends there's no fine.
  assert.equal(ledger({ today: "2026-07-15" }).instalments[0]!.fine, 0)
  // Paid in full on time: no fine, even later.
  const onTime = ledger({
    payments: [
      {
        status: "paid",
        paidOn: "2026-07-14",
        allocation: [{ instalmentId: "i1", headId: "tuition", amount: 30000 }],
      },
    ],
  })
  assert.equal(onTime.instalments[0]!.fine, 0)
  assert.equal(onTime.instalments[0]!.balance, 0)
  // An instalment without a fine never has one.
  assert.equal(ledger({ today: "2027-01-31" }).instalments[1]!.fine, 0)
})

test("the ledger counts paid receipts only, and what's overdue", () => {
  const l = ledger({
    payments: [
      {
        status: "paid",
        paidOn: "2026-07-20",
        allocation: [{ instalmentId: "i1", headId: "tuition", amount: 10000 }],
      },
      {
        status: "cancelled",
        paidOn: "2026-07-21",
        allocation: [{ instalmentId: "i1", headId: "tuition", amount: 20000 }],
      },
    ],
  })
  const [first, second] = l.instalments
  assert.equal(first!.paid, 10000)
  assert.equal(first!.due, 30500) // the net plus the fine
  assert.equal(first!.balance, 20500)
  assert.equal(first!.overdue, true)
  assert.equal(first!.daysOverdue, 22)
  assert.equal(second!.overdue, false)
  assert.equal(l.balance, 20500 + 30000)
  assert.equal(l.overdue, 20500)
})

test("a payment goes to the oldest dues first, line by line, the fine last", () => {
  const l = ledger()
  const a = allocatePayment(l, 30300)
  assert.deepEqual(a, {
    ok: true,
    allocation: [
      { instalmentId: "i1", headId: "tuition", amount: 30000 },
      { instalmentId: "i1", headId: "fine", amount: 300 },
    ],
  })
  const spill = allocatePayment(l, 40500)
  assert.ok(spill.ok)
  assert.deepEqual(spill.allocation.at(-1), {
    instalmentId: "i2",
    headId: "tuition",
    amount: 10000,
  })
})

test("a payment can be for chosen instalments only, and never more than is owed", () => {
  const l = ledger()
  const chosen = allocatePayment(l, 30000, ["i2"])
  assert.ok(chosen.ok)
  assert.deepEqual(chosen.allocation, [
    { instalmentId: "i2", headId: "tuition", amount: 30000 },
  ])
  assert.deepEqual(allocatePayment(l, 30001, ["i2"]), {
    ok: false,
    problem: "That's more than is owed: ₹30,000 at most.",
  })
  assert.deepEqual(allocatePayment(l, 0), {
    ok: false,
    problem: "Enter an amount above zero.",
  })
})

test("receipts are numbered within India's financial year, under the institution's prefix", () => {
  assert.equal(
    receiptNumber("GPC", new Date("2026-11-27T10:00:00Z"), 42),
    "GPC/2026-27/000042"
  )
  assert.equal(
    receiptNumber("GPC", new Date("2027-03-31T10:00:00Z"), 1),
    "GPC/2026-27/000001"
  )
  assert.equal(
    receiptNumber("GPC", new Date("2027-04-01T10:00:00Z"), 1),
    "GPC/2027-28/000001"
  )
})

test("GST is worked out of an amount that includes it", () => {
  assert.deepEqual(splitWithGst(11800, 18), {
    taxable: 10000,
    cgst: 900,
    sgst: 900,
    total: 11800,
  })
  assert.deepEqual(splitWithGst(5000, 0), {
    taxable: 5000,
    cgst: 0,
    sgst: 0,
    total: 5000,
  })
  // Rounding keeps the parts adding up to the amount paid.
  const odd = splitWithGst(1001, 18)
  assert.equal(odd.taxable + odd.cgst + odd.sgst, 1001)
})

test("reminders: 3 days before, on the day, then weekly while it's owed", () => {
  const due = "2026-12-10"
  assert.equal(reminderStep(due, "2026-12-06", 100), null)
  assert.equal(reminderStep(due, "2026-12-07", 100), "soon")
  assert.equal(reminderStep(due, "2026-12-09", 100), "soon")
  assert.equal(reminderStep(due, "2026-12-10", 100), "due")
  assert.equal(reminderStep(due, "2026-12-16", 100), "due")
  assert.equal(reminderStep(due, "2026-12-17", 100), "late-1")
  assert.equal(reminderStep(due, "2026-12-24", 100), "late-2")
  assert.equal(reminderStep(due, "2026-12-24", 0), null)
})
