import {
  classSubjects,
  getDb,
  organizations,
  sql,
  subjects,
  timetablePeriods,
  timetableSlots,
  users,
  type User,
} from "@workspace/db"
import {
  enabledModules,
  readTimetableSettings,
  teacherClash,
  validPeriod,
} from "@workspace/judge"
import { z } from "zod"

import { classContext } from "@/features/classes/server"
import {
  canAnywhere,
  canFor,
  needFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * The Timetable module: the organization's periods and school days, and each class's week
 * (a cell = day + period -> one of the class's subjects, which carries its teacher). A
 * teacher is never put in two classes in the same day and period (teacherClash).
 */

const { and, asc, eq, inArray } = sql

export const periodsSchema = z.object({
  days: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Choose at least one day")
    .max(7),
  periods: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1, "Name each period").max(40),
        starts: z.string(),
        ends: z.string(),
        isBreak: z.boolean().default(false),
      })
    )
    .max(16, "At most 16 periods"),
})

export const slotSchema = z.object({
  groupId: z.uuid(),
  day: z.number().int().min(1).max(7),
  periodId: z.uuid(),
  /** null clears the cell. */
  classSubjectId: z.uuid().nullable(),
  room: z.string().trim().max(40).default(""),
})

function needModule(ctx: OrgContext) {
  if (!enabledModules(ctx.org.type, ctx.org.modules).has("timetable")) {
    throw notFound("Timetables aren't switched on for this organization.")
  }
}

const pathOf = (ctx: OrgContext, groupId: string) => {
  const byId = new Map(ctx.groups.map((g) => [g.id, g]))
  const names: string[] = []
  for (
    let g = byId.get(groupId);
    g;
    g = g.parentId ? byId.get(g.parentId) : undefined
  )
    names.unshift(g.name)
  return names.join(" › ")
}

export const periodsOf = (orgId: string) =>
  getDb()
    .select()
    .from(timetablePeriods)
    .where(eq(timetablePeriods.orgId, orgId))
    .orderBy(asc(timetablePeriods.position))

/** Slots of some groups, with subject and teacher. */
export async function slotsOf(
  orgId: string,
  groupIds: string[] | null,
  teacherId?: string
) {
  const where = [eq(timetableSlots.orgId, orgId)]
  if (groupIds) {
    if (groupIds.length === 0) return []
    where.push(inArray(timetableSlots.groupId, groupIds))
  }
  if (teacherId) where.push(eq(classSubjects.teacherId, teacherId))
  return getDb()
    .select({
      id: timetableSlots.id,
      groupId: timetableSlots.groupId,
      day: timetableSlots.day,
      periodId: timetableSlots.periodId,
      room: timetableSlots.room,
      classSubjectId: timetableSlots.classSubjectId,
      subject: subjects.name,
      code: subjects.code,
      teacherId: classSubjects.teacherId,
      teacher: users.name,
    })
    .from(timetableSlots)
    .innerJoin(
      classSubjects,
      eq(timetableSlots.classSubjectId, classSubjects.id)
    )
    .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
    .leftJoin(users, eq(classSubjects.teacherId, users.id))
    .where(and(...where))
}

/** Manage › Timetable: periods, days, and the classes this person may edit. */
export async function timetableSetup(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    periods: canAnywhere(ctx, "timetable.periods"),
    edit: canAnywhere(ctx, "timetable.edit"),
  }
  if (!can.periods && !can.edit) {
    throw new ApiError(
      403,
      "forbidden",
      "Managing timetables isn't part of your role."
    )
  }
  const choosable = ctx.groups.filter((g) =>
    canFor(ctx, "timetable.edit", [[g.id]])
  )
  const byId = new Map(ctx.groups.map((g) => [g.id, g]))
  const shown = new Map(choosable.map((g) => [g.id, g]))
  for (const g of choosable) {
    for (
      let p = g.parentId;
      p && !shown.has(p);
      p = byId.get(p)?.parentId ?? null
    )
      shown.set(p, byId.get(p)!)
  }
  return {
    can,
    days: readTimetableSettings(ctx.org.moduleSettings).days,
    periods: (await periodsOf(ctx.org.id)).map(
      ({ id, name, starts, ends, isBreak }) => ({
        id,
        name,
        starts,
        ends,
        isBreak,
      })
    ),
    levels: ctx.org.groupLevels,
    choosable: choosable.map((g) => g.id),
    groups: [...shown.values()].map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
    })),
  }
}

/** Replaces the periods (kept by id, so cells stay) and the school days. */
export async function savePeriods(
  slug: string,
  user: User,
  input: z.infer<typeof periodsSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needFor(ctx, "timetable.periods", [])
  for (const p of input.periods) {
    if (!validPeriod(p.starts, p.ends)) {
      throw new ApiError(
        400,
        "bad_time",
        `${p.name}: give a start and end like 09:00 and 09:45, start first.`
      )
    }
  }
  const existing = await periodsOf(ctx.org.id)
  const known = new Set(existing.map((p) => p.id))
  if (input.periods.some((p) => p.id && !known.has(p.id)))
    throw notFound("Period not found")
  await getDb().transaction(async (tx) => {
    const keep = input.periods.flatMap((p) => (p.id ? [p.id] : []))
    const gone = existing.filter((p) => !keep.includes(p.id)).map((p) => p.id)
    if (gone.length)
      await tx
        .delete(timetablePeriods)
        .where(inArray(timetablePeriods.id, gone))
    for (const [position, p] of input.periods.entries()) {
      const values = {
        name: p.name,
        starts: p.starts,
        ends: p.ends,
        isBreak: p.isBreak,
        position,
      }
      if (p.id)
        await tx
          .update(timetablePeriods)
          .set(values)
          .where(eq(timetablePeriods.id, p.id))
      else
        await tx
          .insert(timetablePeriods)
          .values({ ...values, orgId: ctx.org.id })
    }
    // A period that became a break can't hold classes.
    const breaks = input.periods
      .filter((p) => p.isBreak && p.id)
      .map((p) => p.id!)
    if (breaks.length)
      await tx
        .delete(timetableSlots)
        .where(inArray(timetableSlots.periodId, breaks))
    const days = [...new Set(input.days)].sort()
    await tx
      .update(organizations)
      .set({
        moduleSettings: { ...ctx.org.moduleSettings, timetable: { days } },
      })
      .where(eq(organizations.id, ctx.org.id))
  })
  await writeAudit(
    ctx,
    "timetable.periods",
    `Set ${input.periods.length} periods and the school days`
  )
  return timetableSetup(slug, user)
}

/** A class's week, for viewing (members of the class) or editing (timetable editors). */
export async function classTimetable(
  slug: string,
  user: User,
  groupId: string
) {
  if (!z.uuid().safeParse(groupId).success) throw notFound("Class not found")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!ctx.groups.some((g) => g.id === groupId))
    throw notFound("Class not found")
  const canEdit = canFor(ctx, "timetable.edit", [[groupId]])
  // Editors may open any class they edit; everyone else must teach or sit in it.
  if (!canEdit) await classContext(slug, user, groupId)
  const [periods, slots, choices] = await Promise.all([
    periodsOf(ctx.org.id),
    slotsOf(ctx.org.id, [groupId]),
    getDb()
      .select({
        id: classSubjects.id,
        name: subjects.name,
        code: subjects.code,
        teacher: users.name,
      })
      .from(classSubjects)
      .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
      .leftJoin(users, eq(classSubjects.teacherId, users.id))
      .where(eq(classSubjects.groupId, groupId))
      .orderBy(asc(subjects.name)),
  ])
  return {
    group: pathOf(ctx, groupId),
    canEdit,
    days: readTimetableSettings(ctx.org.moduleSettings).days,
    periods: periods.map(({ id, name, starts, ends, isBreak }) => ({
      id,
      name,
      starts,
      ends,
      isBreak,
    })),
    slots: slots.map((s) => ({
      day: s.day,
      periodId: s.periodId,
      classSubjectId: s.classSubjectId,
      subject: s.subject,
      code: s.code,
      teacher: s.teacher,
      room: s.room,
    })),
    subjects: canEdit ? choices : [],
  }
}

/** Puts a class subject in a cell, or clears it (classSubjectId null). */
export async function setSlot(
  slug: string,
  user: User,
  input: z.infer<typeof slotSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!ctx.groups.some((g) => g.id === input.groupId))
    throw notFound("Class not found")
  needFor(ctx, "timetable.edit", [[input.groupId]])
  const days = readTimetableSettings(ctx.org.moduleSettings).days
  if (!days.includes(input.day))
    throw new ApiError(400, "not_a_school_day", "That isn't a school day.")
  const db = getDb()
  const [period] = await db
    .select()
    .from(timetablePeriods)
    .where(
      and(
        eq(timetablePeriods.id, input.periodId),
        eq(timetablePeriods.orgId, ctx.org.id)
      )
    )
  if (!period) throw notFound("Period not found")
  if (period.isBreak)
    throw new ApiError(400, "break", `${period.name} is a break.`)
  const cell = and(
    eq(timetableSlots.groupId, input.groupId),
    eq(timetableSlots.day, input.day),
    eq(timetableSlots.periodId, input.periodId)
  )
  if (!input.classSubjectId) {
    await db.delete(timetableSlots).where(cell)
    return { cleared: true }
  }
  const [choice] = await db
    .select({
      id: classSubjects.id,
      teacherId: classSubjects.teacherId,
      teacher: users.name,
    })
    .from(classSubjects)
    .leftJoin(users, eq(classSubjects.teacherId, users.id))
    .where(
      and(
        eq(classSubjects.id, input.classSubjectId),
        eq(classSubjects.groupId, input.groupId)
      )
    )
  if (!choice)
    throw new ApiError(
      400,
      "not_this_class",
      "Pick one of this class's subjects."
    )
  // The teacher mustn't be in another class in this period.
  const busy = await db
    .select({
      groupId: timetableSlots.groupId,
      teacherId: classSubjects.teacherId,
    })
    .from(timetableSlots)
    .innerJoin(
      classSubjects,
      eq(timetableSlots.classSubjectId, classSubjects.id)
    )
    .where(
      and(
        eq(timetableSlots.orgId, ctx.org.id),
        eq(timetableSlots.day, input.day),
        eq(timetableSlots.periodId, input.periodId)
      )
    )
  const clash = teacherClash(
    busy.map((b) => ({ ...b, day: input.day, periodId: input.periodId })),
    {
      groupId: input.groupId,
      day: input.day,
      periodId: input.periodId,
      teacherId: choice.teacherId,
    }
  )
  if (clash) {
    throw new ApiError(
      409,
      "teacher_busy",
      `${choice.teacher ?? "That teacher"} already teaches ${pathOf(ctx, clash.groupId)} in ${period.name}.`
    )
  }
  await db
    .insert(timetableSlots)
    .values({ ...input, classSubjectId: choice.id, orgId: ctx.org.id })
    .onConflictDoUpdate({
      target: [
        timetableSlots.groupId,
        timetableSlots.day,
        timetableSlots.periodId,
      ],
      set: { classSubjectId: choice.id, room: input.room },
    })
  await writeAudit(
    ctx,
    "timetable.slot",
    `Changed ${pathOf(ctx, input.groupId)}'s timetable`
  )
  return { saved: true }
}

/** Where this person teaches each period of the week (for a teacher's own view). */
export async function myTeachingWeek(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const [periods, slots] = await Promise.all([
    periodsOf(ctx.org.id),
    slotsOf(ctx.org.id, null, user.id),
  ])
  return {
    days: readTimetableSettings(ctx.org.moduleSettings).days,
    periods: periods.map(({ id, name, starts, ends, isBreak }) => ({
      id,
      name,
      starts,
      ends,
      isBreak,
    })),
    slots: slots.map((s) => ({
      day: s.day,
      periodId: s.periodId,
      subject: s.subject,
      code: s.code,
      group: pathOf(ctx, s.groupId),
      room: s.room,
    })),
  }
}
