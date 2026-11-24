import {
  getDb,
  invoiceCounters,
  organizations,
  payments,
  sql,
  subscriptions,
  type User,
} from "@workspace/db"
import {
  BILLING_PERIODS,
  financialYear,
  gstSplit,
  invoiceNumber,
  periodEnd,
  priceOfPlan,
  upgradeDue,
  RENEW_WINDOW_DAYS,
  samePlan,
  withNeeds,
  type BillingPeriod,
  type PlanChoice,
} from "@workspace/judge"
import { z } from "zod"

import { writeSystemEntry } from "@/features/audit/server"
import { legalFacts } from "@/features/legal/server"
import { notify } from "@/features/notifications/server"
import {
  membersWhoCan,
  needFor,
  orgContext,
  writeAudit,
} from "@/features/orgs/server"
import { getSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"
import { needWithinLimit } from "@/lib/api/rate-limit"
import {
  COLORS,
  footers,
  letterhead,
  mm,
  newDocument,
  Writer,
} from "@/lib/pdf/document"

import {
  createOrder,
  paymentSignatureOk,
  razorpayKeyId,
  razorpayReady,
} from "./razorpay"
import { priceList } from "./server"

/*
 * Paying for a plan (Razorpay), and its invoice. The server works the price out again from the
 * choice (never trusting the browser), stores a payment with the change to make, and creates a
 * Razorpay order; once Razorpay says it's paid (the checkout's signed answer, or its signed
 * webhook if the tab was closed), applyPayment applies the change exactly once and numbers the
 * GST invoice. A smaller plan mid-period isn't paid for: it's kept for the next period.
 */

const { and, eq } = sql
const DAY = 86_400_000
/** Paying in the last week of a period renews it (the new one starts when it ends). */

export const checkoutSchema = z.object({
  features: z.array(z.string().max(40)).max(60),
  students: z.number().int().min(1).max(1_000_000),
  staff: z.number().int().min(0).max(100_000),
  judges: z.number().int().min(0).max(100),
  storagePacks: z.number().int().min(0).max(1000),
  period: z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]),
})

type Change = {
  choice: PlanChoice
  periodStart: string
  periodEnd: string
  /** Rupees one period of the plan costs (what the subscription records). */
  periodPrice: number
  describe: string
}

const PERIOD_WORD: Record<BillingPeriod, string> = {
  month: "Monthly",
  semester: "Semester",
  year: "Yearly",
}
const day = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })

async function billingContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.billing.manage", [])
  return ctx
}

async function seller() {
  const [s, legal] = await Promise.all([getSettings(), legalFacts()])
  return {
    registered: s["billing.gst_registered"],
    rate: s["billing.gst_rate"],
    sellerGstin: s["billing.gstin"],
    name: legal.operator,
    address: legal.address,
    email: legal.email,
  }
}

/** Starts paying for a plan: the order for the browser's Razorpay checkout, or a plan kept for next period. */
export async function checkout(
  slug: string,
  user: User,
  input: z.infer<typeof checkoutSchema>
) {
  const ctx = await billingContext(slug, user)
  // Each attempt makes a Razorpay order: an organization can't flood them.
  await needWithinLimit("checkout", ctx.org.id)
  const settings = await getSettings()
  if (!settings["billing.enabled"])
    throw new ApiError(409, "billing_off", "Billing isn't switched on.")
  if (!razorpayReady())
    throw new ApiError(
      409,
      "payments_off",
      "Paying online isn't set up yet. Contact GretLab to change your plan."
    )
  const list = await priceList()
  const choice: PlanChoice = {
    ...input,
    features: withNeeds(list, input.features),
  }
  const price = priceOfPlan(list, choice)
  if (price.quote)
    throw new ApiError(
      409,
      "custom_quote",
      "Plans this size are priced for you: contact GretLab."
    )
  const [sub] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, ctx.org.id))
  const now = new Date()
  const live =
    sub?.status === "active" &&
    sub.periodStart &&
    sub.periodEnd &&
    sub.periodEnd > now
  const renewing =
    live && sub!.periodEnd!.getTime() - now.getTime() <= RENEW_WINDOW_DAYS * DAY
  let kind: "new" | "renew" | "upgrade"
  let amount: number
  let change: Change
  const describe = (c: PlanChoice, start: Date, end: Date) =>
    `GretLab plan: ${c.features.length} features, ${c.students.toLocaleString("en-IN")} students, ${c.staff.toLocaleString("en-IN")} staff${c.judges ? `, ${c.judges} judge machines` : ""}${c.storagePacks ? `, ${c.storagePacks * 50} GB more storage` : ""} · ${PERIOD_WORD[c.period]}, ${day(start)} to ${day(end)}`
  if (live && !renewing) {
    // Mid-period: what's added, for the days left; the period can change at renewal.
    const current: PlanChoice = {
      features: sub!.features,
      students: sub!.students,
      staff: sub!.staff,
      judges: sub!.judges,
      storagePacks: sub!.storagePacks,
      period: sub!.period,
    }
    if (choice.period !== current.period)
      throw new ApiError(
        409,
        "change_period_at_renewal",
        "The way you pay changes at renewal. Choose the same period for now."
      )
    if (samePlan(list, current, choice))
      throw new ApiError(
        409,
        "same_plan",
        "That's your plan now. Change something to pay for it."
      )
    const due = upgradeDue(
      list,
      current,
      choice,
      sub!.periodStart!,
      sub!.periodEnd!,
      now
    )
    if (due <= 0) {
      // Smaller: nothing to pay; it starts at the next period.
      await getDb()
        .update(subscriptions)
        .set({
          next: choice as unknown as Record<string, unknown>,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(subscriptions.orgId, ctx.org.id))
      await writeAudit(
        ctx,
        "billing.scheduled",
        "Chose a smaller plan from the next period"
      )
      return { scheduled: true as const, from: sub!.periodEnd!.toISOString() }
    }
    kind = "upgrade"
    amount = due
    change = {
      choice,
      periodStart: sub!.periodStart!.toISOString(),
      periodEnd: sub!.periodEnd!.toISOString(),
      periodPrice: price.price,
      describe: `Added for the rest of the period: ${describe(choice, now, sub!.periodEnd!)}`,
    }
  } else {
    // A new period: from now, or from when the current one ends (renewing early).
    kind = live
      ? "renew"
      : sub?.status === "active" ||
          sub?.status === "past_due" ||
          sub?.status === "paused"
        ? "renew"
        : "new"
    const start = live ? sub!.periodEnd! : now
    const end = periodEnd(start, choice.period)
    amount = price.price
    change = {
      choice,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      periodPrice: price.price,
      describe: describe(choice, start, end),
    }
  }
  if (amount <= 0)
    throw new ApiError(
      409,
      "nothing_to_pay",
      "There's nothing to pay for that plan."
    )
  const tax = gstSplit(amount, await seller(), sub?.gstin || null)
  const [payment] = await getDb()
    .insert(payments)
    .values({
      orgId: ctx.org.id,
      kind,
      change: change as unknown as Record<string, unknown>,
      amount: tax.taxable,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst,
      total: tax.total,
      createdBy: user.id,
    })
    .returning({ id: payments.id })
  const order = await createOrder({
    paise: tax.total * 100,
    receipt: payment!.id,
    notes: { orgId: ctx.org.id, paymentId: payment!.id },
  })
  await getDb()
    .update(payments)
    .set({ razorpayOrderId: order.id })
    .where(eq(payments.id, payment!.id))
  return {
    scheduled: false as const,
    paymentId: payment!.id,
    orderId: order.id,
    /** For Razorpay's checkout: paise, the public key, and who's paying. */
    amount: tax.total * 100,
    currency: "INR",
    keyId: razorpayKeyId(),
    name: (await seller()).name,
    description: change.describe.slice(0, 250),
    prefill: { name: user.name ?? "", email: sub?.billingEmail || user.email },
    total: tax.total,
  }
}

export const confirmSchema = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
})

/** The checkout's answer: applied once its signature is Razorpay's. */
export async function confirm(
  slug: string,
  user: User,
  input: z.infer<typeof confirmSchema>
) {
  const ctx = await billingContext(slug, user)
  if (!paymentSignatureOk(input.orderId, input.paymentId, input.signature))
    throw new ApiError(
      400,
      "bad_signature",
      "That payment couldn't be confirmed. If you were charged, it will be applied within minutes."
    )
  const [own] = await getDb()
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.razorpayOrderId, input.orderId),
        eq(payments.orgId, ctx.org.id)
      )
    )
  if (!own) throw notFound("Payment not found")
  const applied = await applyPayment(input.orderId, input.paymentId)
  return { paid: true, invoiceNumber: applied?.invoiceNumber ?? null }
}

/**
 * Applies a paid order: once only (a second call finds it paid), the payment marked, the next
 * invoice number of the financial year taken, the invoice stored as issued, and the plan
 * changed, all in one transaction. Then whoever manages billing is told.
 */
export async function applyPayment(orderId: string, razorpayPaymentId: string) {
  const db = getDb()
  const result = await db.transaction(async (tx) => {
    const [payment] = (await tx.execute(
      sql.sql`select * from payments where razorpay_order_id = ${orderId} for update`
    )) as unknown as {
      id: string
      org_id: string
      status: string
      kind: string
      change: Change
      amount: number
      cgst: number
      sgst: number
      igst: number
      total: number
      invoice_number: string | null
    }[]
    if (!payment) return null
    if (payment.status === "paid")
      return {
        invoiceNumber: payment.invoice_number,
        orgId: payment.org_id,
        fresh: false,
      }
    const now = new Date()
    const fy = financialYear(now)
    const [counter] = await tx
      .insert(invoiceCounters)
      .values({ financialYear: fy, last: 1 })
      .onConflictDoUpdate({
        target: invoiceCounters.financialYear,
        set: { last: sql.sql`${invoiceCounters.last} + 1` },
      })
      .returning({ last: invoiceCounters.last })
    const number = invoiceNumber(now, counter!.last)
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, payment.org_id))
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orgId, payment.org_id))
    const s = await seller()
    const change = payment.change
    const invoice = {
      number,
      date: now.toISOString(),
      seller: {
        name: s.name,
        address: s.address,
        gstin: s.registered ? s.sellerGstin : "",
        email: s.email,
      },
      buyer: {
        name: sub?.legalName || org!.name,
        gstin: sub?.gstin ?? "",
        address: sub?.address ?? "",
        email: sub?.billingEmail ?? "",
      },
      lines: [{ description: change.describe, amount: payment.amount }],
      taxable: payment.amount,
      cgst: payment.cgst,
      sgst: payment.sgst,
      igst: payment.igst,
      total: payment.total,
      gstRate: s.rate,
      razorpayPaymentId,
    }
    await tx
      .update(payments)
      .set({
        status: "paid",
        paidAt: now,
        razorpayPaymentId,
        invoiceNumber: number,
        invoice,
      })
      .where(eq(payments.id, payment.id))
    const list = await priceList()
    const c = change.choice
    await tx
      .update(subscriptions)
      .set({
        status: "active",
        period: c.period,
        features: c.features,
        students: c.students,
        staff: c.staff,
        judges: c.judges,
        storagePacks: c.storagePacks,
        periodStart: new Date(change.periodStart),
        periodEnd: new Date(change.periodEnd),
        price: change.periodPrice,
        prices: list as unknown as Record<string, unknown>,
        next: null,
        overSince: null,
        notice: "",
        updatedAt: now,
      })
      .where(eq(subscriptions.orgId, payment.org_id))
    await tx
      .update(organizations)
      .set({ planFeatures: c.features })
      .where(eq(organizations.id, payment.org_id))
    await writeSystemEntry(
      "Razorpay",
      "billing.paid",
      `Paid ₹${payment.total.toLocaleString("en-IN")} (invoice ${number})`,
      { paymentId: payment.id, kind: payment.kind, invoice: number },
      { orgId: payment.org_id, tx }
    )
    return {
      invoiceNumber: number,
      orgId: payment.org_id,
      fresh: true,
      slug: org!.slug,
      orgName: org!.name,
      total: payment.total,
    }
  })
  if (result?.fresh && "slug" in result) {
    const ids = await membersWhoCan(result.orgId, "org.billing.manage")
    await notify(ids, {
      kind: "billing",
      title: `Payment received: ₹${result.total!.toLocaleString("en-IN")}`,
      body: `Invoice ${result.invoiceNumber} for ${result.orgName}. Your plan is updated.`,
      href: `/orgs/${result.slug}/manage/billing`,
      orgId: result.orgId,
    })
  }
  return result
}

/* ---------- the invoice ---------- */

type Invoice = {
  number: string
  date: string
  seller: { name: string; address: string; gstin: string; email: string }
  buyer: { name: string; gstin: string; address: string; email: string }
  lines: { description: string; amount: number }[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  gstRate: number
  razorpayPaymentId: string
}

const rupee = (n: number) => `Rs ${n.toLocaleString("en-IN")}`

/** A paid invoice as a PDF, for whoever manages the organization's billing. */
export async function invoicePdf(slug: string, user: User, paymentId: string) {
  const ctx = await billingContext(slug, user)
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw notFound("Invoice not found")
  const [row] = await getDb()
    .select({ invoice: payments.invoice, status: payments.status })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, ctx.org.id)))
  if (!row || row.status !== "paid" || !row.invoice)
    throw notFound("Invoice not found")
  const inv = row.invoice as unknown as Invoice
  const taxed = inv.cgst + inv.sgst + inv.igst > 0
  const { doc, fonts } = await newDocument({
    title: `Invoice ${inv.number}`,
    author: inv.seller.name,
  })
  const w = new Writer(doc, fonts, { margin: mm(18) })
  letterhead(
    w,
    inv.seller.name,
    taxed ? "Tax invoice" : "Invoice",
    inv.seller.address || undefined
  )
  w.facts([
    ["Invoice", inv.number],
    ["Date", day(new Date(inv.date))],
    ["Billed to", inv.buyer.name],
    ["Their GSTIN", inv.buyer.gstin || "–"],
    ["Address", inv.buyer.address || "–"],
    ["Our GSTIN", inv.seller.gstin || "Not registered for GST"],
  ])
  w.gap(10)
  w.table(
    [
      { label: "Description", width: 5 },
      { label: "Amount", width: 1.4, align: "right" },
    ],
    [
      ...inv.lines.map((l) => ({ cells: [l.description, rupee(l.amount)] })),
      ...(inv.cgst
        ? [{ cells: [`CGST ${inv.gstRate / 2}%`, rupee(inv.cgst)] }]
        : []),
      ...(inv.sgst
        ? [{ cells: [`SGST ${inv.gstRate / 2}%`, rupee(inv.sgst)] }]
        : []),
      ...(inv.igst
        ? [{ cells: [`IGST ${inv.gstRate}%`, rupee(inv.igst)] }]
        : []),
      { cells: ["Total paid", rupee(inv.total)], bold: true, shade: true },
    ],
    { size: 10 }
  )
  w.gap(10)
  w.text(`Paid online through Razorpay (payment ${inv.razorpayPaymentId}).`, {
    size: 9,
    color: COLORS.muted,
  })
  if (inv.seller.email)
    w.text(`Questions: ${inv.seller.email}`, { size: 9, color: COLORS.muted })
  footers(doc, fonts, `${inv.number} · ${inv.seller.name}`)
  return { doc, filename: `${inv.number.replaceAll("/", "-")}.pdf` }
}
