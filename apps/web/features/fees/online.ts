import {
  feePayments,
  feePlans,
  getDb,
  orgGroups,
  organizations,
  sql,
  type User,
} from "@workspace/db"
import { allocatePayment, type FeeAllocation } from "@workspace/judge"
import { z } from "zod"

import { writeSystemEntry } from "@/features/audit/server"
import { notify } from "@/features/notifications/server"
import { orgPages } from "@/lib/paths"
import { createOrder, paymentSignatureOk } from "@/features/billing/razorpay"
import { orgContext } from "@/features/orgs/server"
import { needWithinLimit } from "@/lib/api/rate-limit"
import { ApiError, notFound } from "@/lib/api/route"
import { seal, unseal } from "@/lib/sealed"

import {
  isStudentOrParent,
  ledgersFor,
  nextReceipt,
  receiptLines,
  student,
  type FeeScope,
  type ReceiptSnapshot,
} from "./ledger"
import { needFees } from "./server"

/*
 * Paying fees online, into the institution's own Razorpay account (its keys, sealed in
 * organizations.fee_settings). A student pays for themselves, or a linked parent for their
 * child. The order is made for at most what's owed; the checkout's signature or the
 * institution's webhook (/api/razorpay/fees/<slug>) applies it, whichever comes first, once,
 * under the payment's row lock, with a numbered receipt.
 */

const { and, eq, sql: raw } = { ...sql, sql: sql.sql }

export const payOnlineSchema = z.object({
  studentId: z.uuid(),
  planId: z.uuid(),
  amount: z.number().int().min(1).max(100_000_000),
  instalments: z.array(z.string().max(40)).max(24).optional(),
})

export const confirmOnlineSchema = z.object({
  orderId: z.string().min(1).max(60),
  paymentId: z.string().min(1).max(60),
  signature: z.string().min(1).max(200),
})

/** The institution's keys, opened; null when online payment isn't set up. */
function keysOf(settings: (typeof organizations.$inferSelect)["feeSettings"]) {
  const r = settings.razorpay
  if (!r) return null
  const keySecret = unseal("fees", r.keySecret)
  const webhookSecret = unseal("fees", r.webhookSecret)
  if (!keySecret || !webhookSecret) return null
  return { keyId: r.keyId, keySecret, webhookSecret }
}

/** Starts an online payment: a Razorpay order in the institution's account. */
export async function startOnlinePayment(
  slug: string,
  user: User,
  input: z.infer<typeof payOnlineSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  if (!(await isStudentOrParent(ctx, user, input.studentId)))
    throw notFound("No such student's fees.")
  const keys = keysOf(ctx.org.feeSettings)
  if (!keys)
    throw new ApiError(
      409,
      "payments_off",
      "Paying online isn't set up here yet. Pay at the fee counter."
    )
  await needWithinLimit("checkout", `fees:${input.studentId}`)
  const who = await student(ctx, input.studentId)
  const data = await ledgersFor(ctx, input.studentId)
  const plan = data.plans.find((p) => p.id === input.planId)
  if (!plan) throw notFound("That plan isn't this student's.")
  const allocated = allocatePayment(
    plan.ledger,
    input.amount,
    input.instalments
  )
  if (!allocated.ok) throw new ApiError(400, "bad_amount", allocated.problem)
  const db = getDb()
  const [payment] = await db
    .insert(feePayments)
    .values({
      orgId: ctx.org.id,
      planId: plan.id,
      studentId: input.studentId,
      amount: input.amount,
      mode: "online",
      status: "created",
      collectedBy: user.id,
    })
    .returning({ id: feePayments.id })
  const order = await createOrder(
    {
      paise: input.amount * 100,
      receipt: payment!.id,
      notes: { orgId: ctx.org.id, feePaymentId: payment!.id },
    },
    keys
  )
  await db
    .update(feePayments)
    .set({ razorpayOrderId: order.id })
    .where(eq(feePayments.id, payment!.id))
  return {
    paymentId: payment!.id,
    orderId: order.id,
    keyId: keys.keyId,
    amount: input.amount * 100,
    currency: "INR",
    name: ctx.org.name,
    description: `${plan.name}: fees for ${who.name ?? who.email}`.slice(
      0,
      250
    ),
    prefill: { name: user.name ?? "", email: user.email },
  }
}

/** The checkout's answer, checked with the institution's key secret, then applied. */
export async function confirmOnlinePayment(
  slug: string,
  user: User,
  input: z.infer<typeof confirmOnlineSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const keys = keysOf(ctx.org.feeSettings)
  if (
    !keys ||
    !paymentSignatureOk(
      input.orderId,
      input.paymentId,
      input.signature,
      keys.keySecret
    )
  )
    throw new ApiError(
      400,
      "bad_signature",
      "That payment couldn't be confirmed."
    )
  return applyOnlinePayment(ctx.org.id, input.orderId, input.paymentId)
}

/** The institution's webhook secret, for /api/razorpay/fees/<slug>; null when not set up. */
export async function feeWebhookSecret(slug: string) {
  const [org] = await getDb()
    .select({ id: organizations.id, feeSettings: organizations.feeSettings })
    .from(organizations)
    .where(eq(organizations.slug, slug))
  if (!org) return null
  const keys = keysOf(org.feeSettings)
  return keys ? { orgId: org.id, secret: keys.webhookSecret } : null
}

/**
 * Applies a paid order, once: the payment's row is locked, its dues worked out now, and a
 * receipt numbered. Money already taken is always recorded: if the counter took the same dues
 * meanwhile, what's beyond them is kept as an advance on the receipt.
 */
export async function applyOnlinePayment(
  orgId: string,
  orderId: string,
  razorpayPaymentId: string
) {
  const db = getDb()
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(feePayments)
      .where(
        and(
          eq(feePayments.razorpayOrderId, orderId),
          eq(feePayments.orgId, orgId)
        )
      )
      .for("update")
    if (!row) throw notFound("No such payment.")
    // The same shape on every path; only a fresh payment is logged.
    const done = { studentName: "", amount: 0, studentId: "", slug: "" }
    if (row.status === "paid")
      return { paid: true, receiptNo: row.receiptNo, fresh: false, ...done }
    if (row.status !== "created")
      return { paid: false, receiptNo: null, fresh: false, ...done }
    await tx.execute(
      raw`select pg_advisory_xact_lock(hashtext(${`fees:${row.planId}:${row.studentId}`}))`
    )
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
    const groups = await tx
      .select({ id: orgGroups.id, parentId: orgGroups.parentId })
      .from(orgGroups)
      .where(eq(orgGroups.orgId, orgId))
    const scope: FeeScope = { org: { id: orgId }, groups }
    const who = await student(scope, row.studentId)
    const data = await ledgersFor(scope, row.studentId)
    const plan = data.plans.find((p) => p.id === row.planId)
    const owed = plan?.ledger.balance ?? 0
    let allocation: FeeAllocation[] = []
    if (plan && owed > 0) {
      const fits = allocatePayment(plan.ledger, Math.min(row.amount, owed))
      if (fits.ok) allocation = fits.allocation
    }
    const spent = allocation.reduce((n, a) => n + a.amount, 0)
    if (spent < row.amount)
      allocation.push({
        instalmentId: "",
        headId: "advance",
        amount: row.amount - spent,
      })
    const now = new Date()
    const prefix = org!.feeSettings.prefix || "FEE"
    const number = await nextReceipt(tx, orgId, prefix, now)
    const [planRow] = await tx
      .select()
      .from(feePlans)
      .where(eq(feePlans.id, row.planId))
    const gstin = org!.feeSettings.gstin ?? ""
    const snapshot: ReceiptSnapshot = {
      number,
      date: now.toISOString(),
      org: { name: org!.name, gstin },
      student: {
        name: who.name ?? who.email,
        email: who.email,
        admissionNo: who.admissionNo,
      },
      plan: planRow?.name ?? "",
      mode: "online",
      reference: razorpayPaymentId,
      collectedBy: null,
      lines: receiptLines(
        allocation,
        planRow?.instalments ?? [],
        data.heads,
        Boolean(gstin)
      ).map((l, i) =>
        allocation[i]!.headId === "advance" ? { ...l, head: "Advance" } : l
      ),
      total: row.amount,
    }
    await tx
      .update(feePayments)
      .set({
        status: "paid",
        allocation,
        receiptNo: number,
        receipt: seal("fee-receipt", JSON.stringify(snapshot)),
        razorpayPaymentId,
        paidAt: now,
      })
      .where(eq(feePayments.id, row.id))
    return {
      paid: true,
      receiptNo: number,
      fresh: true,
      studentName: who.name ?? who.email,
      amount: row.amount,
      studentId: row.studentId,
      slug: org!.slug,
    }
  })
  if (result.fresh) {
    await notify([result.studentId], {
      kind: "fee_paid",
      title: `Fee received: ₹${result.amount.toLocaleString("en-IN")} (${result.receiptNo})`,
      href: orgPages(result.slug).fees("me"),
      orgId,
    })
    await writeSystemEntry(
      "Razorpay",
      "fees.paid",
      `${result.studentName} paid ₹${result.amount.toLocaleString("en-IN")} online (${result.receiptNo})`,
      { receipt: result.receiptNo },
      { orgId }
    )
  }
  return { paid: result.paid, receiptNo: result.receiptNo }
}

/** A student's fees for themselves or a linked parent ("me" for your own). */
export async function myFees(slug: string, user: User, studentId: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const id = studentId === "me" ? user.id : studentId
  if (!(await isStudentOrParent(ctx, user, id)))
    throw notFound("No such student's fees.")
  const who = await student(ctx, id)
  const data = await ledgersFor(ctx, id)
  return {
    student: who,
    today: data.day,
    heads: data.heads,
    online: Boolean(keysOf(ctx.org.feeSettings)),
    plans: data.plans.map((p) => ({
      id: p.id,
      name: p.name,
      ledger: p.ledger,
      // Not who collected it, nor staff's notes on a concession.
      payments: p.payments.map(({ collectedBy: _by, ...rest }) => rest),
      concessions: p.concessions.map((c) => ({
        id: c.id,
        headId: c.headId,
        percent: c.percent,
        amount: c.amount,
        reason: c.reason,
      })),
    })),
  }
}
