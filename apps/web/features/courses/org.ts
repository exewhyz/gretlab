import type { User } from "@workspace/db"
import type { Permission } from "@workspace/judge"

import { canAnywhere, orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError } from "@/lib/api/route"

import type { CourseInput, OutlineInput } from "./schemas"
import {
  copyCourse,
  deleteCourse,
  getCourse,
  listCourses,
  saveCourse,
  saveOutline,
} from "./server"

/** A college's courses: written by people who write content, seen by those who set work. */
async function courseContext(slug: string, user: User, write = false) {
  const ctx = await orgContext(slug, user)
  const needed: Permission[] = write
    ? ["problems.manage"]
    : ["problems.manage", "assignments.manage", "contests.manage"]
  if (!needed.some((p) => canAnywhere(ctx, p))) {
    throw new ApiError(403, "forbidden", "You don't have permission to do that.")
  }
  return ctx
}

export async function orgCourses(slug: string, user: User) {
  const ctx = await courseContext(slug, user)
  return listCourses(ctx.org.id, user.id)
}

export async function orgCourse(slug: string, user: User, id: string) {
  const ctx = await courseContext(slug, user)
  return getCourse(ctx.org.id, id, user.id)
}

export async function orgSaveCourse(slug: string, user: User, id: string | null, input: CourseInput) {
  const ctx = await courseContext(slug, user, true)
  const row = await saveCourse(ctx.org.id, id, input)
  if (!id) await writeAudit(ctx, "course.create", `Created the course ${row.title}`)
  return row
}

export async function orgSaveOutline(slug: string, user: User, id: string, input: OutlineInput) {
  const ctx = await courseContext(slug, user, true)
  return saveOutline(ctx.org.id, id, input, user.id)
}

export async function orgDeleteCourse(slug: string, user: User, id: string) {
  const ctx = await courseContext(slug, user, true)
  const course = await getCourse(ctx.org.id, id, user.id)
  await deleteCourse(ctx.org.id, id)
  await writeAudit(ctx, "course.delete", `Deleted the course ${course.title}`)
}

export async function orgCopyCourse(slug: string, user: User, id: string) {
  const ctx = await courseContext(slug, user, true)
  const copy = await copyCourse(ctx.org.id, id, user.id)
  await writeAudit(ctx, "course.copy", `Copied the course ${copy.title}`)
  return copy
}
