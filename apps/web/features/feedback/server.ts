import {
  assignments,
  feedbackSnippets,
  getDb,
  sql,
  submissionComments,
  users,
  type User,
} from "@workspace/db"

import { ApiError, isStaff, notFound } from "@/lib/api/route"
import { teachesAnywhere } from "@/features/teaching/server"

/*
 * A teacher's saved comments, reused across students and semesters: "Use a dictionary
 * here", "Name variables for what they hold". Private to the teacher.
 */

const { and, asc, desc, eq } = sql

async function needTeacher(user: User) {
  if (!isStaff(user) && !(await teachesAnywhere(user))) {
    throw new ApiError(
      403,
      "forbidden",
      "Saved comments are for people who teach."
    )
  }
}

export async function mySnippets(user: User) {
  await needTeacher(user)
  return getDb()
    .select({ id: feedbackSnippets.id, body: feedbackSnippets.body })
    .from(feedbackSnippets)
    .where(eq(feedbackSnippets.userId, user.id))
    .orderBy(desc(feedbackSnippets.createdAt))
    .limit(200)
}

export async function addSnippet(user: User, body: string) {
  await needTeacher(user)
  const [snippet] = await getDb()
    .insert(feedbackSnippets)
    .values({ userId: user.id, body })
    .returning({ id: feedbackSnippets.id, body: feedbackSnippets.body })
  return snippet
}

export async function deleteSnippet(user: User, id: string) {
  const removed = await getDb()
    .delete(feedbackSnippets)
    .where(
      and(eq(feedbackSnippets.id, id), eq(feedbackSnippets.userId, user.id))
    )
    .returning({ id: feedbackSnippets.id })
  if (removed.length === 0) throw notFound("Saved comment not found")
}

/**
 * Line comments on a student's own submission, from assignments whose feedback is out.
 * For the student's submission page.
 */
export async function releasedCommentsOn(submissionId: string) {
  return getDb()
    .select({
      id: submissionComments.id,
      path: submissionComments.path,
      line: submissionComments.line,
      body: submissionComments.body,
      createdAt: submissionComments.createdAt,
      author: users.name,
      assignment: assignments.title,
    })
    .from(submissionComments)
    .innerJoin(assignments, eq(submissionComments.assignmentId, assignments.id))
    .leftJoin(users, eq(submissionComments.authorId, users.id))
    .where(
      and(
        eq(submissionComments.submissionId, submissionId),
        eq(assignments.holdFeedback, false)
      )
    )
    .orderBy(asc(submissionComments.line), asc(submissionComments.createdAt))
}
