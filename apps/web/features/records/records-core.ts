import {
  academicYears,
  enrolments,
  getDb,
  groupMembers,
  sql,
  studentRecords,
  users,
} from "@workspace/db"
import { ENROLMENT_STATUSES, type Permission } from "@workspace/judge"
import { z } from "zod"

import { covers } from "@/features/campus/people"
import { type OrgContext } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { seal } from "@/lib/sealed"

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

const { and, eq, inArray } = sql

export const SEAL = "student record"

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")

export const yearSchema = z.object({
  name: z.string().trim().min(2).max(40),
  startsOn: day,
  endsOn: day,
  isCurrent: z.boolean().optional(),
})

export const studentSchema = z.object({
  name: z.string().trim().min(1, "Give the student's name").max(120),
  /** Empty: a student who doesn't sign in. */
  email: z.union([z.literal(""), z.email("Not an email address")]).default(""),
  admissionNo: z.string().trim().max(40).default(""),
  gender: z.enum(["", "female", "male", "other"]).default(""),
  birthDate: z.union([z.literal(""), day]).default(""),
  phone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(300).default(""),
  /** The group (section) for the current year; null: not placed. */
  groupId: z.uuid().nullable().default(null),
  rollNo: z.number().int().min(1).max(9999).nullable().default(null),
})

export const statusSchema = z.object({ status: z.enum(ENROLMENT_STATUSES) })

export const forbidden = (message: string) =>
  new ApiError(403, "forbidden", message)

export function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("records")) {
    throw notFound("Student records aren't switched on for this organization.")
  }
}

export const isLeaf = (ctx: OrgContext, groupId: string) =>
  ctx.groups.some((g) => g.id === groupId) &&
  !ctx.groups.some((g) => g.parentId === groupId)

/** Whether a permission covers a student placed in this group (or, unplaced, the whole org). */
export const coversGroup = (
  ctx: OrgContext,
  p: Permission,
  groupId: string | null
) => covers(ctx, p, groupId ? [groupId] : [])

export type Tx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0]

export type Db = ReturnType<typeof getDb> | Tx

export async function currentYear(db: Db, orgId: string) {
  const [y] = await db
    .select()
    .from(academicYears)
    .where(
      and(eq(academicYears.orgId, orgId), eq(academicYears.isCurrent, true))
    )
  return y ?? null
}

/** Seats one student in exactly this group of the organization (or none). */
export async function place(
  db: Db,
  ctx: OrgContext,
  userId: string,
  groupId: string | null
) {
  const ids = ctx.groups.map((g) => g.id)
  if (ids.length) {
    await db
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, ids))
      )
  }
  if (groupId)
    await db
      .insert(groupMembers)
      .values({ groupId, userId })
      .onConflictDoNothing()
}

/** Every student's place becomes their active enrolment in this year. */
export async function syncPlaces(db: Db, ctx: OrgContext, yearId: string) {
  const students = await db
    .select({ userId: studentRecords.userId })
    .from(studentRecords)
    .where(eq(studentRecords.orgId, ctx.org.id))
  const ids = students.map((s) => s.userId)
  if (ids.length === 0) return
  const groupIds = ctx.groups.map((g) => g.id)
  if (groupIds.length) {
    await db
      .delete(groupMembers)
      .where(
        and(
          inArray(groupMembers.userId, ids),
          inArray(groupMembers.groupId, groupIds)
        )
      )
  }
  const seats = await db
    .select({ userId: enrolments.userId, groupId: enrolments.groupId })
    .from(enrolments)
    .where(and(eq(enrolments.yearId, yearId), eq(enrolments.status, "active")))
  const rows = seats.filter((s): s is { userId: string; groupId: string } =>
    Boolean(s.groupId)
  )
  if (rows.length)
    await db.insert(groupMembers).values(rows).onConflictDoNothing()
}

export async function yearOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Academic year not found")
  const [y] = await getDb()
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.id, id), eq(academicYears.orgId, ctx.org.id)))
  if (!y) throw notFound("Academic year not found")
  return y
}

/** A group and its ancestors' ids, own first. */
export function pathIds(ctx: OrgContext, groupId: string) {
  const out: string[] = []
  for (
    let g = ctx.groups.find((x) => x.id === groupId);
    g;
    g = g.parentId ? ctx.groups.find((x) => x.id === g!.parentId) : undefined
  ) {
    out.push(g.id)
  }
  return out
}

export function needPlace(ctx: OrgContext, groupId: string | null) {
  if (groupId && !isLeaf(ctx, groupId)) {
    throw new ApiError(
      400,
      "not_a_section",
      "Choose a class or section with no groups inside it."
    )
  }
  if (!coversGroup(ctx, "students.edit", groupId)) {
    throw forbidden(
      groupId
        ? "Adding students to that group isn't part of your role."
        : "Adding students outside your groups isn't part of your role."
    )
  }
}

export const sealed = (v: string) => (v ? seal(SEAL, v) : null)

export async function recordOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Student not found")
  const db = getDb()
  const year = await currentYear(db, ctx.org.id)
  const [row] = await db
    .select({ record: studentRecords, user: users })
    .from(studentRecords)
    .innerJoin(users, eq(studentRecords.userId, users.id))
    .where(
      and(eq(studentRecords.orgId, ctx.org.id), eq(studentRecords.userId, id))
    )
  if (!row) throw notFound("Student not found")
  const [enrolment] = year
    ? await db
        .select()
        .from(enrolments)
        .where(and(eq(enrolments.yearId, year.id), eq(enrolments.userId, id)))
    : []
  return { ...row, year, enrolment: enrolment ?? null }
}

export const GENDERS: Record<string, "" | "female" | "male" | "other"> = {
  "": "",
  f: "female",
  female: "female",
  girl: "female",
  m: "male",
  male: "male",
  boy: "male",
  o: "other",
  other: "other",
}

/** "2019-04-02", "02/04/2019" (day first) or "2/4/2019", as "YYYY-MM-DD"; null if neither. */
export function asDay(text: string) {
  const t = text.trim()
  if (!t) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  return m
    ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
    : null
}

/** A class written as a path, "Grade 3 / A" or "Grade 3 › A", to its group. */
export function groupByPath(ctx: OrgContext, path: string) {
  const parts = path
    .split(/\s*(?:\/|›|>)\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  let parent: string | null = null
  let found: (typeof ctx.groups)[number] | undefined
  for (const part of parts) {
    found = ctx.groups.find(
      (g) => g.parentId === parent && g.name.toLowerCase() === part
    )
    if (!found) return null
    parent = found.id
  }
  return found ?? null
}

export async function ownYear(ctx: OrgContext, yearId: string) {
  if (!z.uuid().safeParse(yearId).success) throw notFound("Year not found")
  const [year] = await getDb()
    .select()
    .from(academicYears)
    .where(
      and(eq(academicYears.id, yearId), eq(academicYears.orgId, ctx.org.id))
    )
  if (!year) throw notFound("Year not found")
  return year
}
