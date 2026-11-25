/**
 * Solution posts (the owner's decisions, 25 November 2026): on public library problems only,
 * someone who has solved a problem shares one of their accepted submissions with a write-up.
 * Posts open on the same terms as the editorial: once solved (or for everyone when the platform
 * lets editorials open before solving), never while a contest uses the problem or during an exam.
 * Votes are +1 and not on your own; readers report posts, and platform staff with "Moderate
 * solution posts" hide them (logged).
 */
import {
  getDb,
  problems,
  solutionComments,
  solutionPosts,
  solutionReports,
  solutionVotes,
  sql,
  submissions,
  users,
  type User,
} from "@workspace/db"
import { z } from "zod"

import { guardExamSolutions } from "@/features/exams/server"
import { notify } from "@/features/notifications/server"
import { platformCan } from "@/features/platform/access"
import { writePlatformAudit } from "@/features/platform/staff"
import { isInLiveContest, isPublicProblem } from "@/features/problems/server"
import { slugIs } from "@/features/problems/slugs"
import { getSettings, requireFeature } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"

const { and, count, desc, eq, gte, inArray, sql: raw } = sql

const POSTS_PER_DAY = 10
const COMMENTS_PER_HOUR = 60

export const postSchema = z.object({
  title: z.string().trim().min(3, "Give it a title").max(120),
  body: z
    .string()
    .trim()
    .min(20, "Say how it works, in a few sentences at least")
    .max(20_000),
  /** One of the author's accepted submissions for this problem: the code shown. */
  submissionId: z.uuid(),
})

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
})

const moderates = (user: User) =>
  platformCan(user, "platform.solutions.moderate")

async function solvedBy(userId: string, problemId: string) {
  const [row] = await getDb()
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, userId),
        eq(submissions.problemId, problemId),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC")
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * A public library problem and what this person may do with its posts. Anything else (drafts,
 * members-only, assessment problems) has none: not found.
 */
async function access(slug: string, user: User) {
  await requireFeature("solutions.posts")
  const [problem] = await getDb()
    .select({ id: problems.id, slug: problems.slug, title: problems.title })
    .from(problems)
    .where(and(slugIs(slug), isPublicProblem))
  if (!problem) throw notFound("Problem not found")
  const moderator = await moderates(user)
  if (!moderator) {
    await guardExamSolutions(user.id)
    if (await isInLiveContest(problem.id))
      throw new ApiError(
        403,
        "contest_running",
        "Hidden while a contest uses this problem."
      )
  }
  const [solved, settings] = await Promise.all([
    solvedBy(user.id, problem.id),
    getSettings(),
  ])
  const openToAll =
    settings["practice.show_solutions"] &&
    !settings["practice.solutions_after_solve"]
  return {
    problem,
    solved,
    moderator,
    canRead: moderator || solved || openToAll,
  }
}

async function postAccess(postId: string, user: User) {
  const [post] = await getDb()
    .select({ post: solutionPosts, slug: problems.slug })
    .from(solutionPosts)
    .innerJoin(problems, eq(solutionPosts.problemId, problems.id))
    .where(eq(solutionPosts.id, postId))
  if (!post) throw notFound("Post not found")
  const a = await access(post.slug, user)
  const visible =
    !post.post.hidden || a.moderator || post.post.authorId === user.id
  if (!a.canRead || !visible) throw notFound("Post not found")
  return { ...a, post: post.post }
}

/** A problem's posts for this person: the list once they may read, else just how many. */
export async function listPosts(
  slug: string,
  user: User,
  sort: "votes" | "new" = "votes"
) {
  const a = await access(slug, user)
  const db = getDb()
  const where = and(
    eq(solutionPosts.problemId, a.problem.id),
    a.moderator
      ? undefined
      : raw`(${solutionPosts.hidden} = false or ${solutionPosts.authorId} = ${user.id})`
  )
  if (!a.canRead) {
    const [row] = await db
      .select({ total: count() })
      .from(solutionPosts)
      .where(and(where, eq(solutionPosts.hidden, false)))
    return {
      canRead: false,
      canWrite: false,
      count: row?.total ?? 0,
      posts: [],
      mine: null,
    }
  }
  const rows = await db
    .select({
      id: solutionPosts.id,
      title: solutionPosts.title,
      language: solutionPosts.language,
      votes: solutionPosts.votes,
      reports: solutionPosts.reports,
      hidden: solutionPosts.hidden,
      createdAt: solutionPosts.createdAt,
      authorId: solutionPosts.authorId,
      author: users.name,
      handle: users.handle,
      comments: raw<number>`(select count(*)::int from ${solutionComments} c where c.post_id = ${solutionPosts.id} and not c.hidden)`,
    })
    .from(solutionPosts)
    .innerJoin(users, eq(solutionPosts.authorId, users.id))
    .where(where)
    .orderBy(
      ...(sort === "new"
        ? [desc(solutionPosts.createdAt)]
        : [desc(solutionPosts.votes), desc(solutionPosts.createdAt)])
    )
    .limit(100)
  const voted = rows.length
    ? new Set(
        (
          await db
            .select({ postId: solutionVotes.postId })
            .from(solutionVotes)
            .where(
              and(
                eq(solutionVotes.userId, user.id),
                inArray(
                  solutionVotes.postId,
                  rows.map((r) => r.id)
                )
              )
            )
        ).map((v) => v.postId)
      )
    : new Set<string>()
  return {
    canRead: true,
    canWrite: a.solved,
    count: rows.length,
    mine: rows.find((r) => r.authorId === user.id)?.id ?? null,
    posts: rows.map(({ authorId, reports, ...r }) => ({
      ...r,
      author: r.author ?? "Student",
      own: authorId === user.id,
      voted: voted.has(r.id),
      // Only moderators see how often a post was reported.
      reports: a.moderator ? reports : undefined,
    })),
  }
}

/** One post with its code and comments. */
export async function getPost(postId: string, user: User) {
  const a = await postAccess(postId, user)
  const db = getDb()
  const [author, comments, [vote]] = await Promise.all([
    db
      .select({ name: users.name, handle: users.handle })
      .from(users)
      .where(eq(users.id, a.post.authorId)),
    db
      .select({
        id: solutionComments.id,
        body: solutionComments.body,
        hidden: solutionComments.hidden,
        createdAt: solutionComments.createdAt,
        authorId: solutionComments.authorId,
        author: users.name,
      })
      .from(solutionComments)
      .innerJoin(users, eq(solutionComments.authorId, users.id))
      .where(
        and(
          eq(solutionComments.postId, postId),
          a.moderator
            ? undefined
            : raw`(${solutionComments.hidden} = false or ${solutionComments.authorId} = ${user.id})`
        )
      )
      .orderBy(solutionComments.createdAt),
    db
      .select({ postId: solutionVotes.postId })
      .from(solutionVotes)
      .where(
        and(eq(solutionVotes.postId, postId), eq(solutionVotes.userId, user.id))
      ),
  ])
  const { reports, authorId, submissionId: _s, ...post } = a.post
  return {
    ...post,
    author: author[0]?.name ?? "Student",
    handle: author[0]?.handle ?? null,
    own: authorId === user.id,
    voted: Boolean(vote),
    reports: a.moderator ? reports : undefined,
    canModerate: a.moderator,
    comments: comments.map(({ authorId: by, ...c }) => ({
      ...c,
      author: c.author ?? "Student",
      own: by === user.id,
    })),
  }
}

/** The author's accepted submissions for the problem, newest first, to share one of. */
export async function myAccepted(slug: string, user: User) {
  const a = await access(slug, user)
  if (!a.solved) return []
  return getDb()
    .selectDistinctOn([submissions.language], {
      id: submissions.id,
      language: submissions.language,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, user.id),
        eq(submissions.problemId, a.problem.id),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC")
      )
    )
    .orderBy(submissions.language, desc(submissions.createdAt))
}

/** Writes or rewrites the author's one post on a problem, with code from an accepted submission. */
export async function savePost(
  slug: string,
  user: User,
  input: z.infer<typeof postSchema>
) {
  const a = await access(slug, user)
  if (!a.solved)
    throw new ApiError(
      403,
      "solve_first",
      "Solve this problem first to share your solution."
    )
  const db = getDb()
  const [sub] = await db
    .select({ language: submissions.language, files: submissions.files })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.userId, user.id),
        eq(submissions.problemId, a.problem.id),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC")
      )
    )
  if (!sub)
    throw new ApiError(
      400,
      "not_accepted",
      "Choose one of your accepted submissions for this problem."
    )
  const [existing] = await db
    .select({ id: solutionPosts.id })
    .from(solutionPosts)
    .where(
      and(
        eq(solutionPosts.problemId, a.problem.id),
        eq(solutionPosts.authorId, user.id)
      )
    )
  if (!existing) {
    const [recent] = await db
      .select({ total: count() })
      .from(solutionPosts)
      .where(
        and(
          eq(solutionPosts.authorId, user.id),
          gte(solutionPosts.createdAt, raw`now() - interval '1 day'`)
        )
      )
    if ((recent?.total ?? 0) >= POSTS_PER_DAY)
      throw new ApiError(
        429,
        "too_many_posts",
        `At most ${POSTS_PER_DAY} new posts a day.`
      )
  }
  const values = {
    title: input.title,
    body: input.body,
    language: sub.language,
    code: sub.files.map((f) => f.content).join("\n"),
    submissionId: input.submissionId,
  }
  const [saved] = existing
    ? await db
        .update(solutionPosts)
        .set(values)
        .where(eq(solutionPosts.id, existing.id))
        .returning({ id: solutionPosts.id })
    : await db
        .insert(solutionPosts)
        .values({ ...values, problemId: a.problem.id, authorId: user.id })
        .returning({ id: solutionPosts.id })
  return { id: saved!.id }
}

export async function deletePost(postId: string, user: User) {
  const a = await postAccess(postId, user)
  if (a.post.authorId !== user.id)
    throw new ApiError(403, "forbidden", "Only its author can delete a post.")
  await getDb().delete(solutionPosts).where(eq(solutionPosts.id, postId))
}

/** +1 or take it back; never on your own post. */
export async function votePost(postId: string, user: User, on: boolean) {
  const a = await postAccess(postId, user)
  if (a.post.authorId === user.id)
    throw new ApiError(400, "own_post", "You can't vote on your own post.")
  const db = getDb()
  return db.transaction(async (tx) => {
    const changed = on
      ? await tx
          .insert(solutionVotes)
          .values({ postId, userId: user.id })
          .onConflictDoNothing()
          .returning()
      : await tx
          .delete(solutionVotes)
          .where(
            and(
              eq(solutionVotes.postId, postId),
              eq(solutionVotes.userId, user.id)
            )
          )
          .returning()
    const [post] = changed.length
      ? await tx
          .update(solutionPosts)
          .set({ votes: raw`${solutionPosts.votes} + ${on ? 1 : -1}` })
          .where(eq(solutionPosts.id, postId))
          .returning({ votes: solutionPosts.votes })
      : await tx
          .select({ votes: solutionPosts.votes })
          .from(solutionPosts)
          .where(eq(solutionPosts.id, postId))
    return { votes: post!.votes, voted: on }
  })
}

/** Reports a post to the moderators, once per person. */
export async function reportPost(postId: string, user: User) {
  const a = await postAccess(postId, user)
  if (a.post.authorId === user.id)
    throw new ApiError(400, "own_post", "You can't report your own post.")
  const db = getDb()
  await db.transaction(async (tx) => {
    const added = await tx
      .insert(solutionReports)
      .values({ postId, userId: user.id })
      .onConflictDoNothing()
      .returning()
    if (added.length)
      await tx
        .update(solutionPosts)
        .set({ reports: raw`${solutionPosts.reports} + 1` })
        .where(eq(solutionPosts.id, postId))
  })
}

/** A comment on a post; its author is told. */
export async function commentOn(
  postId: string,
  user: User,
  input: z.infer<typeof commentSchema>
) {
  const a = await postAccess(postId, user)
  const db = getDb()
  const [recent] = await db
    .select({ total: count() })
    .from(solutionComments)
    .where(
      and(
        eq(solutionComments.authorId, user.id),
        gte(solutionComments.createdAt, raw`now() - interval '1 hour'`)
      )
    )
  if ((recent?.total ?? 0) >= COMMENTS_PER_HOUR)
    throw new ApiError(
      429,
      "too_many_comments",
      `At most ${COMMENTS_PER_HOUR} comments an hour.`
    )
  const [saved] = await db
    .insert(solutionComments)
    .values({ postId, authorId: user.id, body: input.body })
    .returning({ id: solutionComments.id })
  if (a.post.authorId !== user.id)
    await notify([a.post.authorId], {
      kind: "solution_comment",
      title: `New comment on your solution "${a.post.title}"`,
      body: input.body.slice(0, 200),
      href: `/problems/${a.problem.slug}?tab=solutions&post=${postId}`,
    }).catch(() => {})
  return { id: saved!.id }
}

export async function deleteComment(commentId: string, user: User) {
  const deleted = await getDb()
    .delete(solutionComments)
    .where(
      and(
        eq(solutionComments.id, commentId),
        eq(solutionComments.authorId, user.id)
      )
    )
    .returning({ id: solutionComments.id })
  if (!deleted.length) throw notFound("Comment not found")
}

/* ---------- moderation (platform.solutions.moderate) ---------- */

/** Posts for moderators: reported ones first, then the newest. */
export async function moderationList(filter: "reported" | "hidden" | "recent") {
  const rows = await getDb()
    .select({
      id: solutionPosts.id,
      title: solutionPosts.title,
      reports: solutionPosts.reports,
      hidden: solutionPosts.hidden,
      votes: solutionPosts.votes,
      createdAt: solutionPosts.createdAt,
      author: users.name,
      email: users.email,
      problem: problems.title,
      problemSlug: problems.slug,
    })
    .from(solutionPosts)
    .innerJoin(users, eq(solutionPosts.authorId, users.id))
    .innerJoin(problems, eq(solutionPosts.problemId, problems.id))
    .where(
      filter === "reported"
        ? raw`${solutionPosts.reports} > 0`
        : filter === "hidden"
          ? eq(solutionPosts.hidden, true)
          : undefined
    )
    .orderBy(
      ...(filter === "reported" ? [desc(solutionPosts.reports)] : []),
      desc(solutionPosts.createdAt)
    )
    .limit(200)
  return rows
}

/** Hides or shows a post or a comment. Logged on the platform's activity log. */
export async function moderate(
  actor: User,
  input: { kind: "post" | "comment"; id: string; hidden: boolean }
) {
  const db = getDb()
  const table = input.kind === "post" ? solutionPosts : solutionComments
  const [row] = await db
    .update(table)
    .set({ hidden: input.hidden })
    .where(eq(table.id, input.id))
    .returning({ id: table.id })
  if (!row) throw notFound("Not found")
  await writePlatformAudit(
    actor,
    input.hidden ? "solution.hide" : "solution.show",
    `${input.hidden ? "Hid" : "Showed again"} a solution ${input.kind}`,
    { [input.kind]: input.id }
  )
}

export const moderateSchema = z.object({
  kind: z.enum(["post", "comment"]),
  id: z.uuid(),
  hidden: z.boolean(),
})
