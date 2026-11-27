import {
  feeConcessions,
  feeHeads,
  feePayments,
  feePlans,
  getDb,
  groupMembers,
  orgGroups,
  sql,
  studentRecords,
  users,
  type User,
} from "@workspace/db"
import type { Permission } from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import { canFor, orgContext, type OrgContext } from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import { orgLedgers } from "./batch"
import { CONCESSION_REASON, MODE_LABEL } from "./ledger"
import { needFees } from "./server"

/*
 * Fee reports (See fees, scoped): collection over a range of days (by mode, head and
 * collector, and every receipt), dues and defaulters (worked out for the whole organization in
 * one pass, then filtered), and concessions given. Each covers only the students of the groups
 * the person's role covers, or everyone with an organization-wide grant. CSV of each.
 */

const { and, desc, eq, gte, inArray, lt } = sql

const SEES: Permission[] = ["fees.view", "fees.collect", "fees.concede"]

export const reportQuerySchema = z.object({
  kind: z.enum(["collection", "dues", "concessions"]),
  /** YYYY-MM-DD, collection only: from this day through `to`. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Dues only: students in this group or one inside it. */
  groupId: z.uuid().optional(),
  overdueOnly: z.enum(["true", "false"]).optional(),
})

/** The students this person may see fees of: null for everyone (an organization-wide grant). */
async function visibleStudents(ctx: OrgContext) {
  if (SEES.some((p) => canFor(ctx, p, []))) return null
  const groups = ctx.groups
    .filter((g) => SEES.some((p) => canFor(ctx, p, [[g.id]])))
    .map((g) => g.id)
  if (groups.length === 0)
    throw new ApiError(
      403,
      "forbidden",
      "Fee reports aren't part of your role."
    )
  const rows = await getDb()
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groups))
  return new Set(rows.map((r) => r.userId))
}

/** A group and every group inside it. */
function subtree(ctx: OrgContext, groupId: string) {
  const ids = new Set([groupId])
  let grew = true
  while (grew) {
    grew = false
    for (const g of ctx.groups)
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id)
        grew = true
      }
  }
  return ids
}

async function names(ids: string[]) {
  if (ids.length === 0)
    return new Map<
      string,
      { name: string; email: string; admissionNo: string | null }
    >()
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      admissionNo: studentRecords.admissionNo,
    })
    .from(users)
    .leftJoin(studentRecords, eq(studentRecords.userId, users.id))
    .where(inArray(users.id, ids))
  return new Map(
    rows.map((r) => [
      r.id,
      { name: r.name ?? r.email, email: r.email, admissionNo: r.admissionNo },
    ])
  )
}

export async function feeReport(
  slug: string,
  user: User,
  input: z.infer<typeof reportQuerySchema>
) {
  const ctx = await orgContext(slug, user)
  needFees(ctx)
  const visible = await visibleStudents(ctx)
  const seen = (id: string) => visible === null || visible.has(id)
  const day = await today()
  const db = getDb()

  if (input.kind === "collection") {
    const to = input.to ?? day
    const from = input.from ?? `${day.slice(0, 7)}-01`
    if (from > to)
      throw new ApiError(
        400,
        "bad_range",
        "The first day comes after the last."
      )
    const end = new Date(`${to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    const [rows, heads, collectors] = await Promise.all([
      db
        .select({
          id: feePayments.id,
          studentId: feePayments.studentId,
          amount: feePayments.amount,
          mode: feePayments.mode,
          receiptNo: feePayments.receiptNo,
          paidAt: feePayments.paidAt,
          allocation: feePayments.allocation,
          collectedBy: feePayments.collectedBy,
          plan: feePlans.name,
        })
        .from(feePayments)
        .innerJoin(feePlans, eq(feePlans.id, feePayments.planId))
        .where(
          and(
            eq(feePayments.orgId, ctx.org.id),
            eq(feePayments.status, "paid"),
            gte(feePayments.paidAt, new Date(`${from}T00:00:00Z`)),
            lt(feePayments.paidAt, end)
          )
        )
        .orderBy(desc(feePayments.paidAt)),
      db
        .select({ id: feeHeads.id, name: feeHeads.name })
        .from(feeHeads)
        .where(eq(feeHeads.orgId, ctx.org.id)),
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .innerJoin(feePayments, eq(feePayments.collectedBy, users.id))
        .where(eq(feePayments.orgId, ctx.org.id)),
    ])
    const mine = rows.filter((r) => seen(r.studentId))
    const who = await names([...new Set(mine.map((r) => r.studentId))])
    const headName = new Map(heads.map((h) => [h.id, h.name]))
    const collector = new Map(collectors.map((c) => [c.id, c.name ?? c.email]))
    const sum = (key: (r: (typeof mine)[number]) => string) => {
      const totals = new Map<string, number>()
      for (const r of mine)
        totals.set(key(r), (totals.get(key(r)) ?? 0) + r.amount)
      return [...totals]
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount)
    }
    const byHead = new Map<string, number>()
    for (const r of mine)
      for (const a of r.allocation) {
        const label =
          a.headId === "fine"
            ? "Late fines"
            : a.headId === "advance"
              ? "Advances"
              : (headName.get(a.headId) ?? "Fee")
        byHead.set(label, (byHead.get(label) ?? 0) + a.amount)
      }
    return {
      kind: "collection" as const,
      from,
      to,
      total: mine.reduce((n, r) => n + r.amount, 0),
      count: mine.length,
      byMode: sum((r) => MODE_LABEL[r.mode] ?? r.mode),
      byHead: [...byHead]
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount),
      byCollector: sum((r) =>
        r.mode === "online"
          ? "Online (Razorpay)"
          : (collector.get(r.collectedBy ?? "") ?? "—")
      ),
      rows: mine.map((r) => ({
        id: r.id,
        receiptNo: r.receiptNo,
        paidAt: r.paidAt,
        student: who.get(r.studentId)?.name ?? "",
        admissionNo: who.get(r.studentId)?.admissionNo ?? null,
        plan: r.plan,
        mode: MODE_LABEL[r.mode] ?? r.mode,
        amount: r.amount,
      })),
    }
  }

  if (input.kind === "dues") {
    const inGroup = input.groupId ? subtree(ctx, input.groupId) : null
    const seats = inGroup
      ? new Set(
          (
            await db
              .select({ userId: groupMembers.userId })
              .from(groupMembers)
              .innerJoin(orgGroups, eq(orgGroups.id, groupMembers.groupId))
              .where(
                and(
                  eq(orgGroups.orgId, ctx.org.id),
                  inArray(groupMembers.groupId, [...inGroup])
                )
              )
          ).map((r) => r.userId)
        )
      : null
    const ledgers = (await orgLedgers(ctx.org.id, day)).filter(
      (l) =>
        seen(l.studentId) &&
        (!seats || seats.has(l.studentId)) &&
        l.ledger.balance > 0
    )
    const byStudent = new Map<
      string,
      { owed: number; overdue: number; daysLate: number; plans: string[] }
    >()
    for (const l of ledgers) {
      const s = byStudent.get(l.studentId) ?? {
        owed: 0,
        overdue: 0,
        daysLate: 0,
        plans: [],
      }
      s.owed += l.ledger.balance
      s.overdue += l.ledger.overdue
      s.daysLate = Math.max(
        s.daysLate,
        ...l.ledger.instalments.map((i) => i.daysOverdue)
      )
      s.plans.push(l.planName)
      byStudent.set(l.studentId, s)
    }
    const overdueOnly = input.overdueOnly === "true"
    const list = [...byStudent].filter(([, s]) => !overdueOnly || s.overdue > 0)
    const who = await names(list.map(([id]) => id))
    const rows = list
      .map(([id, s]) => ({
        studentId: id,
        student: who.get(id)?.name ?? "",
        email: who.get(id)?.email ?? "",
        admissionNo: who.get(id)?.admissionNo ?? null,
        plans: s.plans.join(", "),
        owed: s.owed,
        overdue: s.overdue,
        daysLate: s.daysLate,
      }))
      .sort(
        (a, b) =>
          b.overdue - a.overdue ||
          b.owed - a.owed ||
          a.student.localeCompare(b.student)
      )
    return {
      kind: "dues" as const,
      today: day,
      students: rows.length,
      owed: rows.reduce((n, r) => n + r.owed, 0),
      overdue: rows.reduce((n, r) => n + r.overdue, 0),
      overdueStudents: rows.filter((r) => r.overdue > 0).length,
      rows,
    }
  }

  const rows = await db
    .select({
      id: feeConcessions.id,
      studentId: feeConcessions.studentId,
      plan: feePlans.name,
      head: feeHeads.name,
      percent: feeConcessions.percent,
      amount: feeConcessions.amount,
      reason: feeConcessions.reason,
      note: feeConcessions.note,
      givenBy: users.name,
      createdAt: feeConcessions.createdAt,
    })
    .from(feeConcessions)
    .innerJoin(feePlans, eq(feePlans.id, feeConcessions.planId))
    .leftJoin(feeHeads, eq(feeHeads.id, feeConcessions.headId))
    .leftJoin(users, eq(users.id, feeConcessions.givenBy))
    .where(eq(feeConcessions.orgId, ctx.org.id))
    .orderBy(desc(feeConcessions.createdAt))
  const mine = rows.filter((r) => seen(r.studentId))
  const who = await names([...new Set(mine.map((r) => r.studentId))])
  return {
    kind: "concessions" as const,
    count: mine.length,
    rows: mine.map((r) => ({
      ...r,
      student: who.get(r.studentId)?.name ?? "",
      admissionNo: who.get(r.studentId)?.admissionNo ?? null,
      head: r.head ?? "Whole plan",
      reason: CONCESSION_REASON[r.reason] ?? r.reason,
    })),
  }
}

/** A cell made safe for spreadsheets: quoted, and never read as a formula. */
const cell = (v: unknown) => {
  let text = v === null || v === undefined ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** The report as CSV, every row. */
export function feeReportCsv(report: Awaited<ReturnType<typeof feeReport>>) {
  const lines: unknown[][] = []
  if (report.kind === "collection") {
    lines.push([
      "Receipt",
      "Paid on",
      "Student",
      "Admission no.",
      "Plan",
      "Mode",
      "Amount",
    ])
    for (const r of report.rows)
      lines.push([
        r.receiptNo,
        r.paidAt?.toISOString().slice(0, 10),
        r.student,
        r.admissionNo,
        r.plan,
        r.mode,
        r.amount,
      ])
  } else if (report.kind === "dues") {
    lines.push([
      "Student",
      "Email",
      "Admission no.",
      "Plans",
      "Owed",
      "Overdue",
      "Days late",
    ])
    for (const r of report.rows)
      lines.push([
        r.student,
        r.email,
        r.admissionNo,
        r.plans,
        r.owed,
        r.overdue,
        r.daysLate,
      ])
  } else {
    lines.push([
      "Student",
      "Admission no.",
      "Plan",
      "Off",
      "Concession",
      "Reason",
      "Note",
      "Given by",
      "On",
    ])
    for (const r of report.rows)
      lines.push([
        r.student,
        r.admissionNo,
        r.plan,
        r.head,
        r.percent ? `${r.percent}%` : r.amount,
        r.reason,
        r.note,
        r.givenBy,
        r.createdAt.toISOString().slice(0, 10),
      ])
  }
  return lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n"
}
