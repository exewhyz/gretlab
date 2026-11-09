import {
  assignmentProblems,
  assignments,
  getDb,
  peerReviews,
  problems,
  sql,
  submissions,
  users,
  type User,
} from "@workspace/db"
import { allocateReviews, checkScores, criteriaFor, type SourceFile } from "@workspace/judge"
import { alias } from "drizzle-orm/pg-core"

import { findAssignment, studentsOf } from "@/features/assignments/server"
import { dbNow } from "@/features/exams/sittings"
import { notify } from "@/features/notifications/server"
import { ApiError, notFound } from "@/lib/api/route"

import type { ReviewInput } from "./schemas"

/*
 * Peer review: after an assignment is due, a teacher hands out reviews (each student who
 * submitted reviews `reviews` classmates' final submissions per problem, never their own;
 * packages/judge peer.ts). Reviewers score against the problem's rubric, comment on lines
 * and sum up, until the review due time. Authors see reviews of their work; teachers see
 * everything with names and can hide a review. Reviews never change marks.
 */

const { and, asc, desc, eq, gte, inArray, isNull } = sql

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)

async function staffAssignment(id: string, orgId: string | null) {
  const [a] = await getDb()
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, id), ownedBy(orgId)))
  if (!a) throw notFound("Assignment not found")
  return a
}

/** Hands out reviews, once, after the due time. */
export async function startPeerReview(id: string, orgId: string | null) {
  const a = await staffAssignment(id, orgId)
  if (!a.peerReview) throw new ApiError(400, "no_peer_review", "Turn on peer review in the assignment's settings first.")
  const now = await dbNow()
  if (now < a.dueAt) throw new ApiError(409, "not_due", "Reviews start after the due time, when the work is final.")
  const db = getDb()
  const [started] = await db
    .select({ id: peerReviews.id })
    .from(peerReviews)
    .where(eq(peerReviews.assignmentId, id))
    .limit(1)
  if (started) throw new ApiError(409, "already_started", "Reviews have already been handed out.")
  const [students, items] = await Promise.all([
    studentsOf(a, "all"),
    db.select().from(assignmentProblems).where(eq(assignmentProblems.assignmentId, id)),
  ])
  const studentIds = students.map((s) => s.id)
  const rows: (typeof peerReviews.$inferInsert)[] = []
  for (const item of items) {
    // Each student's last graded submission for it, from when it opened.
    const latest = studentIds.length
      ? await db
          .selectDistinctOn([submissions.userId], { id: submissions.id, userId: submissions.userId })
          .from(submissions)
          .where(
            and(
              eq(submissions.problemId, item.problemId),
              inArray(submissions.userId, studentIds),
              eq(submissions.kind, "submit"),
              eq(submissions.status, "done"),
              gte(submissions.createdAt, a.opensAt)
            )
          )
          .orderBy(submissions.userId, desc(submissions.createdAt))
      : []
    const work = new Map(latest.map((l) => [l.userId, l.id]))
    for (const pair of allocateReviews([...work.keys()], a.peerReview.reviews, `${a.id}:${item.problemId}`)) {
      rows.push({
        assignmentId: id,
        problemId: item.problemId,
        reviewerId: pair.reviewer,
        authorId: pair.author,
        submissionId: work.get(pair.author)!,
      })
    }
  }
  if (rows.length) await db.insert(peerReviews).values(rows).onConflictDoNothing()
  const reviewers = [...new Set(rows.map((r) => r.reviewerId))]
  await notify(reviewers, {
    kind: "peer_review",
    title: `Peer review: ${a.title}`,
    body: a.peerReview.dueAt
      ? `Review your classmates' work by ${new Date(a.peerReview.dueAt).toUTCString()}.`
      : "Review your classmates' work.",
    href: `/assignments/${a.slug}`,
  })
  return { reviews: rows.length, reviewers: reviewers.length }
}

/** Every review of an assignment, with names, for its teachers. */
export async function peerOverview(id: string, orgId: string | null) {
  const a = await staffAssignment(id, orgId)
  const db = getDb()
  const reviewer = alias(users, "reviewer")
  const author = alias(users, "author")
  const rows = await db
    .select({
      review: peerReviews,
      problem: problems.title,
      reviewer: reviewer.email,
      reviewerName: reviewer.name,
      author: author.email,
      authorName: author.name,
      rubric: assignmentProblems.rubric,
    })
    .from(peerReviews)
    .innerJoin(problems, eq(peerReviews.problemId, problems.id))
    .innerJoin(reviewer, eq(peerReviews.reviewerId, reviewer.id))
    .innerJoin(author, eq(peerReviews.authorId, author.id))
    .innerJoin(
      assignmentProblems,
      and(eq(assignmentProblems.assignmentId, peerReviews.assignmentId), eq(assignmentProblems.problemId, peerReviews.problemId))
    )
    .where(eq(peerReviews.assignmentId, id))
    .orderBy(asc(problems.title), asc(author.email))
  const now = await dbNow()
  return {
    settings: a.peerReview,
    started: rows.length > 0,
    canStart: Boolean(a.peerReview) && now >= a.dueAt && rows.length === 0,
    dueAt: a.dueAt,
    reviews: rows.map((r) => {
      const criteria = criteriaFor(r.rubric)
      return {
        id: r.review.id,
        problem: r.problem,
        reviewer: r.reviewerName ?? r.reviewer,
        author: r.authorName ?? r.author,
        submitted: r.review.submittedAt !== null,
        score: r.review.submittedAt ? criteria.reduce((n, c) => n + (r.review.scores[c.id] ?? 0), 0) : null,
        outOf: criteria.reduce((n, c) => n + c.points, 0),
        comment: r.review.comment,
        lineComments: r.review.lineComments.length,
        hidden: r.review.hidden,
      }
    }),
  }
}

export async function hideReview(id: string, orgId: string | null, reviewId: string, hidden: boolean) {
  await staffAssignment(id, orgId)
  const [row] = await getDb()
    .update(peerReviews)
    .set({ hidden })
    .where(and(eq(peerReviews.id, reviewId), eq(peerReviews.assignmentId, id)))
    .returning()
  if (!row) throw notFound("Review not found")
}

const reviewsOpen = (dueAt: string | null, now: Date) => dueAt === null || now < new Date(dueAt)

/** A student's side: reviews to write, and reviews of their work. */
export async function myPeerReview(slug: string, viewer: User) {
  const { assignment: a } = await findAssignment(slug, viewer)
  if (!a.peerReview) return { settings: null, open: false, toDo: [], received: [] }
  const db = getDb()
  const reviewer = alias(users, "reviewer")
  const [mine, received, now] = await Promise.all([
    db
      .select({ review: peerReviews, problem: problems.title })
      .from(peerReviews)
      .innerJoin(problems, eq(peerReviews.problemId, problems.id))
      .where(and(eq(peerReviews.assignmentId, a.id), eq(peerReviews.reviewerId, viewer.id)))
      .orderBy(asc(problems.title), asc(peerReviews.id)),
    db
      .select({
        review: peerReviews,
        problem: problems.title,
        reviewer: reviewer.name,
        rubric: assignmentProblems.rubric,
      })
      .from(peerReviews)
      .innerJoin(problems, eq(peerReviews.problemId, problems.id))
      .innerJoin(reviewer, eq(peerReviews.reviewerId, reviewer.id))
      .innerJoin(
        assignmentProblems,
        and(eq(assignmentProblems.assignmentId, peerReviews.assignmentId), eq(assignmentProblems.problemId, peerReviews.problemId))
      )
      .where(
        and(
          eq(peerReviews.assignmentId, a.id),
          eq(peerReviews.authorId, viewer.id),
          eq(peerReviews.hidden, false),
          sql.isNotNull(peerReviews.submittedAt)
        )
      )
      .orderBy(asc(problems.title), asc(peerReviews.submittedAt)),
    dbNow(),
  ])
  const anonymous = a.peerReview.anonymous
  return {
    settings: a.peerReview,
    open: reviewsOpen(a.peerReview.dueAt, now),
    toDo: mine.map((m, i) => ({
      id: m.review.id,
      problem: m.problem,
      label: `Classmate ${i + 1}`,
      submitted: m.review.submittedAt !== null,
    })),
    received: received.map((r, i) => ({
      id: r.review.id,
      problem: r.problem,
      reviewer: anonymous ? `Reviewer ${i + 1}` : (r.reviewer ?? "A classmate"),
      criteria: criteriaFor(r.rubric),
      scores: r.review.scores,
      comment: r.review.comment,
      lineComments: r.review.lineComments,
    })),
  }
}

async function myReview(slug: string, viewer: User, reviewId: string) {
  const { assignment: a } = await findAssignment(slug, viewer)
  const [row] = await getDb()
    .select({ review: peerReviews, rubric: assignmentProblems.rubric, problem: problems })
    .from(peerReviews)
    .innerJoin(problems, eq(peerReviews.problemId, problems.id))
    .innerJoin(
      assignmentProblems,
      and(eq(assignmentProblems.assignmentId, peerReviews.assignmentId), eq(assignmentProblems.problemId, peerReviews.problemId))
    )
    .where(and(eq(peerReviews.id, reviewId), eq(peerReviews.assignmentId, a.id), eq(peerReviews.reviewerId, viewer.id)))
  if (!row || !a.peerReview) throw notFound("Review not found")
  return { a, settings: a.peerReview, ...row }
}

/** A review to write: the classmate's code, the criteria, and what's written so far. */
export async function getReviewTask(slug: string, viewer: User, reviewId: string) {
  const { settings, review, rubric, problem } = await myReview(slug, viewer, reviewId)
  const [work] = review.submissionId
    ? await getDb()
        .select({ files: submissions.files, language: submissions.language })
        .from(submissions)
        .where(eq(submissions.id, review.submissionId))
    : []
  const [author] = settings.anonymous
    ? []
    : await getDb().select({ name: users.name }).from(users).where(eq(users.id, review.authorId))
  return {
    id: review.id,
    problem: { title: problem.title },
    author: settings.anonymous ? "A classmate" : (author?.name ?? "A classmate"),
    language: work?.language ?? null,
    files: (work?.files ?? []) as SourceFile[],
    criteria: criteriaFor(rubric),
    scores: review.scores,
    comment: review.comment,
    lineComments: review.lineComments,
    submittedAt: review.submittedAt,
    open: reviewsOpen(settings.dueAt, await dbNow()),
  }
}

/** Saves a review as a draft, or hands it in (then it must be complete). */
export async function saveReview(slug: string, viewer: User, reviewId: string, input: ReviewInput) {
  const { a, settings, review, rubric } = await myReview(slug, viewer, reviewId)
  if (!reviewsOpen(settings.dueAt, await dbNow())) {
    throw new ApiError(409, "reviews_closed", "Reviews for this assignment are closed.")
  }
  const criteria = criteriaFor(rubric)
  const errors = checkScores(criteria, input.scores).filter((e) => input.submit || !e.startsWith("Score "))
  if (input.submit && !input.comment.trim()) errors.push("Write a summary for your classmate")
  if (errors.length) throw new ApiError(400, "incomplete_review", errors.join(". ") + ".")
  const [work] = review.submissionId
    ? await getDb().select({ files: submissions.files }).from(submissions).where(eq(submissions.id, review.submissionId))
    : []
  const files = (work?.files ?? []) as SourceFile[]
  for (const c of input.lineComments) {
    const file = files.find((f) => f.path === c.path)
    if (!file || c.line > file.content.replace(/\n$/, "").split("\n").length) {
      throw new ApiError(400, "no_such_line", "A comment is on a line that isn't in the code.")
    }
  }
  const first = input.submit && review.submittedAt === null
  await getDb()
    .update(peerReviews)
    .set({
      scores: input.scores,
      comment: input.comment,
      lineComments: input.lineComments,
      ...(input.submit ? { submittedAt: review.submittedAt ?? new Date() } : {}),
    })
    .where(eq(peerReviews.id, review.id))
  if (first) {
    await notify([review.authorId], {
      kind: "peer_review_received",
      title: `Your work on ${a.title} was reviewed`,
      body: "A classmate reviewed it. Read their comments on the assignment's page.",
      href: `/assignments/${a.slug}`,
    })
  }
  return { submitted: input.submit || review.submittedAt !== null }
}
