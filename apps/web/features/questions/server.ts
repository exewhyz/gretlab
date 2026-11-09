import { getDb, questions, sql } from "@workspace/db"

import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"
import { ApiError, notFound } from "@/lib/api/route"

import { readQuestionFile } from "./import"
import { usableBy, usableIds } from "@/features/library/sharing"
import { marksItself, type QuestionInput } from "./schemas"

/*
 * The question bank, owned like problems: the platform's (orgId null) or an
 * organization's. `orgId` here is the owner, already authorized by the caller; every query
 * matches it, so another owner's ids aren't found.
 */

const { and, asc, eq, inArray, isNull, or } = sql

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(questions.orgId) : eq(questions.orgId, orgId)

/** An owner's questions; with `picker`, also the platform's published ones to reuse. */
export async function listQuestionsForStaff(
  orgId: string | null,
  picker = false,
  userId?: string
) {
  const rows = await getDb()
    .select()
    .from(questions)
    .where(picker ? usableBy(questions, "question", orgId, userId) : ownedBy(orgId))
    .orderBy(asc(questions.title))
  return rows.map(({ correct: _c, accepted: _a, ...q }) => ({
    ...q,
    marksItself: marksItself({ kind: q.kind, accepted: _a }),
  }))
}

export async function getQuestionForStaff(id: string, orgId: string | null) {
  const [row] = await getDb()
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), ownedBy(orgId)))
  if (!row) throw notFound("Question not found")
  return row
}

export async function saveQuestion(
  id: string | null,
  input: QuestionInput,
  orgId: string | null
) {
  const { expectedUpdatedAt, ...fields } = input
  const values = {
    ...fields,
    orgId,
    // A college's questions are its own; the platform's sharing is set in the Library.
    ...(orgId ? { sharing: "owner" as const } : {}),
    // Only choice questions have options; only short answers accepted answers.
    options: fields.kind === "single" || fields.kind === "multiple" ? fields.options : [],
    correct: fields.kind === "single" || fields.kind === "multiple" ? fields.correct : [],
    accepted: fields.kind === "short" ? fields.accepted : [],
  }
  if (!id) {
    const [row] = await getDb().insert(questions).values(values).returning()
    return row!
  }
  const [row] = await getDb()
    .update(questions)
    .set(values)
    .where(
      and(
        eq(questions.id, id),
        ownedBy(orgId),
        unchangedSince(questions.updatedAt, expectedUpdatedAt)
      )
    )
    .returning()
  if (row) return row
  const [exists] = await getDb()
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, id), ownedBy(orgId)))
  throw exists ? editedElsewhere() : notFound("Question not found")
}

export async function deleteQuestion(id: string, orgId: string | null) {
  try {
    const deleted = await getDb()
      .delete(questions)
      .where(and(eq(questions.id, id), ownedBy(orgId)))
      .returning({ id: questions.id })
    if (deleted.length === 0) throw notFound("Question not found")
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      409,
      "question_in_use",
      "Assignments or contests use this question. Remove it from them first."
    )
  }
}

/** Questions from a question file, all checked before any is saved. */
export async function importQuestions(
  orgId: string | null,
  raw: unknown,
  published: boolean
) {
  const { questions: found, errors } = readQuestionFile(raw)
  if (errors.length) {
    throw new ApiError(400, "invalid_file", errors.slice(0, 5).join(" "))
  }
  if (found.length === 0) return { created: [] }
  const rows = await getDb()
    .insert(questions)
    .values(
      found.map(({ expectedUpdatedAt: _, ...q }) => ({
        ...q,
        published,
        orgId,
        sharing: orgId ? ("owner" as const) : ("everyone" as const),
      }))
    )
    .returning({ id: questions.id, title: questions.title, kind: questions.kind })
  return { created: rows }
}

/**
 * The bank questions an assignment or contest of this owner may use: its own, and the
 * platform's published ones. Contests and daily challenges need questions that mark
 * themselves.
 */
export async function usableQuestions(
  ids: string[],
  orgId: string | null,
  needsAutoMark = false
) {
  if (ids.length === 0) return []
  const rows = await getDb()
    .select()
    .from(questions)
    .where(inArray(questions.id, ids))
  if (rows.length !== new Set(ids).size) {
    throw new ApiError(400, "unknown_question", "A chosen question no longer exists.")
  }
  const usable = await usableIds("question", ids, orgId)
  for (const q of rows) {
    if (!usable.has(q.id)) {
      throw new ApiError(400, "private_question", `"${q.title}" isn't shared with you.`)
    }
    if (needsAutoMark && !marksItself(q)) {
      throw new ApiError(
        400,
        "needs_marking",
        `"${q.title}" needs a teacher to mark it, so it can't be used here. Use choice questions, or short answers with accepted answers.`
      )
    }
  }
  return rows
}
