import {
  courseClasses,
  courseItems,
  courseModules,
  courses,
  getDb,
  organizations,
  problems,
  questions,
  sql,
} from "@workspace/db"

import { sourceOf, usableBy, usableIds } from "@/features/library/sharing"
import { marksItself } from "@/features/questions/schemas"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"
import { ApiError, notFound } from "@/lib/api/route"

import type { CourseInput, OutlineInput } from "./schemas"

/*
 * Courses, as their owner (the platform or a college) writes them: an outline of modules,
 * each an ordered list of problems and questions from the library. Classes use them
 * (features/courses/classes.ts). `orgId` is the owner, already authorized by the caller.
 */

const { and, asc, count, eq, inArray, isNull } = sql

type Kind = "problem" | "question"
export type ItemRef = { kind: Kind; id: string }

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(courses.orgId) : eq(courses.orgId, orgId)

/** The owner's courses and those shared with it. */
export async function listCourses(orgId: string | null, userId?: string) {
  const db = getDb()
  const rows = await db
    .select()
    .from(courses)
    .where(usableBy(courses, "course", orgId, userId))
    .orderBy(asc(courses.title))
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return []
  const [mods, items, used, orgNames] = await Promise.all([
    db
      .select({ courseId: courseModules.courseId, n: count() })
      .from(courseModules)
      .where(inArray(courseModules.courseId, ids))
      .groupBy(courseModules.courseId),
    db
      .select({ courseId: courseModules.courseId, n: count() })
      .from(courseItems)
      .innerJoin(courseModules, eq(courseItems.moduleId, courseModules.id))
      .where(inArray(courseModules.courseId, ids))
      .groupBy(courseModules.courseId),
    db
      .select({ courseId: courseClasses.courseId, n: count() })
      .from(courseClasses)
      .innerJoin(sql.sql`org_groups g`, sql.sql`g.id = ${courseClasses.groupId}`)
      .where(
        and(
          inArray(courseClasses.courseId, ids),
          // Only the owner's own classes: a college never learns where another uses it.
          orgId === null ? sql.sql`true` : sql.sql`g.org_id = ${orgId}`
        )
      )
      .groupBy(courseClasses.courseId),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ])
  const n = (list: { courseId: string; n: number }[], id: string) =>
    list.find((x) => x.courseId === id)?.n ?? 0
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    published: c.published,
    sharing: c.sharing,
    copiedFrom: c.copiedFrom,
    updatedAt: c.updatedAt,
    source: sourceOf(c.orgId, orgId),
    owner:
      c.orgId === null ? "Platform" : (orgNames.find((o) => o.id === c.orgId)?.name ?? "A college"),
    modules: n(mods, c.id),
    items: n(items, c.id),
    classes: n(used, c.id),
  }))
}

/** A course this owner may use, with its outline and each item's title. */
export async function getCourse(orgId: string | null, id: string, userId?: string) {
  const db = getDb()
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), usableBy(courses, "course", orgId, userId)))
  if (!course) throw notFound("Course not found")
  return { ...course, editable: course.orgId === orgId, modules: await outlineOf([id]).then((m) => m.get(id) ?? []) }
}

export interface OutlineItem {
  kind: Kind
  id: string
  title: string
  /** A problem's level or a question's kind. */
  detail: string
  slug: string | null
  membersOnly: boolean
  points: number
}

export interface OutlineModule {
  id: string
  title: string
  summary: string
  openAfterDays: number | null
  afterPrevious: boolean
  items: OutlineItem[]
}

/** The modules of several courses, in order, with their items resolved. */
export async function outlineOf(courseIds: string[]) {
  const db = getDb()
  const out = new Map<string, OutlineModule[]>()
  if (courseIds.length === 0) return out
  const mods = await db
    .select()
    .from(courseModules)
    .where(inArray(courseModules.courseId, courseIds))
    .orderBy(asc(courseModules.position))
  const items = mods.length
    ? await db
        .select()
        .from(courseItems)
        .where(inArray(courseItems.moduleId, mods.map((m) => m.id)))
        .orderBy(asc(courseItems.position))
    : []
  const problemIds = items.filter((i) => i.itemType === "problem").map((i) => i.itemId)
  const questionIds = items.filter((i) => i.itemType === "question").map((i) => i.itemId)
  const [ps, qs] = await Promise.all([
    problemIds.length
      ? db
          .select({
            id: problems.id,
            title: problems.title,
            slug: problems.slug,
            level: problems.level,
            membersOnly: problems.membersOnly,
          })
          .from(problems)
          .where(inArray(problems.id, problemIds))
      : [],
    questionIds.length
      ? db
          .select({ id: questions.id, title: questions.title, kind: questions.kind, points: questions.points })
          .from(questions)
          .where(inArray(questions.id, questionIds))
      : [],
  ])
  for (const m of mods) {
    const list = out.get(m.courseId) ?? []
    list.push({
      id: m.id,
      title: m.title,
      summary: m.summary,
      openAfterDays: m.openAfterDays,
      afterPrevious: m.afterPrevious,
      items: items
        .filter((i) => i.moduleId === m.id)
        .flatMap((i): OutlineItem[] => {
          if (i.itemType === "problem") {
            const p = ps.find((x) => x.id === i.itemId)
            return p
              ? [{ kind: "problem", id: p.id, title: p.title, detail: p.level, slug: p.slug, membersOnly: p.membersOnly, points: 0 }]
              : []
          }
          const q = qs.find((x) => x.id === i.itemId)
          return q
            ? [{ kind: "question", id: q.id, title: q.title, detail: q.kind, slug: null, membersOnly: false, points: q.points }]
            : []
        }),
    })
    out.set(m.courseId, list)
  }
  return out
}

async function ownCourse(orgId: string | null, id: string) {
  const [row] = await getDb()
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), ownedBy(orgId)))
  if (!row) throw notFound("Course not found")
  return row
}

export async function saveCourse(orgId: string | null, id: string | null, input: CourseInput) {
  const values = {
    title: input.title,
    description: input.description,
    published: input.published,
  }
  if (!id) {
    const [row] = await getDb()
      .insert(courses)
      // The platform's courses reach every college unless shared otherwise; a college's stay its own.
      .values({ ...values, orgId, sharing: orgId === null ? "everyone" : "owner" })
      .returning()
    return row!
  }
  await ownCourse(orgId, id)
  const [row] = await getDb()
    .update(courses)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(courses.id, id), unchangedSince(courses.updatedAt, input.expectedUpdatedAt)))
    .returning()
  if (!row) throw editedElsewhere()
  return row
}

/**
 * Items a course may hold: public library problems, or library items the owner may use that
 * students can open without an assignment (members-only problems only the owner's own), and
 * ready questions that mark themselves, since nobody marks practice.
 */
async function checkItems(orgId: string | null, items: ItemRef[], userId?: string) {
  const db = getDb()
  const problemIds = [...new Set(items.filter((i) => i.kind === "problem").map((i) => i.id))]
  const questionIds = [...new Set(items.filter((i) => i.kind === "question").map((i) => i.id))]
  const [usableP, usableQ] = await Promise.all([
    usableIds("problem", problemIds, orgId, userId),
    usableIds("question", questionIds, orgId, userId),
  ])
  const ps = problemIds.length
    ? await db.select().from(problems).where(inArray(problems.id, problemIds))
    : []
  for (const id of problemIds) {
    const p = ps.find((x) => x.id === id)
    // Public library problems are open to everyone, so any course may hold them.
    const isPublic = p && p.published && p.listed && !p.membersOnly
    if (!p || (!usableP.has(id) && !isPublic)) {
      throw new ApiError(400, "not_shared", "A problem in the outline isn't in your library.")
    }
    if (!p.published || !p.listed || (p.membersOnly && p.orgId !== orgId)) {
      throw new ApiError(
        400,
        "not_practice",
        `"${p.title}" is a draft or written for assessments; a course uses ready library problems.`
      )
    }
  }
  const qs = questionIds.length
    ? await db.select().from(questions).where(inArray(questions.id, questionIds))
    : []
  for (const id of questionIds) {
    const q = qs.find((x) => x.id === id)
    if (!q || !usableQ.has(id)) {
      throw new ApiError(400, "not_shared", "A question in the outline isn't in your library.")
    }
    if (!q.published || !marksItself(q)) {
      throw new ApiError(
        400,
        "needs_marking",
        `"${q.title}" needs a teacher to mark it; a course uses questions that mark themselves.`
      )
    }
  }
}

/** Replaces a course's outline. Modules keep their ids, so classes' progress follows them. */
export async function saveOutline(
  orgId: string | null,
  id: string,
  input: OutlineInput,
  userId?: string
) {
  const course = await ownCourse(orgId, id)
  if (
    input.expectedUpdatedAt &&
    Math.abs(course.updatedAt.getTime() - input.expectedUpdatedAt.getTime()) >= 1
  ) {
    throw editedElsewhere()
  }
  await checkItems(orgId, input.modules.flatMap((m) => m.items), userId)
  const db = getDb()
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: courseModules.id })
      .from(courseModules)
      .where(eq(courseModules.courseId, id))
    const known = new Set(existing.map((m) => m.id))
    const kept = new Set<string>()
    for (const [position, m] of input.modules.entries()) {
      const values = {
        title: m.title,
        summary: m.summary,
        openAfterDays: m.openAfterDays,
        afterPrevious: m.afterPrevious,
        position,
      }
      let moduleId: string
      if (m.id && known.has(m.id) && !kept.has(m.id)) {
        await tx.update(courseModules).set(values).where(eq(courseModules.id, m.id))
        moduleId = m.id
      } else {
        const [row] = await tx.insert(courseModules).values({ ...values, courseId: id }).returning()
        moduleId = row!.id
      }
      kept.add(moduleId)
      await tx.delete(courseItems).where(eq(courseItems.moduleId, moduleId))
      const seen = new Set<string>()
      const items = m.items.filter((i) => {
        const key = `${i.kind}:${i.id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (items.length) {
        await tx.insert(courseItems).values(
          items.map((i, n) => ({ moduleId, itemType: i.kind, itemId: i.id, position: n }))
        )
      }
    }
    const gone = [...known].filter((m) => !kept.has(m))
    if (gone.length) await tx.delete(courseModules).where(inArray(courseModules.id, gone))
    await tx.update(courses).set({ updatedAt: new Date() }).where(eq(courses.id, id))
  })
  return getCourse(orgId, id, userId)
}

export async function deleteCourse(orgId: string | null, id: string) {
  await ownCourse(orgId, id)
  const [used] = await getDb()
    .select({ n: count() })
    .from(courseClasses)
    .where(eq(courseClasses.courseId, id))
  if ((used?.n ?? 0) > 0) {
    throw new ApiError(
      409,
      "course_in_use",
      `${used!.n} ${used!.n === 1 ? "class uses" : "classes use"} this course. Take it off them first.`
    )
  }
  await getDb().delete(courses).where(eq(courses.id, id))
}

/** A college's own copy of a course shared with it, to change. Items stay the shared ones. */
export async function copyCourse(orgId: string, id: string, userId?: string) {
  const source = await getCourse(orgId, id, userId)
  if (source.orgId === orgId) throw new ApiError(400, "already_ours", "This course is already yours.")
  const db = getDb()
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(courses)
      .values({
        orgId,
        title: source.title,
        description: source.description,
        published: false,
        sharing: "owner",
        copiedFrom: source.id,
      })
      .returning()
    for (const [position, m] of source.modules.entries()) {
      const [row] = await tx
        .insert(courseModules)
        .values({
          courseId: copy!.id,
          title: m.title,
          summary: m.summary,
          openAfterDays: m.openAfterDays,
          afterPrevious: m.afterPrevious,
          position,
        })
        .returning()
      if (m.items.length) {
        await tx.insert(courseItems).values(
          m.items.map((i, n) => ({ moduleId: row!.id, itemType: i.kind, itemId: i.id, position: n }))
        )
      }
    }
    return copy!
  })
}
