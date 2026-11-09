import { discussionPosts, discussionVotes, getDb, sql, users, type User } from "@workspace/db"

import * as classes from "@/features/classes/server"
import type { ClassContext } from "@/features/classes/server"
import { notify } from "@/features/notifications/server"
import { writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * A class's discussion board. Everyone in the class (students sitting in it or a group
 * inside, and its teachers) reads and posts; nobody else sees it (404). Anonymous posts
 * hide the author from classmates, never from teachers. Teachers pin, lock, hide, delete
 * and mark a reply as the answer; authors edit and delete their own.
 */

const { and, asc, count, desc, eq, gt, inArray, isNull } = sql

/** Posts one person may make in an hour, against floods. */
const POSTS_PER_HOUR = 30

type Post = typeof discussionPosts.$inferSelect

const board = classes.classContext

/** A post as this viewer may see it: author hidden from classmates when anonymous. */
function shown(
  p: Post,
  cc: ClassContext,
  viewer: User,
  names: Map<string, { name: string; teacher: boolean }>,
  votes: { postId: string; n: number }[],
  mine: Set<string>
) {
  const author = p.authorId ? names.get(p.authorId) : undefined
  const own = p.authorId === viewer.id
  const reveal = !p.anonymous || cc.teaches || own
  return {
    id: p.id,
    title: p.title,
    body: p.deleted ? "" : p.body,
    deleted: p.deleted,
    hidden: p.hidden,
    pinned: p.pinned,
    locked: p.locked,
    answerId: p.answerId,
    anonymous: p.anonymous,
    author: p.deleted ? null : reveal ? (author?.name ?? "Someone") : "Anonymous",
    byTeacher: !p.anonymous && (author?.teacher ?? false),
    own,
    createdAt: p.createdAt,
    editedAt: p.editedAt,
    activityAt: p.activityAt,
    votes: votes.find((v) => v.postId === p.id)?.n ?? 0,
    voted: mine.has(p.id),
  }
}

/** Display names, and whether each person teaches this class. */
async function namesOf(cc: ClassContext, ids: string[]) {
  const out = new Map<string, { name: string; teacher: boolean }>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out
  const rows = await getDb()
    .select({ id: users.id, name: users.name, handle: users.handle, email: users.email })
    .from(users)
    .where(inArray(users.id, unique))
  const teachers = await classes.runsClass(cc, unique)
  for (const r of rows) {
    out.set(r.id, { name: r.name ?? r.handle ?? r.email, teacher: teachers.has(r.id) })
  }
  return out
}

async function votesOn(ids: string[], userId: string) {
  if (ids.length === 0) return { votes: [], mine: new Set<string>() }
  const db = getDb()
  const [votes, mine] = await Promise.all([
    db
      .select({ postId: discussionVotes.postId, n: count() })
      .from(discussionVotes)
      .where(inArray(discussionVotes.postId, ids))
      .groupBy(discussionVotes.postId),
    db
      .select({ postId: discussionVotes.postId })
      .from(discussionVotes)
      .where(and(inArray(discussionVotes.postId, ids), eq(discussionVotes.userId, userId))),
  ])
  return { votes, mine: new Set(mine.map((m) => m.postId)) }
}

/** Hidden posts are for teachers and their author. */
const visibleTo = (cc: ClassContext, viewer: User) => (p: Post) =>
  !p.hidden || cc.teaches || p.authorId === viewer.id

export async function listThreads(slug: string, user: User, groupId: string) {
  const cc = await board(slug, user, groupId)
  const db = getDb()
  const threads = (
    await db
      .select()
      .from(discussionPosts)
      .where(and(eq(discussionPosts.groupId, groupId), isNull(discussionPosts.parentId)))
      .orderBy(desc(discussionPosts.pinned), desc(discussionPosts.activityAt))
      .limit(500)
  ).filter(visibleTo(cc, user))
  const ids = threads.map((t) => t.id)
  const replies = ids.length
    ? await db
        .select({ parentId: discussionPosts.parentId, n: count() })
        .from(discussionPosts)
        .where(
          and(
            inArray(discussionPosts.parentId, ids),
            eq(discussionPosts.deleted, false),
            cc.teaches ? undefined : eq(discussionPosts.hidden, false)
          )
        )
        .groupBy(discussionPosts.parentId)
    : []
  const [names, { votes, mine }] = await Promise.all([
    namesOf(cc, threads.flatMap((t) => (t.authorId ? [t.authorId] : []))),
    votesOn(ids, user.id),
  ])
  return {
    teacher: cc.teaches,
    threads: threads.map((t) => ({
      ...shown(t, cc, user, names, votes, mine),
      // A preview, not the whole post.
      body: t.deleted ? "" : t.body.slice(0, 200),
      replies: replies.find((r) => r.parentId === t.id)?.n ?? 0,
    })),
  }
}

async function threadIn(cc: ClassContext, viewer: User, id: string) {
  const [t] = await getDb()
    .select()
    .from(discussionPosts)
    .where(
      and(
        eq(discussionPosts.id, id),
        eq(discussionPosts.groupId, cc.groupId),
        isNull(discussionPosts.parentId)
      )
    )
  if (!t || !visibleTo(cc, viewer)(t)) throw notFound("Post not found")
  return t
}

export async function getThread(slug: string, user: User, groupId: string, id: string) {
  const cc = await board(slug, user, groupId)
  const t = await threadIn(cc, user, id)
  const replies = (
    await getDb()
      .select()
      .from(discussionPosts)
      .where(eq(discussionPosts.parentId, id))
      .orderBy(asc(discussionPosts.createdAt))
  ).filter(visibleTo(cc, user))
  const all = [t, ...replies]
  const [names, { votes, mine }] = await Promise.all([
    namesOf(cc, all.flatMap((p) => (p.authorId ? [p.authorId] : []))),
    votesOn(all.map((p) => p.id), user.id),
  ])
  return {
    teacher: cc.teaches,
    thread: shown(t, cc, user, names, votes, mine),
    replies: replies.map((r) => shown(r, cc, user, names, votes, mine)),
  }
}

async function checkRate(userId: string) {
  const [row] = await getDb()
    .select({ n: count() })
    .from(discussionPosts)
    .where(
      and(
        eq(discussionPosts.authorId, userId),
        gt(discussionPosts.createdAt, sql.sql`now() - interval '1 hour'`)
      )
    )
  if ((row?.n ?? 0) >= POSTS_PER_HOUR) {
    throw new ApiError(429, "too_many_posts", "That's a lot of posts in an hour. Try again later.")
  }
}

export async function postThread(
  slug: string,
  user: User,
  groupId: string,
  input: { title: string; body: string; anonymous: boolean }
) {
  const cc = await board(slug, user, groupId)
  await checkRate(user.id)
  const [row] = await getDb()
    .insert(discussionPosts)
    .values({
      orgId: cc.ctx.org.id,
      groupId,
      authorId: user.id,
      title: input.title,
      body: input.body,
      // Teachers always post as themselves.
      anonymous: input.anonymous && !cc.teaches,
    })
    .returning()
  return { id: row!.id }
}

export async function postReply(
  slug: string,
  user: User,
  groupId: string,
  threadId: string,
  input: { body: string; anonymous: boolean }
) {
  const cc = await board(slug, user, groupId)
  const t = await threadIn(cc, user, threadId)
  if (t.deleted) throw new ApiError(409, "deleted", "This post was deleted.")
  if (t.locked && !cc.teaches) throw new ApiError(409, "locked", "A teacher locked this thread.")
  await checkRate(user.id)
  const db = getDb()
  const [row] = await db
    .insert(discussionPosts)
    .values({
      orgId: cc.ctx.org.id,
      groupId,
      parentId: t.id,
      authorId: user.id,
      body: input.body,
      anonymous: input.anonymous && !cc.teaches,
    })
    .returning()
  await db.update(discussionPosts).set({ activityAt: new Date() }).where(eq(discussionPosts.id, t.id))
  // The thread's author hears about replies to it.
  if (t.authorId && t.authorId !== user.id) {
    await notify([t.authorId], {
      kind: "discussion_reply",
      title: `New reply to "${t.title}"`,
      body: input.body.slice(0, 140),
      href: `/orgs/${slug}/classes/${groupId}?tab=discussion&thread=${t.id}`,
    })
  }
  return { id: row!.id }
}

async function postIn(cc: ClassContext, viewer: User, id: string) {
  const [p] = await getDb()
    .select()
    .from(discussionPosts)
    .where(and(eq(discussionPosts.id, id), eq(discussionPosts.groupId, cc.groupId)))
  if (!p || !visibleTo(cc, viewer)(p)) throw notFound("Post not found")
  return p
}

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

/** An author edits their words; a teacher pins, locks, hides or marks the answer. */
export async function changePost(
  slug: string,
  user: User,
  groupId: string,
  id: string,
  input: {
    title?: string
    body?: string
    pinned?: boolean
    locked?: boolean
    hidden?: boolean
    answerId?: string | null
  }
) {
  const cc = await board(slug, user, groupId)
  const p = await postIn(cc, user, id)
  if (p.deleted) throw new ApiError(409, "deleted", "This post was deleted.")
  const set: Partial<Post> = {}
  if (input.title !== undefined || input.body !== undefined) {
    if (p.authorId !== user.id) throw forbidden("Only its author can edit a post.")
    if (input.title !== undefined && p.parentId === null) set.title = input.title
    if (input.body !== undefined) set.body = input.body
    set.editedAt = new Date()
  }
  const moderating =
    input.pinned !== undefined || input.locked !== undefined || input.hidden !== undefined || input.answerId !== undefined
  if (moderating) {
    if (!cc.teaches) throw forbidden("Teachers moderate the discussion.")
    if (input.hidden !== undefined) set.hidden = input.hidden
    if (p.parentId === null) {
      if (input.pinned !== undefined) set.pinned = input.pinned
      if (input.locked !== undefined) set.locked = input.locked
      if (input.answerId !== undefined) {
        if (input.answerId) {
          const [reply] = await getDb()
            .select({ id: discussionPosts.id })
            .from(discussionPosts)
            .where(and(eq(discussionPosts.id, input.answerId), eq(discussionPosts.parentId, p.id)))
          if (!reply) throw new ApiError(400, "not_a_reply", "The answer must be a reply in this thread.")
        }
        set.answerId = input.answerId
      }
    }
    if (input.hidden !== undefined) {
      const name = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "a class"
      await writeAudit(cc.ctx, "discussion.hide", `${input.hidden ? "Hid" : "Showed"} a post in ${name}'s discussion`)
    }
  }
  if (Object.keys(set).length === 0) return { ok: true }
  await getDb().update(discussionPosts).set(set).where(eq(discussionPosts.id, id))
  return { ok: true }
}

/**
 * Deletes a post: its author or a teacher. A thread with replies stays as "deleted" so the
 * replies keep their place; anything else goes.
 */
export async function deletePost(slug: string, user: User, groupId: string, id: string) {
  const cc = await board(slug, user, groupId)
  const p = await postIn(cc, user, id)
  if (p.authorId !== user.id && !cc.teaches) throw forbidden("Only its author or a teacher can delete a post.")
  const db = getDb()
  const [replies] = await db
    .select({ n: count() })
    .from(discussionPosts)
    .where(eq(discussionPosts.parentId, id))
  if (p.parentId === null && (replies?.n ?? 0) > 0) {
    await db.update(discussionPosts).set({ deleted: true, body: "" }).where(eq(discussionPosts.id, id))
  } else {
    await db.delete(discussionPosts).where(eq(discussionPosts.id, id))
    if (p.parentId) {
      // An answer that's gone is no longer the answer.
      await db
        .update(discussionPosts)
        .set({ answerId: null })
        .where(and(eq(discussionPosts.id, p.parentId), eq(discussionPosts.answerId, id)))
    }
  }
  if (p.authorId !== user.id) {
    const name = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "a class"
    await writeAudit(cc.ctx, "discussion.delete", `Deleted a post in ${name}'s discussion`)
  }
}

/** A +1, or taking it back. Not on your own posts. */
export async function toggleVote(slug: string, user: User, groupId: string, id: string) {
  const cc = await board(slug, user, groupId)
  const p = await postIn(cc, user, id)
  if (p.authorId === user.id) throw new ApiError(400, "own_post", "You can't vote for your own post.")
  const db = getDb()
  const removed = await db
    .delete(discussionVotes)
    .where(and(eq(discussionVotes.postId, id), eq(discussionVotes.userId, user.id)))
    .returning()
  if (removed.length === 0) await db.insert(discussionVotes).values({ postId: id, userId: user.id })
  return { voted: removed.length === 0 }
}
