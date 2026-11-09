import {
  attendance,
  getDb,
  notifications,
  orgGroups,
  organizations,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"

import { listAssignments } from "@/features/assignments/server"
import { listContests } from "@/features/contests/server"
import { getSettings } from "@/features/settings/server"

import { sendMail } from "./mail"

/*
 * Notifications. Events (new work, feedback released, an extension, a class notice) are
 * stored when they happen, for each person they concern, and emailed when the server has
 * SMTP set up and the person hasn't turned email off. Reminders that depend on the clock
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
}

/** Tells these people. Never fails the action that caused it. */
export async function notify(userIds: string[], n: NewNotification) {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return
  try {
    await getDb()
      .insert(notifications)
      .values(
        ids.map((userId) => ({
          userId,
          kind: n.kind,
          title: n.title.slice(0, 300),
          body: (n.body ?? "").slice(0, 2000),
          href: n.href ?? "",
        }))
      )
    void emailThem(ids, n)
  } catch (error) {
    console.error("[notifications] couldn't store:", error)
  }
}

async function emailThem(userIds: string[], n: NewNotification) {
  try {
    const recipients = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          inArray(users.id, userIds),
          eq(users.emailNotifications, true),
          eq(users.disabled, false)
        )
      )
    const site = process.env.NEXTAUTH_URL ?? ""
    for (const { email } of recipients) {
      await sendMail({
        to: email,
        subject: n.title,
        text: [n.body, n.href ? `${site}${n.href}` : ""]
          .filter(Boolean)
          .join("\n\n"),
      })
    }
  } catch (error) {
    console.error("[notifications] email failed:", error)
  }
}

export interface Reminder {
  id: string
  kind: "due_soon" | "contest_soon" | "attendance_low"
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
      if (!a.published || a.phase !== "open" || left > DAY_MS || left <= 0) continue
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
      total: count(),
      present: sql.sql<number>`count(*) filter (where ${attendance.present})`,
    })
    .from(attendance)
    .innerJoin(teachingSessions, eq(attendance.sessionId, teachingSessions.id))
    .innerJoin(orgGroups, eq(teachingSessions.groupId, orgGroups.id))
    .innerJoin(organizations, eq(orgGroups.orgId, organizations.id))
    .where(eq(attendance.userId, user.id))
    .groupBy(teachingSessions.groupId, orgGroups.name, organizations.slug)
  for (const r of rows) {
    const percent = Math.round((100 * Number(r.present)) / r.total)
    if (r.total < 4 || percent >= 75) continue
    out.push({
      id: `attendance:${r.groupId}`,
      kind: "attendance_low",
      title: `Your attendance in ${r.group} is ${percent}%`,
      body: "Below 75%. Talk to your teacher if something is getting in the way.",
      href: `/orgs/${r.orgSlug}/classes/${r.groupId}`,
      at: new Date().toISOString(),
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
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  ])
  const [me] = await getDb()
    .select({ email: users.emailNotifications })
    .from(users)
    .where(eq(users.id, user.id))
  return {
    reminders,
    notifications: stored,
    unread: unread?.n ?? 0,
    email: { on: me?.email ?? true, available: Boolean(process.env.SMTP_URL) },
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

export async function setEmailNotifications(user: User, on: boolean) {
  await getDb()
    .update(users)
    .set({ emailNotifications: on })
    .where(eq(users.id, user.id))
}
