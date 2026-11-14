import { enrolments, getDb, sql, users, type User } from "@workspace/db"
import { suggestPromotion } from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { pathName } from "@/features/campus/people"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError } from "@/lib/api/errors"
import {
  forbidden,
  isLeaf,
  needModule,
  syncPlaces,
  yearOf,
} from "./records-core"
import { makeCurrent } from "./years"

/*
 * Student records (a module): academic years, each student's record (admission number,
 * gender, and phone, date of birth and address sealed), and an enrolment per student per
 * year placing them in a group with a roll number and a status. The current year's
 * active enrolments are the students' places (group_members), so registers, timetables,
 * parents and the rest follow them: making another year current, or placing, moving or
 * withdrawing a student, rewrites their places (place / syncPlaces). A student may never
 * sign in: their account then has an address on .invalid (noLoginEmail), which Google
 * can't sign in and the outbox never mails. Rules in packages/judge/src/records.ts.
 */

const { and, asc, eq } = sql

export const target = z.union([
  z.uuid(),
  z.literal("graduate"),
  z.literal("repeat"),
  z.literal("withdraw"),
])

export const promoteSchema = z.object({
  fromYearId: z.uuid(),
  toYearId: z.uuid(),
  /** Each section's students go to a group, graduate, stay (repeat) or leave. */
  sections: z.record(z.string(), target),
  /** One student's own destination, over their section's. */
  exceptions: z.record(z.string(), target).default({}),
  makeCurrent: z.boolean().default(false),
  /** false: only count what would happen. */
  apply: z.boolean().default(false),
})

export function needPromote(ctx: OrgContext) {
  if (!canFor(ctx, "students.years", []) || !canFor(ctx, "students.edit", [])) {
    throw forbidden(
      "Promoting students needs Academic years and Add and edit students for the whole organization."
    )
  }
}

/** Every active student of a year, by section, with a suggested destination for each section. */
export async function promotionPlan(
  slug: string,
  user: User,
  fromYearId: string,
  toYearId: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needPromote(ctx)
  const [from, to] = await Promise.all([
    yearOf(ctx, fromYearId),
    yearOf(ctx, toYearId),
  ])
  if (from.id === to.id)
    throw new ApiError(400, "same_year", "Choose two different years.")
  const db = getDb()
  const [rows, already] = await Promise.all([
    db
      .select({
        userId: enrolments.userId,
        groupId: enrolments.groupId,
        rollNo: enrolments.rollNo,
        name: users.name,
        email: users.email,
      })
      .from(enrolments)
      .innerJoin(users, eq(enrolments.userId, users.id))
      .where(
        and(eq(enrolments.yearId, from.id), eq(enrolments.status, "active"))
      )
      .orderBy(asc(enrolments.rollNo), asc(users.name)),
    db
      .select({ userId: enrolments.userId })
      .from(enrolments)
      .where(eq(enrolments.yearId, to.id)),
  ])
  const placed = new Set(already.map((a) => a.userId))
  const sectionIds = [
    ...new Set(rows.flatMap((r) => (r.groupId ? [r.groupId] : []))),
  ]
  const suggested = suggestPromotion(ctx.groups, sectionIds)
  return {
    from: { id: from.id, name: from.name, isCurrent: from.isCurrent },
    to: { id: to.id, name: to.name, isCurrent: to.isCurrent },
    sections: sectionIds
      .map((id) => ({
        groupId: id,
        path: pathName(ctx, id),
        suggested: suggested[id] ?? "repeat",
        students: rows
          .filter((r) => r.groupId === id)
          .map((r) => ({
            id: r.userId,
            name: r.name ?? r.email,
            rollNo: r.rollNo,
            already: placed.has(r.userId),
          })),
      }))
      .sort((a, b) => byName(a.path, b.path)),
    targets: ctx.groups
      .filter((g) => isLeaf(ctx, g.id))
      .map((g) => ({ id: g.id, path: pathName(ctx, g.id) }))
      .sort((a, b) => byName(a.path, b.path)),
  }
}

/**
 * Moves a year's students on: each gets an enrolment in the other year (their section's
 * destination, or their own), or graduates or leaves (their enrolment this year says so).
 * Anyone already enrolled in the other year is skipped, so it can be run again. Places
 * change only if the other year is made current here (or later).
 */
export async function promote(
  slug: string,
  user: User,
  input: z.infer<typeof promoteSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needPromote(ctx)
  const [from, to] = await Promise.all([
    yearOf(ctx, input.fromYearId),
    yearOf(ctx, input.toYearId),
  ])
  if (from.id === to.id)
    throw new ApiError(400, "same_year", "Choose two different years.")
  for (const t of [
    ...Object.values(input.sections),
    ...Object.values(input.exceptions),
  ]) {
    if (!["graduate", "repeat", "withdraw"].includes(t) && !isLeaf(ctx, t)) {
      throw new ApiError(
        400,
        "not_a_section",
        "Every destination must be a class or section with nothing inside it."
      )
    }
  }
  const db = getDb()
  const [rows, already] = await Promise.all([
    db
      .select({
        id: enrolments.id,
        userId: enrolments.userId,
        groupId: enrolments.groupId,
        rollNo: enrolments.rollNo,
      })
      .from(enrolments)
      .where(
        and(eq(enrolments.yearId, from.id), eq(enrolments.status, "active"))
      ),
    db
      .select({ userId: enrolments.userId })
      .from(enrolments)
      .where(eq(enrolments.yearId, to.id)),
  ])
  const placed = new Set(already.map((a) => a.userId))
  const plan = rows.map((r) => {
    const t =
      input.exceptions[r.userId] ??
      (r.groupId ? input.sections[r.groupId] : undefined) ??
      "repeat"
    const kind = placed.has(r.userId)
      ? "skipped"
      : t === "graduate"
        ? "graduated"
        : t === "withdraw"
          ? "withdrawn"
          : t === "repeat"
            ? "repeated"
            : "moved"
    return { ...r, to: t === "repeat" ? r.groupId : t, kind }
  })
  const counts = {
    moved: 0,
    repeated: 0,
    graduated: 0,
    withdrawn: 0,
    skipped: 0,
  }
  for (const p of plan) counts[p.kind as keyof typeof counts]++
  if (!input.apply) return { applied: false, counts }
  await db.transaction(async (tx) => {
    for (const p of plan) {
      if (p.kind === "skipped") continue
      if (p.kind === "graduated" || p.kind === "withdrawn") {
        await tx
          .update(enrolments)
          .set({ status: p.kind })
          .where(eq(enrolments.id, p.id))
        continue
      }
      await tx.insert(enrolments).values({
        orgId: ctx.org.id,
        yearId: to.id,
        userId: p.userId,
        groupId: p.to,
        rollNo: p.kind === "repeated" ? p.rollNo : null,
      })
    }
    if (input.makeCurrent) await makeCurrent(tx, ctx, to.id)
    // Graduates and leavers of the current year leave their classes now.
    else if (from.isCurrent) await syncPlaces(tx, ctx, from.id)
  })
  await writeAudit(
    ctx,
    "records.promote",
    `Promoted ${from.name} to ${to.name}: ${counts.moved} moved up, ${counts.repeated} staying, ${counts.graduated} graduated, ${counts.withdrawn} leaving${input.makeCurrent ? `; ${to.name} is now current` : ""}`,
    { counts }
  )
  return { applied: true, counts }
}
