import {
  getDb,
  orgAffiliations,
  organizations,
  sql,
  universityExams,
  universityMarks,
  type User,
} from "@workspace/db"
import { courseResult, semesterResult } from "@workspace/judge"
import { z } from "zod"

import { canFor, orgContext } from "@/features/orgs/server"
import { likeTerm, pageOf, readPage } from "@/lib/api/paging"
import { notFound } from "@/lib/api/route"

import { needUniversity } from "./affiliation"
import { coursesOf, scaleOf } from "./exams"
import { universityPrograms } from "./syllabus"

/*
 * The oversight dashboard (`university.view`). For each affiliated college: registered students,
 * their attendance over the last 90 days (excused left out), the pass rate of the latest
 * published university exam, and graded coding lab submissions in 30 days; and each college's
 * registered students with the same. Read only from academic tables (registrations, attendance,
 * university marks, submission counts): never fees, parents, hostel, transport, leave or staff.
 * Only colleges affiliated now.
 */

const { and, desc, eq, inArray, sql: raw } = { ...sql, sql: sql.sql }

const ATTENDANCE_DAYS = 90
const CODING_DAYS = 30

async function universitySide(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needUniversity(
    ctx,
    ctx.org.type === "university" && canFor(ctx, "university.colleges", [])
      ? "university.colleges"
      : "university.view"
  )
  return ctx
}

type Exam = typeof universityExams.$inferSelect

/**
 * Results of a published exam for some of a college's students: each one's semester result
 * (complete, SGPA, backlogs). Students with no marks in it are left out.
 */
async function examResults(
  exam: Exam,
  collegeId: string,
  studentIds?: string[]
) {
  const [courses, scale, marks] = await Promise.all([
    coursesOf(exam),
    scaleOf(exam.universityId),
    getDb()
      .select()
      .from(universityMarks)
      .where(
        and(
          eq(universityMarks.examId, exam.id),
          eq(universityMarks.collegeId, collegeId),
          studentIds
            ? inArray(universityMarks.studentId, studentIds)
            : undefined
        )
      ),
  ])
  const students = [...new Set(marks.map((m) => m.studentId))]
  return new Map(
    students.map((s) => {
      const rows = courses.map((c) => {
        const m = marks.find(
          (x) => x.studentId === s && x.subjectId === c.subjectId
        )
        const r = courseResult(
          c,
          {
            internal: m?.internal ?? null,
            external: m?.external ?? null,
            absent: m?.absent ?? false,
          },
          scale
        )
        return { credits: c.credits ?? 0, points: r.points, outcome: r.outcome }
      })
      return [s, semesterResult(rows)]
    })
  )
}

/** The latest published exam each college has marks in. */
async function latestExams(universityId: string, collegeIds: string[]) {
  if (collegeIds.length === 0) return new Map<string, Exam>()
  const rows = await getDb()
    .selectDistinctOn([universityMarks.collegeId], {
      collegeId: universityMarks.collegeId,
      exam: universityExams,
    })
    .from(universityMarks)
    .innerJoin(universityExams, eq(universityExams.id, universityMarks.examId))
    .where(
      and(
        eq(universityExams.universityId, universityId),
        inArray(universityMarks.collegeId, collegeIds),
        raw`${universityExams.publishedAt} is not null`
      )
    )
    .orderBy(universityMarks.collegeId, desc(universityExams.publishedAt))
  return new Map(rows.map((r) => [r.collegeId, r.exam]))
}

/** Manage › Oversight: every affiliated college's figures, a page at a time. */
export async function universityOverview(
  slug: string,
  user: User,
  query: URLSearchParams
) {
  const ctx = await universitySide(slug, user)
  const asked = readPage(query)
  const perPage = asked.perPage ?? 50
  const db = getDb()
  const search = asked.q
    ? raw`and (o.name ilike ${likeTerm(asked.q)} or a.college_code ilike ${likeTerm(asked.q)})`
    : raw``
  const [count] = await db.execute<{ n: number }>(raw`
    select count(*)::int as n from org_affiliations a join organizations o on o.id = a.college_id
    where a.university_id = ${ctx.org.id} and a.status = 'active' ${search}`)
  const at = pageOf(count?.n ?? 0, asked.page ?? 1, perPage)
  const rows = await db.execute<{
    id: string
    name: string
    code: string | null
    registered: number
    waiting: number
    marked: number
    counted: number
    submissions: number
  }>(raw`
    with page as (
      select o.id, o.name, a.college_code as code
      from org_affiliations a join organizations o on o.id = a.college_id
      where a.university_id = ${ctx.org.id} and a.status = 'active' ${search}
      order by o.name limit ${perPage} offset ${at.offset}
    ),
    regs as (
      select r.college_id, r.student_id, r.status from university_registrations r
      where r.university_id = ${ctx.org.id} and r.college_id in (select id from page)
    )
    select p.id, p.name, p.code,
      (select count(*)::int from regs where regs.college_id = p.id and regs.status = 'approved') as registered,
      (select count(*)::int from regs where regs.college_id = p.id and regs.status = 'requested') as waiting,
      (select count(*) filter (where at.status in ('present', 'late'))::int
         from attendance at join teaching_sessions ts on ts.id = at.session_id
         join regs on regs.student_id = at.user_id and regs.college_id = p.id and regs.status = 'approved'
         where ts.org_id = p.id and ts.day >= to_char(now() - make_interval(days => ${ATTENDANCE_DAYS}), 'YYYY-MM-DD')) as marked,
      (select count(*) filter (where at.status <> 'excused')::int
         from attendance at join teaching_sessions ts on ts.id = at.session_id
         join regs on regs.student_id = at.user_id and regs.college_id = p.id and regs.status = 'approved'
         where ts.org_id = p.id and ts.day >= to_char(now() - make_interval(days => ${ATTENDANCE_DAYS}), 'YYYY-MM-DD')) as counted,
      (select count(*)::int from submissions s
         join regs on regs.student_id = s.user_id and regs.college_id = p.id and regs.status = 'approved'
         where s.kind = 'submit' and s.created_at > now() - make_interval(days => ${CODING_DAYS})) as submissions
    from page p order by p.name`)
  const colleges = [...rows]
  const latest = await latestExams(
    ctx.org.id,
    colleges.map((c) => c.id)
  )
  const results = await Promise.all(
    colleges.map(async (c) => {
      const exam = latest.get(c.id)
      if (!exam) return null
      const all = [...(await examResults(exam, c.id)).values()].filter(
        (r) => r.complete
      )
      return {
        exam: exam.name,
        semester: exam.semester,
        sat: all.length,
        passed: all.filter((r) => r.backlogs === 0).length,
      }
    })
  )
  const [totals] = await db.execute<{
    colleges: number
    registered: number
    waiting: number
  }>(raw`
    select
      (select count(*)::int from org_affiliations where university_id = ${ctx.org.id} and status = 'active') as colleges,
      (select count(*)::int from university_registrations r join org_affiliations a
         on a.college_id = r.college_id and a.university_id = r.university_id and a.status = 'active'
         where r.university_id = ${ctx.org.id} and r.status = 'approved') as registered,
      (select count(*)::int from university_registrations r join org_affiliations a
         on a.college_id = r.college_id and a.university_id = r.university_id and a.status = 'active'
         where r.university_id = ${ctx.org.id} and r.status = 'requested') as waiting`)
  return {
    days: { attendance: ATTENDANCE_DAYS, coding: CODING_DAYS },
    totals: totals ?? { colleges: 0, registered: 0, waiting: 0 },
    total: count?.n ?? 0,
    page: at.page,
    pages: at.pages,
    perPage,
    items: colleges.map((c, i) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      registered: c.registered,
      waiting: c.waiting,
      attendance:
        c.counted > 0 ? Math.round((c.marked / c.counted) * 1000) / 10 : null,
      submissions: c.submissions,
      results: results[i]
        ? {
            ...results[i]!,
            percent:
              results[i]!.sat > 0
                ? Math.round((results[i]!.passed / results[i]!.sat) * 1000) / 10
                : null,
          }
        : null,
    })),
  }
}

/** One affiliated college: its registered students, each with attendance, coding and results. */
export async function universityCollege(
  slug: string,
  user: User,
  collegeId: string,
  query: URLSearchParams
) {
  const ctx = await universitySide(slug, user)
  if (!z.uuid().safeParse(collegeId).success)
    throw notFound("College not found")
  const db = getDb()
  const [college] = await db
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
        eq(orgAffiliations.collegeId, collegeId),
        eq(orgAffiliations.status, "active")
      )
    )
  // A college that isn't affiliated now is simply not found: ending cuts access.
  if (!college) throw notFound("College not found")
  const asked = readPage(query)
  const perPage = asked.perPage ?? 100
  const search = asked.q
    ? raw`and (u.name ilike ${likeTerm(asked.q)} or r.reg_no ilike ${likeTerm(asked.q)})`
    : raw``
  const where = raw`r.university_id = ${ctx.org.id} and r.college_id = ${collegeId} and r.status = 'approved' ${search}`
  const [count] = await db.execute<{ n: number }>(raw`
    select count(*)::int as n from university_registrations r join users u on u.id = r.student_id where ${where}`)
  const at = pageOf(count?.n ?? 0, asked.page ?? 1, perPage)
  const rows = await db.execute<{
    student_id: string
    name: string | null
    reg_no: string | null
    program_id: string
    admission_year: number
    marked: number
    counted: number
    submissions: number
  }>(raw`
    with page as (
      select r.student_id, u.name, r.reg_no, r.program_id, r.admission_year
      from university_registrations r join users u on u.id = r.student_id
      where ${where}
      order by r.reg_no nulls last, u.name limit ${perPage} offset ${at.offset}
    )
    select p.*,
      (select count(*) filter (where at.status in ('present', 'late'))::int
         from attendance at join teaching_sessions ts on ts.id = at.session_id
         where at.user_id = p.student_id and ts.org_id = ${collegeId}
           and ts.day >= to_char(now() - make_interval(days => ${ATTENDANCE_DAYS}), 'YYYY-MM-DD')) as marked,
      (select count(*) filter (where at.status <> 'excused')::int
         from attendance at join teaching_sessions ts on ts.id = at.session_id
         where at.user_id = p.student_id and ts.org_id = ${collegeId}
           and ts.day >= to_char(now() - make_interval(days => ${ATTENDANCE_DAYS}), 'YYYY-MM-DD')) as counted,
      (select count(*)::int from submissions s
         where s.user_id = p.student_id and s.kind = 'submit'
           and s.created_at > now() - make_interval(days => ${CODING_DAYS})) as submissions
    from page p order by p.reg_no nulls last, p.name`)
  const students = [...rows]
  const exam = (await latestExams(ctx.org.id, [collegeId])).get(collegeId)
  const results = exam
    ? await examResults(
        exam,
        collegeId,
        students.map((s) => s.student_id)
      )
    : new Map()
  const programs = await universityPrograms(ctx.org.id)
  return {
    college,
    days: { attendance: ATTENDANCE_DAYS, coding: CODING_DAYS },
    latestExam: exam ? { name: exam.name, semester: exam.semester } : null,
    total: count?.n ?? 0,
    page: at.page,
    pages: at.pages,
    perPage,
    items: students.map((s) => {
      const r = results.get(s.student_id)
      return {
        studentId: s.student_id,
        name: s.name ?? "",
        regNo: s.reg_no,
        program: programs.find((p) => p.id === s.program_id)?.path ?? "—",
        admissionYear: s.admission_year,
        attendance:
          s.counted > 0 ? Math.round((s.marked / s.counted) * 1000) / 10 : null,
        submissions: s.submissions,
        result: r && r.complete ? { sgpa: r.sgpa, backlogs: r.backlogs } : null,
      }
    }),
  }
}
