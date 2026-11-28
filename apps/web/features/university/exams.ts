import {
  getDb,
  orgAffiliations,
  organizations,
  sql,
  subjects,
  syllabusCourses,
  universityExams,
  universityMarks,
  type User,
} from "@workspace/db"
import {
  cgpa,
  courseResult,
  markProblem,
  parseExternalMarks,
  readExamSettings,
  semesterProblem,
  semesterResult,
  type GradeBand,
} from "@workspace/judge"
import { z } from "zod"

import { notify } from "@/features/notifications/server"
import {
  canAnywhere,
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { likeTerm, pageOf, readPage } from "@/lib/api/paging"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"

import { activeUniversityOf, needUniversity } from "./affiliation"
import { universityPrograms } from "./syllabus"

/*
 * University exams and results. A university holds an end-semester exam for one program and
 * semester. Who sits it: students with an approved registration for the program who sit in a
 * class (or a group inside it) their college has put on that semester, while the college is
 * affiliated; anyone with marks stays. Colleges enter internal marks (exams.marks for the
 * class) until the university closes them; the university enters external marks or imports
 * them as CSV; results (courseResult, semesterResult in packages/judge/src/university.ts) show
 * to students, parents and the college once published. The college's own exams are separate.
 */

const { and, asc, desc, eq, inArray, sql: raw } = { ...sql, sql: sql.sql }

export const examSchema = z.object({
  programId: z.uuid(),
  semester: z.number().int(),
  name: z.string().trim().min(1, "Name the exam").max(80),
  startsOn: z.iso.date().nullable().default(null),
  endsOn: z.iso.date().nullable().default(null),
})

export const externalSchema = z.object({
  subjectId: z.uuid(),
  marks: z
    .array(
      z.object({
        studentId: z.uuid(),
        external: z.number().nullable(),
        absent: z.boolean().default(false),
      })
    )
    .max(2000),
})

export const internalSchema = z.object({
  subjectId: z.uuid(),
  marks: z
    .array(z.object({ studentId: z.uuid(), internal: z.number().nullable() }))
    .max(2000),
})

export const importSchema = z.object({ csv: z.string().max(2_000_000) })

export const publishSchema = z.object({
  publish: z.boolean(),
  force: z.boolean().default(false),
})

type Exam = typeof universityExams.$inferSelect

/** The university's scale: its own (Exams settings), else the UGC ten-point one. */
async function scaleOf(universityId: string): Promise<GradeBand[]> {
  const [org] = await getDb()
    .select({ settings: organizations.moduleSettings })
    .from(organizations)
    .where(eq(organizations.id, universityId))
  return readExamSettings(org?.settings, "credits").scale
}

/** The exam's courses: its program's semester in the syllabus, in order. */
async function coursesOf(exam: Exam) {
  return getDb()
    .select({
      subjectId: subjects.id,
      code: subjects.code,
      name: subjects.name,
      credits: subjects.credits,
      internalMax: syllabusCourses.internalMax,
      externalMax: syllabusCourses.externalMax,
      passExternal: syllabusCourses.passExternal,
      passTotal: syllabusCourses.passTotal,
    })
    .from(syllabusCourses)
    .innerJoin(subjects, eq(subjects.id, syllabusCourses.subjectId))
    .where(
      and(
        eq(syllabusCourses.programId, exam.programId),
        eq(syllabusCourses.semester, exam.semester)
      )
    )
    .orderBy(asc(syllabusCourses.position))
}

type Sitter = {
  student_id: string
  name: string | null
  reg_no: string | null
  college_id: string
  college: string
  class_id: string | null
}

/**
 * Who sits the exam, optionally for one college or matching a search, a page at a time
 * (limit/offset in SQL), with the total.
 */
async function sitters(
  exam: Exam,
  opts: { collegeId?: string; q?: string; limit?: number; offset?: number } = {}
) {
  const db = getDb()
  const filters = raw.join(
    [
      opts.collegeId ? raw`and s.college_id = ${opts.collegeId}` : raw``,
      opts.q
        ? raw`and (s.name ilike ${likeTerm(opts.q)} or s.reg_no ilike ${likeTerm(opts.q)})`
        : raw``,
    ],
    raw` `
  )
  const base = raw`
    with recursive classes as (
      select cp.org_id, cp.group_id as class_id, cp.group_id as id
      from class_programs cp
      where cp.university_id = ${exam.universityId} and cp.program_id = ${exam.programId}
        and cp.semester = ${exam.semester}
      union all
      select c.org_id, c.class_id, g.id from org_groups g join classes c on g.parent_id = c.id
    ),
    seated as (
      select distinct on (r.student_id) r.student_id, u.name, r.reg_no, r.college_id,
        o.name as college, c.class_id
      from university_registrations r
      join org_affiliations a on a.college_id = r.college_id
        and a.university_id = ${exam.universityId} and a.status = 'active'
      join classes c on c.org_id = r.college_id
      join group_members gm on gm.group_id = c.id and gm.user_id = r.student_id
      join users u on u.id = r.student_id
      join organizations o on o.id = r.college_id
      where r.university_id = ${exam.universityId} and r.program_id = ${exam.programId}
        and r.status = 'approved'
      order by r.student_id
    ),
    marked as (
      select distinct on (m.student_id) m.student_id, u.name, r.reg_no, m.college_id,
        o.name as college, null::uuid as class_id
      from university_marks m
      join users u on u.id = m.student_id
      join organizations o on o.id = m.college_id
      left join university_registrations r on r.student_id = m.student_id
        and r.university_id = ${exam.universityId} and r.status = 'approved'
      where m.exam_id = ${exam.id}
        and m.student_id not in (select student_id from seated)
      order by m.student_id
    ),
    s as (select * from seated union all select * from marked)`
  const [count] = await db.execute<{ n: number }>(
    raw`${base} select count(*)::int as n from s where true ${filters}`
  )
  const rows = await db.execute<Sitter>(
    raw`${base} select * from s where true ${filters}
      order by s.college, s.reg_no nulls last, s.name
      limit ${opts.limit ?? 100000} offset ${opts.offset ?? 0}`
  )
  return { total: count?.n ?? 0, rows: [...rows] }
}

async function marksFor(examId: string, studentIds: string[]) {
  if (studentIds.length === 0) return []
  return getDb()
    .select()
    .from(universityMarks)
    .where(
      and(
        eq(universityMarks.examId, examId),
        inArray(universityMarks.studentId, studentIds)
      )
    )
}

async function examIn(universityId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Exam not found")
  const [exam] = await getDb()
    .select()
    .from(universityExams)
    .where(
      and(
        eq(universityExams.id, id),
        eq(universityExams.universityId, universityId)
      )
    )
  if (!exam) throw notFound("Exam not found")
  return exam
}

/* ---------- the university's side ---------- */

async function universitySide(slug: string, user: User, write: boolean) {
  const ctx = await orgContext(slug, user)
  const edit =
    ctx.org.type === "university" && canFor(ctx, "university.exams", [])
  needUniversity(ctx, write || edit ? "university.exams" : "university.view")
  return { ctx, edit }
}

/** Manage › University exams: the exams, newest first. */
export async function listUniversityExams(slug: string, user: User) {
  const { ctx, edit } = await universitySide(slug, user, false)
  const db = getDb()
  const [exams, programs, entered] = await Promise.all([
    db
      .select()
      .from(universityExams)
      .where(eq(universityExams.universityId, ctx.org.id))
      .orderBy(desc(universityExams.createdAt)),
    universityPrograms(ctx.org.id),
    db
      .select({
        examId: universityMarks.examId,
        students:
          raw<number>`count(distinct ${universityMarks.studentId})`.mapWith(
            Number
          ),
      })
      .from(universityMarks)
      .innerJoin(
        universityExams,
        eq(universityExams.id, universityMarks.examId)
      )
      .where(eq(universityExams.universityId, ctx.org.id))
      .groupBy(universityMarks.examId),
  ])
  const path = new Map(programs.map((p) => [p.id, p.path]))
  return {
    can: { edit },
    programs,
    exams: exams.map((e) => ({
      id: e.id,
      name: e.name,
      program: path.get(e.programId) ?? "A program no longer offered",
      programId: e.programId,
      semester: e.semester,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      internalClosed: e.internalClosedAt !== null,
      published: e.publishedAt !== null,
      withMarks: entered.find((x) => x.examId === e.id)?.students ?? 0,
    })),
  }
}

/** The university sets an exam for a program's semester that has courses. */
export async function createUniversityExam(
  slug: string,
  user: User,
  input: z.infer<typeof examSchema>
) {
  const { ctx } = await universitySide(slug, user, true)
  const bad = semesterProblem(input.semester)
  if (bad) throw new ApiError(400, "bad_semester", bad)
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
    throw new ApiError(400, "bad_dates", "It can't end before it starts.")
  const program = (await universityPrograms(ctx.org.id)).find(
    (p) => p.id === input.programId
  )
  if (!program) throw notFound("No such program.")
  const db = getDb()
  const [has] = await db
    .select({ id: syllabusCourses.id })
    .from(syllabusCourses)
    .where(
      and(
        eq(syllabusCourses.programId, input.programId),
        eq(syllabusCourses.semester, input.semester)
      )
    )
    .limit(1)
  if (!has)
    throw new ApiError(
      400,
      "no_courses",
      `Semester ${input.semester} of ${program.name} has no courses in the syllabus yet.`
    )
  try {
    const [row] = await db
      .insert(universityExams)
      .values({ ...input, universityId: ctx.org.id })
      .returning()
    await writeAudit(
      ctx,
      "university.exam",
      `Set the exam ${input.name} for ${program.path}, semester ${input.semester}`
    )
    return row!
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } }
    if ((e.cause?.code ?? e.code) === "23505")
      throw new ApiError(
        409,
        "duplicate",
        "That semester already has an exam by that name."
      )
    throw error
  }
}

/** One exam's marks sheet for the university: a course, a page of who sits it. */
export async function universityExamSheet(
  slug: string,
  user: User,
  id: string,
  query: URLSearchParams
) {
  const { ctx, edit } = await universitySide(slug, user, false)
  const exam = await examIn(ctx.org.id, id)
  const asked = readPage(query)
  const perPage = asked.perPage ?? 100
  const collegeId = z
    .uuid()
    .optional()
    .parse(query.get("college") || undefined)
  const db = getDb()
  const [courses, programs, colleges] = await Promise.all([
    coursesOf(exam),
    universityPrograms(ctx.org.id),
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        code: orgAffiliations.collegeCode,
      })
      .from(orgAffiliations)
      .innerJoin(organizations, eq(organizations.id, orgAffiliations.collegeId))
      .where(
        and(
          eq(orgAffiliations.universityId, ctx.org.id),
          eq(orgAffiliations.status, "active")
        )
      )
      .orderBy(asc(organizations.name)),
  ])
  const first = await sitters(exam, { collegeId, q: asked.q, limit: 0 })
  const at = pageOf(first.total, asked.page ?? 1, perPage)
  const page = await sitters(exam, {
    collegeId,
    q: asked.q,
    limit: perPage,
    offset: at.offset,
  })
  const marks = await marksFor(
    exam.id,
    page.rows.map((r) => r.student_id)
  )
  const scale = await scaleOf(ctx.org.id)
  return {
    can: { edit },
    exam: {
      id: exam.id,
      name: exam.name,
      semester: exam.semester,
      program: programs.find((p) => p.id === exam.programId)?.path ?? "—",
      startsOn: exam.startsOn,
      endsOn: exam.endsOn,
      internalClosed: exam.internalClosedAt !== null,
      published: exam.publishedAt !== null,
    },
    courses,
    colleges,
    total: first.total,
    page: at.page,
    pages: at.pages,
    perPage,
    students: page.rows.map((s) => {
      const mine = marks.filter((m) => m.studentId === s.student_id)
      const results = courses.map((c) => {
        const m = mine.find((x) => x.subjectId === c.subjectId)
        const marksNow = {
          internal: m?.internal ?? null,
          external: m?.external ?? null,
          absent: m?.absent ?? false,
        }
        return {
          subjectId: c.subjectId,
          ...marksNow,
          ...courseResult(c, marksNow, scale),
        }
      })
      return {
        studentId: s.student_id,
        name: s.name ?? "",
        regNo: s.reg_no,
        college: s.college,
        courses: results,
        result: semesterResult(
          results.map((r, i) => ({
            credits: courses[i]!.credits ?? 0,
            points: r.points,
            outcome: r.outcome,
          }))
        ),
      }
    }),
  }
}

/** Sitters by id, for a save: refuses anyone who doesn't sit the exam. */
async function sittersByIds(exam: Exam, ids: string[], collegeId?: string) {
  const all = await sitters(exam, { collegeId })
  const found = new Map(all.rows.map((r) => [r.student_id, r]))
  if (ids.some((id) => !found.has(id)))
    throw new ApiError(
      400,
      "not_sitting",
      "Someone here doesn't sit this exam."
    )
  return found
}

function courseIn(
  courses: Awaited<ReturnType<typeof coursesOf>>,
  subjectId: string
) {
  const course = courses.find((c) => c.subjectId === subjectId)
  if (!course)
    throw new ApiError(400, "unknown_course", "That course isn't in this exam.")
  return course
}

/** The university's external marks for one course. Changes after publishing are logged apart. */
export async function saveExternalMarks(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof externalSchema>
) {
  const { ctx } = await universitySide(slug, user, true)
  const exam = await examIn(ctx.org.id, id)
  const course = courseIn(await coursesOf(exam), input.subjectId)
  for (const m of input.marks) {
    if (m.absent || m.external == null) continue
    const problem = markProblem(m.external, course.externalMax)
    if (problem)
      throw new ApiError(400, "bad_mark", `${course.name}: ${problem}`)
  }
  const found = await sittersByIds(
    exam,
    input.marks.map((m) => m.studentId)
  )
  const changed = await writeExternal(
    exam,
    input.subjectId,
    input.marks.map((m) => ({
      ...m,
      collegeId: found.get(m.studentId)!.college_id,
    })),
    user
  )
  await writeAudit(
    ctx,
    exam.publishedAt ? "university.marks_correct" : "university.marks",
    `${exam.publishedAt ? "Corrected" : "Entered"} external marks of ${course.name} for ${changed} ${changed === 1 ? "student" : "students"} (${exam.name})`
  )
  return { saved: changed }
}

async function writeExternal(
  exam: Exam,
  subjectId: string,
  marks: {
    studentId: string
    external: number | null
    absent: boolean
    collegeId: string
  }[],
  user: User
) {
  if (marks.length === 0) return 0
  await getDb()
    .insert(universityMarks)
    .values(
      marks.map((m) => ({
        examId: exam.id,
        subjectId,
        studentId: m.studentId,
        collegeId: m.collegeId,
        external: m.absent ? null : m.external,
        absent: m.absent,
        externalBy: user.id,
      }))
    )
    .onConflictDoUpdate({
      target: [
        universityMarks.examId,
        universityMarks.subjectId,
        universityMarks.studentId,
      ],
      set: {
        external: raw`excluded.external`,
        absent: raw`excluded.absent`,
        externalBy: user.id,
        updatedAt: new Date(),
      },
    })
  return marks.length
}

/** External marks from a CSV (registration number, course code, marks or AB): all or nothing. */
export async function importExternalMarks(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof importSchema>
) {
  const { ctx } = await universitySide(slug, user, true)
  const exam = await examIn(ctx.org.id, id)
  const courses = await coursesOf(exam)
  const parsed = parseExternalMarks(input.csv)
  const all = await sitters(exam)
  const byReg = new Map(
    all.rows.filter((r) => r.reg_no).map((r) => [r.reg_no!, r])
  )
  const byCode = new Map(
    courses.filter((c) => c.code).map((c) => [c.code.toUpperCase(), c])
  )
  const problems = [...parsed.problems]
  const seen = new Set<string>()
  for (const row of parsed.rows) {
    const course = byCode.get(row.code)
    const sitter = byReg.get(row.regNo)
    if (!sitter)
      problems.push({
        line: row.line,
        problem: `${row.regNo} doesn't sit this exam.`,
      })
    else if (!course)
      problems.push({
        line: row.line,
        problem: `${row.code} isn't a course of this exam.`,
      })
    else if (seen.has(`${row.regNo}|${row.code}`))
      problems.push({
        line: row.line,
        problem: "This student's course is in the file twice.",
      })
    else if (row.marks != null && markProblem(row.marks, course.externalMax))
      problems.push({
        line: row.line,
        problem: markProblem(row.marks, course.externalMax)!,
      })
    seen.add(`${row.regNo}|${row.code}`)
  }
  if (problems.length)
    return { saved: 0, problems: problems.sort((a, b) => a.line - b.line) }
  if (parsed.rows.length === 0)
    throw new ApiError(400, "empty", "The file has no marks.")
  for (const c of courses) {
    const rows = parsed.rows.filter((r) => r.code === c.code.toUpperCase())
    await writeExternal(
      exam,
      c.subjectId,
      rows.map((r) => ({
        studentId: byReg.get(r.regNo)!.student_id,
        external: r.marks,
        absent: r.absent,
        collegeId: byReg.get(r.regNo)!.college_id,
      })),
      user
    )
  }
  await writeAudit(
    ctx,
    exam.publishedAt ? "university.marks_correct" : "university.marks",
    `Imported ${parsed.rows.length} external marks (${exam.name})`
  )
  return { saved: parsed.rows.length, problems: [] }
}

/** Closes (or reopens) internal marks: colleges can't change them while closed. */
export async function setInternalClosed(
  slug: string,
  user: User,
  id: string,
  closed: boolean
) {
  const { ctx } = await universitySide(slug, user, true)
  const exam = await examIn(ctx.org.id, id)
  if (exam.publishedAt)
    throw new ApiError(409, "published", "Unpublish the results first.")
  await getDb()
    .update(universityExams)
    .set({ internalClosedAt: closed ? new Date() : null })
    .where(eq(universityExams.id, exam.id))
  await writeAudit(
    ctx,
    "university.exam",
    `${closed ? "Closed" : "Reopened"} internal marks of ${exam.name}`
  )
}

/**
 * Publishes the results (a protected action): refused while marks are missing unless forced.
 * Each student is told at their college, and their parents get a copy. Unpublishing hides them.
 */
export async function publishUniversityExam(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof publishSchema>
) {
  const { ctx } = await universitySide(slug, user, true)
  const exam = await examIn(ctx.org.id, id)
  const db = getDb()
  if (!input.publish) {
    await db
      .update(universityExams)
      .set({ publishedAt: null })
      .where(eq(universityExams.id, exam.id))
    await writeAudit(
      ctx,
      "university.exam",
      `Took back the results of ${exam.name}`
    )
    return { published: false, missing: 0, told: 0 }
  }
  const [courses, all] = await Promise.all([coursesOf(exam), sitters(exam)])
  const marks = await marksFor(
    exam.id,
    all.rows.map((r) => r.student_id)
  )
  let missing = 0
  for (const s of all.rows)
    for (const c of courses) {
      const m = marks.find(
        (x) => x.studentId === s.student_id && x.subjectId === c.subjectId
      )
      if (
        !m ||
        (!m.absent && m.external == null) ||
        (c.internalMax > 0 && m.internal == null)
      )
        missing++
    }
  if (missing > 0 && !input.force)
    throw new ApiError(
      409,
      "incomplete",
      `${missing} marks aren't in yet. Publish anyway, or wait for them.`
    )
  await db
    .update(universityExams)
    .set({
      publishedAt: new Date(),
      internalClosedAt: exam.internalClosedAt ?? new Date(),
    })
    .where(eq(universityExams.id, exam.id))
  await writeAudit(
    ctx,
    "university.exam",
    `Published the results of ${exam.name}${missing ? ` with ${missing} marks missing` : ""}`
  )
  // Students hear at their own college (their report card is there); parents get a copy.
  let told = 0
  const byCollege = new Map<string, string[]>()
  for (const s of all.rows)
    byCollege.set(s.college_id, [
      ...(byCollege.get(s.college_id) ?? []),
      s.student_id,
    ])
  for (const [collegeId, students] of byCollege) {
    const [college] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, collegeId))
    const r = await notify(students, {
      kind: "results",
      title: `${ctx.org.name}: ${exam.name} results are out`,
      body: `Your university results for semester ${exam.semester} are on your report card.`,
      href: orgPages(college!.slug).results("me"),
      orgId: collegeId,
    })
    told += r.inApp
  }
  return { published: true, missing, told }
}

/* ---------- the college's side ---------- */

/** The college's side: affiliated, and allowed to enter marks somewhere in it. */
async function collegeSide(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (ctx.org.type !== "college")
    throw notFound("Only a college enters internal marks for a university.")
  if (!canAnywhere(ctx, "exams.marks"))
    throw new ApiError(
      403,
      "forbidden",
      "Entering marks isn't part of your role."
    )
  const uni = await activeUniversityOf(ctx.org.id)
  if (!uni)
    throw new ApiError(
      409,
      "not_affiliated",
      "Affiliate to a university first."
    )
  return { ctx, universityId: uni.universityId }
}

/** The classes of this college a person may enter marks for. */
const markable = (ctx: OrgContext, classId: string | null) =>
  classId !== null && canFor(ctx, "exams.marks", [[classId]])

/** Manage › University › Exams: the university exams the college's classes sit. */
export async function collegeUniversityExams(slug: string, user: User) {
  const { ctx, universityId } = await collegeSide(slug, user)
  const db = getDb()
  const exams = await db.execute<{
    id: string
    name: string
    semester: number
    program_id: string
    internal_closed_at: string | null
    published_at: string | null
  }>(raw`
    select distinct e.id, e.name, e.semester, e.program_id, e.internal_closed_at, e.published_at, e.created_at
    from university_exams e
    join class_programs cp on cp.program_id = e.program_id and cp.semester = e.semester
      and cp.org_id = ${ctx.org.id} and cp.university_id = ${universityId}
    where e.university_id = ${universityId}
    order by e.created_at desc`)
  const programs = await universityPrograms(universityId)
  return {
    exams: [...exams].map((e) => ({
      id: e.id,
      name: e.name,
      semester: e.semester,
      program: programs.find((p) => p.id === e.program_id)?.path ?? "—",
      internalClosed: e.internal_closed_at !== null,
      published: e.published_at !== null,
    })),
  }
}

async function collegeExam(ctx: OrgContext, universityId: string, id: string) {
  const exam = await examIn(universityId, id)
  return exam
}

/** The college's internal marks sheet: its own sitters in classes the person may mark. */
export async function internalSheet(slug: string, user: User, id: string) {
  const { ctx, universityId } = await collegeSide(slug, user)
  const exam = await collegeExam(ctx, universityId, id)
  const [courses, all] = await Promise.all([
    coursesOf(exam),
    sitters(exam, { collegeId: ctx.org.id }),
  ])
  const mine = all.rows.filter((s) => markable(ctx, s.class_id))
  if (
    all.rows.length > 0 &&
    mine.length === 0 &&
    !canFor(ctx, "exams.marks", [])
  )
    throw new ApiError(
      403,
      "forbidden",
      "None of this exam's students are in your classes."
    )
  const marks = await marksFor(
    exam.id,
    mine.map((s) => s.student_id)
  )
  const groupName = new Map(ctx.groups.map((g) => [g.id, g.name]))
  return {
    exam: {
      id: exam.id,
      name: exam.name,
      semester: exam.semester,
      internalClosed: exam.internalClosedAt !== null,
      published: exam.publishedAt !== null,
    },
    courses: courses
      .filter((c) => c.internalMax > 0)
      .map(({ subjectId, code, name, internalMax }) => ({
        subjectId,
        code,
        name,
        internalMax,
      })),
    students: mine.map((s) => ({
      studentId: s.student_id,
      name: s.name ?? "",
      regNo: s.reg_no,
      className: s.class_id ? (groupName.get(s.class_id) ?? "") : "",
      internal: Object.fromEntries(
        marks
          .filter((m) => m.studentId === s.student_id)
          .map((m) => [m.subjectId, m.internal])
      ) as Record<string, number | null>,
    })),
  }
}

/** The college saves internal marks for one course, until the university closes them. */
export async function saveInternalMarks(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof internalSchema>
) {
  const { ctx, universityId } = await collegeSide(slug, user)
  const exam = await collegeExam(ctx, universityId, id)
  if (exam.internalClosedAt || exam.publishedAt)
    throw new ApiError(
      409,
      "internal_closed",
      "The university has closed internal marks for this exam."
    )
  const course = courseIn(await coursesOf(exam), input.subjectId)
  if (course.internalMax === 0)
    throw new ApiError(
      400,
      "no_internal",
      `${course.name} has no internal marks.`
    )
  for (const m of input.marks) {
    if (m.internal == null) continue
    const problem = markProblem(m.internal, course.internalMax)
    if (problem)
      throw new ApiError(400, "bad_mark", `${course.name}: ${problem}`)
  }
  const found = await sittersByIds(
    exam,
    input.marks.map((m) => m.studentId),
    ctx.org.id
  )
  if (input.marks.some((m) => !markable(ctx, found.get(m.studentId)!.class_id)))
    throw new ApiError(
      403,
      "forbidden",
      "Someone here isn't in a class you enter marks for."
    )
  if (input.marks.length) {
    await getDb()
      .insert(universityMarks)
      .values(
        input.marks.map((m) => ({
          examId: exam.id,
          subjectId: input.subjectId,
          studentId: m.studentId,
          collegeId: ctx.org.id,
          internal: m.internal,
          internalBy: user.id,
        }))
      )
      .onConflictDoUpdate({
        target: [
          universityMarks.examId,
          universityMarks.subjectId,
          universityMarks.studentId,
        ],
        set: {
          internal: raw`excluded.internal`,
          internalBy: user.id,
          updatedAt: new Date(),
        },
      })
  }
  await writeAudit(
    ctx,
    "university.marks",
    `Entered internal marks of ${course.name} for ${input.marks.length} ${input.marks.length === 1 ? "student" : "students"} (${exam.name})`
  )
  return { saved: input.marks.length }
}

/* ---------- a student's university results ---------- */

/**
 * A student's published university results at their college (for the report card): each
 * exam's courses with internal, external, grade and points, the semester's SGPA, and the
 * CGPA across the published semesters (the latest exam of each semester counts).
 */
export async function universityResultsOf(
  collegeId: string,
  studentId: string
) {
  const db = getDb()
  const exams = await db
    .selectDistinct({ exam: universityExams })
    .from(universityMarks)
    .innerJoin(universityExams, eq(universityExams.id, universityMarks.examId))
    .where(
      and(
        eq(universityMarks.studentId, studentId),
        eq(universityMarks.collegeId, collegeId),
        raw`${universityExams.publishedAt} is not null`
      )
    )
  if (exams.length === 0) return null
  const universityId = exams[0]!.exam.universityId
  const [scale, [university], marks] = await Promise.all([
    scaleOf(universityId),
    db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, universityId)),
    db
      .select()
      .from(universityMarks)
      .where(
        and(
          eq(universityMarks.studentId, studentId),
          inArray(
            universityMarks.examId,
            exams.map((e) => e.exam.id)
          )
        )
      ),
  ])
  const programs = await universityPrograms(universityId)
  const sorted = exams
    .map((e) => e.exam)
    .sort((a, b) => a.semester - b.semester || +a.createdAt - +b.createdAt)
  const out = []
  for (const exam of sorted) {
    const courses = await coursesOf(exam)
    const rows = courses.map((c) => {
      const m = marks.find(
        (x) => x.examId === exam.id && x.subjectId === c.subjectId
      )
      const now = {
        internal: m?.internal ?? null,
        external: m?.external ?? null,
        absent: m?.absent ?? false,
      }
      return {
        code: c.code,
        name: c.name,
        credits: c.credits ?? 0,
        internalMax: c.internalMax,
        externalMax: c.externalMax,
        ...now,
        ...courseResult(c, now, scale),
      }
    })
    out.push({
      id: exam.id,
      name: exam.name,
      semester: exam.semester,
      program: programs.find((p) => p.id === exam.programId)?.path ?? "",
      courses: rows,
      result: semesterResult(rows),
    })
  }
  const latest = new Map<number, (typeof out)[number]>()
  for (const e of out) latest.set(e.semester, e)
  const done = [...latest.values()].filter(
    (e) => e.result.complete && e.result.sgpa !== null
  )
  const [reg] = await db.execute<{ reg_no: string | null }>(raw`
    select reg_no from university_registrations
    where university_id = ${universityId} and student_id = ${studentId} and status = 'approved' limit 1`)
  return {
    university: university?.name ?? "",
    regNo: reg?.reg_no ?? null,
    exams: out,
    cgpa: cgpa(
      done.map((e) => ({ sgpa: e.result.sgpa!, credits: e.result.credits }))
    ),
  }
}
