import { randomBytes } from "node:crypto"

import {
  assignments,
  contestParticipants,
  getDb,
  peerReviews,
  sql,
  users,
  type User,
} from "@workspace/db"
import { buildCalendar, type CalendarEvent } from "@workspace/judge"

import { listAssignments } from "@/features/assignments/server"
import { listContests } from "@/features/contests/server"
import { getSettings } from "@/features/settings/server"
import { notFound } from "@/lib/api/route"

/*
 * A person's calendar: their assignments' due times (with their own extensions), exam
 * windows, peer reviews to write, and contests they're registered for or their
 * organizations run. The same events are offered as a private iCal feed at a secret
 * address, for Google Calendar, Outlook or Apple Calendar.
 */

const { and, eq, inArray, isNull } = sql

export interface Event {
  id: string
  kind: "due" | "exam" | "contest" | "peer_review"
  title: string
  start: string
  end: string | null
  href: string
  detail: string
  /** Finished work, for the page to show quietly. */
  done: boolean
}

export async function eventsFor(user: User): Promise<Event[]> {
  const settings = await getSettings()
  const out: Event[] = []
  const work = settings["assignments.enabled"] ? await listAssignments(user).catch(() => []) : []
  for (const a of work) {
    if (!a.published) continue
    const where = a.org ? ` · ${a.org.name}` : ""
    if (a.exam) {
      out.push({
        id: `exam-${a.slug}`,
        kind: "exam",
        title: `Exam: ${a.title}`,
        start: new Date(a.opensAt).toISOString(),
        end: new Date(a.dueAt).toISOString(),
        href: `/assignments/${a.slug}`,
        detail: `One timed sitting${where}`,
        done: a.phase === "closed",
      })
    } else {
      out.push({
        id: `due-${a.slug}`,
        kind: "due",
        title: `Due: ${a.title}`,
        start: new Date(a.dueAt).toISOString(),
        end: null,
        href: `/assignments/${a.slug}`,
        detail: `${a.problemCount ? `${a.solved} of ${a.problemCount} problems solved` : "Quiz"}${a.extended ? " · your extension" : ""}${where}`,
        done: a.total > 0 && a.earned >= a.total,
      })
    }
  }
  // Peer reviews still to write, where reviews have a due time.
  const pending = await getDb()
    .select({ slug: assignments.slug, title: assignments.title, peer: assignments.peerReview })
    .from(peerReviews)
    .innerJoin(assignments, eq(peerReviews.assignmentId, assignments.id))
    .where(and(eq(peerReviews.reviewerId, user.id), isNull(peerReviews.submittedAt)))
  for (const p of new Map(pending.map((x) => [x.slug, x])).values()) {
    if (!p.peer?.dueAt) continue
    out.push({
      id: `peer-${p.slug}`,
      kind: "peer_review",
      title: `Peer reviews due: ${p.title}`,
      start: p.peer.dueAt,
      end: null,
      href: `/assignments/${p.slug}`,
      detail: "Review your classmates' work",
      done: false,
    })
  }
  if (settings["contests.enabled"]) {
    const contests = await listContests(user).catch(() => [])
    const ids = contests.map((c) => c.id)
    const registered = ids.length
      ? new Set(
          (
            await getDb()
              .select({ id: contestParticipants.contestId })
              .from(contestParticipants)
              .where(and(eq(contestParticipants.userId, user.id), inArray(contestParticipants.contestId, ids)))
          ).map((r) => r.id)
        )
      : new Set<string>()
    for (const c of contests) {
      // The platform's open contests don't fill everyone's calendar; theirs and their colleges' do.
      if (!c.published || (!registered.has(c.id) && !c.org)) continue
      out.push({
        id: `contest-${c.slug}`,
        kind: "contest",
        title: `Contest: ${c.title}`,
        start: new Date(c.startsAt).toISOString(),
        end: new Date(c.endsAt).toISOString(),
        href: `/contests/${c.slug}`,
        detail: `${registered.has(c.id) ? "Registered" : "Not registered yet"}${c.org ? ` · ${c.org.name}` : ""}`,
        done: c.phase === "ended",
      })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

export async function myCalendar(user: User) {
  const [events, [me]] = await Promise.all([
    eventsFor(user),
    getDb().select({ token: users.calendarToken }).from(users).where(eq(users.id, user.id)),
  ])
  return { events, feed: me?.token ?? null }
}

/** Turns the feed on, or gives it a new address (the old one stops working). */
export async function rotateFeed(user: User) {
  const token = randomBytes(24).toString("base64url")
  await getDb().update(users).set({ calendarToken: token }).where(eq(users.id, user.id))
  return { feed: token }
}

export async function removeFeed(user: User) {
  await getDb().update(users).set({ calendarToken: null }).where(eq(users.id, user.id))
}

/** The feed for whoever holds this secret; blocked accounts get nothing. */
export async function feedFor(token: string, origin: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Not found")
  const [user] = await getDb().select().from(users).where(eq(users.calendarToken, token))
  if (!user || user.disabled) throw notFound("Not found")
  const events = await eventsFor(user)
  const site = (await getSettings())["site.title"] || "Gretlab"
  const items: CalendarEvent[] = events.map((e) => ({
    uid: `${e.id}@${new URL(origin).host}`,
    title: e.title,
    start: new Date(e.start),
    end: e.end ? new Date(e.end) : undefined,
    description: e.detail,
    url: origin + e.href,
  }))
  return buildCalendar(`${site}: ${user.name ?? user.email}`, items)
}
