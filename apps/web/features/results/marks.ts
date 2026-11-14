import {
  academicYears,
  enrolments,
  examMarks,
  examPapers,
  getDb,
  reportRemarks,
  sql,
  subjects,
  termExams,
  users,
  type User,
} from "@workspace/db"
import { markProblem } from "@workspace/judge"
import { z } from "zod"

import { pathName } from "@/features/campus/people"
import { writeAudit, type OrgContext } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { classSheet } from "./report-cards"
import {
  canSee,
  classTeachersIn,
  context,
  forbidden,
  isLeaf,
  locked,
  marksSchema,
  mayMark,
  mayRemark,
  ownExam,
  ownPaper,
  remarksSchema,
  settingsOf,
  sitting,
  subjectTeachers,
  Tx,
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

const { and, count, eq, inArray } = sql

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

/** Writes remarks (an empty one removes it): overall when paperId is null. */
export async function writeRemarks(
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
