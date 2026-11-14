import {
  academicTerms,
  academicYears,
  classSubjects,
  classTeachers,
  enrolments,
  examMarks,
  examPapers,
  getDb,
  sql,
  studentRecords,
  subjects,
  termExams,
  users,
  type User,
} from "@workspace/db"
import {
  KINDS,
  readExamSettings,
  REMARK_MAX,
  SUBJECT_REMARK_MAX,
  type Permission,
} from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { covers } from "@/features/campus/people"
import {
  canFor,
  groupChain,
  orgContext,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"

/*
 * Exams and report cards (a module). An exam belongs to an academic year; its papers are
 * one per subject per class (a section), each with full and pass marks; marks are per
 * student per paper. Who sits a paper comes from the year's enrolments (Student records),
 * not from today's classes, so last year's results stay right after promotion.
 *
 * Who may do what:
 *   - "Set up exams" (exams.setup, organization-wide): exams, papers, the grading scale,
 *     publishing.
 *   - Entering marks: the paper's subject teacher (Subjects module), or "Enter marks"
 *     (exams.marks) covering the class.
 *   - "See results" (exams.view, the Teacher role has it) covering the class.
 *   - Students and their parents see their own report card, published exams only.
 * Marks are locked while an exam is published. Rules in packages/judge/src/results.ts.
 */

const { and, asc, desc, eq, inArray, or } = sql

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")

export const optionalDay = z
  .union([z.literal(""), day])
  .nullable()
  .default(null)
  .transform((v) => v || null)

export const examSchema = z.object({
  yearId: z.uuid(),
  name: z.string().trim().min(2, "Name the exam").max(60),
  startsOn: optionalDay,
  endsOn: optionalDay,
  weight: z.number().int().min(0).max(100).default(0),
  /** The term (semester) it's part of; null for none. */
  termId: z.uuid().nullable().optional(),
})

export const examPatchSchema = examSchema.omit({ yearId: true }).partial()

export const termSchema = z.object({
  yearId: z.uuid(),
  name: z.string().trim().min(2, "Name the term").max(40),
  startsOn: optionalDay,
  endsOn: optionalDay,
})

export const termPatchSchema = termSchema.omit({ yearId: true }).partial()

export const scaleSchema = z.object({
  remarks: z.array(z.string().max(1000)).max(200).optional(),
  scale: z
    .array(
      z.object({
        min: z.number().min(0).max(100),
        grade: z.string().trim().min(1).max(12),
        points: z.number().min(0).max(100).nullable().optional(),
      })
    )
    .min(2)
    .max(20)
    .optional(),
})

export const papersSchema = z.object({
  /** Classes; a grade means each of its sections. */
  groupIds: z.array(z.uuid()).min(1).max(500),
  /** Only these subjects; omitted: every subject the class takes. */
  subjectIds: z.array(z.uuid()).max(100).optional(),
  maxMarks: z.number().int().min(1).max(1000),
  passMarks: z.number().min(0).max(1000),
})

export const paperPatchSchema = z.object({
  maxMarks: z.number().int().min(1).max(1000).optional(),
  passMarks: z.number().min(0).max(1000).optional(),
  heldOn: optionalDay.optional(),
})

export const marksSchema = z.object({
  marks: z
    .array(
      z.object({
        userId: z.uuid(),
        marks: z.number().min(0).max(1000).nullable(),
        absent: z.boolean().default(false),
        /** The subject teacher's remark; omitted: left as it is, "": removed. */
        remark: z.string().trim().max(SUBJECT_REMARK_MAX).optional(),
      })
    )
    .max(500),
})

export const remarksSchema = z.object({
  remarks: z
    .array(
      z.object({
        userId: z.uuid(),
        text: z
          .string()
          .trim()
          .max(REMARK_MAX, `At most ${REMARK_MAX} characters`),
      })
    )
    .max(500),
})

export const publishSchema = z.object({
  published: z.boolean(),
  /** Publish even though some marks aren't in. */
  force: z.boolean().default(false),
})

export const forbidden = (message: string) =>
  new ApiError(403, "forbidden", message)

export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message)

export const duplicate = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === "23505" || e?.cause?.code === "23505"
}

export async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const modules = ctx.modules
  if (!modules.has("exams"))
    throw notFound("Exams aren't switched on for this organization.")
  if (!modules.has("records") || !modules.has("subjects"))
    throw conflict(
      "needs_modules",
      "Exams need the Student records and Subjects modules switched on."
    )
  return ctx
}

export const canSetup = (ctx: OrgContext) => canFor(ctx, "exams.setup", [])

export const coversAny = (ctx: OrgContext, ps: Permission[], groupId: string) =>
  ps.some((p) => covers(ctx, p, [groupId]))

/** May see a class's marks and results. */
export const canSee = (ctx: OrgContext, groupId: string) =>
  canSetup(ctx) || coversAny(ctx, ["exams.view", "exams.marks"], groupId)

export const isLeaf = (ctx: OrgContext, groupId: string) =>
  ctx.groups.some((g) => g.id === groupId) &&
  !ctx.groups.some((g) => g.parentId === groupId)

/** The sections at or under these groups. */
export function leavesOf(ctx: OrgContext, groupIds: string[]) {
  const out = new Set<string>()
  const walk = (id: string) => {
    const kids = ctx.groups.filter((g) => g.parentId === id)
    if (kids.length === 0) out.add(id)
    else kids.forEach((k) => walk(k.id))
  }
  for (const id of groupIds) {
    if (!ctx.groups.some((g) => g.id === id)) throw notFound("Class not found")
    walk(id)
  }
  return [...out]
}

export const settingsOf = (ctx: OrgContext) =>
  readExamSettings(ctx.org.moduleSettings, KINDS[ctx.org.type].grading)

/** The subject teacher of each (class, subject), looking up the class's grades too. */
export async function subjectTeachers(ctx: OrgContext, groupIds: string[]) {
  const chains = new Map(groupIds.map((g) => [g, [...groupChain(ctx, g)]]))
  const all = [...new Set([...chains.values()].flat())]
  const rows = all.length
    ? await getDb()
        .select()
        .from(classSubjects)
        .where(
          and(
            eq(classSubjects.orgId, ctx.org.id),
            inArray(classSubjects.groupId, all)
          )
        )
    : []
  return (groupId: string, subjectId: string) => {
    for (const g of chains.get(groupId) ?? [groupId]) {
      const row = rows.find((r) => r.groupId === g && r.subjectId === subjectId)
      if (row) return row.teacherId
    }
    return null
  }
}

/** Whether this person may enter marks for a paper. */
export const mayMark = (
  ctx: OrgContext,
  paper: { groupId: string; teacherId: string | null }
) =>
  canSetup(ctx) ||
  covers(ctx, "exams.marks", [paper.groupId]) ||
  (paper.teacherId != null && paper.teacherId === ctx.user.id)

/** Each of these sections' class teacher in a year. */
export async function classTeachersIn(yearId: string, groupIds: string[]) {
  const rows = groupIds.length
    ? await getDb()
        .select()
        .from(classTeachers)
        .where(
          and(
            eq(classTeachers.yearId, yearId),
            inArray(classTeachers.groupId, groupIds)
          )
        )
    : []
  return new Map(rows.map((r) => [r.groupId, r.teacherId]))
}

/** Whether this person may write a class's overall remarks. */
export const mayRemark = (
  ctx: OrgContext,
  groupId: string,
  classTeacher: string | null | undefined
) =>
  canSetup(ctx) ||
  covers(ctx, "exams.remarks", [groupId]) ||
  (classTeacher != null && classTeacher === ctx.user.id)

export async function ownExam(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Exam not found")
  const [exam] = await getDb()
    .select()
    .from(termExams)
    .where(and(eq(termExams.id, id), eq(termExams.orgId, ctx.org.id)))
  if (!exam) throw notFound("Exam not found")
  return exam
}

export async function ownPaper(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Paper not found")
  const [row] = await getDb()
    .select({
      paper: examPapers,
      exam: termExams,
      subject: subjects.name,
    })
    .from(examPapers)
    .innerJoin(termExams, eq(examPapers.examId, termExams.id))
    .innerJoin(subjects, eq(examPapers.subjectId, subjects.id))
    .where(and(eq(examPapers.id, id), eq(examPapers.orgId, ctx.org.id)))
  if (!row) throw notFound("Paper not found")
  const teacherOf = await subjectTeachers(ctx, [row.paper.groupId])
  return {
    ...row,
    teacherId: teacherOf(row.paper.groupId, row.paper.subjectId),
  }
}

export const locked = (exam: { publishedAt: Date | null; name: string }) => {
  if (exam.publishedAt)
    throw conflict(
      "published",
      `${exam.name} is published. Unpublish it to change marks or papers.`
    )
}

/** Whether this person has anything to do with exams here. */
export async function needSomeAccess(ctx: OrgContext) {
  if (
    canSetup(ctx) ||
    ctx.groups.some((g) => coversAny(ctx, ["exams.view", "exams.marks"], g.id))
  )
    return
  const [teaches] = await getDb()
    .select({ id: classSubjects.id })
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.orgId, ctx.org.id),
        eq(classSubjects.teacherId, ctx.user.id)
      )
    )
    .limit(1)
  if (teaches) return
  const [leads] = await getDb()
    .select({ g: classTeachers.groupId })
    .from(classTeachers)
    .where(
      and(
        eq(classTeachers.orgId, ctx.org.id),
        eq(classTeachers.teacherId, ctx.user.id)
      )
    )
    .limit(1)
  if (!leads) throw forbidden("You don't have access to exams here.")
}

export async function yearsOf(orgId: string) {
  return getDb()
    .select({
      id: academicYears.id,
      name: academicYears.name,
      isCurrent: academicYears.isCurrent,
      startsOn: academicYears.startsOn,
    })
    .from(academicYears)
    .where(eq(academicYears.orgId, orgId))
    .orderBy(desc(academicYears.startsOn))
}

export async function termsOf(yearId: string) {
  return getDb()
    .select()
    .from(academicTerms)
    .where(eq(academicTerms.yearId, yearId))
    .orderBy(
      asc(academicTerms.position),
      asc(academicTerms.startsOn),
      asc(academicTerms.createdAt)
    )
}

export async function ownTerm(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Term not found")
  const [term] = await getDb()
    .select()
    .from(academicTerms)
    .where(and(eq(academicTerms.id, id), eq(academicTerms.orgId, ctx.org.id)))
  if (!term) throw notFound("Term not found")
  return term
}

/** Active students of a class in a year, plus anyone who already has marks in its papers. */
export async function sitting(
  yearId: string,
  groupId: string,
  paperIds: string[]
) {
  const db = getDb()
  const withMarks = paperIds.length
    ? db
        .select({ userId: examMarks.userId })
        .from(examMarks)
        .where(inArray(examMarks.paperId, paperIds))
    : null
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      rollNo: enrolments.rollNo,
      status: enrolments.status,
      admissionNo: studentRecords.admissionNo,
    })
    .from(enrolments)
    .innerJoin(users, eq(enrolments.userId, users.id))
    .leftJoin(
      studentRecords,
      and(
        eq(studentRecords.orgId, enrolments.orgId),
        eq(studentRecords.userId, enrolments.userId)
      )
    )
    .where(
      and(
        eq(enrolments.yearId, yearId),
        eq(enrolments.groupId, groupId),
        withMarks
          ? or(
              eq(enrolments.status, "active"),
              inArray(enrolments.userId, withMarks)
            )
          : eq(enrolments.status, "active")
      )
    )
  return rows
    .map((r) => ({ ...r, name: r.name ?? r.email }))
    .sort(
      (a, b) => (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || byName(a.name, b.name)
    )
}

export type Tx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0]

export type ExamRow = typeof termExams.$inferSelect
