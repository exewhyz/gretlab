import {
  assignmentProblems,
  assignments,
  getDb,
  organizations,
  problems,
  questions,
  sql,
  templates,
  type TemplateContent,
} from "@workspace/db"

import { chosenProblems, getAssignmentForStaff, saveAssignment } from "@/features/assignments/server"
import { dbNow } from "@/features/exams/sittings"
import { sourceOf, usableBy, usableIds } from "@/features/library/sharing"
import type { AssignmentInput } from "@/features/problems/schemas"
import { slugify } from "@/features/problems/schemas"
import { editedElsewhere, unchangedSince } from "@/lib/api/conflict"
import { ApiError, notFound } from "@/lib/api/route"

import type { ApplyTemplateInput } from "./schemas"

/*
 * Templates: an assignment or exam written once (problems, questions, points, rubrics,
 * rules) and used many times, each use an ordinary assignment with its own dates for a
 * class, a college or the platform. Until a use opens, saving the template brings it the
 * template's changes; once it opens it's left alone. `orgId` is the owner, authorized by
 * the caller.
 */

const { and, asc, eq, gt, inArray, isNull } = sql

const ownedBy = (orgId: string | null) =>
  orgId === null ? isNull(templates.orgId) : eq(templates.orgId, orgId)

const assignmentOwnedBy = (orgId: string | null) =>
  orgId === null ? isNull(assignments.orgId) : eq(assignments.orgId, orgId)

const itemsOf = (content: TemplateContent) =>
  new Set([...content.problems.map((p) => p.problemId), ...content.questions.map((q) => q.questionId)])

export async function listTemplates(orgId: string | null, userId?: string) {
  const db = getDb()
  const rows = await db
    .select()
    .from(templates)
    .where(usableBy(templates, "template", orgId, userId))
    .orderBy(asc(templates.title))
  const ids = rows.map((r) => r.id)
  const [uses, orgNames] = await Promise.all([
    ids.length
      ? db
          .select({ templateId: assignments.templateId, n: sql.count() })
          .from(assignments)
          .where(and(inArray(assignments.templateId, ids), assignmentOwnedBy(orgId)))
          .groupBy(assignments.templateId)
      : [],
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ])
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    published: t.published,
    sharing: t.sharing,
    copiedFrom: t.copiedFrom,
    exam: t.content.exam !== null,
    problems: t.content.problems.length,
    questions: t.content.questions.length,
    points:
      t.content.problems.reduce((n, p) => n + p.points + p.rubric.reduce((m, c) => m + c.points, 0), 0) +
      t.content.questions.reduce((n, q) => n + q.points, 0),
    uses: uses.find((u) => u.templateId === t.id)?.n ?? 0,
    source: sourceOf(t.orgId, orgId),
    owner: t.orgId === null ? "Platform" : (orgNames.find((o) => o.id === t.orgId)?.name ?? "A college"),
  }))
}

async function usableTemplate(orgId: string | null, id: string, userId?: string) {
  const [row] = await getDb()
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), usableBy(templates, "template", orgId, userId)))
  if (!row) throw notFound("Template not found")
  return row
}

/** A template in the assignment form's shape, with this owner's uses of it. */
export async function getTemplate(orgId: string | null, id: string, userId?: string) {
  const t = await usableTemplate(orgId, id, userId)
  const [uses, now] = await Promise.all([
    getDb()
      .select({
        id: assignments.id,
        slug: assignments.slug,
        title: assignments.title,
        audience: assignments.audience,
        opensAt: assignments.opensAt,
        dueAt: assignments.dueAt,
        published: assignments.published,
      })
      .from(assignments)
      .where(and(eq(assignments.templateId, id), assignmentOwnedBy(orgId)))
      .orderBy(asc(assignments.opensAt)),
    dbNow(),
  ])
  return {
    id: t.id,
    updatedAt: t.updatedAt,
    editable: t.orgId === orgId,
    title: t.title,
    description: t.description,
    published: t.published,
    sharing: t.sharing,
    allowLate: t.content.allowLate,
    latePenaltyPercent: t.content.latePenaltyPercent,
    holdFeedback: t.content.holdFeedback,
    exam: t.content.exam,
    problems: t.content.problems.map((p) => ({ ...p, outcomes: [] as string[] })),
    chosenProblems: await chosenProblems(t.content.problems.map((p) => p.problemId)),
    questions: t.content.questions,
    uses: uses.map((u) => ({ ...u, opened: u.opensAt <= now })),
  }
}

/** Checks a template's items as an assignment's: ready, and usable by this owner (or already in it). */
async function checkItems(orgId: string | null, content: TemplateContent, allowed: Set<string>, userId?: string) {
  const db = getDb()
  const problemIds = content.problems.map((p) => p.problemId)
  const questionIds = content.questions.map((q) => q.questionId)
  const [ps, qs, usableP, usableQ] = await Promise.all([
    problemIds.length ? db.select().from(problems).where(inArray(problems.id, problemIds)) : [],
    questionIds.length ? db.select().from(questions).where(inArray(questions.id, questionIds)) : [],
    usableIds("problem", problemIds, orgId, userId),
    usableIds("question", questionIds, orgId, userId),
  ])
  if (ps.length !== new Set(problemIds).size || qs.length !== new Set(questionIds).size) {
    throw new ApiError(400, "unknown_problem", "A chosen problem or question no longer exists.")
  }
  for (const p of ps) {
    if (!usableP.has(p.id) && !allowed.has(p.id)) {
      throw new ApiError(400, "private_problem", "That problem isn't shared with you.")
    }
    if (!p.published) {
      throw new ApiError(400, "draft_problem", "Only published problems can be used. Publish the drafts first.")
    }
  }
  for (const q of qs) {
    if (!usableQ.has(q.id) && !allowed.has(q.id)) {
      throw new ApiError(400, "private_question", `"${q.title}" isn't shared with you.`)
    }
  }
}

const contentOf = (input: AssignmentInput): TemplateContent => ({
  allowLate: input.exam ? false : input.allowLate,
  latePenaltyPercent: input.latePenaltyPercent,
  holdFeedback: input.holdFeedback,
  exam: input.exam ? { ...input.exam, networks: [] } : null,
  problems: input.problems.map(({ problemId, points, rubric }) => ({ problemId, points, rubric })),
  questions: input.questions.map(({ questionId, points }) => ({ questionId, points })),
})

/**
 * Saves a template from the assignment form (its dates, address and audience are ignored)
 * and brings the changes to every use that hasn't opened yet.
 */
export async function saveTemplate(
  orgId: string | null,
  id: string | null,
  input: AssignmentInput,
  userId?: string
) {
  const content = contentOf(input)
  const values = { title: input.title, description: input.description, published: input.published, content }
  if (!id) {
    await checkItems(orgId, content, new Set(), userId)
    const [row] = await getDb()
      .insert(templates)
      .values({ ...values, orgId, sharing: orgId === null ? "everyone" : "owner" })
      .returning()
    return { template: row!, updated: 0, kept: 0 }
  }
  const [before] = await getDb()
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), ownedBy(orgId)))
  if (!before) throw notFound("Template not found")
  await checkItems(orgId, content, itemsOf(before.content), userId)
  const [row] = await getDb()
    .update(templates)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(templates.id, id), unchangedSince(templates.updatedAt, input.expectedUpdatedAt)))
    .returning()
  if (!row) throw editedElsewhere()
  return { template: row, ...(await bringChanges(row)) }
}

/** Gives the template's content to its uses that haven't opened; the opened ones stay. */
async function bringChanges(t: typeof templates.$inferSelect) {
  const db = getDb()
  const now = await dbNow()
  const uses = await db.select().from(assignments).where(eq(assignments.templateId, t.id))
  const waiting = uses.filter((u) => u.opensAt > now)
  const allowed = itemsOf(t.content)
  for (const use of waiting) {
    const tagged = await db
      .select({ problemId: assignmentProblems.problemId, outcomes: assignmentProblems.outcomes })
      .from(assignmentProblems)
      .where(eq(assignmentProblems.assignmentId, use.id))
    await saveAssignment(
      use.id,
      {
        title: t.title,
        slug: use.slug,
        description: t.description,
        opensAt: use.opensAt,
        dueAt: use.dueAt,
        allowLate: t.content.exam ? false : t.content.allowLate,
        latePenaltyPercent: t.content.latePenaltyPercent,
        holdFeedback: t.content.holdFeedback,
        // A use keeps its own lab networks.
        exam: t.content.exam
          ? { ...t.content.exam, startWithin: t.content.exam.startWithin ?? null, networks: use.exam?.networks ?? [] }
          : null,
        published: use.published,
        audience: use.audience,
        problems: t.content.problems.map((p) => ({
          ...p,
          // Course outcomes are the class's: kept for problems still in it.
          outcomes: tagged.find((x) => x.problemId === p.problemId)?.outcomes ?? [],
        })),
        questions: t.content.questions,
      },
      use.orgId,
      { allowed }
    )
  }
  return { updated: waiting.length, kept: uses.length - waiting.length }
}

export async function deleteTemplate(orgId: string | null, id: string) {
  // Its uses stay as ordinary assignments.
  const [row] = await getDb()
    .delete(templates)
    .where(and(eq(templates.id, id), ownedBy(orgId)))
    .returning()
  if (!row) throw notFound("Template not found")
  return row
}

/** A template from an assignment's content. */
export async function templateFromAssignment(orgId: string | null, assignmentId: string) {
  const a = await getAssignmentForStaff(assignmentId, orgId)
  const content: TemplateContent = {
    allowLate: a.allowLate,
    latePenaltyPercent: a.latePenaltyPercent,
    holdFeedback: a.holdFeedback,
    exam: a.exam ? { ...a.exam, networks: [] } : null,
    problems: a.problems.map(({ problemId, points, rubric }) => ({ problemId, points, rubric })),
    questions: a.questions,
  }
  const [row] = await getDb()
    .insert(templates)
    .values({
      orgId,
      title: a.title,
      description: a.description,
      content,
      published: true,
      sharing: orgId === null ? "everyone" : "owner",
    })
    .returning()
  return row!
}

/** A college's own copy of a template shared with it, to change. */
export async function copyTemplate(orgId: string, id: string, userId?: string) {
  const t = await usableTemplate(orgId, id, userId)
  if (t.orgId === orgId) throw new ApiError(400, "already_ours", "This template is already yours.")
  const [row] = await getDb()
    .insert(templates)
    .values({
      orgId,
      title: t.title,
      description: t.description,
      content: t.content,
      published: true,
      sharing: "owner",
      copiedFrom: t.id,
    })
    .returning()
  return row!
}

/** A free address for a new use: the title, the class, and a number if taken. */
async function freeSlug(base: string) {
  const root = slugify(base).slice(0, 50) || "assignment"
  const taken = new Set(
    (
      await getDb()
        .select({ slug: assignments.slug })
        .from(assignments)
        .where(sql.like(assignments.slug, `${root}%`))
    ).map((r) => r.slug)
  )
  let slug = root
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`
  return slug
}

/**
 * Uses a template: one assignment per class (or one for the whole owner), each with its own
 * dates, linked back so the template's changes reach it until it opens. `groupName` names
 * a class for its address.
 */
export async function applyTemplate(
  orgId: string | null,
  id: string,
  input: ApplyTemplateInput,
  groupName: (groupId: string) => string,
  userId?: string
) {
  const t = await usableTemplate(orgId, id, userId)
  if (!t.published) throw new ApiError(400, "draft_template", "Mark the template ready before using it.")
  const allowed = itemsOf(t.content)
  const created: { id: string; slug: string; title: string }[] = []
  for (const use of input.uses) {
    const slug = await freeSlug(use.groupId ? `${t.title} ${groupName(use.groupId)}` : t.title)
    const saved = await saveAssignment(
      null,
      {
        title: t.title,
        slug,
        description: t.description,
        opensAt: use.opensAt,
        dueAt: use.dueAt,
        allowLate: t.content.exam ? false : t.content.allowLate,
        latePenaltyPercent: t.content.latePenaltyPercent,
        holdFeedback: t.content.holdFeedback,
        exam: t.content.exam ? { ...t.content.exam, startWithin: t.content.exam.startWithin ?? null } : null,
        published: input.published,
        audience: use.groupId ? [[use.groupId]] : [],
        problems: t.content.problems.map((p) => ({ ...p, outcomes: [] })),
        questions: t.content.questions,
      },
      orgId,
      { allowed, templateId: t.id }
    )
    created.push({ id: saved.id, slug: saved.slug, title: saved.title })
  }
  return { created }
}

/** Uses not opened yet, for the editor's note. */
export async function waitingUses(templateId: string) {
  const now = await dbNow()
  const [row] = await getDb()
    .select({ n: sql.count() })
    .from(assignments)
    .where(and(eq(assignments.templateId, templateId), gt(assignments.opensAt, now)))
  return row?.n ?? 0
}
