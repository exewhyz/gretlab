import {
  getDb,
  groupMembers,
  orgAffiliations,
  orgMembers,
  organizations,
  sql,
  studentRecords,
  universityRegCounters,
  universityRegistrations,
  users,
  type User,
} from "@workspace/db"
import {
  admissionYearProblem,
  registrationNext,
  registrationNumber,
} from "@workspace/judge"
import { z } from "zod"

import { notify } from "@/features/notifications/server"
import {
  canFor,
  leavesUnder,
  membersWhoCan,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { likeTerm, paged, readPage } from "@/lib/api/paging"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"

import { activeUniversityOf, needUniversity } from "./affiliation"
import { universityPrograms } from "./syllabus"

/*
 * Student registration. A college registers its students (those with a student record) with
 * its university for a program and an admission year; the university approves, numbering each
 * (`registrationNumber`: college code, year, sequence, from `university_reg_counters` under a
 * row lock), or rejects. A waiting registration can be cancelled by the college. The university
 * sees a student's name and the college's admission number, nothing else of the record.
 */

const {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql: raw,
} = { ...sql, sql: sql.sql }

export const registerSchema = z
  .object({
    programId: z.uuid(),
    admissionYear: z.number().int(),
    /** Every student in this class (and the groups inside it)… */
    groupId: z.uuid().optional(),
    /** …or these students. */
    studentIds: z.array(z.uuid()).max(5000).optional(),
  })
  .refine((v) => Boolean(v.groupId) !== Boolean(v.studentIds?.length), {
    message: "Choose a class or students.",
  })

export const decideRegistrationsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(2000),
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).default(""),
})

/* ---------- the college's side ---------- */

/** The college's side: Student records on, organization-wide "Manage student records". */
async function collegeSide(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (ctx.org.type !== "college")
    throw notFound("Only a college registers students with a university.")
  if (!ctx.modules.has("records"))
    throw notFound("Student records aren't switched on here.")
  if (!canFor(ctx, "students.manage", []))
    throw new ApiError(
      403,
      "forbidden",
      "Registering students isn't part of your role."
    )
  return ctx
}

/** The rows a list shows: the student, their college's admission number and the program. */
function listQuery(where: ReturnType<typeof and>) {
  return getDb()
    .select({
      id: universityRegistrations.id,
      status: universityRegistrations.status,
      regNo: universityRegistrations.regNo,
      admissionYear: universityRegistrations.admissionYear,
      programId: universityRegistrations.programId,
      note: universityRegistrations.note,
      requestedAt: universityRegistrations.requestedAt,
      decidedAt: universityRegistrations.decidedAt,
      studentId: users.id,
      student: users.name,
      admissionNo: studentRecords.admissionNo,
      collegeId: organizations.id,
      college: organizations.name,
    })
    .from(universityRegistrations)
    .innerJoin(users, eq(users.id, universityRegistrations.studentId))
    .innerJoin(
      organizations,
      eq(organizations.id, universityRegistrations.collegeId)
    )
    .leftJoin(
      studentRecords,
      and(
        eq(studentRecords.orgId, universityRegistrations.collegeId),
        eq(studentRecords.userId, universityRegistrations.studentId)
      )
    )
    .where(where)
}

/** How many rows a list's filter matches, counted in the database. */
async function countOf(where: ReturnType<typeof and>) {
  const [row] = await getDb()
    .select({ n: raw<number>`count(*)`.mapWith(Number) })
    .from(universityRegistrations)
    .innerJoin(users, eq(users.id, universityRegistrations.studentId))
    .leftJoin(
      studentRecords,
      and(
        eq(studentRecords.orgId, universityRegistrations.collegeId),
        eq(studentRecords.userId, universityRegistrations.studentId)
      )
    )
    .where(where)
  return row?.n ?? 0
}

const STATUS = z
  .enum(["requested", "approved", "rejected", "cancelled"])
  .optional()

/** Search by name, admission number or registration number. */
const searched = (q: string) =>
  q
    ? or(
        ilike(users.name, likeTerm(q)),
        ilike(studentRecords.admissionNo, likeTerm(q)),
        ilike(universityRegistrations.regNo, likeTerm(q))
      )
    : undefined

/** Manage › University › Registration: the college's registrations, paged. */
export async function collegeRegistrations(
  slug: string,
  user: User,
  query: URLSearchParams
) {
  const ctx = await collegeSide(slug, user)
  const uni = await activeUniversityOf(ctx.org.id)
  if (!uni)
    return {
      university: null,
      programs: [],
      items: [],
      total: 0,
      page: 1,
      pages: 1,
      perPage: 100,
      counts: { requested: 0, approved: 0 },
    }
  const asked = readPage(query)
  const q = asked.q ?? ""
  const status = STATUS.parse(query.get("status") || undefined)
  const where = and(
    eq(universityRegistrations.collegeId, ctx.org.id),
    eq(universityRegistrations.universityId, uni.universityId),
    status ? eq(universityRegistrations.status, status) : undefined,
    searched(q)
  )
  const [result, programs, [counts]] = await Promise.all([
    paged({
      page: asked.page ?? 1,
      perPage: asked.perPage ?? 100,
      count: () => countOf(where),
      rows: (limit, offset) =>
        listQuery(where)
          .orderBy(desc(universityRegistrations.requestedAt), asc(users.name))
          .limit(limit)
          .offset(offset),
    }),
    universityPrograms(uni.universityId),
    getDb()
      .select({
        requested:
          raw<number>`count(*) filter (where ${universityRegistrations.status} = 'requested')`.mapWith(
            Number
          ),
        approved:
          raw<number>`count(*) filter (where ${universityRegistrations.status} = 'approved')`.mapWith(
            Number
          ),
      })
      .from(universityRegistrations)
      .where(
        and(
          eq(universityRegistrations.collegeId, ctx.org.id),
          eq(universityRegistrations.universityId, uni.universityId)
        )
      ),
  ])
  const programName = new Map(programs.map((p) => [p.id, p.path]))
  return {
    university: { code: uni.code },
    programs,
    ...result,
    items: result.items.map(({ collegeId: _c, college: _n, ...r }) => ({
      ...r,
      program: programName.get(r.programId) ?? "A program no longer offered",
    })),
    counts: counts ?? { requested: 0, approved: 0 },
  }
}

/** A college registers students: a class (with the groups inside it) or chosen ones. */
export async function registerStudents(
  slug: string,
  user: User,
  input: z.infer<typeof registerSchema>
) {
  const ctx = await collegeSide(slug, user)
  const uni = await activeUniversityOf(ctx.org.id)
  if (!uni)
    throw new ApiError(
      409,
      "not_affiliated",
      "Affiliate to a university first."
    )
  const yearProblem = admissionYearProblem(input.admissionYear)
  if (yearProblem) throw new ApiError(400, "bad_year", yearProblem)
  const programs = await universityPrograms(uni.universityId)
  const program = programs.find((p) => p.id === input.programId)
  if (!program)
    throw new ApiError(
      400,
      "unknown_program",
      "The university has no such program."
    )
  const db = getDb()
  let candidates: string[]
  if (input.groupId) {
    if (!ctx.groups.some((g) => g.id === input.groupId))
      throw notFound("Class not found")
    const rows = await db
      .selectDistinct({ id: groupMembers.userId })
      .from(groupMembers)
      .where(
        inArray(groupMembers.groupId, [
          input.groupId,
          ...leavesUnder(ctx, input.groupId),
        ])
      )
    candidates = rows.map((r) => r.id)
  } else candidates = [...new Set(input.studentIds)]
  // Students: active members with a student record here.
  const students = candidates.length
    ? await db
        .select({ id: studentRecords.userId })
        .from(studentRecords)
        .innerJoin(
          orgMembers,
          and(
            eq(orgMembers.orgId, studentRecords.orgId),
            eq(orgMembers.userId, studentRecords.userId),
            eq(orgMembers.status, "active")
          )
        )
        .where(
          and(
            eq(studentRecords.orgId, ctx.org.id),
            inArray(studentRecords.userId, candidates)
          )
        )
    : []
  if (input.studentIds && students.length !== candidates.length)
    throw new ApiError(
      400,
      "not_a_student",
      "Only this college's students with a student record can be registered."
    )
  const ids = students.map((s) => s.id)
  const already = ids.length
    ? await db
        .select({ id: universityRegistrations.studentId })
        .from(universityRegistrations)
        .where(
          and(
            eq(universityRegistrations.universityId, uni.universityId),
            inArray(universityRegistrations.studentId, ids),
            inArray(universityRegistrations.status, ["requested", "approved"])
          )
        )
    : []
  const fresh = ids.filter((id) => !already.some((a) => a.id === id))
  if (fresh.length) {
    await db
      .insert(universityRegistrations)
      .values(
        fresh.map((studentId) => ({
          universityId: uni.universityId,
          collegeId: ctx.org.id,
          studentId,
          programId: input.programId,
          admissionYear: input.admissionYear,
          requestedBy: user.id,
        }))
      )
      .onConflictDoNothing()
    await writeAudit(
      ctx,
      "university.registration",
      `Registered ${fresh.length} ${fresh.length === 1 ? "student" : "students"} for ${program.path} (${input.admissionYear})`
    )
    const [uniOrg] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, uni.universityId))
    await notify(
      await membersWhoCan(uni.universityId, "university.registrations"),
      {
        kind: "registration",
        title: `${ctx.org.name} registered ${fresh.length} ${fresh.length === 1 ? "student" : "students"} for ${program.path}`,
        href: orgPages(uniOrg!.slug).manage("/registrations"),
        orgId: uni.universityId,
      }
    )
  }
  return {
    registered: fresh.length,
    alreadyRegistered: already.length,
    /** In the class but without a student record (or not active). */
    skipped: candidates.length - ids.length,
  }
}

/** The college cancels a registration still waiting. */
export async function cancelRegistration(slug: string, user: User, id: string) {
  const ctx = await collegeSide(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Not found")
  const db = getDb()
  const [row] = await db
    .select()
    .from(universityRegistrations)
    .where(
      and(
        eq(universityRegistrations.id, id),
        eq(universityRegistrations.collegeId, ctx.org.id)
      )
    )
  if (!row) throw notFound("Not found")
  const next = registrationNext(row.status, "cancel")
  if (!next.ok) throw new ApiError(409, "bad_step", next.problem)
  await db
    .update(universityRegistrations)
    .set({ status: next.status, decidedBy: user.id, decidedAt: new Date() })
    .where(
      and(
        eq(universityRegistrations.id, id),
        eq(universityRegistrations.status, "requested")
      )
    )
  await writeAudit(
    ctx,
    "university.registration",
    "Cancelled a waiting registration"
  )
}

/* ---------- the university's side ---------- */

/** Manage › Registrations: every affiliated college's registrations, paged and filtered. */
export async function universityRegistrationList(
  slug: string,
  user: User,
  query: URLSearchParams
) {
  const ctx = await orgContext(slug, user)
  const decide =
    ctx.org.type === "university" && canFor(ctx, "university.registrations", [])
  if (!decide) needUniversity(ctx, "university.view")
  else needUniversity(ctx, "university.registrations")
  const asked = readPage(query)
  const q = asked.q ?? ""
  const status = STATUS.parse(query.get("status") || undefined)
  const college = z
    .uuid()
    .optional()
    .parse(query.get("college") || undefined)
  const db = getDb()
  // Only colleges affiliated now: a college that left takes its students with it.
  const colleges = await db
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
    .orderBy(asc(organizations.name))
  const reachable = colleges
    .map((c) => c.id)
    .filter((id) => !college || id === college)
  const where = and(
    eq(universityRegistrations.universityId, ctx.org.id),
    reachable.length
      ? inArray(universityRegistrations.collegeId, reachable)
      : raw`false`,
    status ? eq(universityRegistrations.status, status) : undefined,
    searched(q)
  )
  const base = and(
    eq(universityRegistrations.universityId, ctx.org.id),
    reachable.length
      ? inArray(universityRegistrations.collegeId, reachable)
      : raw`false`
  )
  const [result, programs, [counts]] = await Promise.all([
    paged({
      page: asked.page ?? 1,
      perPage: asked.perPage ?? 100,
      count: () => countOf(where),
      rows: (limit, offset) =>
        listQuery(where)
          .orderBy(asc(organizations.name), asc(users.name))
          .limit(limit)
          .offset(offset),
    }),
    universityPrograms(ctx.org.id),
    db
      .select({
        requested:
          raw<number>`count(*) filter (where ${universityRegistrations.status} = 'requested')`.mapWith(
            Number
          ),
        approved:
          raw<number>`count(*) filter (where ${universityRegistrations.status} = 'approved')`.mapWith(
            Number
          ),
      })
      .from(universityRegistrations)
      .where(base),
  ])
  const programName = new Map(programs.map((p) => [p.id, p.path]))
  return {
    can: { decide },
    colleges,
    ...result,
    items: result.items.map(({ studentId: _s, ...r }) => ({
      ...r,
      program: programName.get(r.programId) ?? "—",
    })),
    counts: counts ?? { requested: 0, approved: 0 },
  }
}

/**
 * The university approves (numbering each, in college then name order, under the counters'
 * row locks) or rejects waiting registrations of its affiliated colleges.
 */
export async function decideRegistrations(
  slug: string,
  user: User,
  input: z.infer<typeof decideRegistrationsSchema>
) {
  const ctx = await orgContext(slug, user)
  needUniversity(ctx, "university.registrations")
  const db = getDb()
  const done = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: universityRegistrations.id,
        status: universityRegistrations.status,
        collegeId: universityRegistrations.collegeId,
        admissionYear: universityRegistrations.admissionYear,
        code: orgAffiliations.collegeCode,
        name: users.name,
      })
      .from(universityRegistrations)
      .innerJoin(users, eq(users.id, universityRegistrations.studentId))
      .innerJoin(
        orgAffiliations,
        and(
          eq(orgAffiliations.collegeId, universityRegistrations.collegeId),
          eq(orgAffiliations.universityId, ctx.org.id),
          eq(orgAffiliations.status, "active")
        )
      )
      .where(
        and(
          inArray(universityRegistrations.id, input.ids),
          eq(universityRegistrations.universityId, ctx.org.id)
        )
      )
      .orderBy(asc(universityRegistrations.collegeId), asc(users.name))
      .for("update", { of: universityRegistrations })
    if (rows.length !== new Set(input.ids).size)
      throw notFound("Some registrations aren't here.")
    const waiting = rows.filter(
      (r) => registrationNext(r.status, input.action).ok
    )
    if (waiting.length !== rows.length)
      throw new ApiError(
        409,
        "bad_step",
        "Only registrations still waiting can be decided."
      )
    const now = new Date()
    if (input.action === "reject") {
      await tx
        .update(universityRegistrations)
        .set({
          status: "rejected",
          note: input.note,
          decidedBy: user.id,
          decidedAt: now,
        })
        .where(
          inArray(
            universityRegistrations.id,
            rows.map((r) => r.id)
          )
        )
    } else {
      // One counter per college code and year, taken under its row lock.
      const groups = new Map<string, typeof rows>()
      for (const r of rows) {
        const key = `${r.code}|${r.admissionYear}`
        groups.set(key, [...(groups.get(key) ?? []), r])
      }
      for (const [key, list] of groups) {
        const [code, year] = [key.split("|")[0]!, Number(key.split("|")[1])]
        await tx
          .insert(universityRegCounters)
          .values({
            universityId: ctx.org.id,
            collegeCode: code,
            admissionYear: year,
            last: 0,
          })
          .onConflictDoNothing()
        const [counter] = await tx
          .update(universityRegCounters)
          .set({ last: raw`${universityRegCounters.last} + ${list.length}` })
          .where(
            and(
              eq(universityRegCounters.universityId, ctx.org.id),
              eq(universityRegCounters.collegeCode, code),
              eq(universityRegCounters.admissionYear, year)
            )
          )
          .returning({ last: universityRegCounters.last })
        const first = counter!.last - list.length + 1
        for (const [i, r] of list.entries()) {
          await tx
            .update(universityRegistrations)
            .set({
              status: "approved",
              regNo: registrationNumber(code, year, first + i),
              note: input.note,
              decidedBy: user.id,
              decidedAt: now,
            })
            .where(eq(universityRegistrations.id, r.id))
        }
      }
    }
    return rows
  })
  await writeAudit(
    ctx,
    "university.registration",
    `${input.action === "approve" ? "Approved" : "Rejected"} ${done.length} ${done.length === 1 ? "registration" : "registrations"}`
  )
  // Each college's student records office hears of its own.
  const byCollege = new Map<string, number>()
  for (const r of done)
    byCollege.set(r.collegeId, (byCollege.get(r.collegeId) ?? 0) + 1)
  for (const [collegeId, n] of byCollege) {
    const [college] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, collegeId))
    await notify(await membersWhoCan(collegeId, "students.manage"), {
      kind: "registration",
      title: `${ctx.org.name} ${input.action === "approve" ? "approved" : "rejected"} ${n} ${n === 1 ? "registration" : "registrations"}`,
      href: orgPages(college!.slug).manage("/university"),
      orgId: collegeId,
    })
  }
  return { decided: done.length }
}

/** A student's approved registration, for their record page (null when none). */
export async function registrationOf(collegeId: string, studentId: string) {
  const [row] = await getDb()
    .select({
      regNo: universityRegistrations.regNo,
      university: organizations.name,
      admissionYear: universityRegistrations.admissionYear,
      status: universityRegistrations.status,
    })
    .from(universityRegistrations)
    .innerJoin(
      organizations,
      eq(organizations.id, universityRegistrations.universityId)
    )
    .where(
      and(
        eq(universityRegistrations.collegeId, collegeId),
        eq(universityRegistrations.studentId, studentId),
        inArray(universityRegistrations.status, ["requested", "approved"])
      )
    )
    .orderBy(desc(universityRegistrations.requestedAt))
    .limit(1)
  return row ?? null
}

export type { OrgContext }
