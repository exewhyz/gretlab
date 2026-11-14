import {
  academicYears,
  classTeachers,
  enrolments,
  getDb,
  sql,
  type User,
} from "@workspace/db"
import { changesBetween, KINDS, yearProblem } from "@workspace/judge"
import { z } from "zod"

import { anyGroupGrant, pathName } from "@/features/campus/people"
import { teachersOfGroups } from "@/features/classes/server"
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
  ownYear,
  syncPlaces,
  Tx,
  yearOf,
  yearSchema,
} from "./records-core"

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

const { and, count, desc, eq, ilike, inArray, ne } = sql

export async function listYears(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = { years: canFor(ctx, "students.years", []) }
  if (
    !can.years &&
    !anyGroupGrant(ctx, "students.view") &&
    !anyGroupGrant(ctx, "students.edit")
  ) {
    throw forbidden("Student records aren't part of your role.")
  }
  const db = getDb()
  const [years, counts] = await Promise.all([
    db
      .select()
      .from(academicYears)
      .where(eq(academicYears.orgId, ctx.org.id))
      .orderBy(desc(academicYears.startsOn)),
    db
      .select({ yearId: enrolments.yearId, n: count() })
      .from(enrolments)
      .where(eq(enrolments.orgId, ctx.org.id))
      .groupBy(enrolments.yearId),
  ])
  return {
    terms: KINDS[ctx.org.type].terms,
    can,
    years: years.map((y) => ({
      id: y.id,
      name: y.name,
      startsOn: y.startsOn,
      endsOn: y.endsOn,
      isCurrent: y.isCurrent,
      enrolled: Number(counts.find((c) => c.yearId === y.id)?.n ?? 0),
    })),
  }
}

export async function nameFree(ctx: OrgContext, name: string, except?: string) {
  const [clash] = await getDb()
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(eq(academicYears.orgId, ctx.org.id), ilike(academicYears.name, name))
    )
  if (clash && clash.id !== except)
    throw new ApiError(
      409,
      "duplicate",
      `There's already a year called ${name}.`
    )
}

/** Makes a year the current one: every student moves to their place in it. */
export async function makeCurrent(tx: Tx, ctx: OrgContext, yearId: string) {
  await tx
    .update(academicYears)
    .set({ isCurrent: false })
    .where(
      and(eq(academicYears.orgId, ctx.org.id), ne(academicYears.id, yearId))
    )
  await tx
    .update(academicYears)
    .set({ isCurrent: true })
    .where(eq(academicYears.id, yearId))
  await syncPlaces(tx, ctx, yearId)
}

export async function addYear(
  slug: string,
  user: User,
  input: z.infer<typeof yearSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const problem = yearProblem(input)
  if (problem) throw new ApiError(400, "bad_year", problem)
  await nameFree(ctx, input.name)
  const id = await getDb().transaction(async (tx) => {
    const [y] = await tx
      .insert(academicYears)
      .values({
        orgId: ctx.org.id,
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      })
      .returning({ id: academicYears.id })
    if (input.isCurrent) await makeCurrent(tx, ctx, y!.id)
    return y!.id
  })
  await writeAudit(
    ctx,
    "records.year_add",
    `Added the academic year ${input.name}${input.isCurrent ? " (current)" : ""}`
  )
  return { id }
}

export async function updateYear(
  slug: string,
  user: User,
  id: string,
  input: Partial<z.infer<typeof yearSchema>>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const year = await yearOf(ctx, id)
  const next = {
    name: input.name ?? year.name,
    startsOn: input.startsOn ?? year.startsOn,
    endsOn: input.endsOn ?? year.endsOn,
  }
  const problem = yearProblem(next)
  if (problem) throw new ApiError(400, "bad_year", problem)
  if (input.name) await nameFree(ctx, input.name, id)
  await getDb().transaction(async (tx) => {
    await tx.update(academicYears).set(next).where(eq(academicYears.id, id))
    if (input.isCurrent === true && !year.isCurrent)
      await makeCurrent(tx, ctx, id)
    if (input.isCurrent === false && year.isCurrent) {
      await tx
        .update(academicYears)
        .set({ isCurrent: false })
        .where(eq(academicYears.id, id))
    }
  })
  const changes = changesBetween(
    { ...year, isCurrent: year.isCurrent },
    { ...next, isCurrent: input.isCurrent ?? year.isCurrent },
    { name: "Name", startsOn: "Starts", endsOn: "Ends", isCurrent: "Current" }
  )
  await writeAudit(
    ctx,
    input.isCurrent === true && !year.isCurrent
      ? "records.year_current"
      : "records.year_edit",
    input.isCurrent === true && !year.isCurrent
      ? `Made ${next.name} the current academic year`
      : `Changed the academic year ${next.name}`,
    { changes }
  )
  return { saved: true }
}

export async function deleteYear(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden("Academic years aren't part of your role.")
  const year = await yearOf(ctx, id)
  const [{ n } = { n: 0 }] = await getDb()
    .select({ n: count() })
    .from(enrolments)
    .where(eq(enrolments.yearId, id))
  if (Number(n) > 0) {
    throw new ApiError(
      400,
      "in_use",
      `${n} students are enrolled in ${year.name}. Only a year with no one in it can be deleted.`
    )
  }
  await getDb().delete(academicYears).where(eq(academicYears.id, id))
  await writeAudit(
    ctx,
    "records.year_delete",
    `Deleted the academic year ${year.name}`
  )
  return { deleted: true }
}

export const classTeachersSchema = z.object({
  assignments: z
    .array(z.object({ groupId: z.uuid(), teacherId: z.uuid().nullable() }))
    .max(1000),
})

/** Each section's class teacher for a year, and who could be (those teaching it). */
export async function classTeachersOf(
  slug: string,
  user: User,
  yearId: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden('Choosing class teachers needs "Academic years".')
  const year = await ownYear(ctx, yearId)
  const sections = ctx.groups.filter((g) => isLeaf(ctx, g.id))
  const [rows, options] = await Promise.all([
    getDb()
      .select()
      .from(classTeachers)
      .where(eq(classTeachers.yearId, year.id)),
    teachersOfGroups(
      ctx,
      sections.map((g) => g.id)
    ),
  ])
  return {
    year: { id: year.id, name: year.name },
    sections: sections
      .map((g) => ({
        groupId: g.id,
        name: pathName(ctx, g.id),
        teacherId: rows.find((r) => r.groupId === g.id)?.teacherId ?? null,
        options: (options.get(g.id) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
        })),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      ),
  }
}

export async function setClassTeachers(
  slug: string,
  user: User,
  yearId: string,
  input: z.infer<typeof classTeachersSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!canFor(ctx, "students.years", []))
    throw forbidden('Choosing class teachers needs "Academic years".')
  const year = await ownYear(ctx, yearId)
  for (const a of input.assignments)
    if (!isLeaf(ctx, a.groupId))
      throw new ApiError(
        400,
        "not_a_section",
        "Class teachers are for sections."
      )
  const options = await teachersOfGroups(
    ctx,
    input.assignments.map((a) => a.groupId)
  )
  for (const a of input.assignments) {
    if (
      a.teacherId &&
      !(options.get(a.groupId) ?? []).some((t) => t.id === a.teacherId)
    )
      throw new ApiError(
        400,
        "not_a_teacher",
        `Only someone teaching ${pathName(ctx, a.groupId)} can be its class teacher.`
      )
  }
  const before = await getDb()
    .select()
    .from(classTeachers)
    .where(eq(classTeachers.yearId, year.id))
  const changed = input.assignments.filter(
    (a) =>
      (before.find((b) => b.groupId === a.groupId)?.teacherId ?? null) !==
      a.teacherId
  )
  if (changed.length === 0) return classTeachersOf(slug, user, yearId)
  await getDb().transaction(async (tx) => {
    const cleared = changed.filter((a) => !a.teacherId).map((a) => a.groupId)
    if (cleared.length)
      await tx
        .delete(classTeachers)
        .where(
          and(
            eq(classTeachers.yearId, year.id),
            inArray(classTeachers.groupId, cleared)
          )
        )
    const set = changed.filter((a) => a.teacherId)
    if (set.length)
      await tx
        .insert(classTeachers)
        .values(
          set.map((a) => ({
            orgId: ctx.org.id,
            yearId: year.id,
            groupId: a.groupId,
            teacherId: a.teacherId!,
          }))
        )
        .onConflictDoUpdate({
          target: [classTeachers.yearId, classTeachers.groupId],
          set: { teacherId: sql.sql`excluded.teacher_id` },
        })
  })
  await writeAudit(
    ctx,
    "records.class_teachers",
    `Set the class teachers of ${changed.length} sections for ${year.name}`,
    { yearId: year.id }
  )
  return classTeachersOf(slug, user, yearId)
}
