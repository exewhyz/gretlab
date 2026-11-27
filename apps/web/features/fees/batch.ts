import {
  feeConcessions,
  feeHeads,
  feePayments,
  feePlans,
  getDb,
  groupMembers,
  hostelResidents,
  orgGroups,
  orgMembers,
  sql,
  transportRiders,
} from "@workspace/db"
import { feeLedger } from "@workspace/judge"

import { withAncestors, type FeeScope } from "./ledger"

const { and, eq, inArray } = sql

/**
 * Every student's ledger for every plan that reaches them, in one pass over the organization
 * (a few queries, then in memory), for reminders and reports at any size. A plan reaches a
 * student when it names their group or one above it, or when they've paid on it.
 */
export async function orgLedgers(orgId: string, today: string) {
  const db = getDb()
  const [groups, plans, heads, concessions, payments, seats, hostel, bus] =
    await Promise.all([
      db
        .select({ id: orgGroups.id, parentId: orgGroups.parentId })
        .from(orgGroups)
        .where(eq(orgGroups.orgId, orgId)),
      db.select().from(feePlans).where(eq(feePlans.orgId, orgId)),
      db.select().from(feeHeads).where(eq(feeHeads.orgId, orgId)),
      db.select().from(feeConcessions).where(eq(feeConcessions.orgId, orgId)),
      db
        .select({
          planId: feePayments.planId,
          studentId: feePayments.studentId,
          status: feePayments.status,
          paidAt: feePayments.paidAt,
          allocation: feePayments.allocation,
        })
        .from(feePayments)
        .where(
          and(
            eq(feePayments.orgId, orgId),
            inArray(feePayments.status, ["paid", "cancelled"])
          )
        ),
      db
        .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
        .from(groupMembers)
        .innerJoin(orgGroups, eq(orgGroups.id, groupMembers.groupId))
        .innerJoin(
          orgMembers,
          and(
            eq(orgMembers.orgId, orgGroups.orgId),
            eq(orgMembers.userId, groupMembers.userId)
          )
        )
        .where(
          and(eq(orgGroups.orgId, orgId), eq(orgMembers.status, "active"))
        ),
      db
        .select({ id: hostelResidents.userId })
        .from(hostelResidents)
        .where(eq(hostelResidents.orgId, orgId)),
      db
        .select({ id: transportRiders.userId })
        .from(transportRiders)
        .where(eq(transportRiders.orgId, orgId)),
    ])
  const scope: FeeScope = { org: { id: orgId }, groups }
  const headInfo = heads.map((h) => ({
    id: h.id,
    name: h.name,
    gstRate: h.gstRate,
    appliesTo: h.appliesTo,
  }))
  const seatsOf = new Map<string, string[]>()
  for (const s of seats)
    seatsOf.set(s.userId, [...(seatsOf.get(s.userId) ?? []), s.groupId])
  const hostelIds = new Set(hostel.map((h) => h.id))
  const busIds = new Set(bus.map((b) => b.id))
  const paidOn = new Map<string, typeof payments>()
  for (const p of payments) {
    const key = `${p.planId}:${p.studentId}`
    paidOn.set(key, [...(paidOn.get(key) ?? []), p])
  }
  const out: {
    studentId: string
    planId: string
    planName: string
    ledger: ReturnType<typeof feeLedger>
  }[] = []
  const students = new Set([
    ...seatsOf.keys(),
    ...payments.map((p) => p.studentId),
  ])
  for (const studentId of students) {
    const reach = withAncestors(scope, seatsOf.get(studentId) ?? [])
    for (const plan of plans) {
      const theirs = paidOn.get(`${plan.id}:${studentId}`) ?? []
      if (!plan.audience.some((g) => reach.has(g)) && theirs.length === 0)
        continue
      out.push({
        studentId,
        planId: plan.id,
        planName: plan.name,
        ledger: feeLedger({
          heads: headInfo,
          instalments: plan.instalments,
          concessions: concessions.filter(
            (c) => c.planId === plan.id && c.studentId === studentId
          ),
          payments: theirs.map((p) => ({
            status: p.status as "paid" | "cancelled",
            paidOn: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
            allocation: p.allocation,
          })),
          facts: {
            hostel: hostelIds.has(studentId),
            transport: busIds.has(studentId),
          },
          today,
        }),
      })
    }
  }
  return out
}
