import {
  classSubjects,
  getDb,
  sql,
  subjects,
  users,
  type User,
} from "@workspace/db"
import { KINDS } from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { teachersOfGroup } from "@/features/classes/server"
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
 * The Subjects module: an organization's list of subjects, and which classes (groups) take
 * each one and who teaches it there. Timetables build on these.
 */

const { and, asc, eq, inArray } = sql

export const subjectSchema = z.object({
  name: z.string().trim().min(1, "Name the subject").max(80),
  code: z
    .string()
    .trim()
    .max(12, "At most 12 characters")
    .regex(/^[A-Za-z0-9_-]*$/, "Letters, digits, - and _ only")
    .default(""),
  description: z.string().trim().max(1000).default(""),
  /** Credits, for kinds that grade by credits (a college course: 3, 4, 1.5). */
  credits: z
    .number()
    .min(0)
    .max(40)
    .refine((n) => Math.round(n * 2) === n * 2, "Credits go in halves at most")
    .nullable()
    .default(null),
})

export const assignSchema = z.object({
  groupId: z.uuid(),
  teacherId: z.uuid().nullable().default(null),
})

function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("subjects")) {
    throw notFound("Subjects aren't switched on for this organization.")
  }
}

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  return ctx
}

/** "Grade 1 › Section A": a group's name with the groups above it. */
function pathOf(ctx: OrgContext, groupId: string) {
  const byId = new Map(ctx.groups.map((g) => [g.id, g]))
  const names: string[] = []
  for (
    let g = byId.get(groupId);
    g;
    g = g.parentId ? byId.get(g.parentId) : undefined
  ) {
    names.unshift(g.name)
  }
  return names.join(" › ")
}

const duplicate = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === "23505" || e?.cause?.code === "23505"
}

async function ownSubject(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Subject not found")
  const [row] = await getDb()
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, id), eq(subjects.orgId, ctx.org.id)))
  if (!row) throw notFound("Subject not found")
  return row
}

/** The subjects, each with the classes that take it and their teachers. */
export async function listSubjects(slug: string, user: User) {
  const ctx = await context(slug, user)
  const can = {
    create: canAnywhere(ctx, "subjects.create"),
    edit: canAnywhere(ctx, "subjects.edit"),
    delete: canAnywhere(ctx, "subjects.delete"),
    assign: canAnywhere(ctx, "subjects.assign"),
  }
  if (!Object.values(can).some(Boolean)) {
    throw new ApiError(
      403,
      "forbidden",
      "Managing subjects isn't part of your role."
    )
  }
  const db = getDb()
  const [rows, uses] = await Promise.all([
    db
      .select()
      .from(subjects)
      .where(eq(subjects.orgId, ctx.org.id))
      .orderBy(asc(subjects.name)),
    db
      .select({
        id: classSubjects.id,
        subjectId: classSubjects.subjectId,
        groupId: classSubjects.groupId,
        teacherId: classSubjects.teacherId,
        teacherName: users.name,
        teacherEmail: users.email,
      })
      .from(classSubjects)
      .leftJoin(users, eq(classSubjects.teacherId, users.id))
      .where(eq(classSubjects.orgId, ctx.org.id)),
  ])
  // Classes this person may put subjects on, with the groups above them to keep the tree whole.
  const choosable = ctx.groups.filter((g) =>
    canFor(ctx, "subjects.assign", [[g.id]])
  )
  const byId = new Map(ctx.groups.map((g) => [g.id, g]))
  const shown = new Map(choosable.map((g) => [g.id, g]))
  for (const g of choosable) {
    for (
      let p = g.parentId;
      p && !shown.has(p);
      p = byId.get(p)?.parentId ?? null
    ) {
      shown.set(p, byId.get(p)!)
    }
  }
  return {
    can,
    /** Credit-graded kinds (colleges) give each course its credits. */
    usesCredits: KINDS[ctx.org.type].grading === "credits",
    terms: KINDS[ctx.org.type].terms,
    levels: ctx.org.groupLevels,
    choosable: choosable.map((g) => g.id),
    groups: [...shown.values()].map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
    })),
    subjects: rows.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      description: s.description,
      credits: s.credits,
      classes: uses
        .filter((u) => u.subjectId === s.id)
        .map((u) => ({
          id: u.id,
          groupId: u.groupId,
          group: pathOf(ctx, u.groupId),
          teacher: u.teacherId
            ? { id: u.teacherId, name: u.teacherName ?? u.teacherEmail ?? "" }
            : null,
          canChange: canFor(ctx, "subjects.assign", [[u.groupId]]),
        }))
        .sort((a, b) => byName(a.group, b.group)),
    })),
  }
}

export async function createSubject(
  slug: string,
  user: User,
  input: z.infer<typeof subjectSchema>
) {
  const ctx = await context(slug, user)
  needFor(ctx, "subjects.create", [])
  try {
    const [row] = await getDb()
      .insert(subjects)
      .values({ ...input, orgId: ctx.org.id })
      .returning()
    await writeAudit(ctx, "subject.create", `Added the subject ${input.name}`)
    return row!
  } catch (error) {
    if (duplicate(error))
      throw new ApiError(
        409,
        "duplicate",
        "A subject with that name or code exists."
      )
    throw error
  }
}

export async function updateSubject(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof subjectSchema>
) {
  const ctx = await context(slug, user)
  needFor(ctx, "subjects.edit", [])
  await ownSubject(ctx, id)
  try {
    const [row] = await getDb()
      .update(subjects)
      .set(input)
      .where(eq(subjects.id, id))
      .returning()
    await writeAudit(ctx, "subject.update", `Changed the subject ${input.name}`)
    return row!
  } catch (error) {
    if (duplicate(error))
      throw new ApiError(
        409,
        "duplicate",
        "A subject with that name or code exists."
      )
    throw error
  }
}

export async function deleteSubject(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  needFor(ctx, "subjects.delete", [])
  const row = await ownSubject(ctx, id)
  await getDb().delete(subjects).where(eq(subjects.id, id))
  await writeAudit(ctx, "subject.delete", `Deleted the subject ${row.name}`)
}

/** Puts a subject on a class, or changes its teacher there. */
export async function assignSubject(
  slug: string,
  user: User,
  subjectId: string,
  input: z.infer<typeof assignSchema>
) {
  const ctx = await context(slug, user)
  if (!ctx.groups.some((g) => g.id === input.groupId))
    throw notFound("Class not found")
  needFor(ctx, "subjects.assign", [[input.groupId]])
  const subject = await ownSubject(ctx, subjectId)
  if (input.teacherId) {
    const staff = await teachersOfGroup(ctx, input.groupId)
    if (!staff.some((t) => t.id === input.teacherId)) {
      throw new ApiError(
        400,
        "not_a_teacher",
        "Choose someone who teaches this class."
      )
    }
  }
  const [row] = await getDb()
    .insert(classSubjects)
    .values({
      orgId: ctx.org.id,
      groupId: input.groupId,
      subjectId,
      teacherId: input.teacherId,
    })
    .onConflictDoUpdate({
      target: [classSubjects.groupId, classSubjects.subjectId],
      set: { teacherId: input.teacherId },
    })
    .returning()
  await writeAudit(
    ctx,
    "subject.assign",
    `Gave ${pathOf(ctx, input.groupId)} the subject ${subject.name}`
  )
  return row!
}

export async function unassignSubject(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Not found")
  const [row] = await getDb()
    .select()
    .from(classSubjects)
    .where(and(eq(classSubjects.id, id), eq(classSubjects.orgId, ctx.org.id)))
  if (!row) throw notFound("Not found")
  needFor(ctx, "subjects.assign", [[row.groupId]])
  await getDb().delete(classSubjects).where(eq(classSubjects.id, id))
  const subject = await ownSubject(ctx, row.subjectId)
  await writeAudit(
    ctx,
    "subject.unassign",
    `Took ${subject.name} off ${pathOf(ctx, row.groupId)}`
  )
}

/** Who may teach a subject in a class: the people given teaching there. */
export async function subjectTeachers(
  slug: string,
  user: User,
  groupId: string
) {
  const ctx = await context(slug, user)
  if (
    !z.uuid().safeParse(groupId).success ||
    !ctx.groups.some((g) => g.id === groupId)
  ) {
    throw notFound("Class not found")
  }
  needFor(ctx, "subjects.assign", [[groupId]])
  return (await teachersOfGroup(ctx, groupId)).map((t) => ({
    id: t.id,
    name: t.name,
  }))
}

/** A class's subjects and teachers (for the class page and the timetable). */
export async function subjectsOfGroups(orgId: string, groupIds: string[]) {
  if (groupIds.length === 0) return []
  return getDb()
    .select({
      id: classSubjects.id,
      groupId: classSubjects.groupId,
      subjectId: subjects.id,
      name: subjects.name,
      code: subjects.code,
      teacherId: classSubjects.teacherId,
      teacherName: users.name,
    })
    .from(classSubjects)
    .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
    .leftJoin(users, eq(classSubjects.teacherId, users.id))
    .where(
      and(
        eq(classSubjects.orgId, orgId),
        inArray(classSubjects.groupId, groupIds)
      )
    )
    .orderBy(asc(subjects.name))
}
