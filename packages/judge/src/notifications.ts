import { z } from "zod"

/*
 * Who hears about what, and who decides. Every notification belongs to an event below.
 * Three levels control an event, each only able to narrow the one above it:
 *
 *   platform      what the whole site allows                (Dashboard › Notifications)
 *   organization  what one organization allows, within that (Manage › Notifications)
 *   person        whether they want the email               (their notification settings)
 *
 * For each event a level sets three switches: `inApp` (it appears in the bell), `email`
 * (it may be emailed) and `userChoice` (people may turn its email off or on for
 * themselves; without it, the email goes to everyone it concerns). A switch is on only if
 * every level above has it on, so what the platform turns off an organization can't use.
 */

export type NotificationAudience = "students" | "parents" | "staff" | "everyone"

export interface EventDefinition {
  label: string
  description: string
  audience: NotificationAudience
  /** The `kind` values stored on notifications of this event. */
  kinds: readonly string[]
  /** Whether people who haven't chosen get the email. */
  emailByDefault: boolean
  /** Sent by email only: nothing appears in the bell. */
  emailOnly?: boolean
}

export const NOTIFICATION_EVENTS = {
  "assignment.published": {
    label: "New assignment or exam",
    description: "Work is published to a class.",
    audience: "students",
    kinds: ["new_assignment", "new_exam"],
    emailByDefault: true,
  },
  "feedback.released": {
    label: "Marks and feedback",
    description:
      "A teacher marks answers or a project, comments on code, or releases results.",
    audience: "students",
    kinds: ["marks", "comment", "feedback", "project_marked", "results"],
    emailByDefault: true,
  },
  "assignment.extension": {
    label: "More time",
    description: "A teacher gives a student more time on an assignment.",
    audience: "students",
    kinds: ["extension"],
    emailByDefault: true,
  },
  "class.notice": {
    label: "Class notice",
    description: "A teacher posts a notice to a class.",
    audience: "students",
    kinds: ["notice"],
    emailByDefault: true,
  },
  "class.teacher_note": {
    label: "A note from a teacher",
    description: "A teacher writes to students who are falling behind.",
    audience: "students",
    kinds: ["teacher_note"],
    emailByDefault: true,
  },
  "training.reminder": {
    label: "Training reminder",
    description: "Someone is reminded to finish or renew training assigned to them.",
    audience: "students",
    kinds: ["training_due"],
    emailByDefault: true,
  },
  "certificate.issued": {
    label: "Certificate",
    description: "A student earns a certificate.",
    audience: "students",
    kinds: ["certificate"],
    emailByDefault: true,
  },
  "peer.review": {
    label: "Peer review",
    description:
      "A student is asked to review classmates' work, or their work is reviewed.",
    audience: "students",
    kinds: ["peer_review", "peer_review_received"],
    emailByDefault: true,
  },
  "discussion.reply": {
    label: "Reply in a discussion",
    description:
      "Someone replies to a question a person asked in a class discussion.",
    audience: "everyone",
    kinds: ["discussion_reply"],
    emailByDefault: true,
  },
  "campus.update": {
    label: "Bus and hostel",
    description: "Someone is put on a bus route and stop, or given a hostel bed, or it changes.",
    audience: "students",
    kinds: ["transport", "hostel"],
    emailByDefault: true,
  },
  "parent.updates": {
    label: "Your child's notices and marks",
    description:
      "Parents get a copy of what their child is told: class notices, new work, marks and teachers' notes; and a note when they're linked to a child.",
    audience: "parents",
    kinds: ["child_update", "parent_linked"],
    emailByDefault: true,
  },
  "parent.absence": {
    label: "Absent from class",
    description: "Parents hear the same day when their child is marked absent.",
    audience: "parents",
    kinds: ["child_absent"],
    emailByDefault: true,
  },
  "staff.assignment_published": {
    label: "A colleague published work",
    description:
      "The other teachers of a class get a copy when an assignment or exam is published to it.",
    audience: "staff",
    kinds: ["staff_assignment_published"],
    emailByDefault: false,
  },
  "admission.new": {
    label: "New application",
    description: "Someone applies for admission.",
    audience: "staff",
    kinds: ["admission_new"],
    emailByDefault: true,
  },
  "admission.update": {
    label: "Your application",
    description: "An application you made for admission is reviewed, waitlisted, decided or admitted.",
    audience: "everyone",
    kinds: ["admission_update"],
    emailByDefault: true,
  },
  "leave.request": {
    label: "Leave to decide",
    description: "Someone you approve leave for asks for it.",
    audience: "staff",
    kinds: ["leave_request"],
    emailByDefault: true,
  },
  "leave.decision": {
    label: "Leave decided",
    description: "Leave you asked for is approved or refused.",
    audience: "everyone",
    kinds: ["leave_decision"],
    emailByDefault: true,
  },
  "staff.join_request": {
    label: "Request to join",
    description:
      "Someone asks to join the organization and waits for approval.",
    audience: "staff",
    kinds: ["join_request"],
    emailByDefault: true,
  },
  "staff.weekly_digest": {
    label: "Weekly summary",
    description:
      "An email each Monday to the organization's owners and admins: new members, work set and handed in, what's due.",
    audience: "staff",
    kinds: ["weekly_digest"],
    emailByDefault: true,
    emailOnly: true,
  },
} as const satisfies Record<string, EventDefinition>

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS
export const NOTIFICATION_EVENT_KEYS = Object.keys(
  NOTIFICATION_EVENTS
) as NotificationEvent[]

const EVENT_OF_KIND = new Map<string, NotificationEvent>(
  NOTIFICATION_EVENT_KEYS.flatMap((event) =>
    NOTIFICATION_EVENTS[event].kinds.map((kind) => [kind, event] as const)
  )
)

/** The event a stored notification's `kind` belongs to, or null for one unknown here. */
export const eventOfKind = (kind: string) => EVENT_OF_KIND.get(kind) ?? null

export interface EventPolicy {
  inApp: boolean
  email: boolean
  userChoice: boolean
}

/** What a level has changed from "everything on"; only the differences are stored. */
export type PolicyOverrides = Partial<
  Record<NotificationEvent, Partial<EventPolicy>>
>

const switches = z
  .object({
    inApp: z.boolean(),
    email: z.boolean(),
    userChoice: z.boolean(),
  })
  .partial()
  .strict()

/** Validates what a dashboard saves: known events only, known switches only. */
export const policyOverridesSchema: z.ZodType<PolicyOverrides> = z
  .object(
    Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((event) => [event, switches.optional()])
    )
  )
  .strict()

/** Anything stored that isn't a valid set of overrides counts as none. */
export function readOverrides(stored: unknown): PolicyOverrides {
  const parsed = policyOverridesSchema.safeParse(stored ?? {})
  return parsed.success ? parsed.data : {}
}

const FIELDS = ["inApp", "email", "userChoice"] as const

/** One level's own switches: on unless that level turned them off. */
export function levelPolicy(
  overrides: PolicyOverrides,
  event: NotificationEvent
): EventPolicy {
  const own = overrides[event] ?? {}
  return {
    inApp: own.inApp ?? true,
    email: own.email ?? true,
    userChoice: own.userChoice ?? true,
  }
}

export interface EffectivePolicy extends EventPolicy {
  /** Switches the platform has off, which an organization therefore can't turn on. */
  lockedByPlatform: { inApp: boolean; email: boolean; userChoice: boolean }
}

/**
 * What applies to an event: the platform's switches narrowed by the organization's.
 * `org` is null for something that isn't an organization's (the platform's own work).
 */
export function effectivePolicy(
  event: NotificationEvent,
  platform: PolicyOverrides,
  org: PolicyOverrides | null
): EffectivePolicy {
  const top = levelPolicy(platform, event)
  const own = org
    ? levelPolicy(org, event)
    : { inApp: true, email: true, userChoice: true }
  const result = { lockedByPlatform: {} } as EffectivePolicy
  for (const field of FIELDS) {
    result[field] = top[field] && own[field]
    result.lockedByPlatform[field] = !top[field]
  }
  const definition: EventDefinition = NOTIFICATION_EVENTS[event]
  if (definition.emailOnly) result.inApp = false
  return result
}

/** A person's own choices: `emailOn` is their one switch for all email. */
export interface PersonPreferences {
  emailOn: boolean
  /** Per event, where they chose; missing means the event's default. */
  events: Partial<Record<NotificationEvent, boolean>>
}

export const personPreferencesSchema = z
  .object(
    Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((event) => [event, z.boolean().optional()])
    )
  )
  .strict() as z.ZodType<PersonPreferences["events"]>

export function readPreferences(stored: unknown): PersonPreferences["events"] {
  const parsed = personPreferencesSchema.safeParse(stored ?? {})
  return parsed.success ? parsed.data : {}
}

/** Whether a person wants an event's email, when the choice is theirs. */
export function wantsEmail(
  event: NotificationEvent,
  person: PersonPreferences
) {
  if (!person.emailOn) return false
  return person.events[event] ?? NOTIFICATION_EVENTS[event].emailByDefault
}

/** What one person gets for an event under the policy that applies. */
export function deliveryFor(
  event: NotificationEvent,
  policy: EventPolicy,
  person: PersonPreferences
) {
  return {
    inApp: policy.inApp,
    // Without the choice, the email goes to everyone it concerns.
    email:
      policy.email && (policy.userChoice ? wantsEmail(event, person) : true),
  }
}

/* ---------- the weekly summary ---------- */

const DIGEST_WEEKDAY = 1 // Monday
const DIGEST_HOUR = 8

/**
 * The week a summary is due for, as that week's Monday (YYYY-MM-DD) in the site's
 * timezone: the latest Monday whose 08:00 has passed. Each organization gets one summary
 * per key, so it goes out once, on Monday morning or as soon after as a scheduler runs.
 */
export function weeklyDigestKey(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  )
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday ?? ""
  )
  let back = (weekday - DIGEST_WEEKDAY + 7) % 7
  if (back === 0 && Number(parts.hour) < DIGEST_HOUR) back = 7
  // Calendar arithmetic on the local date, done in UTC so no offset can shift it.
  const local = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  )
  local.setUTCDate(local.getUTCDate() - back)
  return local.toISOString().slice(0, 10)
}
