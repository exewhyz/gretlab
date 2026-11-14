import {
  organizations,
  contestParticipants,
  contests,
  dailyChallenges,
  dailyAnswers,
  dailyQuestions,
  questions,
  getDb,
  problemListItems,
  problemLists,
  problemNotes,
  problems,
  problemTags,
  sql,
  submissions,
  tags,
  units,
  users,
  type User,
} from "@workspace/db"
import {
  dayIn,
  earnedBadges,
  findSimilarPairs,
  pickDaily,
  markQuestion,
  streaks,
} from "@workspace/judge"

import { byName } from "@/lib/by-name"
import { ApiError, isStaff, notFound } from "@/lib/api/route"
import { cached, invalidate } from "@/lib/ttl-cache"
import { isPublicProblem } from "@/features/problems/server"
import { slugify } from "@/features/problems/schemas"
import { marksItself } from "@/features/questions/schemas"
import { usableQuestions } from "@/features/questions/server"
import { getSettings, requireFeature } from "@/features/settings/server"

const { and, asc, count, desc, eq, gte, inArray, isNull, sql: raw } = sql

/* ---------- the problem library ---------- */

export interface CatalogProblem {
  id: string
  no: number
  title: string
  level: "easy" | "medium" | "hard"
  unit: string | null
  /** The organization that wrote it, credited in the library. */
  by: string | null
  /** Its slug, for showing one organization's problems. */
  org: string | null
  tags: { slug: string; name: string }[]
  /** Accepted graded submissions over all graded submissions, or null before any. */
  acceptance: number | null
  submissions: number
}

/** Submission counts per problem: a full scan, so computed at most once a minute per server. */
function problemStats() {
  return cached("problem-stats", 60_000, async () => {
    const rows = await getDb()
      .select({
        problemId: submissions.problemId,
        total: count(),
        accepted: raw<number>`count(*) filter (where ${submissions.verdict} = 'AC')`,
      })
      .from(submissions)
      .where(
        and(eq(submissions.kind, "submit"), eq(submissions.status, "done"))
      )
      .groupBy(submissions.problemId)
    return new Map(
      rows.map((row) => [
        row.problemId,
        { total: row.total, accepted: Number(row.accepted) },
      ])
    )
  })
}

export async function getCatalog(): Promise<{
  problems: CatalogProblem[]
  tags: { slug: string; name: string; count: number }[]
}> {
  const db = getDb()
  const [rows, tagRows, stats] = await Promise.all([
    db
      .select({
        id: problems.id,
        slug: problems.slug,
        title: problems.title,
        level: problems.level,
        unit: units.name,
        by: organizations.name,
        org: organizations.slug,
      })
      .from(problems)
      .leftJoin(units, eq(problems.unitId, units.id))
      .leftJoin(organizations, eq(problems.orgId, organizations.id))
      .where(isPublicProblem)
      .orderBy(asc(units.position), asc(problems.position), asc(problems.slug)),
    db
      .select({
        problemId: problemTags.problemId,
        slug: tags.slug,
        name: tags.name,
      })
      .from(problemTags)
      .innerJoin(tags, eq(problemTags.tagId, tags.id))
      .orderBy(asc(tags.name)),
    problemStats(),
  ])
  const tagsFor = new Map<string, { slug: string; name: string }[]>()
  const tagCounts = new Map<
    string,
    { slug: string; name: string; count: number }
  >()
  const published = new Set(rows.map((row) => row.id))
  for (const tag of tagRows) {
    if (!published.has(tag.problemId)) continue
    tagsFor.set(tag.problemId, [...(tagsFor.get(tag.problemId) ?? []), tag])
    const entry = tagCounts.get(tag.slug) ?? {
      slug: tag.slug,
      name: tag.name,
      count: 0,
    }
    entry.count += 1
    tagCounts.set(tag.slug, entry)
  }
  return {
    problems: rows.map((row, index) => {
      const stat = stats.get(row.id)
      return {
        id: row.slug,
        no: index + 1,
        title: row.title,
        level: row.level,
        unit: row.unit,
        by: row.by,
        org: row.org,
        tags: tagsFor.get(row.id) ?? [],
        acceptance: stat?.total ? stat.accepted / stat.total : null,
        submissions: stat?.total ?? 0,
      }
    }),
    tags: [...tagCounts.values()].sort((a, b) => byName(a.name, b.name)),
  }
}

/** Replaces a problem's tags with these names, creating any that don't exist yet. */
export async function setProblemTags(problemId: string, names: string[]) {
  const db = getDb()
  const wanted = [
    ...new Map(
      names
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [slugify(name), name])
    ),
  ].filter(([slug]) => slug)
  if (wanted.length) {
    await db
      .insert(tags)
      .values(wanted.map(([slug, name]) => ({ slug, name })))
      .onConflictDoNothing({ target: tags.slug })
  }
  const rows = wanted.length
    ? await db
        .select({ id: tags.id })
        .from(tags)
        .where(
          inArray(
            tags.slug,
            wanted.map(([slug]) => slug)
          )
        )
    : []
  await db.delete(problemTags).where(eq(problemTags.problemId, problemId))
  if (rows.length) {
    await db
      .insert(problemTags)
      .values(rows.map((row) => ({ problemId, tagId: row.id })))
  }
}

export async function getProblemTagNames(problemId: string) {
  const rows = await getDb()
    .select({ name: tags.name })
    .from(problemTags)
    .innerJoin(tags, eq(problemTags.tagId, tags.id))
    .where(eq(problemTags.problemId, problemId))
    .orderBy(asc(tags.name))
  return rows.map((row) => row.name)
}

/* ---------- daily challenge ---------- */

export async function today() {
  return dayIn((await getSettings())["site.timezone"])
}

async function dailyRow(day: string) {
  const [row] = await getDb()
    .select()
    .from(dailyChallenges)
    .where(eq(dailyChallenges.day, day))
  return row ?? null
}

async function dailyProblemId(day: string): Promise<string | null> {
  const db = getDb()
  const row = await dailyRow(day)
  // A day set to questions alone has no problem.
  if (row && !row.problemId) return null
  const [scheduled] = row?.problemId
    ? await db
        .select({ problemId: problems.id })
        .from(problems)
        .where(and(eq(problems.id, row.problemId), isPublicProblem))
    : []
  if (scheduled) return scheduled.problemId
  const pool = await cached("daily-pool", 60_000, () =>
    db
      .select({ id: problems.id })
      .from(problems)
      .where(isPublicProblem)
      .orderBy(asc(problems.id))
  )
  return pickDaily(day, pool)?.id ?? null
}

/** Most questions a day can have. */
export const MAX_DAILY_QUESTIONS = 10

/** The day's questions, in order: the platform's, ready, marking themselves. */
async function dailyQuestionsOf(day: string) {
  const rows = await getDb()
    .select({ question: questions })
    .from(dailyQuestions)
    .innerJoin(questions, eq(dailyQuestions.questionId, questions.id))
    .where(
      and(
        eq(dailyQuestions.day, day),
        isNull(questions.orgId),
        eq(questions.published, true)
      )
    )
    .orderBy(asc(dailyQuestions.position))
  return rows.map((r) => r.question).filter((q) => marksItself(q))
}

export async function getDaily(viewer: User | null) {
  await requireFeature("daily.enabled")
  const day = await today()
  const [problemId, qs] = await Promise.all([
    dailyProblemId(day),
    dailyQuestionsOf(day),
  ])
  if (!problemId && qs.length === 0) return null
  const [problem] = problemId
    ? await getDb()
        .select({
          slug: problems.slug,
          title: problems.title,
          level: problems.level,
        })
        .from(problems)
        .where(eq(problems.id, problemId))
    : []
  let solvedToday = false
  let streak = 0
  let answers: (typeof dailyAnswers.$inferSelect)[] = []
  if (viewer) {
    const activity = await activityOf(viewer.id)
    solvedToday = problemId ? activity.solvedOn(day, problemId) : false
    streak = streaks(activity.days, day).current
    if (qs.length) {
      answers = await getDb()
        .select()
        .from(dailyAnswers)
        .where(
          and(eq(dailyAnswers.day, day), eq(dailyAnswers.userId, viewer.id))
        )
    }
  }
  return {
    day,
    // The day's problem, when there is one (kept at the top level for older clients).
    ...(problem ?? {}),
    problem: problem ?? null,
    solvedToday,
    streak,
    questions: qs.map((q) => {
      const answered = answers.find((a) => a.questionId === q.id)
      return {
        id: q.id,
        title: q.title,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options,
        answer: answered
          ? { value: answered.answer, correct: answered.correct }
          : null,
        // Once answered, the right answer and why.
        solution: answered
          ? {
              correct: q.correct,
              accepted: q.accepted,
              explanation: q.explanation,
            }
          : null,
      }
    }),
  }
}

/** A student's one answer to one of today's questions; a right one keeps their streak. */
export async function answerDaily(
  viewer: User,
  questionId: string,
  answer: string[] | string
) {
  await requireFeature("daily.enabled")
  const day = await today()
  const q = (await dailyQuestionsOf(day)).find((x) => x.id === questionId)
  if (!q) throw notFound("That isn't one of today's questions")
  const correct = markQuestion(q, answer).earned === q.points
  const [saved] = await getDb()
    .insert(dailyAnswers)
    .values({ day, userId: viewer.id, questionId: q.id, answer, correct })
    .onConflictDoNothing()
    .returning()
  if (!saved) {
    throw new ApiError(
      409,
      "already_answered",
      "You've already answered this question today."
    )
  }
  return {
    correct,
    solution: {
      correct: q.correct,
      accepted: q.accepted,
      explanation: q.explanation,
    },
  }
}

/**
 * Sets a day: a problem, questions, or both. With neither, the day goes back to the
 * automatic problem. Questions must be the platform's and mark themselves.
 */
export async function scheduleDaily(
  day: string,
  problemSlug: string | null,
  questionIds: string[] = []
) {
  const db = getDb()
  const ids = [...new Set(questionIds)]
  if (ids.length > MAX_DAILY_QUESTIONS) {
    throw new ApiError(
      400,
      "too_many",
      `At most ${MAX_DAILY_QUESTIONS} questions a day.`
    )
  }
  if (!problemSlug && ids.length === 0) {
    await db.delete(dailyChallenges).where(eq(dailyChallenges.day, day))
    await db.delete(dailyQuestions).where(eq(dailyQuestions.day, day))
    return
  }
  let problemId: string | null = null
  if (problemSlug) {
    const [problem] = await db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.slug, problemSlug))
    if (!problem) throw notFound("Problem not found")
    problemId = problem.id
  }
  const usable = await usableQuestions(ids, null, true)
  if (usable.some((q) => q.orgId !== null)) {
    throw new ApiError(
      400,
      "private_question",
      "The daily challenge uses the platform's questions."
    )
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(dailyChallenges)
      .values({ day, problemId })
      .onConflictDoUpdate({ target: dailyChallenges.day, set: { problemId } })
    await tx.delete(dailyQuestions).where(eq(dailyQuestions.day, day))
    if (ids.length) {
      await tx
        .insert(dailyQuestions)
        .values(
          ids.map((questionId, position) => ({ day, questionId, position }))
        )
    }
  })
}

export async function getDailySchedule(days: number) {
  const timezone = (await getSettings())["site.timezone"]
  const start = new Date()
  const schedule = []
  for (let offset = 0; offset < days; offset++) {
    const day = dayIn(timezone, new Date(start.getTime() + offset * 86_400_000))
    const set = await dailyRow(day)
    const [row] = set?.problemId
      ? await getDb()
          .select({ slug: problems.slug, title: problems.title })
          .from(problems)
          .where(eq(problems.id, set.problemId))
      : []
    const dayQuestions = await getDb()
      .select({ id: questions.id, title: questions.title })
      .from(dailyQuestions)
      .innerJoin(questions, eq(dailyQuestions.questionId, questions.id))
      .where(eq(dailyQuestions.day, day))
      .orderBy(asc(dailyQuestions.position))
    const automatic = set ? null : await dailyProblemId(day)
    const [auto] = automatic
      ? await getDb()
          .select({ slug: problems.slug, title: problems.title })
          .from(problems)
          .where(eq(problems.id, automatic))
      : []
    schedule.push({
      day,
      scheduled: row ?? null,
      questions: dayQuestions,
      automatic: auto ?? null,
    })
  }
  return schedule
}

/* ---------- activity, profiles, leaderboard ---------- */

/** One read of a student's graded history, grouped by day in the site's timezone. */
async function activityOf(userId: string) {
  const timezone = (await getSettings())["site.timezone"]
  const rows = await getDb()
    .select({
      problemId: submissions.problemId,
      verdict: submissions.verdict,
      createdAt: submissions.createdAt,
      level: problems.level,
    })
    .from(submissions)
    .leftJoin(problems, eq(submissions.problemId, problems.id))
    .where(
      and(
        eq(submissions.userId, userId),
        eq(submissions.kind, "submit"),
        eq(submissions.status, "done"),
        gte(submissions.createdAt, new Date(Date.now() - 400 * 86_400_000))
      )
    )
  const days = new Set<string>()
  const perDay = new Map<string, number>()
  const acceptedOn = new Set<string>()
  for (const row of rows) {
    const day = dayIn(timezone, row.createdAt)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    if (row.verdict === "AC") {
      days.add(day)
      acceptedOn.add(`${day}|${row.problemId}`)
    }
  }
  // A right answer to the day's question keeps the streak too.
  const answeredRight = await getDb()
    .select({ day: dailyAnswers.day })
    .from(dailyAnswers)
    .where(and(eq(dailyAnswers.userId, userId), eq(dailyAnswers.correct, true)))
  for (const a of answeredRight) days.add(a.day)
  return {
    days,
    perDay,
    solvedOn: (day: string, problemId: string) =>
      acceptedOn.has(`${day}|${problemId}`),
  }
}

async function findUser(handleOrId: string) {
  const isUuid = /^[0-9a-f-]{36}$/.test(handleOrId)
  const [user] = await getDb()
    .select()
    .from(users)
    .where(isUuid ? eq(users.id, handleOrId) : eq(users.handle, handleOrId))
  if (!user || user.disabled) throw notFound("No such student")
  return user
}

export async function getProfile(handleOrId: string) {
  await requireFeature("profiles.enabled")
  const user = await findUser(handleOrId)
  const db = getDb()
  const day = await today()
  const [solvedRows, totals, contestRows, recent, activity] = await Promise.all(
    [
      db
        .selectDistinct({
          problemId: submissions.problemId,
          level: problems.level,
        })
        .from(submissions)
        .innerJoin(problems, eq(submissions.problemId, problems.id))
        .where(
          and(
            eq(submissions.userId, user.id),
            eq(submissions.kind, "submit"),
            eq(submissions.verdict, "AC"),
            isPublicProblem
          )
        ),
      db
        .select({ level: problems.level, total: count() })
        .from(problems)
        .where(isPublicProblem)
        .groupBy(problems.level),
      db
        .select({
          slug: contests.slug,
          title: contests.title,
          startsAt: contests.startsAt,
        })
        .from(contestParticipants)
        .innerJoin(contests, eq(contestParticipants.contestId, contests.id))
        .where(
          and(
            eq(contestParticipants.userId, user.id),
            eq(contests.published, true)
          )
        )
        .orderBy(desc(contests.startsAt)),
      db
        .selectDistinctOn([problems.slug], {
          slug: problems.slug,
          title: problems.title,
          at: submissions.createdAt,
        })
        .from(submissions)
        .innerJoin(problems, eq(submissions.problemId, problems.id))
        .where(
          and(
            eq(submissions.userId, user.id),
            eq(submissions.kind, "submit"),
            eq(submissions.verdict, "AC"),
            isPublicProblem
          )
        )
        .orderBy(problems.slug, desc(submissions.createdAt)),
      activityOf(user.id),
    ]
  )
  const solvedBy = { easy: 0, medium: 0, hard: 0 }
  for (const row of solvedRows) solvedBy[row.level] += 1
  const totalBy = { easy: 0, medium: 0, hard: 0 }
  for (const row of totals) totalBy[row.level] = row.total
  const streak = streaks(activity.days, day)
  return {
    handle: user.handle ?? user.id,
    name: user.name ?? user.handle ?? "Student",
    role: user.role,
    joinedAt: user.createdAt,
    solved: solvedRows.length,
    solvedBy,
    totalBy,
    streak,
    heatmap: Object.fromEntries(activity.perDay),
    today: day,
    badges: earnedBadges({
      solved: solvedRows.length,
      longestStreak: streak.longest,
      contests: contestRows.length,
      hardSolved: solvedBy.hard,
    }),
    contests: contestRows,
    recent: recent.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10),
  }
}

export async function getLeaderboard() {
  await requireFeature("profiles.enabled")
  return cached("global-leaderboard", 60_000, async () => {
    const rows = await getDb()
      .select({
        handle: users.handle,
        id: users.id,
        name: users.name,
        solved: raw<number>`count(distinct ${submissions.problemId})`,
        firstAt: raw<Date>`max(${submissions.createdAt})`,
      })
      .from(submissions)
      .innerJoin(users, eq(submissions.userId, users.id))
      .innerJoin(problems, eq(submissions.problemId, problems.id))
      .where(
        and(
          eq(submissions.kind, "submit"),
          eq(submissions.verdict, "AC"),
          isPublicProblem,
          eq(users.disabled, false),
          eq(users.role, "student")
        )
      )
      .groupBy(users.id)
      .orderBy(
        raw`count(distinct ${submissions.problemId}) desc`,
        raw`max(${submissions.createdAt}) asc`
      )
      .limit(100)
    let rank = 0
    let previous = -1
    return rows.map((row, index) => {
      const solved = Number(row.solved)
      if (solved !== previous) rank = index + 1
      previous = solved
      return {
        rank,
        handle: row.handle ?? row.id,
        name: row.name ?? row.handle ?? "Student",
        solved,
      }
    })
  })
}

/* ---------- notes ---------- */

async function problemIdOf(slug: string) {
  const [problem] = await getDb()
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.slug, slug))
  if (!problem) throw notFound("Problem not found")
  return problem.id
}

export async function getNote(user: User, slug: string) {
  const problemId = await problemIdOf(slug)
  const [note] = await getDb()
    .select({ text: problemNotes.text, updatedAt: problemNotes.updatedAt })
    .from(problemNotes)
    .where(
      and(
        eq(problemNotes.userId, user.id),
        eq(problemNotes.problemId, problemId)
      )
    )
  return note ?? { text: "", updatedAt: null }
}

export async function saveNote(user: User, slug: string, text: string) {
  const problemId = await problemIdOf(slug)
  const db = getDb()
  if (!text.trim()) {
    await db
      .delete(problemNotes)
      .where(
        and(
          eq(problemNotes.userId, user.id),
          eq(problemNotes.problemId, problemId)
        )
      )
    return { text: "", updatedAt: null }
  }
  const [note] = await db
    .insert(problemNotes)
    .values({ userId: user.id, problemId, text })
    .onConflictDoUpdate({
      target: [problemNotes.userId, problemNotes.problemId],
      set: { text, updatedAt: new Date() },
    })
    .returning({ text: problemNotes.text, updatedAt: problemNotes.updatedAt })
  return note
}

/* ---------- lists and study plans ---------- */

const MAX_LISTS = 50
const MAX_LIST_ITEMS = 500

async function favoritesOf(
  user: User
): Promise<typeof problemLists.$inferSelect> {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(problemLists)
    .where(
      and(eq(problemLists.ownerId, user.id), eq(problemLists.kind, "favorites"))
    )
  if (existing) return existing
  const [created] = await db
    .insert(problemLists)
    .values({
      ownerId: user.id,
      kind: "favorites",
      slug: `favorites-${user.id}`,
      title: "Favorites",
    })
    .onConflictDoNothing()
    .returning()
  return created ?? (await favoritesOf(user))
}

/** Lists the viewer can see: their own and every published study plan. */
export async function getLists(user: User | null) {
  await requireFeature("lists.enabled")
  if (user) await favoritesOf(user)
  const db = getDb()
  const rows = await db
    .select({
      id: problemLists.id,
      slug: problemLists.slug,
      title: problemLists.title,
      description: problemLists.description,
      kind: problemLists.kind,
      published: problemLists.published,
      ownerId: problemLists.ownerId,
      size: raw<number>`(select count(*) from ${problemListItems} where ${problemListItems.listId} = ${problemLists.id})`,
    })
    .from(problemLists)
    .where(
      user
        ? raw`(${problemLists.ownerId} = ${user.id} or (${problemLists.kind} = 'study_plan' and ${problemLists.published}))`
        : and(
            eq(problemLists.kind, "study_plan"),
            eq(problemLists.published, true)
          )
    )
    .orderBy(asc(problemLists.kind), asc(problemLists.title))
  return rows.map(({ ownerId, ...row }) => ({
    ...row,
    size: Number(row.size),
    mine: Boolean(user && ownerId === user.id),
  }))
}

async function findList(slug: string, viewer: User | null) {
  const [list] = await getDb()
    .select()
    .from(problemLists)
    .where(eq(problemLists.slug, slug))
  const visible =
    list &&
    (list.ownerId === viewer?.id ||
      (list.kind === "study_plan" && (list.published || isStaff(viewer))) ||
      (list.kind === "custom" && list.published))
  if (!list || !visible) throw notFound("List not found")
  return list
}

export async function getList(slug: string, viewer: User | null) {
  await requireFeature("lists.enabled")
  const list = await findList(slug, viewer)
  const items = await getDb()
    .select({
      slug: problems.slug,
      title: problems.title,
      level: problems.level,
      position: problemListItems.position,
    })
    .from(problemListItems)
    .innerJoin(problems, eq(problemListItems.problemId, problems.id))
    .where(and(eq(problemListItems.listId, list.id), isPublicProblem))
    .orderBy(asc(problemListItems.position), asc(problems.title))
  const { ownerId, ...rest } = list
  return { ...rest, mine: ownerId === viewer?.id, items }
}

/** Which of the viewer's lists contain this problem, for the "save" menu. */
export async function getMembership(user: User, problemSlug: string) {
  const problemId = await problemIdOf(problemSlug)
  await favoritesOf(user)
  const rows = await getDb()
    .select({
      slug: problemLists.slug,
      title: problemLists.title,
      kind: problemLists.kind,
      contains: raw<boolean>`exists(select 1 from ${problemListItems} where ${problemListItems.listId} = ${problemLists.id} and ${problemListItems.problemId} = ${problemId})`,
    })
    .from(problemLists)
    .where(eq(problemLists.ownerId, user.id))
    .orderBy(asc(problemLists.kind), asc(problemLists.title))
  return rows
}

async function ownedList(slug: string, user: User) {
  const [list] = await getDb()
    .select()
    .from(problemLists)
    .where(eq(problemLists.slug, slug))
  // Staff manage study plans; everyone else only their own lists.
  const allowed =
    list &&
    (list.ownerId === user.id || (list.kind === "study_plan" && isStaff(user)))
  if (!list || !allowed) throw notFound("List not found")
  return list
}

export async function setMembership(
  user: User,
  listSlug: string,
  problemSlug: string,
  member: boolean
) {
  await requireFeature("lists.enabled")
  const list = await ownedList(listSlug, user)
  const problemId = await problemIdOf(problemSlug)
  const db = getDb()
  if (!member) {
    await db
      .delete(problemListItems)
      .where(
        and(
          eq(problemListItems.listId, list.id),
          eq(problemListItems.problemId, problemId)
        )
      )
    return
  }
  const [size] = await db
    .select({ total: count() })
    .from(problemListItems)
    .where(eq(problemListItems.listId, list.id))
  if ((size?.total ?? 0) >= MAX_LIST_ITEMS) {
    throw new ApiError(400, "list_full", "This list is full.")
  }
  await db
    .insert(problemListItems)
    .values({ listId: list.id, problemId, position: size?.total ?? 0 })
    .onConflictDoNothing()
}

export async function createList(
  user: User,
  input: { title: string; description: string; kind: "custom" | "study_plan" }
) {
  await requireFeature("lists.enabled")
  if (input.kind === "study_plan" && !isStaff(user)) {
    throw new ApiError(403, "forbidden", "Only staff create study plans.")
  }
  const db = getDb()
  const [mine] = await db
    .select({ total: count() })
    .from(problemLists)
    .where(eq(problemLists.ownerId, user.id))
  if ((mine?.total ?? 0) >= MAX_LISTS) {
    throw new ApiError(400, "too_many_lists", "You have too many lists.")
  }
  const base = slugify(input.title) || "list"
  const suffix = Math.random().toString(36).slice(2, 7)
  const [list] = await db
    .insert(problemLists)
    .values({
      ownerId: user.id,
      kind: input.kind,
      title: input.title,
      description: input.description,
      slug: `${base}-${suffix}`,
    })
    .returning()
  // An insert returns its row.
  return list!
}

export async function updateList(
  user: User,
  slug: string,
  input: {
    title?: string
    description?: string
    published?: boolean
    problemSlugs?: string[]
  }
) {
  const list = await ownedList(slug, user)
  if (list.kind === "favorites" && input.title) {
    throw new ApiError(400, "favorites", "Favorites can't be renamed.")
  }
  const db = getDb()
  const { problemSlugs, ...fields } = input
  await db.transaction(async (tx) => {
    if (Object.keys(fields).length) {
      await tx
        .update(problemLists)
        .set(fields)
        .where(eq(problemLists.id, list.id))
    }
    if (problemSlugs) {
      const found = problemSlugs.length
        ? await tx
            .select({ id: problems.id, slug: problems.slug })
            .from(problems)
            .where(inArray(problems.slug, problemSlugs))
        : []
      const idOf = new Map(found.map((row) => [row.slug, row.id]))
      await tx
        .delete(problemListItems)
        .where(eq(problemListItems.listId, list.id))
      const rows = problemSlugs.flatMap((problemSlug, position) => {
        const problemId = idOf.get(problemSlug)
        return problemId ? [{ listId: list.id, problemId, position }] : []
      })
      if (rows.length) await tx.insert(problemListItems).values(rows)
    }
  })
}

export async function deleteList(user: User, slug: string) {
  const list = await ownedList(slug, user)
  if (list.kind === "favorites") {
    throw new ApiError(400, "favorites", "Favorites can't be deleted.")
  }
  await getDb().delete(problemLists).where(eq(problemLists.id, list.id))
}

export async function listStudyPlans() {
  return getDb()
    .select()
    .from(problemLists)
    .where(eq(problemLists.kind, "study_plan"))
    .orderBy(asc(problemLists.title))
}

/* ---------- integrity ---------- */

/**
 * Pairs of students whose accepted code for the same problem is unusually similar. Each
 * student's latest accepted submission is compared. A lead for a teacher, not a verdict.
 */
export async function findSimilarSubmissions(input: {
  problemSlug: string
  contestSlug: string | null
  threshold: number
}) {
  const db = getDb()
  const problemId = await problemIdOf(input.problemSlug)
  let contestId: string | null = null
  if (input.contestSlug) {
    const [contest] = await db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.slug, input.contestSlug))
    if (!contest) throw notFound("Contest not found")
    contestId = contest.id
  }
  const rows = await db
    .selectDistinctOn([submissions.userId], {
      id: submissions.id,
      userId: submissions.userId,
      email: users.email,
      language: submissions.language,
      files: submissions.files,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .where(
      and(
        eq(submissions.problemId, problemId),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC"),
        contestId ? eq(submissions.contestId, contestId) : undefined
      )
    )
    .orderBy(submissions.userId, desc(submissions.createdAt))
  const byId = new Map(rows.map((row) => [row.id, row]))
  // Only the same language is comparable.
  const pairs = ["python", "javascript", "c", "cpp", "java"].flatMap(
    (language) =>
      findSimilarPairs(
        rows
          .filter((row) => row.language === language)
          .map((row) => ({
            key: row.id,
            code: row.files.map((file) => file.content).join("\n"),
          })),
        input.threshold
      )
  )
  return {
    compared: rows.length,
    pairs: pairs
      .sort((a, b) => b.score - a.score)
      .slice(0, 200)
      .map((pair) => {
        const a = byId.get(pair.a)
        const b = byId.get(pair.b)
        return {
          score: Math.round(pair.score * 100),
          language: a?.language ?? "",
          a: { submissionId: pair.a, email: a?.email ?? "", at: a?.createdAt },
          b: { submissionId: pair.b, email: b?.email ?? "", at: b?.createdAt },
        }
      }),
  }
}

/* ---------- handles ---------- */

/** A free handle from an email: "Ana.Lee@x.edu" becomes "ana-lee", then "ana-lee-2". */
export async function freeHandle(email: string) {
  const base = slugify(email.split("@")[0] ?? "").slice(0, 30) || "user"
  const taken = new Set(
    (
      await getDb()
        .select({ handle: users.handle })
        .from(users)
        .where(
          raw`${users.handle} = ${base} or ${users.handle} like ${base + "-%"}`
        )
    ).map((row) => row.handle)
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

export function refreshCatalog() {
  invalidate("problem-stats")
  invalidate("daily-pool")
}
