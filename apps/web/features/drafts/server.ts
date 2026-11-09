import { draftSnapshots, drafts, getDb, sql, type User } from "@workspace/db"
import { isLanguageId, sourceFilesSchema } from "@workspace/judge"
import { z } from "zod"

import { ApiError, notFound } from "@/lib/api/route"
import { getProblemBySlug } from "@/features/problems/server"
import { canReachProblem } from "@/features/submissions/server"
import { examScope, guardExamNetwork } from "@/features/exams/server"

/*
 * Drafts: the code a student is writing, saved to their account every few seconds, so it
 * follows them to any computer. Each change is also kept as a snapshot for playback. The
 * student owns them; teachers see them only where they can already see that student's
 * graded work on the assignment (see `studentAttempts`).
 */

const { and, asc, desc, eq, gte } = sql

/** Snapshots kept per student, problem and language; the oldest go first. */
const KEEP_SNAPSHOTS = 2000

export const draftSchema = z.object({
  language: z.string().refine(isLanguageId, "Unknown language"),
  files: sourceFilesSchema,
  entry: z.string().min(1).max(200),
})

async function reachable(user: User, slug: string) {
  const problem = await getProblemBySlug(slug)
  if (!problem || !(await canReachProblem(user, problem))) {
    throw notFound("Problem not found")
  }
  return problem
}

/** The signed-in student's drafts on a problem, one per language. */
export async function myDrafts(user: User, slug: string) {
  const problem = await reachable(user, slug)
  // During an exam: only the exam's problems, and only code written since it began.
  const scope = await examScope(user.id)
  if (scope && !scope.problemIds.includes(problem.id)) {
    throw new ApiError(403, "exam_locked", "Closed during your exam.")
  }
  const rows = await getDb()
    .select({
      language: drafts.language,
      files: drafts.files,
      entry: drafts.entry,
      updatedAt: drafts.updatedAt,
    })
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, user.id),
        eq(drafts.problemId, problem.id),
        scope ? gte(drafts.updatedAt, scope.since) : undefined
      )
    )
  return { drafts: rows }
}

export async function saveDraft(
  user: User,
  slug: string,
  input: z.infer<typeof draftSchema>,
  ip: string | null = null
) {
  const problem = await reachable(user, slug)
  // Code written elsewhere mustn't arrive in the lab through a draft.
  await guardExamNetwork(user, problem.id, ip)
  if (!input.files.some((f) => f.path === input.entry)) {
    throw new ApiError(
      400,
      "bad_entry",
      "The file to run isn't one of the files."
    )
  }
  const db = getDb()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .insert(drafts)
      .values({
        userId: user.id,
        problemId: problem.id,
        ...input,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [drafts.userId, drafts.problemId, drafts.language],
        set: { files: input.files, entry: input.entry, updatedAt: now },
      })
    // A snapshot only when the code actually changed since the last one.
    const where = and(
      eq(draftSnapshots.userId, user.id),
      eq(draftSnapshots.problemId, problem.id),
      eq(draftSnapshots.language, input.language)
    )
    const [last] = await tx
      .select({ files: draftSnapshots.files })
      .from(draftSnapshots)
      .where(where)
      .orderBy(desc(draftSnapshots.at))
      .limit(1)
    if (JSON.stringify(last?.files) === JSON.stringify(input.files)) return
    await tx.insert(draftSnapshots).values({
      userId: user.id,
      problemId: problem.id,
      language: input.language,
      files: input.files,
      at: now,
    })
    await tx.execute(sql.sql`
      delete from ${draftSnapshots} where id in (
        select id from ${draftSnapshots}
        where user_id = ${user.id} and problem_id = ${problem.id} and language = ${input.language}
        order by at desc offset ${KEEP_SNAPSHOTS}
      )`)
  })
  return { updatedAt: now }
}

/** A student's most recent draft on a problem, in whichever language they used last. */
export async function latestDraft(userId: string, problemId: string) {
  const [row] = await getDb()
    .select({
      language: drafts.language,
      files: drafts.files,
      updatedAt: drafts.updatedAt,
    })
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.problemId, problemId)))
    .orderBy(desc(drafts.updatedAt))
    .limit(1)
  return row ?? null
}

/** Every snapshot of a student's code on a problem, oldest first, for playback. */
export async function draftHistory(userId: string, problemId: string) {
  return getDb()
    .select({
      language: draftSnapshots.language,
      files: draftSnapshots.files,
      at: draftSnapshots.at,
    })
    .from(draftSnapshots)
    .where(
      and(
        eq(draftSnapshots.userId, userId),
        eq(draftSnapshots.problemId, problemId)
      )
    )
    .orderBy(asc(draftSnapshots.at))
    .limit(KEEP_SNAPSHOTS * 2)
}
