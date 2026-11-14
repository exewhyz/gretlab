import {
  academicTerms,
  academicYears,
  classSubjects,
  enrolments,
  examMarks,
  examPapers,
  getDb,
  organizations,
  reportRemarks,
  sql,
  subjects,
  termExams,
  users,
  type User,
} from "@workspace/db"
import {
  cleanRemarkBank,
  examProblem,
  KINDS,
  paperProblem,
  readExamSettings,
  scaleProblem,
  sortScale,
  type GradeBand,
} from "@workspace/judge"
import { z } from "zod"

import { pathName } from "@/features/campus/people"
import { groupChain, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import {
  canSee,
  canSetup,
  classTeachersIn,
  conflict,
  context,
  duplicate,
  examPatchSchema,
  examSchema,
  forbidden,
  isLeaf,
  leavesOf,
  locked,
  mayMark,
  mayRemark,
  needSomeAccess,
  ownExam,
  ownPaper,
  ownTerm,
  paperPatchSchema,
  papersSchema,
  scaleSchema,
  settingsOf,
  subjectTeachers,
  termPatchSchema,
  termSchema,
  termsOf,
  yearsOf,
} from "./results-core"

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

const { and, asc, count, eq, inArray } = sql

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
