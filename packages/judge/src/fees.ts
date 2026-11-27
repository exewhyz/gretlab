/**
 * Fees students pay their institution (the owner's decisions, 27 November 2026; apps/web/features/
 * fees). A plan is a year's instalments, each a due day and an amount per fee head; heads may apply
 * to everyone or only to hostel residents or bus riders. Amounts are what the student pays, GST
 * included where a head carries it. Concessions come off a head first, then off the whole plan.
 * A late fine is charged once when an instalment wasn't paid by the end of its grace. Payments go
 * to the oldest dues first, line by line, the fine last. Pure and unit-tested.
 */
import { financialYear } from "./billing.ts"

export type FeeAppliesTo = "everyone" | "hostel" | "transport"

export interface FeeHead {
  id: string
  name: string
  /** Percent of GST included in its amounts (0 for none). */
  gstRate: number
  appliesTo: FeeAppliesTo
}

export interface FeeInstalment {
  id: string
  label: string
  /** YYYY-MM-DD. */
  dueOn: string
  lines: { headId: string; amount: number }[]
  /** Charged once if it isn't paid by `graceDays` after the due day. */
  fine: { amount: number; graceDays: number } | null
}

/** Off one head (`headId`) or the whole plan (null): a percent or an amount. */
export interface FeeConcession {
  headId: string | null
  percent: number | null
  amount: number | null
}

/** What a payment paid for: an instalment's head, or its fine ("fine"). */
export interface FeeAllocation {
  instalmentId: string
  headId: string
  amount: number
}

export interface FeePaymentFacts {
  status: "created" | "paid" | "cancelled"
  /** YYYY-MM-DD, the day it was paid. */
  paidOn: string | null
  allocation: FeeAllocation[]
}

/** Whether the student lives in a hostel or rides a bus (heads that apply only to them). */
export interface StudentFacts {
  hostel: boolean
  transport: boolean
}

export const FINE = "fine"

const DAY = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY
const addDays = (day: string, n: number) =>
  new Date((dayNumber(day) + n) * DAY).toISOString().slice(0, 10)

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`

export function headApplies(head: FeeHead, facts: StudentFacts) {
  return (
    head.appliesTo === "everyone" ||
    (head.appliesTo === "hostel" && facts.hostel) ||
    (head.appliesTo === "transport" && facts.transport)
  )
}

interface Line {
  headId: string
  gross: number
  concession: number
  net: number
  paid: number
  balance: number
}

/** Takes `amount` off the lines (oldest first), never taking a line below zero. */
function takeAmount(lines: Line[], amount: number) {
  let left = Math.max(0, Math.round(amount))
  for (const line of lines) {
    if (left <= 0) break
    const off = Math.min(left, line.net)
    line.concession += off
    line.net -= off
    left -= off
  }
}

function takePercent(lines: Line[], percent: number) {
  for (const line of lines) {
    const off = Math.min(line.net, Math.round((line.net * percent) / 100))
    line.concession += off
    line.net -= off
  }
}

/**
 * A student's fees for one plan, as of `today`: each instalment's lines (gross, concession, net,
 * paid, balance), its fine, and what's due, paid, owed and overdue. Cancelled and unpaid
 * payments don't count.
 */
export function feeLedger(input: {
  heads: FeeHead[]
  instalments: FeeInstalment[]
  concessions: FeeConcession[]
  payments: FeePaymentFacts[]
  facts: StudentFacts
  today: string
}) {
  const heads = new Map(input.heads.map((h) => [h.id, h]))
  const ordered = [...input.instalments].sort((a, b) =>
    a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0
  )
  const rows = ordered.map((inst) => ({
    inst,
    lines: inst.lines
      .filter((l) => {
        const head = heads.get(l.headId)
        return head ? headApplies(head, input.facts) : false
      })
      .map((l): Line => ({
        headId: l.headId,
        gross: Math.max(0, Math.round(l.amount)),
        concession: 0,
        net: Math.max(0, Math.round(l.amount)),
        paid: 0,
        balance: 0,
      })),
  }))
  const allLines = rows.flatMap((r) => r.lines)
  // A head's own concessions first, then the plan's on what's left.
  for (const c of input.concessions.filter((c) => c.headId !== null)) {
    const lines = allLines.filter((l) => l.headId === c.headId)
    if (c.percent) takePercent(lines, c.percent)
    if (c.amount) takeAmount(lines, c.amount)
  }
  for (const c of input.concessions.filter((c) => c.headId === null)) {
    if (c.percent) takePercent(allLines, c.percent)
    if (c.amount) takeAmount(allLines, c.amount)
  }
  const paid = input.payments.filter((p) => p.status === "paid")
  const today = dayNumber(input.today)
  const instalments = rows.map(({ inst, lines }) => {
    for (const line of lines)
      line.paid = paid
        .flatMap((p) => p.allocation)
        .filter((a) => a.instalmentId === inst.id && a.headId === line.headId)
        .reduce((n, a) => n + a.amount, 0)
    const net = lines.reduce((n, l) => n + l.net, 0)
    let fine = 0
    if (inst.fine && inst.fine.amount > 0) {
      const deadline = addDays(inst.dueOn, inst.fine.graceDays)
      const paidInTime = paid
        .filter((p) => p.paidOn !== null && p.paidOn <= deadline)
        .flatMap((p) => p.allocation)
        .filter((a) => a.instalmentId === inst.id && a.headId !== FINE)
        .reduce((n, a) => n + a.amount, 0)
      if (net - paidInTime > 0 && today > dayNumber(deadline))
        fine = Math.round(inst.fine.amount)
    }
    const finePaid = paid
      .flatMap((p) => p.allocation)
      .filter((a) => a.instalmentId === inst.id && a.headId === FINE)
      .reduce((n, a) => n + a.amount, 0)
    for (const line of lines) line.balance = Math.max(0, line.net - line.paid)
    const fineBalance = Math.max(0, fine - finePaid)
    const paidTotal = lines.reduce((n, l) => n + l.paid, 0) + finePaid
    const due = net + fine
    const balance = lines.reduce((n, l) => n + l.balance, 0) + fineBalance
    const late = today > dayNumber(inst.dueOn)
    return {
      id: inst.id,
      label: inst.label,
      dueOn: inst.dueOn,
      lines,
      gross: lines.reduce((n, l) => n + l.gross, 0),
      concession: lines.reduce((n, l) => n + l.concession, 0),
      net,
      fine,
      fineBalance,
      due,
      paid: paidTotal,
      balance,
      overdue: late && balance > 0,
      daysOverdue: late && balance > 0 ? today - dayNumber(inst.dueOn) : 0,
    }
  })
  return {
    instalments,
    due: instalments.reduce((n, i) => n + i.due, 0),
    paid: instalments.reduce((n, i) => n + i.paid, 0),
    balance: instalments.reduce((n, i) => n + i.balance, 0),
    overdue: instalments
      .filter((i) => i.overdue)
      .reduce((n, i) => n + i.balance, 0),
  }
}

export type FeeLedger = ReturnType<typeof feeLedger>

/**
 * Where a payment of `amount` goes: the oldest dues first (or only the `chosen` instalments),
 * each instalment's lines in order and its fine last. Refused above what's owed.
 */
export function allocatePayment(
  ledger: FeeLedger,
  amount: number,
  chosen?: string[]
): { ok: true; allocation: FeeAllocation[] } | { ok: false; problem: string } {
  const rounded = Math.round(amount)
  if (!(rounded > 0))
    return { ok: false, problem: "Enter an amount above zero." }
  const open = ledger.instalments.filter(
    (i) => i.balance > 0 && (!chosen || chosen.includes(i.id))
  )
  const owed = open.reduce((n, i) => n + i.balance, 0)
  if (rounded > owed)
    return {
      ok: false,
      problem:
        owed > 0
          ? `That's more than is owed: ${rupees(owed)} at most.`
          : "Nothing is owed.",
    }
  let left = rounded
  const allocation: FeeAllocation[] = []
  for (const inst of open) {
    for (const line of inst.lines) {
      if (left <= 0) break
      const take = Math.min(left, line.balance)
      if (take > 0) {
        allocation.push({
          instalmentId: inst.id,
          headId: line.headId,
          amount: take,
        })
        left -= take
      }
    }
    if (left > 0 && inst.fineBalance > 0) {
      const take = Math.min(left, inst.fineBalance)
      allocation.push({ instalmentId: inst.id, headId: FINE, amount: take })
      left -= take
    }
    if (left <= 0) break
  }
  return { ok: true, allocation }
}

/** "GPC/2026-27/000042": the institution's prefix, India's financial year, the sequence. */
export function receiptNumber(prefix: string, date: Date, sequence: number) {
  return `${prefix}/${financialYear(date)}/${String(sequence).padStart(6, "0")}`
}

/** An amount that includes `rate`% GST, split into what's taxed and CGST and SGST. */
export function splitWithGst(amount: number, rate: number) {
  const total = Math.round(amount)
  if (!(rate > 0)) return { taxable: total, cgst: 0, sgst: 0, total }
  const taxable = Math.round((total * 100) / (100 + rate))
  const tax = total - taxable
  const cgst = Math.floor(tax / 2)
  return { taxable, cgst, sgst: tax - cgst, total }
}

/**
 * Which reminder an instalment owes on `today`: "soon" in the 3 days before it's due, "due"
 * from the day for a week, then "late-1", "late-2"… each week after. Null once it's paid.
 */
export function reminderStep(dueOn: string, today: string, balance: number) {
  if (balance <= 0) return null
  const days = dayNumber(today) - dayNumber(dueOn)
  if (days < -3) return null
  if (days < 0) return "soon"
  if (days < 7) return "due"
  return `late-${Math.floor(days / 7)}`
}

const isDay = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day

const wholeAtLeastZero = (n: number) => Number.isInteger(n) && n >= 0

/** Why a plan's instalments can't be saved, or null. `headIds` are the institution's heads. */
export function planProblem(
  instalments: FeeInstalment[],
  headIds: string[]
): string | null {
  if (instalments.length === 0) return "Add at least one instalment."
  if (new Set(instalments.map((i) => i.id)).size !== instalments.length)
    return "Each instalment once."
  for (const inst of instalments) {
    const name = inst.label.trim()
    if (!name) return "Give every instalment a name."
    if (!isDay(inst.dueOn)) return `${name}: the due day isn't a real date.`
    if (inst.lines.length === 0) return `${name}: add at least one fee head.`
    if (new Set(inst.lines.map((l) => l.headId)).size !== inst.lines.length)
      return `${name}: each fee head once.`
    for (const line of inst.lines) {
      if (!headIds.includes(line.headId))
        return `${name}: that fee head isn't one of yours.`
      if (!wholeAtLeastZero(line.amount))
        return `${name}: amounts are whole rupees, 0 or more.`
    }
    if (
      inst.fine &&
      !(
        wholeAtLeastZero(inst.fine.amount) &&
        wholeAtLeastZero(inst.fine.graceDays)
      )
    )
      return `${name}: the fine and its grace are whole numbers, 0 or more.`
  }
  return null
}
