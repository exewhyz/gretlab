import { randomBytes } from "node:crypto"

import {
  assignments,
  contestParticipants,
  examPapers,
  getDb,
  groupMembers,
  guardians,
  leaveRequests,
  orgGroups,
  peerReviews,
  subjects,
  sql,
  termExams,
  users,
  type User,
} from "@workspace/db"
import { buildCalendar, type CalendarEvent } from "@workspace/judge"

import { listAssignments } from "@/features/assignments/server"
import { listContests } from "@/features/contests/server"
import { myEvents } from "@/features/events/server"
import { holidaysBetween } from "@/features/holidays/server"
import { myOrganizations, orgContext } from "@/features/orgs/server"
import { myTraining } from "@/features/training/server"
import { getSettings } from "@/features/settings/server"
import { notFound } from "@/lib/api/route"

/*
 * A person's calendar: their assignments' due times (with their own extensions), exam
 * windows, peer reviews to write, and contests they're registered for or their
 * organizations run. The same events are offered as a private iCal feed at a secret
 * address, for Google Calendar, Outlook or Apple Calendar.
 */

const { and, eq, gte, inArray, isNotNull, isNull } = sql

export interface Event {
  id: string
  kind:
    | "due"
    | "exam"
    | "contest"
    | "peer_review"
    | "event"
    | "holiday"
    | "paper"
    | "leave"
    | "training"
    | "run"
  title: string
  start: string
  end: string | null
  href: string
  detail: string
  /** Finished work, for the page to show quietly. */
  done: boolean
  /** A whole day (or days): no time to show, and the date is the same everywhere. */
  allDay?: boolean
}

export async function eventsFor(user: User): Promise<Event[]> {
  const settings = await getSettings()
  const out: Event[] = []
  const work = settings["assignments.enabled"]
    ? await listAssignments(user).catch(() => [])
    : []
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
    .select({
      slug: assignments.slug,
      title: assignments.title,
      peer: assignments.peerReview,
    })
    .from(peerReviews)
    .innerJoin(assignments, eq(peerReviews.assignmentId, assignments.id))
    .where(
      and(eq(peerReviews.reviewerId, user.id), isNull(peerReviews.submittedAt))
    )
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
              .where(
                and(
                  eq(contestParticipants.userId, user.id),
                  inArray(contestParticipants.contestId, ids)
                )
              )
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
  // Events they're going to or waiting for (the last month's too, so the week view has them).
  for (const r of await myEvents(
    user,
    new Date(Date.now() - 30 * 86_400_000)
  ).catch(() => [])) {
    out.push({
      id: `event-${r.e.id}`,
      kind: "event",
      title: r.e.title,
      start: r.e.startsAt.toISOString(),
      end: r.e.endsAt.toISOString(),
      href: `/orgs/${r.slug}/events/${r.e.id}`,
      detail: `${r.status === "waitlist" ? "On the waitlist" : "Going"}${r.e.location ? ` · ${r.e.location}` : r.e.link ? " · Online" : ""}`,
      done: r.e.endsAt < new Date(),
    })
  }
  out.push(...(await orgDates(user).catch(() => [])))
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

/** A whole day ("YYYY-MM-DD") as the calendar's start or end. */
const allDay = (day: string, end = false) =>
  `${day}T${end ? "23:59:59" : "00:00:00"}.000Z`

/**
 * What the organizations someone belongs to put on their calendar: the days they're closed,
 * exam papers in the classes they (or their children) sit, their own leave, training due,
 * and the runs of cohorts they're in. From two months back to a year ahead.
 */
async function orgDates(user: User): Promise<Event[]> {
  const orgs = (await myOrganizations(user)).filter(
    (o) => o.status === "active"
  )
  if (orgs.length === 0) return []
  const db = getDb()
  const now = Date.now()
  const from = new Date(now - 60 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(now + 365 * 86_400_000).toISOString().slice(0, 10)
  const today = new Date(now).toISOString().slice(0, 10)
  const out: Event[] = []
  for (const o of orgs) {
    const ctx = await orgContext(o.slug, user).catch(() => null)
    if (!ctx) continue
    const base = `/orgs/${o.slug}`
    const where = orgs.length > 1 ? ` · ${o.name}` : ""

    for (const h of await holidaysBetween([ctx.org.id], from, to)) {
      out.push({
        id: `holiday-${h.id}`,
        kind: "holiday",
        allDay: true,
        title: `Holiday: ${h.name}`,
        start: allDay(h.startsOn),
        end: allDay(h.endsOn, true),
        href: base,
        detail: `Closed${where}`,
        done: h.endsOn < today,
      })
    }

    // Classes they sit in, and their children's.
    const kids = await db
      .select({ id: guardians.studentId, name: users.name })
      .from(guardians)
      .innerJoin(users, eq(guardians.studentId, users.id))
      .where(
        and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, user.id))
      )
    const people = [{ id: user.id, name: null as string | null }, ...kids]
    const seats = ctx.groups.length
      ? await db
          .select({
            userId: groupMembers.userId,
            groupId: groupMembers.groupId,
          })
          .from(groupMembers)
          .where(
            and(
              inArray(
                groupMembers.userId,
                people.map((p) => p.id)
              ),
              inArray(
                groupMembers.groupId,
                ctx.groups.map((g) => g.id)
              )
            )
          )
      : []
    const groupIds = [...new Set(seats.map((x) => x.groupId))]

    if (ctx.modules.has("exams") && groupIds.length) {
      const papers = await db
        .select({
          id: examPapers.id,
          groupId: examPapers.groupId,
          heldOn: examPapers.heldOn,
          subject: subjects.name,
          exam: termExams.name,
        })
        .from(examPapers)
        .innerJoin(subjects, eq(examPapers.subjectId, subjects.id))
        .innerJoin(termExams, eq(examPapers.examId, termExams.id))
        .where(
          and(
            inArray(examPapers.groupId, groupIds),
            isNotNull(examPapers.heldOn)
          )
        )
      for (const p of papers) {
        if (!p.heldOn || p.heldOn < from || p.heldOn > to) continue
        const whose = people
          .filter(
            (x) =>
              x.name &&
              seats.some((s) => s.userId === x.id && s.groupId === p.groupId)
          )
          .map((x) => x.name)
        out.push({
          id: `paper-${p.id}`,
          kind: "paper",
          allDay: true,
          title: `${p.subject} paper${whose.length ? ` (${whose.join(", ")})` : ""}`,
          start: allDay(p.heldOn),
          end: null,
          href: base,
          detail: `${p.exam}${where}`,
          done: p.heldOn < today,
        })
      }
    }

    if (ctx.modules.has("leave")) {
      const leave = await db
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.orgId, ctx.org.id),
            inArray(
              leaveRequests.userId,
              people.map((p) => p.id)
            ),
            inArray(leaveRequests.status, ["approved", "pending"]),
            gte(leaveRequests.endsOn, from)
          )
        )
      for (const l of leave) {
        const who = people.find((p) => p.id === l.userId)?.name
        out.push({
          id: `leave-${l.id}`,
          kind: "leave",
          allDay: true,
          title: `${who ? `${who} on leave` : "On leave"}${l.status === "pending" ? " (waiting)" : ""}`,
          start: allDay(l.startsOn),
          end: allDay(l.endsOn, true),
          href: `${base}/leave`,
          detail: `${l.reason || "Leave"}${where}`,
          done: l.endsOn < today,
        })
      }
    }

    for (const t of (await myTraining(ctx, user).catch(() => null)) ?? []) {
      if (!t.needBy || t.status === "done") continue
      out.push({
        id: `training-${o.slug}-${t.courseId}`,
        kind: "training",
        allDay: true,
        title: `Training: ${t.course}`,
        start: allDay(t.needBy),
        end: null,
        href: t.href,
        detail: `${t.progress.done} of ${t.progress.total} done${where}`,
        done: false,
      })
    }

    // Runs with dates (a cohort's weeks) that they're in.
    const runs = groupIds.length
      ? await db
          .select({
            id: orgGroups.id,
            name: orgGroups.name,
            startsOn: orgGroups.startsOn,
            endsOn: orgGroups.endsOn,
          })
          .from(orgGroups)
          .where(
            and(
              inArray(orgGroups.id, [
                ...new Set(groupIds.flatMap((g) => groupChainIds(ctx, g))),
              ]),
              isNotNull(orgGroups.startsOn)
            )
          )
      : []
    for (const r of runs) {
      if (!r.startsOn || !r.endsOn || r.endsOn < from) continue
      out.push({
        id: `run-${r.id}`,
        kind: "run",
        allDay: true,
        title: r.name,
        start: allDay(r.startsOn),
        end: allDay(r.endsOn, true),
        href: base,
        detail: `Runs ${r.startsOn} to ${r.endsOn}${where}`,
        done: r.endsOn < today,
      })
    }
  }
  return out
}

/** A group and every group above it. */
function groupChainIds(
  ctx: { groups: { id: string; parentId: string | null }[] },
  id: string
): string[] {
  const out: string[] = []
  for (
    let g: string | null = id;
    g;
    g = ctx.groups.find((x) => x.id === g)?.parentId ?? null
  )
    out.push(g)
  return out
}

export async function myCalendar(user: User) {
  const [events, [me]] = await Promise.all([
    eventsFor(user),
    getDb()
      .select({ token: users.calendarToken })
      .from(users)
      .where(eq(users.id, user.id)),
  ])
  return { events, feed: me?.token ?? null }
}

/** Turns the feed on, or gives it a new address (the old one stops working). */
export async function rotateFeed(user: User) {
  const token = randomBytes(24).toString("base64url")
  await getDb()
    .update(users)
    .set({ calendarToken: token })
    .where(eq(users.id, user.id))
  return { feed: token }
}

export async function removeFeed(user: User) {
  await getDb()
    .update(users)
    .set({ calendarToken: null })
    .where(eq(users.id, user.id))
}

/** The feed for whoever holds this secret; blocked accounts get nothing. */
export async function feedFor(token: string, origin: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Not found")
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.calendarToken, token))
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
