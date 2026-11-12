import {
  getDb,
  organizations,
  orgMembers,
  settings as settingsTable,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  effectivePolicy,
  levelPolicy,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  readOverrides,
  readPreferences,
  wantsEmail,
  type EventDefinition,
  type EventPolicy,
  type NotificationEvent,
  type PolicyOverrides,
} from "@workspace/judge"

import { needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { writePlatformAudit } from "@/features/platform/staff"
import { isParent } from "@/features/parents/server"
import { teachesAnywhere } from "@/features/teaching/server"

import { mailEnabled } from "./mailer"
import {
  compactOverrides,
  forgetPlatformPolicy,
  orgOverrides,
  PLATFORM_POLICY_KEY,
  platformOverrides,
} from "./policy"

/*
 * Saving who hears about what, and the views the three dashboards show: the platform's
 * (Dashboard › Notifications), an organization's (Manage › Notifications) and a person's own
 * settings. The rules are in packages/judge/src/notifications.ts.
 */

const { and, eq } = sql

const definition = (event: NotificationEvent): EventDefinition =>
  NOTIFICATION_EVENTS[event]

export interface PolicyRow {
  event: NotificationEvent
  label: string
  description: string
  audience: EventDefinition["audience"]
  emailOnly: boolean
  /** This level's own switches. */
  own: EventPolicy
  /** Switches the level above has off, which this one can't turn on. */
  locked: EventPolicy
}

function rows(
  own: PolicyOverrides,
  above: PolicyOverrides | null
): PolicyRow[] {
  return NOTIFICATION_EVENT_KEYS.map((event) => {
    const top = above ? levelPolicy(above, event) : null
    return {
      event,
      label: definition(event).label,
      description: definition(event).description,
      audience: definition(event).audience,
      emailOnly: definition(event).emailOnly ?? false,
      own: levelPolicy(own, event),
      locked: {
        inApp: top ? !top.inApp : false,
        email: top ? !top.email : false,
        userChoice: top ? !top.userChoice : false,
      },
    }
  })
}

/** Dashboard › Notifications. `mail` says whether this server can send email at all. */
export async function platformPolicyView() {
  return { mail: mailEnabled(), events: rows(await platformOverrides(), null) }
}

export async function savePlatformPolicy(user: User, input: PolicyOverrides) {
  const value = compactOverrides(input)
  await getDb()
    .insert(settingsTable)
    .values({ key: PLATFORM_POLICY_KEY, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
  forgetPlatformPolicy()
  await writePlatformAudit(
    user,
    "notifications.update",
    "Changed which notifications the platform allows",
    { off: value }
  )
  return platformPolicyView()
}

/** Changing who is told what is an organization-wide setting. */
async function settingsContext(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.notifications.manage", [])
  return ctx
}

/** Manage › Notifications. */
export async function orgPolicyView(slug: string, user: User) {
  const ctx = await settingsContext(slug, user)
  const [platform, own] = await Promise.all([
    platformOverrides(),
    orgOverrides(ctx.org.id),
  ])
  return { mail: mailEnabled(), events: rows(own, platform) }
}

export async function saveOrgPolicy(
  slug: string,
  user: User,
  input: PolicyOverrides
) {
  const ctx = await settingsContext(slug, user)
  const value = compactOverrides(input)
  await getDb()
    .update(organizations)
    .set({ notifications: value })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "notifications.update",
    "Changed which notifications the organization sends",
    { off: value }
  )
  return orgPolicyView(slug, user)
}

/* ---------- a person's own settings ---------- */

export interface PreferenceRow {
  event: NotificationEvent
  label: string
  description: string
  audience: EventDefinition["audience"]
  /** Whether they get this event's email, by their choice or its default. */
  on: boolean
  /** Whether the choice is theirs anywhere. */
  canChoose: boolean
  /** Organizations that send it to everyone, whatever they choose. */
  alwaysIn: string[]
  /** Organizations (or "Gretlab") that don't email it at all. */
  offIn: string[]
}

/** Their notification settings: one row per event that can concern them. */
export async function myPreferences(user: User) {
  const db = getDb()
  const [[me], memberships, platform, staff, parent] = await Promise.all([
    db
      .select({
        emailOn: users.emailNotifications,
        prefs: users.notificationPrefs,
      })
      .from(users)
      .where(eq(users.id, user.id)),
    db
      .select({ name: organizations.name, value: organizations.notifications })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(
          eq(orgMembers.userId, user.id),
          eq(orgMembers.status, "active"),
          eq(organizations.active, true)
        )
      ),
    platformOverrides(),
    teachesAnywhere(user),
    isParent(user.id),
  ])
  const person = {
    emailOn: me?.emailOn ?? true,
    events: readPreferences(me?.prefs),
  }
  const isStaff = staff || user.role !== "student"
  const events: PreferenceRow[] = NOTIFICATION_EVENT_KEYS.filter(
    (event) =>
      (definition(event).audience !== "staff" || isStaff) &&
      (definition(event).audience !== "parents" || parent)
  ).map((event) => {
    const site = effectivePolicy(event, platform, null)
    const inOrgs = memberships.map((m) => ({
      name: m.name,
      policy: effectivePolicy(event, platform, readOverrides(m.value)),
    }))
    return {
      event,
      label: definition(event).label,
      description: definition(event).description,
      audience: definition(event).audience,
      on: wantsEmail(event, { ...person, emailOn: true }),
      canChoose:
        site.email &&
        site.userChoice &&
        (inOrgs.length === 0 ||
          inOrgs.some((o) => o.policy.email && o.policy.userChoice)),
      alwaysIn: !site.email
        ? []
        : !site.userChoice
          ? ["Gretlab"]
          : inOrgs
              .filter((o) => o.policy.email && !o.policy.userChoice)
              .map((o) => o.name),
      offIn: !site.email
        ? ["Gretlab"]
        : inOrgs.filter((o) => !o.policy.email).map((o) => o.name),
    }
  })
  return { mail: mailEnabled(), emailOn: person.emailOn, events }
}

export async function saveMyPreferences(
  user: User,
  input: {
    emailOn?: boolean
    events?: Partial<Record<NotificationEvent, boolean>>
  }
) {
  const [me] = await getDb()
    .select({ prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, user.id))
  await getDb()
    .update(users)
    .set({
      ...(input.emailOn === undefined
        ? {}
        : { emailNotifications: input.emailOn }),
      ...(input.events
        ? {
            notificationPrefs: {
              ...readPreferences(me?.prefs),
              ...input.events,
            },
          }
        : {}),
    })
    .where(eq(users.id, user.id))
}
