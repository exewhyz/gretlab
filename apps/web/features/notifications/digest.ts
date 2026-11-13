import { getDb, organizations, sql, users } from "@workspace/db"
import {
  deliveryFor,
  effectivePolicy,
  readOverrides,
  readPreferences,
  weeklyDigestKey,
} from "@workspace/judge"

import { composeEmail } from "@/features/emails/server"
import { membersWhoCan } from "@/features/orgs/server"
import { getSettings } from "@/features/settings/server"

import { mailEnabled } from "./mailer"
import { queueEmails } from "./outbox"
import { platformOverrides } from "./policy"

/*
 * The weekly summary: an email each Monday morning (08:00 in the site's timezone) to the
 * people who run an organization, those who can change its settings: owners and admins.
 * A scheduler calls runDueDigests() (through /api/cron/outbox); it needn't be punctual,
 * because each organization is claimed once per week by writing that week's key
 * (`organizations.digest_week`), so two schedulers running at once still send one summary.
 * A week in which nothing happened sends nothing. The emails go through the outbox like
 * any other.
 */

const { and, eq, inArray } = sql
const EVENT = "staff.weekly_digest"

export interface WeekStats {
  newMembers: number
  waiting: number
  published: number
  dueSoon: number
  submissions: number
  activePeople: number
  notices: number
  certificates: number
}

async function statsOf(orgId: string): Promise<WeekStats> {
  const [row] = await getDb().execute<Record<keyof WeekStats, string>>(sql.sql`
    SELECT
      (SELECT count(*) FROM org_members WHERE org_id = ${orgId} AND status = 'active'
        AND created_at > now() - interval '7 days') AS "newMembers",
      (SELECT count(*) FROM org_members WHERE org_id = ${orgId} AND status = 'pending') AS "waiting",
      (SELECT count(*) FROM assignments WHERE org_id = ${orgId} AND published
        AND created_at > now() - interval '7 days') AS "published",
      (SELECT count(*) FROM assignments WHERE org_id = ${orgId} AND published
        AND due_at > now() AND due_at <= now() + interval '7 days') AS "dueSoon",
      (SELECT count(*) FROM submissions s
        JOIN org_members m ON m.user_id = s.user_id AND m.org_id = ${orgId} AND m.status = 'active'
        WHERE s.kind = 'submit' AND s.created_at > now() - interval '7 days') AS "submissions",
      (SELECT count(DISTINCT s.user_id) FROM submissions s
        JOIN org_members m ON m.user_id = s.user_id AND m.org_id = ${orgId} AND m.status = 'active'
        WHERE s.kind = 'submit' AND s.created_at > now() - interval '7 days') AS "activePeople",
      (SELECT count(*) FROM notes WHERE org_id = ${orgId}
        AND created_at > now() - interval '7 days') AS "notices",
      (SELECT count(*) FROM certificates WHERE org_id = ${orgId}
        AND issued_at > now() - interval '7 days') AS "certificates"
  `)
  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)])
  ) as unknown as WeekStats
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** The email's lines, leaving out what didn't happen; empty for a quiet week. */
export function digestLines(s: WeekStats): string[] {
  const lines: string[] = []
  if (s.waiting) {
    lines.push(
      `${count(s.waiting, "person is", "people are")} waiting for approval to join.`
    )
  }
  if (s.newMembers)
    lines.push(`${count(s.newMembers, "new member", "new members")} joined.`)
  if (s.published) {
    lines.push(
      `${count(s.published, "assignment or exam was", "assignments or exams were")} published.`
    )
  }
  if (s.submissions) {
    lines.push(
      `${count(s.submissions, "solution was", "solutions were")} submitted by ${count(s.activePeople, "person", "people")}.`
    )
  }
  if (s.notices)
    lines.push(`${count(s.notices, "notice was", "notices were")} posted.`)
  if (s.certificates) {
    lines.push(
      `${count(s.certificates, "certificate was", "certificates were")} issued.`
    )
  }
  if (s.dueSoon) {
    lines.push(
      `${count(s.dueSoon, "assignment is", "assignments are")} due in the next 7 days.`
    )
  }
  return lines
}

/** Sends the summaries that are due, up to `limit` organizations a run. */
export async function runDueDigests(limit = 25) {
  const done = { organizations: 0, emails: 0 }
  if (!mailEnabled()) return done
  const db = getDb()
  const [settings, platform] = await Promise.all([
    getSettings(),
    platformOverrides(),
  ])
  if (!effectivePolicy(EVENT, platform, null).email) return done
  const week = weeklyDigestKey(new Date(), settings["site.timezone"])
  const due = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      notifications: organizations.notifications,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.active, true),
        sql.sql`${organizations.digestWeek} IS DISTINCT FROM ${week}`
      )
    )
    .limit(limit)
  const site = process.env.NEXTAUTH_URL ?? ""
  for (const org of due) {
    // Whoever writes the week first sends it; anyone else finds nothing to claim.
    const claimed = await db
      .update(organizations)
      .set({ digestWeek: week })
      .where(
        and(
          eq(organizations.id, org.id),
          sql.sql`${organizations.digestWeek} IS DISTINCT FROM ${week}`
        )
      )
      .returning({ id: organizations.id })
    if (claimed.length === 0) continue
    const policy = effectivePolicy(
      EVENT,
      platform,
      readOverrides(org.notifications)
    )
    if (!policy.email) continue
    const lines = digestLines(await statsOf(org.id))
    if (lines.length === 0) continue
    const ids = await membersWhoCan(org.id, "org.settings.manage")
    if (ids.length === 0) continue
    const people = await db
      .select({
        email: users.email,
        emailOn: users.emailNotifications,
        prefs: users.notificationPrefs,
      })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.disabled, false)))
    const recipients = people.filter(
      (p) =>
        deliveryFor(EVENT, policy, {
          emailOn: p.emailOn,
          events: readPreferences(p.prefs),
        }).email
    )
    if (recipients.length === 0) continue
    const email = await composeEmail("digest.weekly", {
      org: org.name,
      lines: lines.map((line) => `- ${line}`).join("\n"),
      reportsLink: `${site}/orgs/${org.slug}/manage/reports`,
    })
    await queueEmails(
      db,
      recipients.map((r) => ({ to: r.email, ...email }))
    )
    done.organizations++
    done.emails += recipients.length
  }
  return done
}
