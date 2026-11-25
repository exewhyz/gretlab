import {
  classSubjects,
  feedbackResponses,
  feedbackRounds,
  getDb,
  groupMembers,
  orgMembers,
  organizations,
  sql,
  subjects,
  users,
  type User,
} from "@workspace/db"
import {
  checkAnswers,
  roundPhase,
  summarizeFeedback,
  type Answers,
  type FeedbackQuestion,
} from "@workspace/judge"
import { z } from "zod"

import { byName } from "@/lib/by-name"
import {
  canFor,
  groupChain,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * Feedback rounds (rules: packages/judge/src/feedback.ts). Whoever holds "Run feedback rounds"
 * (`feedback_rounds.manage`, across the organization) opens a round for some classes between two dates;
 * each student sitting in them rates each teacher of their subjects there (Subjects module:
 * `class_subjects` of their section and every group above it). The bell reminds students while a
 * round is open and they have teachers left. A teacher sees their own results, managers everyone's;
 * nobody sees who answered, and results show only from MIN_RESPONSES answers.
 */

const { and, asc, desc, eq, gt, inArray, lte } = sql

const question = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\w-]+$/, "Use letters, digits, - and _ in a question's id"),
  kind: z.enum(["rating", "comment"]),
  text: z.string().trim().min(1, "Write the question").max(200),
})

export const roundSchema = z
  .object({
    title: z.string().trim().min(1, "Give the round a title").max(120),
    description: z.string().trim().max(2000).default(""),
    groupIds: z.array(z.uuid()).min(1, "Choose the classes it's for").max(500),
    questions: z.array(question).min(1).max(20),
    opensAt: z.coerce.date(),
    closesAt: z.coerce.date(),
  })
  .refine((r) => r.closesAt > r.opensAt, {
    message: "It must close after it opens",
    path: ["closesAt"],
  })
  .refine(
    (r) => new Set(r.questions.map((q) => q.id)).size === r.questions.length,
    {
      message: "Each question needs its own id",
      path: ["questions"],
    }
  )
  .refine((r) => r.questions.some((q) => q.kind === "rating"), {
    message: "Ask at least one rating question",
    path: ["questions"],
  })

export const answerSchema = z.object({
  classSubjectId: z.uuid(),
  answers: z.record(z.string(), z.union([z.number(), z.string()])),
})

async function context(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  // Who teaches whom comes from Subjects.
  if (!ctx.modules.has("subjects"))
    throw new ApiError(
      404,
      "module_off",
      "Feedback rounds need the Subjects module."
    )
  return ctx
}

const manages = (ctx: OrgContext) => canFor(ctx, "feedback_rounds.manage", [])

function needManage(ctx: OrgContext) {
  if (!manages(ctx))
    throw new ApiError(
      403,
      "forbidden",
      "Running feedback rounds isn't part of your role here."
    )
}

async function roundIn(ctx: OrgContext, id: string) {
  const [round] = await getDb()
    .select()
    .from(feedbackRounds)
    .where(and(eq(feedbackRounds.id, id), eq(feedbackRounds.orgId, ctx.org.id)))
  if (!round) throw notFound("Feedback round not found")
  return round
}

/* ---------- managing rounds ---------- */

export async function listRounds(slug: string, user: User) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const db = getDb()
  const rounds = await db
    .select()
    .from(feedbackRounds)
    .where(eq(feedbackRounds.orgId, ctx.org.id))
    .orderBy(desc(feedbackRounds.opensAt))
  const counts = rounds.length
    ? await db
        .select({ roundId: feedbackResponses.roundId, n: sql.count() })
        .from(feedbackResponses)
        .where(
          inArray(
            feedbackResponses.roundId,
            rounds.map((r) => r.id)
          )
        )
        .groupBy(feedbackResponses.roundId)
    : []
  const now = new Date()
  const name = (id: string) => ctx.groups.find((g) => g.id === id)?.name ?? "?"
  return rounds.map((r) => ({
    ...r,
    phase: roundPhase(r.opensAt, r.closesAt, now),
    classes: r.groupIds.map(name).sort(byName),
    responses: Number(counts.find((c) => c.roundId === r.id)?.n ?? 0),
  }))
}

export async function createRound(
  slug: string,
  user: User,
  input: z.infer<typeof roundSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  if (input.groupIds.some((id) => !ctx.groups.some((g) => g.id === id)))
    throw new ApiError(
      400,
      "unknown_group",
      "A chosen class isn't in this organization."
    )
  const [round] = await getDb()
    .insert(feedbackRounds)
    .values({ ...input, orgId: ctx.org.id, createdBy: user.id })
    .returning()
  await writeAudit(
    ctx,
    "feedback_round.create",
    `Opened the feedback round "${input.title}"`
  )
  return round!
}

export async function updateRound(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof roundSchema>
) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const round = await roundIn(ctx, id)
  if (input.groupIds.some((g) => !ctx.groups.some((x) => x.id === g)))
    throw new ApiError(
      400,
      "unknown_group",
      "A chosen class isn't in this organization."
    )
  // Once anyone has answered, the questions stay as they were answered.
  const [answered] = await getDb()
    .select({ n: sql.count() })
    .from(feedbackResponses)
    .where(eq(feedbackResponses.roundId, round.id))
  if (
    Number(answered?.n ?? 0) > 0 &&
    JSON.stringify(input.questions) !== JSON.stringify(round.questions)
  )
    throw new ApiError(
      409,
      "answered",
      "Students have answered already, so its questions can't change."
    )
  await getDb()
    .update(feedbackRounds)
    .set(input)
    .where(eq(feedbackRounds.id, round.id))
  await writeAudit(
    ctx,
    "feedback_round.update",
    `Changed the feedback round "${input.title}"`
  )
}

export async function deleteRound(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  needManage(ctx)
  const round = await roundIn(ctx, id)
  await getDb().delete(feedbackRounds).where(eq(feedbackRounds.id, round.id))
  await writeAudit(
    ctx,
    "feedback_round.delete",
    `Deleted the feedback round "${round.title}" and its answers`
  )
}

/* ---------- students: whom to rate ---------- */

/**
 * The teachers this person rates in a round: for each section they sit in under the round's
 * classes, the subjects given to it or any group above it that have a teacher (not themselves).
 */
async function targetsIn(
  ctx: OrgContext,
  round: { groupIds: string[] },
  userId: string
) {
  const seats = (
    await getDb()
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
  ).map((s) => s.groupId)
  const covered = new Set(round.groupIds)
  const chains = seats
    .filter((g) => ctx.groups.some((x) => x.id === g))
    .map((g) => groupChain(ctx, g))
    .filter((chain) => chain.some((id) => covered.has(id)))
  const groupIds = [...new Set(chains.flat())]
  if (groupIds.length === 0) return []
  const rows = await getDb()
    .select({
      classSubjectId: classSubjects.id,
      groupId: classSubjects.groupId,
      subject: subjects.name,
      teacherId: classSubjects.teacherId,
      teacher: users.name,
      email: users.email,
    })
    .from(classSubjects)
    .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
    .innerJoin(users, eq(classSubjects.teacherId, users.id))
    .where(
      and(
        eq(classSubjects.orgId, ctx.org.id),
        inArray(classSubjects.groupId, groupIds)
      )
    )
    .orderBy(asc(subjects.name))
  return rows
    .filter((r) => r.teacherId !== userId)
    .map((r) => ({
      classSubjectId: r.classSubjectId,
      subject: r.subject,
      teacherId: r.teacherId!,
      teacher: r.teacher ?? r.email,
      group: ctx.groups.find((g) => g.id === r.groupId)?.name ?? "",
    }))
}

/** Open rounds this person has teachers to rate in, with which they've done. */
export async function myRounds(slug: string, user: User) {
  const ctx = await context(slug, user)
  if (ctx.membership?.status !== "active")
    throw notFound("Organization not found")
  const now = new Date()
  const rounds = await getDb()
    .select()
    .from(feedbackRounds)
    .where(
      and(
        eq(feedbackRounds.orgId, ctx.org.id),
        lte(feedbackRounds.opensAt, now),
        gt(feedbackRounds.closesAt, now)
      )
    )
    .orderBy(asc(feedbackRounds.closesAt))
  const out = []
  for (const round of rounds) {
    const targets = await targetsIn(ctx, round, user.id)
    if (targets.length === 0) continue
    const done = new Set(
      (
        await getDb()
          .select({ id: feedbackResponses.classSubjectId })
          .from(feedbackResponses)
          .where(
            and(
              eq(feedbackResponses.roundId, round.id),
              eq(feedbackResponses.studentId, user.id)
            )
          )
      ).map((r) => r.id)
    )
    out.push({
      id: round.id,
      title: round.title,
      description: round.description,
      closesAt: round.closesAt,
      questions: round.questions,
      targets: targets.map((t) => ({ ...t, done: done.has(t.classSubjectId) })),
    })
  }
  return out
}

/** One student's answers about one teacher of one subject; once each, while the round is open. */
export async function answerRound(
  slug: string,
  user: User,
  roundId: string,
  input: z.infer<typeof answerSchema>
) {
  const ctx = await context(slug, user)
  if (ctx.membership?.status !== "active")
    throw notFound("Feedback round not found")
  const round = await roundIn(ctx, roundId)
  if (roundPhase(round.opensAt, round.closesAt, new Date()) !== "open")
    throw new ApiError(409, "closed", "This feedback round isn't open.")
  const target = (await targetsIn(ctx, round, user.id)).find(
    (t) => t.classSubjectId === input.classSubjectId
  )
  if (!target)
    throw new ApiError(
      403,
      "forbidden",
      "You don't rate this teacher in this round."
    )
  const checked = checkAnswers(
    round.questions as FeedbackQuestion[],
    input.answers
  )
  if (!checked.ok) throw new ApiError(400, "invalid_answers", checked.reason)
  const [saved] = await getDb()
    .insert(feedbackResponses)
    .values({
      roundId: round.id,
      studentId: user.id,
      classSubjectId: target.classSubjectId,
      teacherId: target.teacherId,
      answers: checked.answers,
    })
    .onConflictDoNothing()
    .returning({ roundId: feedbackResponses.roundId })
  if (!saved)
    throw new ApiError(
      409,
      "already_answered",
      "You've already given this feedback."
    )
  return { ok: true }
}

/* ---------- results ---------- */

/**
 * A round's results, one line per teacher, subject and class: everyone's for managers, a teacher's
 * own for them. Never who answered; nothing but the count below MIN_RESPONSES.
 */
export async function roundResults(slug: string, user: User, roundId: string) {
  const ctx = await context(slug, user)
  const round = await roundIn(ctx, roundId)
  const everyone = manages(ctx)
  const rows = await getDb()
    .select({
      classSubjectId: feedbackResponses.classSubjectId,
      teacherId: feedbackResponses.teacherId,
      answers: feedbackResponses.answers,
    })
    .from(feedbackResponses)
    .where(
      and(
        eq(feedbackResponses.roundId, round.id),
        ...(everyone ? [] : [eq(feedbackResponses.teacherId, user.id)])
      )
    )
  return {
    round: {
      id: round.id,
      title: round.title,
      closesAt: round.closesAt,
      questions: round.questions,
    },
    lines: await linesOf(ctx, round.questions as FeedbackQuestion[], rows),
  }
}

async function linesOf(
  ctx: OrgContext,
  questions: FeedbackQuestion[],
  rows: { classSubjectId: string; teacherId: string; answers: Answers }[]
) {
  const keys = [
    ...new Set(rows.map((r) => `${r.teacherId}|${r.classSubjectId}`)),
  ]
  if (keys.length === 0) return []
  const db = getDb()
  const [teachers, subjectRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.teacherId))])),
    db
      .select({
        id: classSubjects.id,
        groupId: classSubjects.groupId,
        subject: subjects.name,
      })
      .from(classSubjects)
      .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
      .where(
        inArray(classSubjects.id, [
          ...new Set(rows.map((r) => r.classSubjectId)),
        ])
      ),
  ])
  return keys
    .map((key) => {
      const [teacherId, classSubjectId] = key.split("|") as [string, string]
      const t = teachers.find((x) => x.id === teacherId)
      const s = subjectRows.find((x) => x.id === classSubjectId)
      return {
        teacher: t?.name ?? t?.email ?? "",
        subject: s?.subject ?? "",
        group: ctx.groups.find((g) => g.id === s?.groupId)?.name ?? "",
        ...summarizeFeedback(
          questions,
          rows
            .filter(
              (r) =>
                r.teacherId === teacherId && r.classSubjectId === classSubjectId
            )
            .map((r) => r.answers)
        ),
      }
    })
    .sort(
      (a, b) => byName(a.teacher, b.teacher) || byName(a.subject, b.subject)
    )
}

/** A teacher's own results in every round of this organization, newest first. */
export async function myResults(slug: string, user: User) {
  const ctx = await context(slug, user)
  const db = getDb()
  const rounds = await db
    .select()
    .from(feedbackRounds)
    .where(eq(feedbackRounds.orgId, ctx.org.id))
    .orderBy(desc(feedbackRounds.opensAt))
  const rows = rounds.length
    ? await db
        .select({
          roundId: feedbackResponses.roundId,
          classSubjectId: feedbackResponses.classSubjectId,
          teacherId: feedbackResponses.teacherId,
          answers: feedbackResponses.answers,
        })
        .from(feedbackResponses)
        .where(
          and(
            inArray(
              feedbackResponses.roundId,
              rounds.map((r) => r.id)
            ),
            eq(feedbackResponses.teacherId, user.id)
          )
        )
    : []
  const out = []
  for (const round of rounds) {
    const mine = rows.filter((r) => r.roundId === round.id)
    if (mine.length === 0) continue
    out.push({
      id: round.id,
      title: round.title,
      phase: roundPhase(round.opensAt, round.closesAt, new Date()),
      lines: await linesOf(ctx, round.questions as FeedbackQuestion[], mine),
    })
  }
  return out
}

/* ---------- the bell ---------- */

/**
 * For the bell (features/notifications/server.ts): open rounds in this person's organizations
 * where they still have teachers to rate. Only organizations with an open round are looked at.
 */
export async function feedbackToGive(user: User) {
  const now = new Date()
  const open = await getDb()
    .select({ slug: organizations.slug, roundId: feedbackRounds.id })
    .from(feedbackRounds)
    .innerJoin(organizations, eq(feedbackRounds.orgId, organizations.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, organizations.id),
        eq(orgMembers.userId, user.id),
        eq(orgMembers.status, "active")
      )
    )
    .where(
      and(lte(feedbackRounds.opensAt, now), gt(feedbackRounds.closesAt, now))
    )
  const out: {
    slug: string
    roundId: string
    title: string
    left: number
    closesAt: Date
  }[] = []
  for (const slug of [...new Set(open.map((o) => o.slug))]) {
    const rounds = await myRounds(slug, user).catch(() => [])
    for (const r of rounds) {
      const left = r.targets.filter((t) => !t.done).length
      if (left > 0)
        out.push({
          slug,
          roundId: r.id,
          title: r.title,
          left,
          closesAt: r.closesAt,
        })
    }
  }
  return out
}
