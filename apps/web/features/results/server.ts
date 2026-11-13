import {
  academicTerms,
  academicYears,
  classSubjects,
  classTeachers,
  enrolments,
  examMarks,
  examPapers,
  getDb,
  guardians,
  organizations,
  reportRemarks,
  sql,
  studentRecords,
  subjects,
  termExams,
  users,
  type User,
} from "@workspace/db"
import {
  bandFor,
  cgpa,
  cleanRemarkBank,
  enabledModules,
  examProblem,
  KINDS,
  markProblem,
  paperOutcome,
  paperProblem,
  ranks,
  readExamSettings,
  REMARK_MAX,
  scaleProblem,
  sortScale,
  SUBJECT_REMARK_MAX,
  sgpa,
  summarize,
  weighted,
  type GradeBand,
  type Permission,
} from "@workspace/judge"
import { z } from "zod"

import { covers, pathName } from "@/features/campus/people"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  groupChain,
  orgContext,
  writeAudit,
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

const { and, asc, count, desc, eq, inArray, isNotNull, or } = sql

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give a date")
const optionalDay = z
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

const forbidden = (message: string) => new ApiError(403, "forbidden", message)
const conflict = (code: string, message: string) =>
  new ApiError(409, code, message)

const duplicate = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === "23505" || e?.cause?.code === "23505"
}

async function context(slug: string, user: User) {
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

const canSetup = (ctx: OrgContext) => canFor(ctx, "exams.setup", [])
const coversAny = (ctx: OrgContext, ps: Permission[], groupId: string) =>
  ps.some((p) => covers(ctx, p, [groupId]))
/** May see a class's marks and results. */
const canSee = (ctx: OrgContext, groupId: string) =>
  canSetup(ctx) || coversAny(ctx, ["exams.view", "exams.marks"], groupId)

const isLeaf = (ctx: OrgContext, groupId: string) =>
  ctx.groups.some((g) => g.id === groupId) &&
  !ctx.groups.some((g) => g.parentId === groupId)

/** The sections at or under these groups. */
function leavesOf(ctx: OrgContext, groupIds: string[]) {
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

const settingsOf = (ctx: OrgContext) =>
  readExamSettings(ctx.org.moduleSettings, KINDS[ctx.org.type].grading)

/** The subject teacher of each (class, subject), looking up the class's grades too. */
async function subjectTeachers(ctx: OrgContext, groupIds: string[]) {
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
const mayMark = (
  ctx: OrgContext,
  paper: { groupId: string; teacherId: string | null }
) =>
  canSetup(ctx) ||
  covers(ctx, "exams.marks", [paper.groupId]) ||
  (paper.teacherId != null && paper.teacherId === ctx.user.id)

/** Each of these sections' class teacher in a year. */
async function classTeachersIn(yearId: string, groupIds: string[]) {
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
const mayRemark = (
  ctx: OrgContext,
  groupId: string,
  classTeacher: string | null | undefined
) =>
  canSetup(ctx) ||
  covers(ctx, "exams.remarks", [groupId]) ||
  (classTeacher != null && classTeacher === ctx.user.id)

async function ownExam(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Exam not found")
  const [exam] = await getDb()
    .select()
    .from(termExams)
    .where(and(eq(termExams.id, id), eq(termExams.orgId, ctx.org.id)))
  if (!exam) throw notFound("Exam not found")
  return exam
}

async function ownPaper(ctx: OrgContext, id: string) {
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

const locked = (exam: { publishedAt: Date | null; name: string }) => {
  if (exam.publishedAt)
    throw conflict(
      "published",
      `${exam.name} is published. Unpublish it to change marks or papers.`
    )
}

/* ---------- the grading scale ---------- */

export async function examSettings(slug: string, user: User) {
  const ctx = await context(slug, user)
  const settings = settingsOf(ctx)
  return {
    scale: settings.scale,
    remarks: settings.remarks,
    canSetup: canSetup(ctx),
  }
}

export async function saveScale(
  slug: string,
  user: User,
  input: z.infer<typeof scaleSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can change these settings.")
  const settings = (ctx.org.moduleSettings ?? {}) as Record<string, unknown>
  const exams = { ...((settings.exams as object) ?? {}) } as Record<
    string,
    unknown
  >
  if (input.scale) {
    const scale: GradeBand[] = sortScale(
      input.scale.map((b) => ({
        min: b.min,
        grade: b.grade.trim(),
        points: b.points ?? null,
      }))
    )
    const problem = scaleProblem(scale)
    if (problem) throw new ApiError(400, "bad_scale", problem)
    exams.scale = scale
  }
  if (input.remarks) {
    const { bank, problem } = cleanRemarkBank(input.remarks)
    if (problem) throw new ApiError(400, "bad_remarks", problem)
    exams.remarks = bank
  }
  await getDb()
    .update(organizations)
    .set({ moduleSettings: { ...settings, exams } })
    .where(eq(organizations.id, ctx.org.id))
  const next = readExamSettings({ exams })
  if (input.scale)
    await writeAudit(
      ctx,
      "exam.scale",
      `Set the grading scale: ${next.scale.map((b) => `${b.grade} from ${b.min}%`).join(", ")}`
    )
  if (input.remarks)
    await writeAudit(
      ctx,
      "exam.remark_bank",
      `Set ${next.remarks.length} remarks in the comment bank`
    )
  return { scale: next.scale, remarks: next.remarks, canSetup: true }
}

/* ---------- exams ---------- */

/** Whether this person has anything to do with exams here. */
async function needSomeAccess(ctx: OrgContext) {
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

async function yearsOf(orgId: string) {
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

/* ---------- terms (semesters) ---------- */

async function termsOf(yearId: string) {
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

/** Adds a term to a year: Semester 1, Term 2. */
export async function addTerm(
  slug: string,
  user: User,
  input: z.infer<typeof termSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can add terms.")
  const [year] = await getDb()
    .select()
    .from(academicYears)
    .where(
      and(
        eq(academicYears.id, input.yearId),
        eq(academicYears.orgId, ctx.org.id)
      )
    )
  if (!year) throw notFound("Year not found")
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
    throw new ApiError(400, "bad_term", "A term can't end before it starts.")
  const position = (await termsOf(year.id)).length
  try {
    const [term] = await getDb()
      .insert(academicTerms)
      .values({ ...input, orgId: ctx.org.id, position })
      .returning()
    await writeAudit(ctx, "exam.term", `Added ${input.name} to ${year.name}`, {
      termId: term!.id,
    })
    return { id: term!.id }
  } catch (error) {
    if (duplicate(error))
      throw conflict("duplicate", `${year.name} already has ${input.name}.`)
    throw error
  }
}

async function ownTerm(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Term not found")
  const [term] = await getDb()
    .select()
    .from(academicTerms)
    .where(and(eq(academicTerms.id, id), eq(academicTerms.orgId, ctx.org.id)))
  if (!term) throw notFound("Term not found")
  return term
}

export async function updateTerm(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof termPatchSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can change terms.")
  const term = await ownTerm(ctx, id)
  const next = { ...term, ...input }
  if (next.startsOn && next.endsOn && next.endsOn < next.startsOn)
    throw new ApiError(400, "bad_term", "A term can't end before it starts.")
  try {
    await getDb()
      .update(academicTerms)
      .set(input)
      .where(eq(academicTerms.id, id))
  } catch (error) {
    if (duplicate(error))
      throw conflict("duplicate", `That year already has ${next.name}.`)
    throw error
  }
  await writeAudit(ctx, "exam.term", `Changed the term ${next.name}`, {
    termId: id,
  })
  return { ok: true }
}

/** Removes a term; its exams stay, without a term. */
export async function deleteTerm(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can remove terms.")
  const term = await ownTerm(ctx, id)
  await getDb().delete(academicTerms).where(eq(academicTerms.id, id))
  await writeAudit(ctx, "exam.term_delete", `Removed the term ${term.name}`, {
    termId: id,
  })
  return { ok: true }
}

/** The exams of a year (the current one by default), with how far marking has got. */
export async function listExams(slug: string, user: User, yearId?: string) {
  const ctx = await context(slug, user)
  await needSomeAccess(ctx)
  const years = await yearsOf(ctx.org.id)
  const year =
    years.find((y) => y.id === yearId) ??
    years.find((y) => y.isCurrent) ??
    years[0] ??
    null
  if (yearId && year?.id !== yearId) throw notFound("Year not found")
  const db = getDb()
  const exams = year
    ? await db
        .select()
        .from(termExams)
        .where(eq(termExams.yearId, year.id))
        .orderBy(asc(termExams.startsOn), asc(termExams.createdAt))
    : []
  const ids = exams.map((e) => e.id)
  const [papers, entered] = ids.length
    ? await Promise.all([
        db
          .select({ examId: examPapers.examId, n: count() })
          .from(examPapers)
          .where(inArray(examPapers.examId, ids))
          .groupBy(examPapers.examId),
        db
          .select({ examId: examPapers.examId, n: count() })
          .from(examMarks)
          .innerJoin(examPapers, eq(examMarks.paperId, examPapers.id))
          .where(inArray(examPapers.examId, ids))
          .groupBy(examPapers.examId),
      ])
    : [[], []]
  const terms = year ? await termsOf(year.id) : []
  return {
    years,
    year,
    canSetup: canSetup(ctx),
    scale: settingsOf(ctx).scale,
    grading: KINDS[ctx.org.type].grading,
    words: KINDS[ctx.org.type].terms,
    terms: terms.map((t) => ({
      id: t.id,
      name: t.name,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
    })),
    exams: exams.map((e) => ({
      id: e.id,
      name: e.name,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      weight: e.weight,
      termId: e.termId,
      term: terms.find((t) => t.id === e.termId)?.name ?? null,
      published: e.publishedAt != null,
      papers: Number(papers.find((p) => p.examId === e.id)?.n ?? 0),
      marks: Number(entered.find((p) => p.examId === e.id)?.n ?? 0),
    })),
  }
}

export async function addExam(
  slug: string,
  user: User,
  input: z.infer<typeof examSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can add one.")
  const [year] = await getDb()
    .select()
    .from(academicYears)
    .where(
      and(
        eq(academicYears.id, input.yearId),
        eq(academicYears.orgId, ctx.org.id)
      )
    )
  if (!year) throw notFound("Year not found")
  const problem = examProblem(input)
  if (problem) throw new ApiError(400, "bad_exam", problem)
  if (
    input.termId &&
    !(await termsOf(year.id)).some((t) => t.id === input.termId)
  )
    throw new ApiError(400, "bad_term", "Choose a term of that year.")
  try {
    const [exam] = await getDb()
      .insert(termExams)
      .values({ ...input, orgId: ctx.org.id })
      .returning()
    await writeAudit(
      ctx,
      "exam.create",
      `Added the exam ${input.name} (${year.name})`,
      {
        examId: exam!.id,
      }
    )
    return { id: exam!.id }
  } catch (error) {
    if (duplicate(error))
      throw conflict(
        "duplicate",
        `${year.name} already has an exam called ${input.name}.`
      )
    throw error
  }
}

export async function updateExam(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof examPatchSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can change one.")
  const exam = await ownExam(ctx, id)
  const next = { ...exam, ...input }
  const problem = examProblem(next)
  if (problem) throw new ApiError(400, "bad_exam", problem)
  if (
    input.termId &&
    !(await termsOf(exam.yearId)).some((t) => t.id === input.termId)
  )
    throw new ApiError(400, "bad_term", "Choose a term of that year.")
  try {
    await getDb().update(termExams).set(input).where(eq(termExams.id, id))
  } catch (error) {
    if (duplicate(error))
      throw conflict(
        "duplicate",
        `There's already an exam called ${next.name} that year.`
      )
    throw error
  }
  await writeAudit(ctx, "exam.update", `Changed the exam ${next.name}`, {
    examId: id,
  })
  return { ok: true }
}

export async function deleteExam(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can delete one.")
  const exam = await ownExam(ctx, id)
  locked(exam)
  await getDb().delete(termExams).where(eq(termExams.id, id))
  await writeAudit(
    ctx,
    "exam.delete",
    `Deleted the exam ${exam.name} and its marks`,
    {
      examId: id,
    }
  )
  return { ok: true }
}

/** Active students of a class in a year, plus anyone who already has marks in its papers. */
async function sitting(yearId: string, groupId: string, paperIds: string[]) {
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
      (a, b) =>
        (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || a.name.localeCompare(b.name)
    )
}

/** An exam: its papers (those this person may see), by class, with marking progress. */
export async function getExam(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  await needSomeAccess(ctx)
  const exam = await ownExam(ctx, id)
  const db = getDb()
  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.id, exam.yearId))
  const rows = await db
    .select({
      id: examPapers.id,
      groupId: examPapers.groupId,
      subjectId: examPapers.subjectId,
      subject: subjects.name,
      maxMarks: examPapers.maxMarks,
      passMarks: examPapers.passMarks,
      heldOn: examPapers.heldOn,
    })
    .from(examPapers)
    .innerJoin(subjects, eq(examPapers.subjectId, subjects.id))
    .where(eq(examPapers.examId, id))
    .orderBy(asc(subjects.name))
  const teacherOf = await subjectTeachers(ctx, [
    ...new Set(rows.map((r) => r.groupId)),
  ])
  const visible = rows
    .map((r) => ({ ...r, teacherId: teacherOf(r.groupId, r.subjectId) }))
    .filter((r) => canSee(ctx, r.groupId) || mayMark(ctx, r))
  const ids = visible.map((r) => r.id)
  const groupIds = [...new Set(visible.map((r) => r.groupId))]
  const leads = await classTeachersIn(exam.yearId, groupIds)
  const [entered, seats, teachers, remarked] = await Promise.all([
    ids.length
      ? db
          .select({ paperId: examMarks.paperId, n: count() })
          .from(examMarks)
          .where(inArray(examMarks.paperId, ids))
          .groupBy(examMarks.paperId)
      : [],
    groupIds.length
      ? db
          .select({ groupId: enrolments.groupId, n: count() })
          .from(enrolments)
          .where(
            and(
              eq(enrolments.yearId, exam.yearId),
              eq(enrolments.status, "active"),
              inArray(enrolments.groupId, groupIds)
            )
          )
          .groupBy(enrolments.groupId)
      : [],
    (() => {
      const tids = [
        ...new Set(
          [...visible.map((r) => r.teacherId), ...leads.values()].filter(
            (t): t is string => !!t
          )
        ),
      ]
      return tids.length
        ? db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, tids))
        : []
    })(),
    db
      .select({ userId: reportRemarks.userId, groupId: enrolments.groupId })
      .from(reportRemarks)
      .innerJoin(
        enrolments,
        and(
          eq(enrolments.userId, reportRemarks.userId),
          eq(enrolments.yearId, exam.yearId)
        )
      )
      .where(
        and(eq(reportRemarks.examId, id), sql.isNull(reportRemarks.paperId))
      ),
  ])
  const nameOf = (uid: string | undefined) => {
    const t = teachers.find((x) => x.id === uid)
    return t ? (t.name ?? t.email) : null
  }
  const classes = groupIds
    .map((groupId) => ({
      groupId,
      name: pathName(ctx, groupId),
      students: Number(seats.find((s) => s.groupId === groupId)?.n ?? 0),
      canSeeResults: canSee(ctx, groupId),
      classTeacher: nameOf(leads.get(groupId)),
      canRemark: mayRemark(ctx, groupId, leads.get(groupId)),
      remarks: remarked.filter((r) => r.groupId === groupId).length,
      papers: visible
        .filter((p) => p.groupId === groupId)
        .map((p) => {
          const t = teachers.find((x) => x.id === p.teacherId)
          return {
            id: p.id,
            subjectId: p.subjectId,
            subject: p.subject,
            maxMarks: p.maxMarks,
            passMarks: p.passMarks,
            heldOn: p.heldOn,
            teacher: t ? (t.name ?? t.email) : null,
            entered: Number(entered.find((e) => e.paperId === p.id)?.n ?? 0),
            canMark: mayMark(ctx, p),
          }
        }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const setup = canSetup(ctx)
  return {
    exam: {
      id: exam.id,
      name: exam.name,
      startsOn: exam.startsOn,
      endsOn: exam.endsOn,
      weight: exam.weight,
      termId: exam.termId,
      published: exam.publishedAt != null,
      publishedAt: exam.publishedAt?.toISOString() ?? null,
    },
    year: year ? { id: year.id, name: year.name } : null,
    canSetup: setup,
    classes,
    /** Sections to add papers to (setup only). */
    sections: setup
      ? ctx.groups
          .filter((g) => isLeaf(ctx, g.id))
          .map((g) => ({ id: g.id, name: pathName(ctx, g.id) }))
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
          )
      : [],
    grades: setup
      ? ctx.groups
          .filter((g) => !isLeaf(ctx, g.id))
          .map((g) => ({ id: g.id, name: pathName(ctx, g.id) }))
      : [],
  }
}

/* ---------- papers ---------- */

/** Adds a paper for every subject each chosen class takes (or the chosen subjects). */
export async function addPapers(
  slug: string,
  user: User,
  examId: string,
  input: z.infer<typeof papersSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can add papers.")
  const exam = await ownExam(ctx, examId)
  locked(exam)
  const problem = paperProblem(input)
  if (problem) throw new ApiError(400, "bad_paper", problem)
  const leaves = leavesOf(ctx, input.groupIds)
  // A class takes the subjects given to it or to its grade.
  const chains = new Map(leaves.map((g) => [g, [...groupChain(ctx, g)]]))
  const all = [...new Set([...chains.values()].flat())]
  const taught = await getDb()
    .select({
      groupId: classSubjects.groupId,
      subjectId: classSubjects.subjectId,
    })
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.orgId, ctx.org.id),
        inArray(classSubjects.groupId, all)
      )
    )
  const wanted = input.subjectIds ? new Set(input.subjectIds) : null
  const values = leaves.flatMap((groupId) => {
    const chain = new Set(chains.get(groupId))
    const subjectIds = [
      ...new Set(
        taught.filter((t) => chain.has(t.groupId)).map((t) => t.subjectId)
      ),
    ].filter((s) => !wanted || wanted.has(s))
    return subjectIds.map((subjectId) => ({
      orgId: ctx.org.id,
      examId,
      groupId,
      subjectId,
      maxMarks: input.maxMarks,
      passMarks: input.passMarks,
    }))
  })
  if (values.length === 0)
    throw conflict(
      "no_subjects",
      "Those classes take none of those subjects. Give classes their subjects in Subjects first."
    )
  const added = await getDb()
    .insert(examPapers)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: examPapers.id })
  await writeAudit(
    ctx,
    "exam.papers",
    `Added ${added.length} papers to ${exam.name} (${input.maxMarks} marks, pass ${input.passMarks})`,
    { examId }
  )
  return { added: added.length, skipped: values.length - added.length }
}

export async function updatePaper(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof paperPatchSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can change papers.")
  const { paper, exam, subject } = await ownPaper(ctx, id)
  locked(exam)
  const next = { ...paper, ...input }
  const problem = paperProblem(next)
  if (problem) throw new ApiError(400, "bad_paper", problem)
  if (input.maxMarks != null && input.maxMarks < paper.maxMarks) {
    const [over] = await getDb()
      .select({ n: count() })
      .from(examMarks)
      .where(
        and(eq(examMarks.paperId, id), sql.gt(examMarks.marks, input.maxMarks))
      )
    if (Number(over?.n ?? 0) > 0)
      throw conflict(
        "marks_above",
        `${over!.n} students have more than ${input.maxMarks} marks in this paper already.`
      )
  }
  await getDb().update(examPapers).set(input).where(eq(examPapers.id, id))
  await writeAudit(
    ctx,
    "exam.paper",
    `Changed ${subject}, ${pathName(ctx, paper.groupId)} in ${exam.name}`,
    { examId: exam.id, paperId: id }
  )
  return { ok: true }
}

export async function deletePaper(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can remove papers.")
  const { paper, exam, subject } = await ownPaper(ctx, id)
  locked(exam)
  await getDb().delete(examPapers).where(eq(examPapers.id, id))
  await writeAudit(
    ctx,
    "exam.paper_delete",
    `Removed ${subject}, ${pathName(ctx, paper.groupId)} from ${exam.name}, with its marks`,
    { examId: exam.id }
  )
  return { ok: true }
}

/* ---------- marks ---------- */

/** One paper's marks sheet: the class's students and their marks. */
export async function paperSheet(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  const { paper, exam, subject, teacherId } = await ownPaper(ctx, id)
  const canMark = mayMark(ctx, { groupId: paper.groupId, teacherId })
  if (!canMark && !canSee(ctx, paper.groupId)) throw notFound("Paper not found")
  const [students, marks, notes] = await Promise.all([
    sitting(exam.yearId, paper.groupId, [paper.id]),
    getDb().select().from(examMarks).where(eq(examMarks.paperId, id)),
    getDb().select().from(reportRemarks).where(eq(reportRemarks.paperId, id)),
  ])
  return {
    paper: {
      id: paper.id,
      subject,
      class: pathName(ctx, paper.groupId),
      maxMarks: paper.maxMarks,
      passMarks: paper.passMarks,
      heldOn: paper.heldOn,
    },
    exam: { id: exam.id, name: exam.name, published: exam.publishedAt != null },
    canMark: canMark && exam.publishedAt == null,
    students: students.map((s) => {
      const m = marks.find((x) => x.userId === s.id)
      return {
        id: s.id,
        name: s.name,
        rollNo: s.rollNo,
        admissionNo: s.admissionNo,
        status: s.status,
        marks: m?.marks ?? null,
        absent: m?.absent ?? false,
        remark: notes.find((n) => n.userId === s.id)?.text ?? "",
      }
    }),
  }
}

/** Saves marks for some or all of a paper's students. A blank, not absent, clears a mark. */
export async function saveMarks(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof marksSchema>
) {
  const ctx = await context(slug, user)
  const { paper, exam, subject, teacherId } = await ownPaper(ctx, id)
  if (!mayMark(ctx, { groupId: paper.groupId, teacherId })) {
    if (canSee(ctx, paper.groupId))
      throw forbidden(
        "Only the subject teacher or someone allowed to enter marks can change these."
      )
    throw notFound("Paper not found")
  }
  locked(exam)
  const students = await sitting(exam.yearId, paper.groupId, [paper.id])
  const ids = new Set(students.map((s) => s.id))
  const problems: { userId: string; message: string }[] = []
  for (const m of input.marks) {
    if (!ids.has(m.userId))
      problems.push({
        userId: m.userId,
        message: "Not in this class that year.",
      })
    else if (!m.absent && m.marks != null) {
      const p = markProblem(m.marks, paper.maxMarks)
      if (p) problems.push({ userId: m.userId, message: p })
    }
  }
  if (problems.length) {
    const first = problems[0]!
    const who = students.find((s) => s.id === first.userId)?.name ?? "A student"
    throw new ApiError(
      400,
      "bad_marks",
      `${who}: ${first.message}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`
    )
  }
  const [before, notesBefore] = await Promise.all([
    getDb().select().from(examMarks).where(eq(examMarks.paperId, id)),
    getDb().select().from(reportRemarks).where(eq(reportRemarks.paperId, id)),
  ])
  const remarkChanges = input.marks.filter(
    (m) =>
      m.remark !== undefined &&
      (notesBefore.find((n) => n.userId === m.userId)?.text ?? "") !== m.remark
  )
  const set = input.marks.filter((m) => m.absent || m.marks != null)
  const cleared = input.marks
    .filter((m) => !m.absent && m.marks == null)
    .map((m) => m.userId)
  const changed = input.marks.filter((m) => {
    const was = before.find((b) => b.userId === m.userId)
    const absent = m.absent
    const marks = absent ? null : m.marks
    return was
      ? was.absent !== absent || was.marks !== marks
      : absent || marks != null
  })
  await getDb().transaction(async (tx) => {
    if (cleared.length)
      await tx
        .delete(examMarks)
        .where(
          and(eq(examMarks.paperId, id), inArray(examMarks.userId, cleared))
        )
    if (set.length)
      await tx
        .insert(examMarks)
        .values(
          set.map((m) => ({
            paperId: id,
            userId: m.userId,
            marks: m.absent ? null : m.marks,
            absent: m.absent,
            enteredBy: user.id,
            updatedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: [examMarks.paperId, examMarks.userId],
          set: {
            marks: sql.sql`excluded.marks`,
            absent: sql.sql`excluded.absent`,
            enteredBy: user.id,
            updatedAt: new Date(),
          },
        })
    await writeRemarks(
      tx,
      ctx,
      exam.id,
      id,
      remarkChanges.map((m) => ({ userId: m.userId, text: m.remark! }))
    )
  })
  if (remarkChanges.length)
    await writeAudit(
      ctx,
      "exam.remarks",
      `Wrote ${subject} remarks for ${remarkChanges.length} students, ${pathName(ctx, paper.groupId)} (${exam.name})`,
      { examId: exam.id, paperId: id }
    )
  if (changed.length) {
    // A correction to marks already entered is worth telling apart in the log.
    const corrected = changed.filter((m) =>
      before.some((b) => b.userId === m.userId)
    ).length
    await writeAudit(
      ctx,
      corrected ? "exam.marks_correct" : "exam.marks",
      `${corrected ? "Changed" : "Entered"} marks of ${changed.length} students in ${subject}, ${pathName(ctx, paper.groupId)} (${exam.name})`,
      { examId: exam.id, paperId: id, changed: changed.length, corrected }
    )
  }
  return paperSheet(slug, user, id)
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

/** Writes remarks (an empty one removes it): overall when paperId is null. */
async function writeRemarks(
  tx: Tx,
  ctx: OrgContext,
  examId: string,
  paperId: string | null,
  remarks: { userId: string; text: string }[]
) {
  const cleared = remarks.filter((r) => !r.text).map((r) => r.userId)
  const set = remarks.filter((r) => r.text)
  const where = paperId
    ? eq(reportRemarks.paperId, paperId)
    : and(eq(reportRemarks.examId, examId), sql.isNull(reportRemarks.paperId))
  if (cleared.length)
    await tx
      .delete(reportRemarks)
      .where(and(where, inArray(reportRemarks.userId, cleared)))
  if (set.length === 0) return
  // Partial unique indexes can't be an ON CONFLICT target simply, so replace.
  await tx.delete(reportRemarks).where(
    and(
      where,
      inArray(
        reportRemarks.userId,
        set.map((r) => r.userId)
      )
    )
  )
  await tx.insert(reportRemarks).values(
    set.map((r) => ({
      orgId: ctx.org.id,
      examId,
      paperId,
      userId: r.userId,
      text: r.text,
      writtenBy: ctx.user.id,
    }))
  )
}

/* ---------- overall remarks ---------- */

/** A class's overall remarks in an exam, with each student's result to write from. */
export async function remarksSheet(
  slug: string,
  user: User,
  examId: string,
  groupId: string
) {
  const ctx = await context(slug, user)
  const exam = await ownExam(ctx, examId)
  if (!isLeaf(ctx, groupId)) throw notFound("Class not found")
  const lead = (await classTeachersIn(exam.yearId, [groupId])).get(groupId)
  const canWrite = mayRemark(ctx, groupId, lead)
  if (!canWrite && !canSee(ctx, groupId)) throw notFound("Class not found")
  const [sheet, notes, leadName] = await Promise.all([
    classSheet(ctx, exam, groupId),
    getDb()
      .select()
      .from(reportRemarks)
      .where(eq(reportRemarks.examId, examId)),
    lead
      ? getDb()
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, lead))
      : [],
  ])
  const subjectOf = new Map(sheet.papers.map((p) => [p.id, p.subject]))
  return {
    exam: { id: exam.id, name: exam.name, published: exam.publishedAt != null },
    class: { id: groupId, name: pathName(ctx, groupId) },
    classTeacher: leadName[0] ? (leadName[0].name ?? leadName[0].email) : null,
    canWrite: canWrite && exam.publishedAt == null,
    bank: settingsOf(ctx).remarks,
    students: sheet.rows.map((r) => ({
      id: r.id,
      name: r.name,
      rollNo: r.rollNo,
      percent: r.percent,
      grade: r.grade,
      result: r.result,
      rank: r.rank,
      remark:
        notes.find((n) => n.userId === r.id && n.paperId == null)?.text ?? "",
      subjects: notes
        .filter(
          (n) => n.userId === r.id && n.paperId && subjectOf.has(n.paperId)
        )
        .map((n) => ({ subject: subjectOf.get(n.paperId!)!, text: n.text })),
    })),
  }
}

export async function saveRemarks(
  slug: string,
  user: User,
  examId: string,
  groupId: string,
  input: z.infer<typeof remarksSchema>
) {
  const ctx = await context(slug, user)
  const exam = await ownExam(ctx, examId)
  if (!isLeaf(ctx, groupId)) throw notFound("Class not found")
  const lead = (await classTeachersIn(exam.yearId, [groupId])).get(groupId)
  if (!mayRemark(ctx, groupId, lead)) {
    if (canSee(ctx, groupId))
      throw forbidden(
        "Only the class teacher or someone allowed to write remarks can change these."
      )
    throw notFound("Class not found")
  }
  locked(exam)
  const paperIds = (
    await getDb()
      .select({ id: examPapers.id })
      .from(examPapers)
      .where(
        and(eq(examPapers.examId, examId), eq(examPapers.groupId, groupId))
      )
  ).map((p) => p.id)
  const students = await sitting(exam.yearId, groupId, paperIds)
  const outsider = input.remarks.find(
    (r) => !students.some((s) => s.id === r.userId)
  )
  if (outsider)
    throw new ApiError(
      400,
      "not_in_class",
      "Someone there isn't in this class that year."
    )
  const before = await getDb()
    .select()
    .from(reportRemarks)
    .where(
      and(eq(reportRemarks.examId, examId), sql.isNull(reportRemarks.paperId))
    )
  const changed = input.remarks.filter(
    (r) => (before.find((b) => b.userId === r.userId)?.text ?? "") !== r.text
  )
  if (changed.length) {
    await getDb().transaction((tx) =>
      writeRemarks(tx, ctx, examId, null, changed)
    )
    await writeAudit(
      ctx,
      "exam.remarks",
      `Wrote remarks for ${changed.length} students, ${pathName(ctx, groupId)} (${exam.name})`,
      { examId, groupId }
    )
  }
  return remarksSheet(slug, user, examId, groupId)
}

/* ---------- results ---------- */

type ExamRow = typeof termExams.$inferSelect

/** Every student's result in one exam in one class, ranked. */
async function classSheet(ctx: OrgContext, exam: ExamRow, groupId: string) {
  const db = getDb()
  const papers = await db
    .select({
      id: examPapers.id,
      subjectId: examPapers.subjectId,
      subject: subjects.name,
      maxMarks: examPapers.maxMarks,
      passMarks: examPapers.passMarks,
    })
    .from(examPapers)
    .innerJoin(subjects, eq(examPapers.subjectId, subjects.id))
    .where(and(eq(examPapers.examId, exam.id), eq(examPapers.groupId, groupId)))
    .orderBy(asc(subjects.name))
  const ids = papers.map((p) => p.id)
  const [students, marks] = await Promise.all([
    sitting(exam.yearId, groupId, ids),
    ids.length
      ? db.select().from(examMarks).where(inArray(examMarks.paperId, ids))
      : [],
  ])
  const scale = settingsOf(ctx).scale
  const rows = students.map((s) => {
    const cells = papers.map((p) => {
      const m = marks.find((x) => x.paperId === p.id && x.userId === s.id)
      const mark = {
        maxMarks: p.maxMarks,
        passMarks: p.passMarks,
        marks: m?.marks ?? null,
        absent: m?.absent ?? false,
      }
      return {
        paperId: p.id,
        marks: mark.marks,
        absent: mark.absent,
        outcome: paperOutcome(mark),
        grade:
          mark.marks != null
            ? bandFor(scale, (100 * mark.marks) / p.maxMarks).grade
            : null,
      }
    })
    const summary = summarize(
      papers.map((p, i) => ({
        maxMarks: p.maxMarks,
        passMarks: p.passMarks,
        marks: cells[i]!.marks,
        absent: cells[i]!.absent,
      })),
      scale
    )
    return {
      id: s.id,
      name: s.name,
      rollNo: s.rollNo,
      admissionNo: s.admissionNo,
      status: s.status,
      cells,
      ...summary,
    }
  })
  // Only complete results are ranked, so a half-marked class doesn't mislead.
  const rankOf = ranks(
    rows.map((r) => ({
      id: r.id,
      score: r.result === "incomplete" ? null : r.percent,
    }))
  )
  const complete = rows.filter(
    (r) => r.result === "pass" || r.result === "fail"
  )
  return {
    scale,
    papers,
    rows: rows.map((r) => ({ ...r, rank: rankOf.get(r.id) ?? null })),
    stats: {
      students: rows.length,
      complete: complete.length,
      passed: complete.filter((r) => r.result === "pass").length,
      average: complete.length
        ? Math.round(
            (10 * complete.reduce((s, r) => s + (r.percent ?? 0), 0)) /
              complete.length
          ) / 10
        : null,
      highest: complete.length
        ? Math.max(...complete.map((r) => r.percent ?? 0))
        : null,
      subjects: papers.map((p) => {
        const got = marks.filter(
          (m) => m.paperId === p.id && !m.absent && m.marks != null
        )
        return {
          paperId: p.id,
          average: got.length
            ? Math.round(
                (10 * got.reduce((s, m) => s + m.marks!, 0)) / got.length
              ) / 10
            : null,
          failed: marks.filter(
            (m) =>
              m.paperId === p.id &&
              (m.absent || (m.marks != null && m.marks < p.passMarks))
          ).length,
        }
      }),
    },
  }
}

/** One class's results in an exam. */
export async function examResults(
  slug: string,
  user: User,
  examId: string,
  groupId: string
) {
  const ctx = await context(slug, user)
  const exam = await ownExam(ctx, examId)
  if (!ctx.groups.some((g) => g.id === groupId))
    throw notFound("Class not found")
  if (!canSee(ctx, groupId))
    throw forbidden("You can't see the results of that class.")
  const sheet = await classSheet(ctx, exam, groupId)
  return {
    exam: { id: exam.id, name: exam.name, published: exam.publishedAt != null },
    class: { id: groupId, name: pathName(ctx, groupId) },
    ...sheet,
  }
}

/** Publishes results (students and parents are told) or takes them back. */
export async function setPublished(
  slug: string,
  user: User,
  examId: string,
  input: z.infer<typeof publishSchema>
) {
  const ctx = await context(slug, user)
  if (!canSetup(ctx))
    throw forbidden("Only those who set up exams can publish results.")
  const exam = await ownExam(ctx, examId)
  const db = getDb()
  if (!input.published) {
    if (!exam.publishedAt) return { published: false, told: 0 }
    await db
      .update(termExams)
      .set({ publishedAt: null })
      .where(eq(termExams.id, examId))
    await writeAudit(
      ctx,
      "exam.unpublish",
      `Took back the results of ${exam.name}`,
      { examId }
    )
    return { published: false, told: 0 }
  }
  if (exam.publishedAt) return { published: true, told: 0 }
  const papers = await db
    .select({ id: examPapers.id, groupId: examPapers.groupId })
    .from(examPapers)
    .where(eq(examPapers.examId, examId))
  if (papers.length === 0)
    throw conflict("no_papers", `${exam.name} has no papers yet.`)
  const groupIds = [...new Set(papers.map((p) => p.groupId))]
  const seats = await db
    .select({ userId: enrolments.userId, groupId: enrolments.groupId })
    .from(enrolments)
    .where(
      and(
        eq(enrolments.yearId, exam.yearId),
        eq(enrolments.status, "active"),
        inArray(enrolments.groupId, groupIds)
      )
    )
  const [entered] = await db
    .select({ n: count() })
    .from(examMarks)
    .innerJoin(examPapers, eq(examMarks.paperId, examPapers.id))
    .innerJoin(
      enrolments,
      and(
        eq(enrolments.userId, examMarks.userId),
        eq(enrolments.yearId, exam.yearId),
        eq(enrolments.groupId, examPapers.groupId),
        eq(enrolments.status, "active")
      )
    )
    .where(eq(examPapers.examId, examId))
  const expected = papers.reduce(
    (s, p) => s + seats.filter((x) => x.groupId === p.groupId).length,
    0
  )
  const missing = expected - Number(entered?.n ?? 0)
  if (missing > 0 && !input.force)
    throw new ApiError(
      409,
      "incomplete",
      `${missing} marks aren't in yet. Publish anyway, or wait for them.`
    )
  await db
    .update(termExams)
    .set({ publishedAt: new Date() })
    .where(eq(termExams.id, examId))
  await writeAudit(
    ctx,
    "exam.publish",
    `Published the results of ${exam.name}${missing > 0 ? ` with ${missing} marks missing` : ""}`,
    { examId, missing: Math.max(0, missing) }
  )
  const students = [...new Set(seats.map((s) => s.userId))]
  // Parents get a copy (feedback.released is copied to them).
  const told = await notify(students, {
    kind: "results",
    title: `${exam.name} results are out`,
    body: `Your report card for ${exam.name} is ready.`,
    href: `/orgs/${ctx.org.slug}/results/me`,
    orgId: ctx.org.id,
  })
  return { published: true, told: told.inApp }
}

/* ---------- report cards ---------- */

/**
 * A student's report card for a year: each exam's marks by subject, with grades, the
 * class rank, and the year's weighted result. The student and their parents see only
 * published exams; staff who may see the class see all, marked unpublished.
 */
export async function reportCard(
  slug: string,
  user: User,
  studentId: string,
  yearId?: string
) {
  const ctx = await context(slug, user)
  const id = studentId === "me" ? user.id : studentId
  if (!z.uuid().safeParse(id).success) throw notFound("Not found")
  const db = getDb()
  const years = await db
    .select({
      id: academicYears.id,
      name: academicYears.name,
      isCurrent: academicYears.isCurrent,
      startsOn: academicYears.startsOn,
      groupId: enrolments.groupId,
      rollNo: enrolments.rollNo,
      status: enrolments.status,
    })
    .from(enrolments)
    .innerJoin(academicYears, eq(enrolments.yearId, academicYears.id))
    .where(and(eq(enrolments.orgId, ctx.org.id), eq(enrolments.userId, id)))
    .orderBy(desc(academicYears.startsOn))
  const isSelf = id === user.id
  let isParent = false
  if (!isSelf && ctx.modules.has("parents")) {
    const [link] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(
        and(
          eq(guardians.orgId, ctx.org.id),
          eq(guardians.parentId, user.id),
          eq(guardians.studentId, id)
        )
      )
    isParent = !!link
  }
  const staff = (groupId: string | null) => !!groupId && canSee(ctx, groupId)
  const family = isSelf || isParent
  // Staff see years in classes they may see; the family sees every year.
  const shown = years.filter((y) => family || staff(y.groupId))
  if (shown.length === 0) {
    // Only the family learns there's nothing yet; anyone else can't tell a student exists.
    throw notFound(family ? "No report card yet." : "Not found")
  }
  const year =
    shown.find((y) => y.id === yearId) ??
    shown.find((y) => y.isCurrent) ??
    shown[0]!
  if (yearId && year.id !== yearId) throw notFound("Year not found")
  const seeAll = staff(year.groupId)
  const [student] = await db
    .select({
      name: users.name,
      email: users.email,
      admissionNo: studentRecords.admissionNo,
    })
    .from(users)
    .leftJoin(
      studentRecords,
      and(
        eq(studentRecords.userId, users.id),
        eq(studentRecords.orgId, ctx.org.id)
      )
    )
    .where(eq(users.id, id))
  const exams = await db
    .select()
    .from(termExams)
    .where(
      and(
        eq(termExams.yearId, year.id),
        seeAll ? undefined : isNotNull(termExams.publishedAt)
      )
    )
    .orderBy(asc(termExams.startsOn), asc(termExams.createdAt))
  const [card] = await composeCards(
    ctx,
    { id: year.id, name: year.name, groupId: year.groupId },
    exams,
    [
      {
        id,
        name: student?.name ?? student?.email ?? "Student",
        admissionNo: student?.admissionNo ?? null,
        rollNo: year.rollNo,
        status: year.status,
      },
    ]
  )
  // Credit-graded kinds (colleges): each term's grade card, and the CGPA so far.
  let credits: Awaited<ReturnType<typeof creditCard>> | null = null
  if (KINDS[ctx.org.type].grading === "credits") {
    const earlier = shown.filter((y) => y.startsOn < year.startsOn && y.groupId)
    const before = await Promise.all(
      earlier.map(async (y) => {
        const ex = await db
          .select()
          .from(termExams)
          .where(
            and(
              eq(termExams.yearId, y.id),
              staff(y.groupId) ? undefined : isNotNull(termExams.publishedAt)
            )
          )
        const [c] = await composeCards(
          ctx,
          { id: y.id, name: y.name, groupId: y.groupId },
          ex,
          [
            {
              id,
              name: "",
              admissionNo: null,
              rollNo: y.rollNo,
              status: y.status,
            },
          ]
        )
        return { yearId: y.id, card: c! }
      })
    )
    credits = await creditCard(
      ctx,
      [...before, { yearId: year.id, card: card! }],
      year.id
    )
  }
  return {
    ...card!,
    credits,
    years: shown.map((y) => ({ id: y.id, name: y.name })),
    viewer: isSelf ? "student" : isParent ? "parent" : "staff",
  }
}

/**
 * Grade cards by term for credit-graded kinds: in each term, a course's percentage is its
 * exams in that term weighted (or averaged, with no weights), graded on the scale with its
 * points; the term's SGPA weighs points by the course's credits; the CGPA weighs every
 * term so far by its credits. Only the asked-for year's terms are listed.
 */
async function creditCard(
  ctx: OrgContext,
  years: { yearId: string; card: ReportCardData }[],
  showYear: string
) {
  const scale = settingsOf(ctx).scale
  const subjectIds = [
    ...new Set(years.flatMap((y) => y.card.subjects.map((s) => s.subjectId))),
  ]
  const yearIds = years.map((y) => y.yearId)
  const [info, terms] = await Promise.all([
    subjectIds.length
      ? getDb()
          .select({
            id: subjects.id,
            code: subjects.code,
            credits: subjects.credits,
          })
          .from(subjects)
          .where(inArray(subjects.id, subjectIds))
      : [],
    getDb()
      .select()
      .from(academicTerms)
      .where(inArray(academicTerms.yearId, yearIds))
      .orderBy(asc(academicTerms.position), asc(academicTerms.createdAt)),
  ])
  const all: {
    id: string
    name: string
    yearId: string
    courses: {
      subjectId: string
      code: string
      name: string
      credits: number | null
      percent: number | null
      grade: string | null
      points: number | null
    }[]
    sgpa: number | null
    credits: number
    earned: number
    backlogs: number
  }[] = []
  for (const y of years) {
    const yearTerms = terms.filter((t) => t.yearId === y.yearId)
    for (const t of yearTerms) {
      const exams = y.card.exams.filter((e) => e.termId === t.id)
      if (exams.length === 0) continue
      const courses = y.card.subjects
        .map((s) => {
          const parts = exams.flatMap((e) => {
            const p = e.papers.find((x) => x.subjectId === s.subjectId)
            if (!p || (p.marks == null && !p.absent)) return []
            return [
              {
                weight: e.weight,
                percent: (100 * (p.absent ? 0 : p.marks!)) / p.maxMarks,
              },
            ]
          })
          if (
            parts.length === 0 &&
            !exams.some((e) =>
              e.papers.some((p) => p.subjectId === s.subjectId)
            )
          )
            return null
          const weightedPct = weighted(parts)
          const percent =
            weightedPct ??
            (parts.length
              ? Math.round(
                  (10 * parts.reduce((a, b) => a + b.percent, 0)) / parts.length
                ) / 10
              : null)
          const band = percent == null ? null : bandFor(scale, percent)
          const c = info.find((i) => i.id === s.subjectId)
          return {
            subjectId: s.subjectId,
            code: c?.code ?? "",
            name: s.name,
            credits: c?.credits ?? null,
            percent,
            grade: band?.grade ?? null,
            points: band ? (band.points ?? null) : null,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
      const s = sgpa(
        courses.map((c) => ({ credits: c.credits ?? 0, points: c.points }))
      )
      all.push({
        id: t.id,
        name: t.name,
        yearId: y.yearId,
        courses,
        sgpa: s?.sgpa ?? null,
        credits: s?.credits ?? 0,
        earned: s?.earned ?? 0,
        backlogs: s?.backlogs ?? 0,
      })
    }
  }
  const done = all.filter((t) => t.sgpa != null) as {
    sgpa: number
    credits: number
  }[]
  return {
    terms: all.filter((t) => t.yearId === showYear),
    cgpa: cgpa(done),
    earned: all.reduce((a, t) => a + t.earned, 0),
  }
}

type CardStudent = {
  id: string
  name: string
  admissionNo: string | null
  rollNo: number | null
  status: string
}

/**
 * Report cards for some students of one class in a year, from one pass over the class's
 * results (each exam's sheet, remarks, the class teacher), so a whole class costs about
 * what one student does.
 */
async function composeCards(
  ctx: OrgContext,
  year: { id: string; name: string; groupId: string | null },
  exams: ExamRow[],
  students: CardStudent[]
) {
  const db = getDb()
  const scale = settingsOf(ctx).scale
  const ids = students.map((s) => s.id)
  const [notes, lead] = await Promise.all([
    exams.length && ids.length
      ? db
          .select()
          .from(reportRemarks)
          .where(
            and(
              inArray(reportRemarks.userId, ids),
              inArray(
                reportRemarks.examId,
                exams.map((e) => e.id)
              )
            )
          )
      : [],
    year.groupId
      ? db
          .select({ name: users.name, email: users.email })
          .from(classTeachers)
          .innerJoin(users, eq(classTeachers.teacherId, users.id))
          .where(
            and(
              eq(classTeachers.yearId, year.id),
              eq(classTeachers.groupId, year.groupId)
            )
          )
      : [],
  ])
  const sheets = year.groupId
    ? await Promise.all(exams.map((e) => classSheet(ctx, e, year.groupId!)))
    : []
  // Subjects across the year's exams, in name order.
  const subjectList = [
    ...new Map(
      sheets.flatMap((s) =>
        s.papers.map((p) => [p.subjectId, p.subject] as const)
      )
    ),
  ]
    .map(([subjectId, name]) => ({ subjectId, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return students.map((student) => {
    const id = student.id
    const mine = notes.filter((n) => n.userId === id)
    const perExam = exams.map((e, i) => {
      const sheet = sheets[i]!
      const row = sheet.rows.find((r) => r.id === id)
      return {
        id: e.id,
        name: e.name,
        weight: e.weight,
        termId: e.termId,
        published: e.publishedAt != null,
        papers: sheet.papers.map((p, j) => ({
          subjectId: p.subjectId,
          maxMarks: p.maxMarks,
          passMarks: p.passMarks,
          marks: row?.cells[j]?.marks ?? null,
          absent: row?.cells[j]?.absent ?? false,
          outcome: row?.cells[j]?.outcome ?? "pending",
          grade: row?.cells[j]?.grade ?? null,
        })),
        obtained: row?.obtained ?? 0,
        maxMarks: row?.maxMarks ?? 0,
        percent: row?.percent ?? null,
        grade: row?.grade ?? null,
        result: row?.result ?? "none",
        rank: row?.rank ?? null,
        of: sheet.rows.length,
        remark:
          mine.find((n) => n.examId === e.id && n.paperId == null)?.text ??
          null,
        subjectRemarks: sheet.papers.flatMap((p) => {
          const n = mine.find((x) => x.paperId === p.id)
          return n ? [{ subject: p.subject, text: n.text }] : []
        }),
      }
    })
    const subjectsOut = subjectList.map((s) => {
      const parts = perExam.map((e) => {
        const p = e.papers.find((x) => x.subjectId === s.subjectId)
        return {
          weight: e.weight,
          percent:
            p && (p.marks != null || p.absent)
              ? (100 * (p.absent ? 0 : p.marks!)) / p.maxMarks
              : null,
        }
      })
      const final = weighted(parts)
      return {
        ...s,
        final,
        grade: final == null ? null : bandFor(scale, final).grade,
      }
    })
    const final = weighted(
      perExam.map((e) => ({ weight: e.weight, percent: e.percent }))
    )
    return {
      org: { name: ctx.org.name, slug: ctx.org.slug },
      student: { id, name: student.name, admissionNo: student.admissionNo },
      year: {
        id: year.id,
        name: year.name,
        class: year.groupId ? pathName(ctx, year.groupId) : null,
        rollNo: student.rollNo,
        status: student.status,
        classTeacher: lead[0] ? (lead[0].name ?? lead[0].email) : null,
      },
      scale,
      subjects: subjectsOut,
      exams: perExam,
      final:
        final == null
          ? null
          : { percent: final, grade: bandFor(scale, final).grade },
    }
  })
}

export type ReportCardData = Awaited<ReturnType<typeof composeCards>>[number]
export type CreditCardData = Awaited<ReturnType<typeof creditCard>>

/**
 * Report cards for every student of a class in a year (for printing them all). Staff who
 * may see the class only; drafts included and marked, unless `published` is asked for.
 */
export async function classReportCards(
  slug: string,
  user: User,
  groupId: string,
  opts: { yearId?: string; publishedOnly?: boolean } = {}
) {
  const ctx = await context(slug, user)
  if (!isLeaf(ctx, groupId)) throw notFound("Class not found")
  if (!canSee(ctx, groupId))
    throw forbidden("You can't see the results of that class.")
  const db = getDb()
  const [year] = opts.yearId
    ? await db
        .select()
        .from(academicYears)
        .where(
          and(
            eq(academicYears.id, opts.yearId),
            eq(academicYears.orgId, ctx.org.id)
          )
        )
    : await db
        .select()
        .from(academicYears)
        .where(
          and(
            eq(academicYears.orgId, ctx.org.id),
            eq(academicYears.isCurrent, true)
          )
        )
  if (!year) throw notFound("Year not found")
  const exams = await db
    .select()
    .from(termExams)
    .where(
      and(
        eq(termExams.yearId, year.id),
        opts.publishedOnly ? isNotNull(termExams.publishedAt) : undefined
      )
    )
    .orderBy(asc(termExams.startsOn), asc(termExams.createdAt))
  const students = await sitting(year.id, groupId, [])
  const cards = await composeCards(
    ctx,
    { id: year.id, name: year.name, groupId },
    exams,
    students.map((s) => ({
      id: s.id,
      name: s.name,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      status: s.status,
    }))
  )
  await writeAudit(
    ctx,
    "exam.print",
    `Printed the report cards of ${pathName(ctx, groupId)} for ${year.name}`,
    { groupId, yearId: year.id }
  )
  return { class: pathName(ctx, groupId), year: year.name, cards }
}

/** Published exams a student can open from their home (and their parents from theirs). */
export async function publishedFor(orgId: string, userId: string) {
  return getDb()
    .select({
      id: termExams.id,
      name: termExams.name,
      publishedAt: termExams.publishedAt,
    })
    .from(termExams)
    .innerJoin(
      enrolments,
      and(
        eq(enrolments.yearId, termExams.yearId),
        eq(enrolments.userId, userId)
      )
    )
    .where(and(eq(termExams.orgId, orgId), isNotNull(termExams.publishedAt)))
    .orderBy(desc(termExams.publishedAt))
    .limit(5)
}

/**
 * Papers this teacher still has marks to enter in, for the teacher's home: their own
 * subjects, in the current year's exams that aren't published. Never throws.
 */
export async function papersToMark(ctx: OrgContext) {
  try {
    const modules = ctx.modules
    if (
      !modules.has("exams") ||
      !modules.has("records") ||
      !modules.has("subjects")
    )
      return []
    const db = getDb()
    const [year] = await db
      .select()
      .from(academicYears)
      .where(
        and(
          eq(academicYears.orgId, ctx.org.id),
          eq(academicYears.isCurrent, true)
        )
      )
    if (!year) return []
    const papers = await db
      .select({
        id: examPapers.id,
        examId: termExams.id,
        exam: termExams.name,
        groupId: examPapers.groupId,
        subjectId: examPapers.subjectId,
        subject: subjects.name,
      })
      .from(examPapers)
      .innerJoin(termExams, eq(examPapers.examId, termExams.id))
      .innerJoin(subjects, eq(examPapers.subjectId, subjects.id))
      .where(
        and(eq(termExams.yearId, year.id), sql.isNull(termExams.publishedAt))
      )
    if (papers.length === 0) return []
    const teacherOf = await subjectTeachers(ctx, [
      ...new Set(papers.map((p) => p.groupId)),
    ])
    const mine = papers.filter(
      (p) => teacherOf(p.groupId, p.subjectId) === ctx.user.id
    )
    if (mine.length === 0) return []
    const groupIds = [...new Set(mine.map((p) => p.groupId))]
    const [entered, seats] = await Promise.all([
      db
        .select({ paperId: examMarks.paperId, n: count() })
        .from(examMarks)
        .where(
          inArray(
            examMarks.paperId,
            mine.map((p) => p.id)
          )
        )
        .groupBy(examMarks.paperId),
      db
        .select({ groupId: enrolments.groupId, n: count() })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.yearId, year.id),
            eq(enrolments.status, "active"),
            inArray(enrolments.groupId, groupIds)
          )
        )
        .groupBy(enrolments.groupId),
    ])
    return mine
      .map((p) => ({
        ...p,
        class: pathName(ctx, p.groupId),
        entered: Number(entered.find((e) => e.paperId === p.id)?.n ?? 0),
        students: Number(seats.find((s) => s.groupId === p.groupId)?.n ?? 0),
      }))
      .filter((p) => p.students > 0 && p.entered < p.students)
      .slice(0, 8)
  } catch {
    return []
  }
}
