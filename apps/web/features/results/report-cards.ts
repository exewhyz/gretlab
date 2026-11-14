import {
  academicTerms,
  academicYears,
  classTeachers,
  enrolments,
  examMarks,
  examPapers,
  getDb,
  guardians,
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
  KINDS,
  paperOutcome,
  ranks,
  sgpa,
  summarize,
  weighted,
} from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import { pathName } from "@/features/campus/people"
import { notify } from "@/features/notifications/server"
import { writeAudit, type OrgContext } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { orgPages } from "@/lib/paths"
import {
  canSee,
  canSetup,
  conflict,
  context,
  ExamRow,
  forbidden,
  isLeaf,
  ownExam,
  publishSchema,
  settingsOf,
  sitting,
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

const { and, asc, count, desc, eq, inArray, isNotNull } = sql

/** Every student's result in one exam in one class, ranked. */
export async function classSheet(
  ctx: OrgContext,
  exam: ExamRow,
  groupId: string
) {
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
    href: orgPages(ctx.org.slug).results("me"),
    orgId: ctx.org.id,
  })
  return { published: true, told: told.inApp }
}

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
export async function creditCard(
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

export type CardStudent = {
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
export async function composeCards(
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
    .sort((a, b) => byName(a.name, b.name))
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
