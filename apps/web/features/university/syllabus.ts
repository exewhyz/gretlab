import {
  classPrograms,
  classSubjects,
  getDb,
  orgAffiliations,
  orgGroups,
  organizations,
  sql,
  subjects,
  syllabusCourses,
  type User,
} from "@workspace/db"
import { semesterProblem, syllabusCourseProblem } from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

import { activeUniversityOf, needUniversity } from "./affiliation"

/*
 * The common syllabus. A university sets each program's semesters: its own courses (subjects
 * with code, name and credits) and how each is marked. A college maps one of its classes to a
 * program's semester; the class then takes those courses as the college's own subjects linked
 * to the university's (`subjects.source_subject_id`), whose code, name and credits follow the
 * university's and stay locked while the college is affiliated. The college still chooses who
 * teaches each. Mapping and saving add courses to classes, never take them off (a college may
 * have timetables and marks on them): taking one off is the college's own step.
 */

const { and, asc, eq, inArray, isNotNull, sql: raw } = { ...sql, sql: sql.sql }

export const semesterSchema = z.object({
  courses: z
    .array(
      z.object({
        subjectId: z.uuid(),
        internalMax: z.number(),
        externalMax: z.number(),
        passExternal: z.number(),
        passTotal: z.number(),
      })
    )
    .max(40),
})

export const mapSchema = z.object({
  groupId: z.uuid(),
  programId: z.uuid(),
  semester: z.number().int(),
})

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** A university's programs: its groups at the level called Program, else every group. */
function programsOf(
  groups: { id: string; name: string; parentId: string | null }[],
  levels: string[]
) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const depth = (id: string) => {
    let d = 0
    for (let g = byId.get(id); g?.parentId; g = byId.get(g.parentId)) d++
    return d
  }
  const path = (id: string) => {
    const names: string[] = []
    for (
      let g = byId.get(id);
      g;
      g = g.parentId ? byId.get(g.parentId) : undefined
    )
      names.unshift(g.name)
    return names.join(" › ")
  }
  const level = levels.findIndex((l) => l.trim().toLowerCase() === "program")
  return groups
    .filter((g) => level < 0 || depth(g.id) === level)
    .map((g) => ({ id: g.id, name: g.name, path: path(g.id) }))
    .sort((a, b) => byName(a.path, b.path))
}

/* ---------- the university's side ---------- */

/** Manage › Syllabus: the university's programs, its courses, and the syllabus of each. */
export async function universitySyllabus(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const edit =
    ctx.org.type === "university" && canFor(ctx, "university.syllabus", [])
  if (!edit) needUniversity(ctx, "university.view")
  const db = getDb()
  const [courses, rows] = await Promise.all([
    db
      .select({
        id: subjects.id,
        name: subjects.name,
        code: subjects.code,
        credits: subjects.credits,
      })
      .from(subjects)
      .where(eq(subjects.orgId, ctx.org.id))
      .orderBy(asc(subjects.name)),
    db
      .select()
      .from(syllabusCourses)
      .where(eq(syllabusCourses.universityId, ctx.org.id))
      .orderBy(asc(syllabusCourses.semester), asc(syllabusCourses.position)),
  ])
  return {
    can: { edit },
    programs: programsOf(ctx.groups, ctx.org.groupLevels),
    courses,
    syllabus: rows.map((r) => ({
      programId: r.programId,
      semester: r.semester,
      subjectId: r.subjectId,
      internalMax: r.internalMax,
      externalMax: r.externalMax,
      passExternal: r.passExternal,
      passTotal: r.passTotal,
    })),
  }
}

/** Sets one semester of one program: its courses in order and how each is marked. */
export async function saveSemester(
  slug: string,
  user: User,
  programId: string,
  semester: number,
  input: z.infer<typeof semesterSchema>
) {
  const ctx = await orgContext(slug, user)
  needUniversity(ctx, "university.syllabus")
  const program = programsOf(ctx.groups, ctx.org.groupLevels).find(
    (p) => p.id === programId
  )
  if (!program) throw notFound("No such program.")
  const bad = semesterProblem(semester)
  if (bad) throw new ApiError(400, "bad_semester", bad)
  const ids = input.courses.map((c) => c.subjectId)
  if (new Set(ids).size !== ids.length)
    throw new ApiError(
      400,
      "duplicate_course",
      "A course is in a semester once."
    )
  const db = getDb()
  const own = ids.length
    ? await db
        .select({
          id: subjects.id,
          name: subjects.name,
          credits: subjects.credits,
        })
        .from(subjects)
        .where(and(inArray(subjects.id, ids), eq(subjects.orgId, ctx.org.id)))
    : []
  if (own.length !== ids.length)
    throw new ApiError(
      400,
      "unknown_course",
      "Only the university's own courses go in its syllabus."
    )
  const noCredits = own.find((s) => s.credits === null)
  if (noCredits)
    throw new ApiError(
      400,
      "no_credits",
      `Give ${noCredits.name} its credits first (Subjects).`
    )
  for (const c of input.courses) {
    const problem = syllabusCourseProblem(c)
    if (problem) {
      const name = own.find((s) => s.id === c.subjectId)!.name
      throw new ApiError(400, "bad_marks", `${name}: ${problem}`)
    }
  }
  const synced = await db.transaction(async (tx) => {
    await tx
      .delete(syllabusCourses)
      .where(
        and(
          eq(syllabusCourses.programId, programId),
          eq(syllabusCourses.semester, semester)
        )
      )
    if (input.courses.length)
      await tx
        .insert(syllabusCourses)
        .values(
          input.courses.map((c, i) => ({
            ...c,
            universityId: ctx.org.id,
            programId,
            semester,
            position: i,
          }))
        )
    // Every affiliated college's class on this semester gets any course new to it.
    const classes = await tx
      .select({ orgId: classPrograms.orgId, groupId: classPrograms.groupId })
      .from(classPrograms)
      .innerJoin(
        orgAffiliations,
        and(
          eq(orgAffiliations.collegeId, classPrograms.orgId),
          eq(orgAffiliations.universityId, ctx.org.id),
          eq(orgAffiliations.status, "active")
        )
      )
      .where(
        and(
          eq(classPrograms.programId, programId),
          eq(classPrograms.semester, semester)
        )
      )
    for (const c of classes)
      await syncClass(tx, c.orgId, c.groupId, programId, semester)
    return classes.length
  })
  await writeAudit(
    ctx,
    "university.syllabus",
    `Set ${program.path}, semester ${semester}: ${input.courses.length} ${input.courses.length === 1 ? "course" : "courses"}`
  )
  return { courses: input.courses.length, classes: synced }
}

/**
 * After the university changes one of its courses: its colleges' copies take the new code, name
 * and credits. A copy whose new name clashes with another of the college's subjects keeps its
 * old one (reported by the count).
 */
export async function followUniversityCourse(subject: {
  id: string
  name: string
  code: string
  credits: number | null
}) {
  const db = getDb()
  const copies = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.sourceSubjectId, subject.id))
  let kept = 0
  for (const copy of copies) {
    try {
      await db
        .update(subjects)
        .set({
          name: subject.name,
          code: subject.code,
          credits: subject.credits,
        })
        .where(eq(subjects.id, copy.id))
    } catch {
      kept++
    }
  }
  return { copies: copies.length, kept }
}

/* ---------- the college's side ---------- */

/** The college's side: an active affiliation, and organization-wide "Manage subjects". */
async function collegeSide(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  if (ctx.org.type !== "college")
    throw notFound("Only a college follows a university's syllabus.")
  if (!ctx.modules.has("subjects"))
    throw notFound("Subjects aren't switched on here.")
  if (!canFor(ctx, "subjects.manage", []))
    throw new ApiError(
      403,
      "forbidden",
      "Following the university's syllabus isn't part of your role."
    )
  return ctx
}

function pathIn(ctx: OrgContext, groupId: string) {
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

/** Manage › University › Classes: the university's programs, and which classes follow which. */
export async function collegePrograms(slug: string, user: User) {
  const ctx = await collegeSide(slug, user)
  const uni = await activeUniversityOf(ctx.org.id)
  if (!uni)
    return {
      university: null,
      programs: [],
      classes: [],
      groups: [],
      levels: [],
    }
  const db = getDb()
  const [groups, rows, maps] = await Promise.all([
    db
      .select({
        id: orgGroups.id,
        name: orgGroups.name,
        parentId: orgGroups.parentId,
      })
      .from(orgGroups)
      .where(eq(orgGroups.orgId, uni.universityId)),
    db
      .select({
        programId: syllabusCourses.programId,
        semester: syllabusCourses.semester,
        courses: raw<number>`count(*)`.mapWith(Number),
      })
      .from(syllabusCourses)
      .where(eq(syllabusCourses.universityId, uni.universityId))
      .groupBy(syllabusCourses.programId, syllabusCourses.semester),
    db
      .select()
      .from(classPrograms)
      .where(
        and(
          eq(classPrograms.orgId, ctx.org.id),
          eq(classPrograms.universityId, uni.universityId)
        )
      ),
  ])
  const [university] = await db
    .select({ levels: organizations.groupLevels })
    .from(organizations)
    .where(eq(organizations.id, uni.universityId))
  const programs = programsOf(groups, university?.levels ?? [])
    .map((p) => ({
      ...p,
      semesters: rows
        .filter((r) => r.programId === p.id)
        .map((r) => ({ semester: r.semester, courses: r.courses }))
        .sort((a, b) => a.semester - b.semester),
    }))
    .filter((p) => p.semesters.length > 0)
  return {
    university: { code: uni.code },
    programs,
    classes: maps
      .map((m) => ({
        id: m.id,
        groupId: m.groupId,
        group: pathIn(ctx, m.groupId),
        programId: m.programId,
        program:
          programs.find((p) => p.id === m.programId)?.path ??
          "A program no longer offered",
        semester: m.semester,
      }))
      .sort((a, b) => byName(a.group, b.group)),
    groups: ctx.groups.map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId,
    })),
    levels: ctx.org.groupLevels,
  }
}

/** A college puts one of its classes on a university program's semester. */
export async function mapClass(
  slug: string,
  user: User,
  input: z.infer<typeof mapSchema>
) {
  const ctx = await collegeSide(slug, user)
  const uni = await activeUniversityOf(ctx.org.id)
  if (!uni)
    throw new ApiError(
      409,
      "not_affiliated",
      "Affiliate to a university first."
    )
  if (!ctx.groups.some((g) => g.id === input.groupId))
    throw notFound("Class not found")
  const db = getDb()
  const [offered] = await db
    .select({ n: raw<number>`count(*)`.mapWith(Number) })
    .from(syllabusCourses)
    .where(
      and(
        eq(syllabusCourses.universityId, uni.universityId),
        eq(syllabusCourses.programId, input.programId),
        eq(syllabusCourses.semester, input.semester)
      )
    )
  if (!offered?.n)
    throw new ApiError(
      400,
      "no_courses",
      "The university has no courses for that program and semester."
    )
  const added = await db.transaction(async (tx) => {
    await tx
      .insert(classPrograms)
      .values({
        ...input,
        orgId: ctx.org.id,
        universityId: uni.universityId,
        createdBy: user.id,
      })
      .onConflictDoUpdate({
        target: classPrograms.groupId,
        set: {
          universityId: uni.universityId,
          programId: input.programId,
          semester: input.semester,
        },
      })
    return syncClass(
      tx,
      ctx.org.id,
      input.groupId,
      input.programId,
      input.semester
    )
  })
  await writeAudit(
    ctx,
    "university.class_program",
    `${pathIn(ctx, input.groupId)} follows the university's semester ${input.semester} (${added} new ${added === 1 ? "course" : "courses"})`
  )
  return { added }
}

/** The class stops following the university's semester; the courses it got stay. */
export async function unmapClass(slug: string, user: User, id: string) {
  const ctx = await collegeSide(slug, user)
  if (!z.uuid().safeParse(id).success) throw notFound("Not found")
  const [row] = await getDb()
    .delete(classPrograms)
    .where(and(eq(classPrograms.id, id), eq(classPrograms.orgId, ctx.org.id)))
    .returning()
  if (!row) throw notFound("Not found")
  await writeAudit(
    ctx,
    "university.class_program",
    `${pathIn(ctx, row.groupId)} no longer follows the university's semester ${row.semester}`
  )
}

/**
 * Gives a college's class the courses of a university semester: each as the college's copy of
 * the university's subject (made, or an unlinked one with the same code or name linked), on
 * the class. Returns how many courses were new to the class.
 */
async function syncClass(
  tx: Tx,
  collegeId: string,
  groupId: string,
  programId: string,
  semester: number
) {
  const wanted = await tx
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      credits: subjects.credits,
    })
    .from(syllabusCourses)
    .innerJoin(subjects, eq(subjects.id, syllabusCourses.subjectId))
    .where(
      and(
        eq(syllabusCourses.programId, programId),
        eq(syllabusCourses.semester, semester)
      )
    )
  if (wanted.length === 0) return 0
  const theirs = await tx
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      source: subjects.sourceSubjectId,
    })
    .from(subjects)
    .where(eq(subjects.orgId, collegeId))
  const copyIds: string[] = []
  for (const w of wanted) {
    const linked = theirs.find((s) => s.source === w.id)
    if (linked) {
      copyIds.push(linked.id)
      continue
    }
    const same = theirs.find(
      (s) =>
        s.source === null &&
        ((w.code !== "" && s.code.toLowerCase() === w.code.toLowerCase()) ||
          s.name.toLowerCase() === w.name.toLowerCase())
    )
    if (same) {
      // It takes the university's name and code, unless another of its subjects has them.
      const clash = (field: "name" | "code") =>
        w[field] !== "" &&
        theirs.some(
          (s) =>
            s.id !== same.id &&
            s[field].toLowerCase() === w[field].toLowerCase()
        )
      const [row] = await tx
        .update(subjects)
        .set({
          sourceSubjectId: w.id,
          credits: w.credits,
          name: clash("name") ? same.name : w.name,
          code: clash("code") ? same.code : w.code,
        })
        .where(eq(subjects.id, same.id))
        .returning({ id: subjects.id })
      same.source = w.id
      copyIds.push(row!.id)
      continue
    }
    // A name or code another of its subjects already has gets told apart.
    const taken = (field: "name" | "code", value: string) =>
      value !== "" &&
      theirs.some((s) => s[field].toLowerCase() === value.toLowerCase())
    const name = taken("name", w.name) ? `${w.name} (university)` : w.name
    const code = taken("code", w.code) ? "" : w.code
    const [row] = await tx
      .insert(subjects)
      .values({
        orgId: collegeId,
        name,
        code,
        credits: w.credits,
        sourceSubjectId: w.id,
      })
      .returning({ id: subjects.id })
    theirs.push({ id: row!.id, name, code, source: w.id })
    copyIds.push(row!.id)
  }
  const added = await tx
    .insert(classSubjects)
    .values(
      copyIds.map((subjectId) => ({ orgId: collegeId, groupId, subjectId }))
    )
    .onConflictDoNothing()
    .returning({ id: classSubjects.id })
  return added.length
}

/**
 * Whether a college's subject is a locked copy of its university's course: linked, and the
 * college still affiliated to that university.
 */
export async function lockedCopy(
  collegeId: string,
  subject: { sourceSubjectId: string | null }
) {
  if (!subject.sourceSubjectId) return false
  const [row] = await getDb()
    .select({ id: orgAffiliations.id })
    .from(subjects)
    .innerJoin(
      orgAffiliations,
      and(
        eq(orgAffiliations.universityId, subjects.orgId),
        eq(orgAffiliations.collegeId, collegeId),
        eq(orgAffiliations.status, "active")
      )
    )
    .where(eq(subjects.id, subject.sourceSubjectId))
  return Boolean(row)
}

/** Which of a college's subjects are locked copies (for its Subjects page). */
export async function lockedCopies(collegeId: string) {
  const rows = await getDb()
    .select({ id: subjects.id })
    .from(subjects)
    .innerJoin(
      orgAffiliations,
      and(
        eq(orgAffiliations.collegeId, collegeId),
        eq(orgAffiliations.status, "active"),
        raw`${orgAffiliations.universityId} = (select s.org_id from subjects s where s.id = ${subjects.sourceSubjectId})`
      )
    )
    .where(
      and(eq(subjects.orgId, collegeId), isNotNull(subjects.sourceSubjectId))
    )
  return new Set(rows.map((r) => r.id))
}
