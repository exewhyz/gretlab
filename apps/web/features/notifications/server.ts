import {
  attendance,
  getDb,
  guardians,
  notifications,
  orgGroups,
  organizations,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  deliveryFor,
  enabledModules,
  eventOfKind,
  readPreferences,
  type EventPolicy,
} from "@workspace/judge"
import { after } from "next/server"

import { composeEmail } from "@/features/emails/server"

import { listAssignments } from "@/features/assignments/server"
import { dueLoans } from "@/features/books/server"
import { listContests } from "@/features/contests/server"
import { getSettings } from "@/features/settings/server"
import { modulesOf } from "@/features/orgs/kinds"

import { mailEnabled } from "./mailer"
import { drainOutbox, queueEmails } from "./outbox"
import { policyFor } from "./policy"
import { orgPages } from "@/lib/paths"

/*
 * Notifications. Events (new work, feedback released, an extension, a class notice) are
 * stored when they happen, for each person they concern, and emailed through the outbox.
 * Whether an event appears in the bell, is emailed, and whether people may turn its email
 * off is decided by the platform, then the organization, then the person
 * (packages/judge/src/notifications.ts, ./policy.ts). Reminders that depend on the clock
 * (due within a day, a contest starting soon, attendance below 75%) are worked out each
 * time they're read, so they're never stale and need no scheduler.
 */

const { and, count, desc, eq, inArray, isNull } = sql

export interface NewNotification {
  kind: string
  title: string
  body?: string
  /** A path on this site. */
  href?: string
  /** The organization this happened in, whose settings apply; none for the platform's own. */
  orgId?: string | null
}

/**
 * Runs after the response, so the action that caused it isn't slowed down. On serverless
 * hosts (Vercel) a function is frozen once it has answered, and a promise left running is
 * cut off; after() keeps the function alive until it settles. Outside a request (a
 * script), there's nothing to outlive, so it just runs.
 */
function afterResponse(task: () => Promise<unknown>) {
  const run = () =>
    task().catch((error) => console.error("[notifications] after:", error))
  try {
    after(run)
  } catch {
    void run()
  }
}

async function orgName(orgId: string) {
  const [org] = await getDb()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return org?.name ?? ""
}

/** A kind this code doesn't list as an event: shown in the bell, emailed to who wants email. */
const UNLISTED: EventPolicy = { inApp: true, email: true, userChoice: true }

/**
 * Tells these people about an event, as its policy allows: a notification in the bell,
 * and an email to those the policy and their own settings give one. Both are written in
 * one transaction (the email to the outbox), so neither is stored without the other, and
 * sending starts right after the response. Never fails the action that caused it. Returns
 * how many were told each way.
 */
export async function notify(userIds: string[], n: NewNotification) {
  const told = { inApp: 0, email: 0 }
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return told
  const event = eventOfKind(n.kind)
  try {
    const policy = event ? await policyFor(event, n.orgId ?? null) : UNLISTED
    const emailing = policy.email && mailEnabled()
    if (!policy.inApp && !emailing) return told
    const site = process.env.NEXTAUTH_URL ?? ""
    // One email for everyone told: the Notification template, branded (features/emails).
    const email = emailing
      ? await composeEmail("notification", {
          title: n.title,
          body: n.body ?? "",
          link: n.href ? `${site}${n.href}` : site,
          org: n.orgId ? await orgName(n.orgId) : "",
        })
      : null
    await getDb().transaction(async (tx) => {
      if (policy.inApp) {
        await tx.insert(notifications).values(
          ids.map((userId) => ({
            userId,
            kind: n.kind,
            title: n.title.slice(0, 300),
            body: (n.body ?? "").slice(0, 2000),
            href: n.href ?? "",
          }))
        )
        told.inApp = ids.length
      }
      if (!emailing || !email) return
      const people = await tx
        .select({
          email: users.email,
          emailOn: users.emailNotifications,
          prefs: users.notificationPrefs,
        })
        .from(users)
        .where(and(inArray(users.id, ids), eq(users.disabled, false)))
      const recipients = people.filter((person) => {
        const choices = {
          emailOn: person.emailOn,
          events: readPreferences(person.prefs),
        }
        return event
          ? deliveryFor(event, policy, choices).email
          : choices.emailOn
      })
      await queueEmails(
        tx,
        recipients.map((r) => ({ to: r.email, ...email }))
      )
      told.email = recipients.length
    })
    if (told.email) afterResponse(() => drainOutbox())
  } catch (error) {
    console.error("[notifications] couldn't store:", error)
  }
  if (n.orgId && event && COPIED_TO_PARENTS.has(event)) {
    await tellParents(n.orgId, ids, (child) => ({
      kind: "child_update",
      title: `${child}: ${n.title}`,
      body: n.body,
    }))
  }
  return told
}

/** What a student is told that their parents get a copy of. */
const COPIED_TO_PARENTS = new Set<string>([
  "assignment.published",
  "feedback.released",
  "assignment.extension",
  "class.notice",
  "class.teacher_note",
  "campus.update",
])

/**
 * Tells the parents of these students (Parent accounts module, linked in this
 * organization), one notification per child, linking to that child's page. Never throws.
 */
export async function tellParents(
  orgId: string,
  studentIds: string[],
  message: (childName: string) => Omit<NewNotification, "href" | "orgId">
) {
  if (studentIds.length === 0) return
  try {
    const db = getDb()
    const [org] = await db
      .select({ slug: organizations.slug, type: organizations.type, modules: organizations.modules })
      .from(organizations)
      .where(eq(organizations.id, orgId))
    if (!org || !(await modulesOf(org)).has("parents")) return
    const rows = await db
      .select({ parentId: guardians.parentId, studentId: guardians.studentId, name: users.name, email: users.email })
      .from(guardians)
      .innerJoin(users, eq(guardians.studentId, users.id))
      .where(and(eq(guardians.orgId, orgId), inArray(guardians.studentId, studentIds)))
    const byChild = new Map<string, { name: string; parentIds: string[] }>()
    for (const r of rows) {
      const entry = byChild.get(r.studentId) ?? { name: r.name ?? r.email, parentIds: [] }
      entry.parentIds.push(r.parentId)
      byChild.set(r.studentId, entry)
    }
    for (const [studentId, child] of byChild) {
      await notify(child.parentIds, {
        ...message(child.name),
        href: orgPages(org.slug).child(studentId),
        orgId,
      })
    }
  } catch (error) {
    console.error("[notifications] couldn't tell parents:", error)
  }
}

export interface Reminder {
  id: string
  kind: "due_soon" | "contest_soon" | "attendance_low" | "library_due" | "training_due" | "event_soon"
  title: string
  body: string
  href: string
  at: string
}

const DAY_MS = 86_400_000

function inWords(ms: number) {
  const hours = Math.max(1, Math.round(ms / 3_600_000))
  return hours < 24 ? `in ${hours} h` : "tomorrow"
}

/** What's coming up for this person, worked out now. */
async function remindersFor(user: User): Promise<Reminder[]> {
  const settings = await getSettings()
  const now = Date.now()
  const out: Reminder[] = []
  if (settings["assignments.enabled"]) {
    for (const a of await listAssignments(user).catch(() => [])) {
      const left = new Date(a.dueAt).getTime() - now
      if (!a.published || a.phase !== "open" || left > DAY_MS || left <= 0)
        continue
      if (a.total > 0 && a.earned >= a.total) continue
      out.push({
        id: `due:${a.slug}`,
        kind: "due_soon",
        title: `${a.title} is due ${inWords(left)}`,
        body: `${a.solved} of ${a.problemCount} problems solved so far.`,
        href: `/assignments/${a.slug}`,
        at: new Date(a.dueAt).toISOString(),
      })
    }
  }
  if (settings["contests.enabled"]) {
    for (const c of await listContests(user).catch(() => [])) {
      const until = new Date(c.startsAt).getTime() - now
      if (c.phase !== "upcoming" || until > DAY_MS || until <= 0) continue
      out.push({
        id: `contest:${c.slug}`,
        kind: "contest_soon",
        title: `${c.title} starts ${inWords(until)}`,
        body: "Register on the contest page if you haven't.",
        href: `/contests/${c.slug}`,
        at: new Date(c.startsAt).toISOString(),
      })
    }
  }
  // Below 75% in any class with at least four marked classes.
  const rows = await getDb()
    .select({
      groupId: teachingSessions.groupId,
      group: orgGroups.name,
      orgSlug: organizations.slug,
      // Excused marks are left out of attendance figures.
      total:
        sql.sql<number>`count(*) filter (where ${attendance.status} <> 'excused')`.mapWith(
          Number
        ),
      present: sql.sql<number>`count(*) filter (where ${attendance.present})`,
    })
    .from(attendance)
    .innerJoin(teachingSessions, eq(attendance.sessionId, teachingSessions.id))
    .innerJoin(orgGroups, eq(teachingSessions.groupId, orgGroups.id))
    .innerJoin(organizations, eq(orgGroups.orgId, organizations.id))
    .where(eq(attendance.userId, user.id))
    .groupBy(teachingSessions.groupId, orgGroups.name, organizations.slug)
  for (const r of rows) {
    if (r.total < 4) continue
    const percent = Math.round((100 * Number(r.present)) / r.total)
    if (percent >= 75) continue
    out.push({
      id: `attendance:${r.groupId}`,
      kind: "attendance_low",
      title: `Your attendance in ${r.group} is ${percent}%`,
      body: "Below 75%. Talk to your teacher if something is getting in the way.",
      href: orgPages(r.orgSlug).cls(r.groupId),
      at: new Date().toISOString(),
    })
  }
  // Library books due within a day, or overdue.
  for (const loan of await dueLoans(user.id).catch(() => [])) {
    out.push({
      id: `library:${loan.id}`,
      kind: "library_due",
      title: loan.overdue
        ? `"${loan.title}" was due back on ${loan.dueOn}`
        : `"${loan.title}" is due back by ${loan.dueOn}`,
      body: "Return or renew it at the library.",
      href: orgPages(loan.slug).books,
      at: `${loan.dueOn}T00:00:00.000Z`,
    })
  }
  // Events they're going to, starting within a day.
  const { myEvents } = await import("@/features/events/server")
  for (const r of await myEvents(user, new Date()).catch(() => [])) {
    const until = r.e.startsAt.getTime() - now
    if (r.status !== "going" || until > DAY_MS || until <= 0) continue
    out.push({
      id: `event:${r.e.id}`,
      kind: "event_soon",
      title: `${r.e.title} starts ${inWords(until)}`,
      body: r.e.location || "Online: the link is on the event's page.",
      href: orgPages(r.slug).event(r.e.id),
      at: r.e.startsAt.toISOString(),
    })
  }
  // Assigned training overdue, due within a week, expired or about to (loaded here so the
  // modules don't import each other at start).
  const { trainingReminders } = await import("@/features/training/server")
  for (const t of await trainingReminders(user).catch(() => [])) {
    const renew = t.status === "expired" || t.status === "expiring"
    out.push({
      id: `training:${t.courseId}`,
      kind: "training_due",
      title: renew
        ? `${t.course}: ${t.status === "expired" ? "expired" : "renew"} by ${t.needBy}`
        : `${t.course} is ${t.status === "overdue" ? "overdue" : "due"} (${t.needBy})`,
      body: `${t.org}: ${t.progress.done} of ${t.progress.total} done.`,
      href: t.href,
      at: `${t.needBy ?? t.validUntil}T00:00:00.000Z`,
    })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export async function myNotifications(user: User) {
  const [stored, reminders, [unread]] = await Promise.all([
    getDb()
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    remindersFor(user),
    getDb()
      .select({ n: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), isNull(notifications.readAt))
      ),
  ])
  const [me] = await getDb()
    .select({ email: users.emailNotifications })
    .from(users)
    .where(eq(users.id, user.id))
  return {
    reminders,
    notifications: stored,
    unread: unread?.n ?? 0,
    email: { on: me?.email ?? true, available: mailEnabled() },
  }
}

/** Marks some, or all, as read. */
export async function markRead(user: User, ids: string[] | "all") {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        ids === "all" ? undefined : inArray(notifications.id, ids)
      )
    )
}
