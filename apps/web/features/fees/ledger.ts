import {
  guardians,
  feeConcessions,
  feeHeads,
  feePayments,
  feePlans,
  feeReceiptCounters,
  getDb,
  groupMembers,
  hostelResidents,
  orgMembers,
  sql,
  studentRecords,
  transportRiders,
  users,
  type User,
} from "@workspace/db"
import {
  allocatePayment,
  feeLedger,
  financialYear,
  FINE,
  receiptNumber,
  splitWithGst,
  type Permission,
} from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { notify } from "@/features/notifications/server"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"
import { likeTerm, paged, readPage } from "@/lib/api/paging"
import { seal, unseal } from "@/lib/sealed"

import { feeRights, needFees } from "./server"

/*
 * A student's fees: which plans reach them (a plan names their class or a group above it),
 * the ledger of each (packages/judge/src/fees.ts), collecting at the counter, receipts and
 * cancelling one. Staff act for the students of the groups their role covers.
 */

const {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql: raw,
} = {
  ...sql,
  sql: sql.sql,
}

export const collectSchema = z.object({
  planId: z.uuid(),
  amount: z.number().int().min(1).max(100_000_000),
  mode: z.enum(["cash", "cheque", "dd", "upi", "transfer"]),
  /** A cheque or DD number and bank, a UPI or transfer reference. */
  reference: z.string().trim().max(120).default(""),
  /** Only these instalments; otherwise the oldest dues first. */
  instalments: z.array(z.string().max(40)).max(24).optional(),
})

export const concessionSchema = z
  .object({
    planId: z.uuid(),
    /** One head, or none for the whole plan. */
    headId: z.uuid().nullable(),
    percent: z.number().int().min(1).max(100).nullable(),
    amount: z.number().int().min(1).max(100_000_000).nullable(),
    reason: z.enum(["merit", "scholarship", "sibling", "staff_ward", "other"]),
    note: z.string().trim().max(300).default(""),
  })
  .refine((c) => (c.percent === null) !== (c.amount === null), {
    message: "Give a percent or an amount, not both",
  })

export const CONCESSION_REASON: Record<string, string> = {
  merit: "Merit",
  scholarship: "Scholarship",
  sibling: "Sibling",
  staff_ward: "Staff ward",
  other: "Other",
}

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Say why it's cancelled").max(300),
})

export const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  dd: "Demand draft",
  upi: "UPI",
  transfer: "Bank transfer",
  online: "Online (Razorpay)",
}

const forbidden = (what: string) =>
  new ApiError(403, "forbidden", `${what} isn't part of your role.`)

/** The groups a student sits in, in this organization. */
/** What the ledger needs of an organization; an OrgContext is one, and so is a webhook's. */
export interface FeeScope {
  org: { id: string }
  groups: { id: string; parentId: string | null }[]
}

export async function groupsOf(ctx: FeeScope, studentId: string) {
  const ids = new Set(ctx.groups.map((g) => g.id))
  const rows = await getDb()
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, studentId))
  return rows.map((r) => r.groupId).filter((g) => ids.has(g))
}

/** Those groups and every group above them. */
export function withAncestors(ctx: FeeScope, groupIds: string[]) {
  const parent = new Map(ctx.groups.map((g) => [g.id, g.parentId]))
  const all = new Set<string>()
  for (const g of groupIds) {
    let at: string | null | undefined = g
    while (at && !all.has(at)) {
      all.add(at)
      at = parent.get(at)
    }
  }
  return all
}

/**
 * Whether this person is the student, an active member, or a parent linked to them here
 * (with Parent accounts on).
 */
export async function isStudentOrParent(
  ctx: OrgContext,
  user: User,
  studentId: string
) {
  if (user.id === studentId) return ctx.membership?.status === "active" // A parent's access comes with the Parent accounts module, as everywhere else.
  if (!ctx.modules.has("parents")) return false

  const [link] = await getDb()
    .select({ id: guardians.id })
    .from(guardians)
    .where(
      and(
        eq(guardians.orgId, ctx.org.id),
        eq(guardians.parentId, user.id),
        eq(guardians.studentId, studentId)
      )
    )
  return Boolean(link)
}

/** Whether the person may do `permission` for a student in these groups. */
function mayFor(ctx: OrgContext, permission: Permission, groupIds: string[]) {
  return (
    canFor(ctx, permission, []) ||
    groupIds.some((g) => canFor(ctx, permission, [[g]]))
  )
}

export async function student(ctx: FeeScope, studentId: string) {
  const [row] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      admissionNo: studentRecords.admissionNo,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .leftJoin(
      studentRecords,
      and(
        eq(studentRecords.orgId, orgMembers.orgId),
        eq(studentRecords.userId, orgMembers.userId)
      )
    )
    .where(
      and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, studentId))
    )
  if (!row) throw notFound("No such student here.")
  return row
}

/** Everything a ledger is worked out from, for one student. */
export async function ledgersFor(ctx: FeeScope, studentId: string) {
  const db = getDb()
  const groups = await groupsOf(ctx, studentId)
  const reach = withAncestors(ctx, groups)
  const [plans, heads, concessions, payments, hostel, bus, day] =
    await Promise.all([
      db
        .select()
        .from(feePlans)
        .where(eq(feePlans.orgId, ctx.org.id))
        .orderBy(asc(feePlans.createdAt)),
      db.select().from(feeHeads).where(eq(feeHeads.orgId, ctx.org.id)),
      db
        .select()
        .from(feeConcessions)
        .where(
          and(
            eq(feeConcessions.orgId, ctx.org.id),
            eq(feeConcessions.studentId, studentId)
          )
        ),
      db
        .select({
          id: feePayments.id,
          planId: feePayments.planId,
          amount: feePayments.amount,
          mode: feePayments.mode,
          reference: feePayments.reference,
          allocation: feePayments.allocation,
          status: feePayments.status,
          cancelReason: feePayments.cancelReason,
          receiptNo: feePayments.receiptNo,
          paidAt: feePayments.paidAt,
          collectedBy: users.name,
        })
        .from(feePayments)
        .leftJoin(users, eq(users.id, feePayments.collectedBy))
        .where(
          and(
            eq(feePayments.orgId, ctx.org.id),
            eq(feePayments.studentId, studentId),
            inArray(feePayments.status, ["paid", "cancelled"])
          )
        )
        .orderBy(desc(feePayments.paidAt)),
      db
        .select({ id: hostelResidents.userId })
        .from(hostelResidents)
        .where(
          and(
            eq(hostelResidents.orgId, ctx.org.id),
            eq(hostelResidents.userId, studentId)
          )
        ),
      db
        .select({ id: transportRiders.userId })
        .from(transportRiders)
        .where(
          and(
            eq(transportRiders.orgId, ctx.org.id),
            eq(transportRiders.userId, studentId)
          )
        ),
      today(),
    ])
  const facts = { hostel: hostel.length > 0, transport: bus.length > 0 }
  const reached = plans.filter(
    (p) =>
      p.audience.some((g) => reach.has(g)) ||
      payments.some((pay) => pay.planId === p.id)
  )
  const headInfo = heads.map((h) => ({
    id: h.id,
    name: h.name,
    gstRate: h.gstRate,
    appliesTo: h.appliesTo,
  }))
  return {
    groups,
    heads: headInfo,
    day,
    plans: reached.map((plan) => {
      const mine = payments.filter((p) => p.planId === plan.id)
      return {
        id: plan.id,
        name: plan.name,
        yearId: plan.yearId,
        concessions: concessions.filter((c) => c.planId === plan.id),
        payments: mine,
        ledger: feeLedger({
          heads: headInfo,
          instalments: plan.instalments,
          concessions: concessions.filter((c) => c.planId === plan.id),
          payments: mine.map((p) => ({
            status: p.status as "paid" | "cancelled",
            paidOn: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
            allocation: p.allocation,
          })),
          facts,
          today: day,
        }),
      }
    }),
  }
}

/** A student's fees, for staff who may see them. */
export async function studentFees(slug: string, user: User, studentId: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const who = await student(ctx, studentId)
  const data = await ledgersFor(ctx, studentId)
  const can = {
    view: mayFor(ctx, "fees.view", data.groups),
    collect: mayFor(ctx, "fees.collect", data.groups),
    concede: mayFor(ctx, "fees.concede", data.groups),
  }
  if (!can.view && !can.collect && !can.concede)
    throw forbidden("This student's fees")
  return {
    student: who,
    can,
    heads: data.heads,
    today: data.day,
    plans: data.plans,
  }
}

/**
 * Students whose fees this person may see: members sitting in their groups, searched by
 * name, email or admission number, 50 a page.
 */
export async function feeStudents(
  slug: string,
  user: User,
  query: URLSearchParams
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const rights = feeRights(ctx)
  if (!rights.view) throw forbidden("Fees")
  const page = readPage(query)
  const whole = (["fees.view", "fees.collect", "fees.concede"] as const).some(
    (p) => canFor(ctx, p, [])
  )
  const covered = ctx.groups
    .filter((g) =>
      (["fees.view", "fees.collect", "fees.concede"] as const).some((p) =>
        canFor(ctx, p, [[g.id]])
      )
    )
    .map((g) => g.id)
  const inGroups = whole
    ? raw`exists (select 1 from group_members gm join org_groups og on og.id = gm.group_id where og.org_id = ${ctx.org.id} and gm.user_id = ${orgMembers.userId})`
    : raw`exists (select 1 from group_members gm where gm.user_id = ${orgMembers.userId} and gm.group_id = any(${covered.length ? covered : ["00000000-0000-0000-0000-000000000000"]}::uuid[]))`
  const term = page.q ? likeTerm(page.q) : null
  const where = and(
    eq(orgMembers.orgId, ctx.org.id),
    eq(orgMembers.status, "active"),
    inGroups,
    term
      ? or(
          ilike(users.name, term),
          ilike(users.email, term),
          ilike(studentRecords.admissionNo, term)
        )
      : undefined
  )
  const db = getDb()
  return paged({
    page: page.page ?? 1,
    perPage: page.perPage ?? 50,
    count: async () =>
      Number(
        (
          await db
            .select({ n: raw<number>`count(*)` })
            .from(orgMembers)
            .innerJoin(users, eq(users.id, orgMembers.userId))
            .leftJoin(
              studentRecords,
              and(
                eq(studentRecords.orgId, orgMembers.orgId),
                eq(studentRecords.userId, orgMembers.userId)
              )
            )
            .where(where)
        )[0]?.n ?? 0
      ),
    rows: (limit, offset) =>
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          admissionNo: studentRecords.admissionNo,
        })
        .from(orgMembers)
        .innerJoin(users, eq(users.id, orgMembers.userId))
        .leftJoin(
          studentRecords,
          and(
            eq(studentRecords.orgId, orgMembers.orgId),
            eq(studentRecords.userId, orgMembers.userId)
          )
        )
        .where(where)
        .orderBy(asc(users.name), asc(users.id))
        .limit(limit)
        .offset(offset),
  })
}

/** What a receipt says, as issued (kept sealed, so reprints match). */
export interface ReceiptSnapshot {
  number: string
  date: string
  org: { name: string; gstin: string }
  student: { name: string; email: string; admissionNo: string | null }
  plan: string
  mode: string
  reference: string
  collectedBy: string | null
  lines: {
    instalment: string
    head: string
    amount: number
    gstRate: number
    taxable: number
    cgst: number
    sgst: number
  }[]
  total: number
}

/** The next receipt number for this financial year, taken under the counter's row lock. */
export async function nextReceipt(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  orgId: string,
  prefix: string,
  now: Date
) {
  const [row] = await tx
    .insert(feeReceiptCounters)
    .values({ orgId, financialYear: financialYear(now), last: 1 })
    .onConflictDoUpdate({
      target: [feeReceiptCounters.orgId, feeReceiptCounters.financialYear],
      set: { last: raw`${feeReceiptCounters.last} + 1` },
    })
    .returning({ last: feeReceiptCounters.last })
  return receiptNumber(prefix, now, row!.last)
}

/** The receipt's lines: each head's share, with GST worked out of it where the head has some. */
export function receiptLines(
  allocation: { instalmentId: string; headId: string; amount: number }[],
  instalments: { id: string; label: string }[],
  heads: { id: string; name: string; gstRate: number }[],
  withGst: boolean
) {
  return allocation.map((a) => {
    const head = heads.find((h) => h.id === a.headId)
    const rate = withGst && head ? head.gstRate : 0
    const split = splitWithGst(a.amount, rate)
    return {
      instalment: instalments.find((i) => i.id === a.instalmentId)?.label ?? "",
      head: a.headId === FINE ? "Late fine" : (head?.name ?? "Fee"),
      amount: a.amount,
      gstRate: rate,
      taxable: split.taxable,
      cgst: split.cgst,
      sgst: split.sgst,
    }
  })
}

/**
 * Records a payment at the counter: allocated to the oldest dues (or the chosen instalments),
 * never above what's owed, numbered, and kept as issued. One at a time per student and plan
 * (an advisory lock), so two counters can't spend the same dues twice.
 */
export async function collectFee(
  slug: string,
  user: User,
  studentId: string,
  input: z.infer<typeof collectSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const prefix = ctx.org.feeSettings.prefix
  if (!prefix)
    throw new ApiError(
      409,
      "no_prefix",
      "Set a receipt prefix in Fees › Setup first."
    )
  const who = await student(ctx, studentId)
  const groups = await groupsOf(ctx, studentId)
  if (!mayFor(ctx, "fees.collect", groups))
    throw forbidden("Collecting this student's fees")
  if (
    ["cheque", "dd", "upi", "transfer"].includes(input.mode) &&
    !input.reference
  )
    throw new ApiError(
      400,
      "reference_needed",
      "Enter the cheque, DD or transaction reference."
    )
  const db = getDb()
  const payment = await db.transaction(async (tx) => {
    await tx.execute(
      raw`select pg_advisory_xact_lock(hashtext(${`fees:${input.planId}:${studentId}`}))`
    )
    const data = await ledgersFor(ctx, studentId)
    const plan = data.plans.find((p) => p.id === input.planId)
    if (!plan) throw notFound("That plan isn't this student's.")
    const allocated = allocatePayment(
      plan.ledger,
      input.amount,
      input.instalments
    )
    if (!allocated.ok) throw new ApiError(400, "bad_amount", allocated.problem)
    const now = new Date()
    const number = await nextReceipt(tx, ctx.org.id, prefix, now)
    const [planRow] = await tx
      .select()
      .from(feePlans)
      .where(eq(feePlans.id, plan.id))
    const gstin = ctx.org.feeSettings.gstin ?? ""
    const snapshot: ReceiptSnapshot = {
      number,
      date: now.toISOString(),
      org: { name: ctx.org.name, gstin },
      student: {
        name: who.name ?? who.email,
        email: who.email,
        admissionNo: who.admissionNo,
      },
      plan: plan.name,
      mode: input.mode,
      reference: input.reference,
      collectedBy: user.name ?? user.email,
      lines: receiptLines(
        allocated.allocation,
        planRow!.instalments,
        data.heads,
        Boolean(gstin)
      ),
      total: input.amount,
    }
    const [row] = await tx
      .insert(feePayments)
      .values({
        orgId: ctx.org.id,
        planId: plan.id,
        studentId,
        amount: input.amount,
        mode: input.mode,
        reference: input.reference,
        allocation: allocated.allocation,
        status: "paid",
        receiptNo: number,
        receipt: seal("fee-receipt", JSON.stringify(snapshot)),
        collectedBy: user.id,
        paidAt: now,
      })
      .returning({ id: feePayments.id, receiptNo: feePayments.receiptNo })
    return row!
  })
  await notify([studentId], {
    kind: "fee_paid",
    title: `Fee received: ₹${input.amount.toLocaleString("en-IN")} (${payment.receiptNo})`,
    href: orgPages(ctx.org.slug).fees("me"),
    orgId: ctx.org.id,
  })
  await writeAudit(
    ctx,
    "fees.collect",
    `Collected ₹${input.amount.toLocaleString("en-IN")} from ${who.name ?? who.email} (${payment.receiptNo})`,
    { mode: input.mode, receipt: payment.receiptNo }
  )
  return payment
}

/** Cancels a receipt (a bounced cheque, a mistake): it keeps its number; the dues come back. */
export async function cancelReceipt(
  slug: string,
  user: User,
  paymentId: string,
  input: z.infer<typeof cancelSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const [row] = await getDb()
    .select()
    .from(feePayments)
    .where(
      and(eq(feePayments.id, paymentId), eq(feePayments.orgId, ctx.org.id))
    )
  if (!row || row.status !== "paid")
    throw notFound("No such receipt to cancel.")
  const groups = await groupsOf(ctx, row.studentId)
  if (!mayFor(ctx, "fees.collect", groups))
    throw forbidden("Cancelling this receipt")
  await getDb()
    .update(feePayments)
    .set({ status: "cancelled", cancelReason: input.reason })
    .where(and(eq(feePayments.id, paymentId), eq(feePayments.status, "paid")))
  await writeAudit(
    ctx,
    "fees.cancel",
    `Cancelled receipt ${row.receiptNo}: ${input.reason}`,
    {
      receipt: row.receiptNo,
      amount: row.amount,
    }
  )
}

/** A receipt as issued, for staff who may see the student's fees. */
export async function feeReceipt(slug: string, user: User, paymentId: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const [row] = await getDb()
    .select()
    .from(feePayments)
    .where(
      and(eq(feePayments.id, paymentId), eq(feePayments.orgId, ctx.org.id))
    )
  if (!row?.receipt) throw notFound("No such receipt.")
  const groups = await groupsOf(ctx, row.studentId)
  if (
    !mayFor(ctx, "fees.view", groups) &&
    !mayFor(ctx, "fees.collect", groups) &&
    !mayFor(ctx, "fees.concede", groups) &&
    // The student and their parents may download their own receipts.
    !(await isStudentOrParent(ctx, user, row.studentId))
  )
    throw notFound("No such receipt.")
  return {
    snapshot: JSON.parse(
      unseal("fee-receipt", row.receipt) ?? "null"
    ) as ReceiptSnapshot,
    status: row.status,
    cancelReason: row.cancelReason,
  }
}

/** Gives a concession on one of the student's plans (Give concessions, scoped). Logged. */
export async function giveConcession(
  slug: string,
  user: User,
  studentId: string,
  input: z.infer<typeof concessionSchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const who = await student(ctx, studentId)
  const groups = await groupsOf(ctx, studentId)
  if (!mayFor(ctx, "fees.concede", groups))
    throw forbidden("Giving this student concessions")
  const data = await ledgersFor(ctx, studentId)
  const plan = data.plans.find((p) => p.id === input.planId)
  if (!plan) throw notFound("That plan isn't this student's.")
  const head = input.headId
    ? data.heads.find((h) => h.id === input.headId)
    : null
  if (input.headId && !head)
    throw new ApiError(400, "bad_head", "That fee head isn't one of yours.")
  const [row] = await getDb()
    .insert(feeConcessions)
    .values({
      orgId: ctx.org.id,
      planId: plan.id,
      studentId,
      headId: input.headId,
      percent: input.percent,
      amount: input.amount,
      reason: input.reason,
      note: input.note,
      givenBy: user.id,
    })
    .returning({ id: feeConcessions.id })
  const what = input.percent
    ? `${input.percent}%`
    : `₹${input.amount!.toLocaleString("en-IN")}`
  await writeAudit(
    ctx,
    "fees.concession",
    `Gave ${who.name ?? who.email} a concession of ${what} off ${head ? head.name : plan.name} (${CONCESSION_REASON[input.reason]})`
  )
  return row!
}

/** Removes a concession; what it took off is owed again. Logged. */
export async function removeConcession(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const [row] = await getDb()
    .select()
    .from(feeConcessions)
    .where(and(eq(feeConcessions.id, id), eq(feeConcessions.orgId, ctx.org.id)))
  if (!row) throw notFound("No such concession.")
  const groups = await groupsOf(ctx, row.studentId)
  if (!mayFor(ctx, "fees.concede", groups))
    throw forbidden("Removing this concession")
  await getDb().delete(feeConcessions).where(eq(feeConcessions.id, id))
  const who = await student(ctx, row.studentId)
  await writeAudit(
    ctx,
    "fees.concession",
    `Removed a concession from ${who.name ?? who.email}`
  )
}
