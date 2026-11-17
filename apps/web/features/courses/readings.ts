import {
  courseReadingProgress,
  courseReadings,
  getDb,
  sql,
  type User,
} from "@workspace/db"

import { notFound } from "@/lib/api/route"

import { classCourses } from "./classes"

/*
 * A course's readings as a class reads them: one lesson page at a time, with the module's
 * other items beside it, the one before and after, and "Mark as completed" (which counts
 * toward finishing the module). A student reaches a reading once its module opens for them,
 * by the Course tab's rules; teachers of the class read every one.
 */

const { and, eq } = sql

/** The reading, its course and module, if this person can reach it in this class. */
async function locate(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  readingId: string
) {
  const view = await classCourses(slug, user, groupId)
  const course = view.courses.find((c) => c.id === courseId)
  const module = course?.modules.find((m) =>
    m.items.some((i) => i.kind === "reading" && i.id === readingId)
  )
  if (!course || !module) throw notFound("Not open for you here")
  return { view, course, module }
}

export async function readingView(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  readingId: string
) {
  const { view, course, module } = await locate(
    slug,
    user,
    groupId,
    courseId,
    readingId
  )
  const [reading] = await getDb()
    .select()
    .from(courseReadings)
    .where(
      and(
        eq(courseReadings.id, readingId),
        eq(courseReadings.courseId, courseId)
      )
    )
  if (!reading) throw notFound("Not open for you here")
  // The course's open items in order, for "before" and "after" across modules.
  const steps = course.modules
    .filter((m) => m.items.length > 0)
    .flatMap((m) => m.items.map((i) => ({ ...i, module: m.title })))
  const at = steps.findIndex((i) => i.kind === "reading" && i.id === readingId)
  const step = (i: (typeof steps)[number] | undefined) =>
    i
      ? {
          kind: i.kind,
          id: i.id,
          title: i.title,
          href: i.href,
          module: i.module,
        }
      : null
  return {
    course: { id: course.id, title: course.title },
    module: {
      id: module.id,
      title: module.title,
      items: module.items.map((i) => ({
        kind: i.kind,
        id: i.id,
        title: i.title,
        href: i.href,
        done: i.done,
      })),
    },
    reading: {
      id: reading.id,
      title: reading.title,
      body: reading.body,
      updatedAt: reading.updatedAt,
    },
    teacher: view.teacher,
    done: module.items.find((i) => i.id === readingId)?.done ?? false,
    previous: step(steps[at - 1]),
    next: step(steps[at + 1]),
  }
}

/** Marks a reading read (or not). */
export async function markReading(
  slug: string,
  user: User,
  groupId: string,
  courseId: string,
  readingId: string,
  done: boolean
) {
  await locate(slug, user, groupId, courseId, readingId)
  const db = getDb()
  if (done) {
    await db
      .insert(courseReadingProgress)
      .values({ readingId, userId: user.id })
      .onConflictDoNothing()
  } else {
    await db
      .delete(courseReadingProgress)
      .where(
        and(
          eq(courseReadingProgress.readingId, readingId),
          eq(courseReadingProgress.userId, user.id)
        )
      )
  }
  return { done }
}
