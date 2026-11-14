import {
  eventRsvps,
  getDb,
  groupMembers,
  orgEvents,
  sql,
  users,
  type OrgEvent,
  type User,
} from "@workspace/db"
import { eventProblem, KINDS, placeFor, promote } from "@workspace/judge"
import { z } from "zod"

import { notify } from "@/features/notifications/server"
import { canFor, groupChain, needFor, orgContext, writeAudit, type OrgContext } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"
import { orgPages } from "@/lib/paths"

/*
 * Events (the "events" module; communities have it from the start): meetups, workshops
 * and talks for everyone or one group (and the groups inside it), in person or online.
 * People say they're going; past the capacity they wait, and the longest waiting move up
 * when places free (packages/judge/src/events.ts). An online link shows only to people
 * going and to those who run it. Places are given under a row lock on the event, so two
 * people can't take the last one.
 */

const { and, asc, desc, eq, gte, inArray, lt } = sql

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a title").max(200),
    description: z.string().trim().max(5000).default(""),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    location: z.string().trim().max(300).default(""),
    link: z.union([z.literal(""), z.url({ protocol: /^https?$/, message: "Use a web address" })]).default(""),
    capacity: z.number().int().min(1).max(100_000).nullable().default(null),
    groupId: z.uuid().nullable().default(null),
  })
  .refine((e) => e.location || e.link, { message: "Say where it is, or give its online link", path: ["location"] })

export const rsvpSchema = z.object({ going: z.boolean() })

type EventInput = z.infer<typeof eventSchema>

function needEvents(ctx: OrgContext) {
  if (!ctx.modules.has("events")) throw notFound("Events aren't on here")
}

const runs = (ctx: OrgContext, e: { groupId: string | null }) =>
  canFor(ctx, "events.manage", e.groupId ? [[e.groupId]] : [])

async function seatsOf(ctx: OrgContext, userId: string) {
  if (!ctx.groups.length) return []
  return (
    await getDb()
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, ctx.groups.map((g) => g.id))))
  ).map((s) => s.groupId)
}

/** Whether this person may see an event: it's for everyone, or for a group they're in. */
function sees(ctx: OrgContext, seats: string[], e: { groupId: string | null }) {
  if (runs(ctx, e)) return true
  if (ctx.membership?.status !== "active") return false
  return e.groupId === null || seats.some((s) => groupChain(ctx, s).includes(e.groupId!))
}

async function eventIn(ctx: OrgContext, id: string) {
  const [e] = await getDb()
    .select()
    .from(orgEvents)
    .where(and(eq(orgEvents.id, id), eq(orgEvents.orgId, ctx.org.id)))
  if (!e) throw notFound("Event not found")
  return e
}

async function counts(ids: string[]) {
  if (!ids.length) return []
  return getDb()
    .select({
      eventId: eventRsvps.eventId,
      going: sql.sql<number>`count(*) filter (where ${eventRsvps.status} = 'going')`.mapWith(Number),
      waiting: sql.sql<number>`count(*) filter (where ${eventRsvps.status} = 'waitlist')`.mapWith(Number),
    })
    .from(eventRsvps)
    .where(inArray(eventRsvps.eventId, ids))
    .groupBy(eventRsvps.eventId)
}

function view(
  ctx: OrgContext,
  e: OrgEvent,
  n: { going: number; waiting: number } | undefined,
  mine: "going" | "waitlist" | "not_going" | null
) {
  const manage = runs(ctx, e)
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    location: e.location,
    online: Boolean(e.link),
    // The link is for people coming, and those running it.
    link: mine === "going" || manage ? e.link || null : null,
    capacity: e.capacity,
    group: e.groupId ? { id: e.groupId, name: ctx.groups.find((g) => g.id === e.groupId)?.name ?? "?" } : null,
    going: n?.going ?? 0,
    waiting: n?.waiting ?? 0,
    full: e.capacity != null && (n?.going ?? 0) >= e.capacity,
    cancelled: e.cancelledAt !== null,
    mine,
    canManage: manage,
  }
}

/** Upcoming events this person may see (or past ones, newest first), with their answer. */
export async function listEvents(slug: string, user: User, when: "upcoming" | "past" = "upcoming") {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  const now = new Date()
  const rows = await getDb()
    .select()
    .from(orgEvents)
    .where(
      and(
        eq(orgEvents.orgId, ctx.org.id),
        when === "upcoming" ? gte(orgEvents.endsAt, now) : lt(orgEvents.endsAt, now)
      )
    )
    .orderBy(when === "upcoming" ? asc(orgEvents.startsAt) : desc(orgEvents.startsAt))
    .limit(200)
  const seats = await seatsOf(ctx, user.id)
  const shown = rows.filter((e) => sees(ctx, seats, e))
  const ids = shown.map((e) => e.id)
  const [n, mine] = await Promise.all([
    counts(ids),
    ids.length
      ? getDb()
          .select({ eventId: eventRsvps.eventId, status: eventRsvps.status })
          .from(eventRsvps)
          .where(and(eq(eventRsvps.userId, user.id), inArray(eventRsvps.eventId, ids)))
      : [],
  ])
  const creatable = [
    ...(canFor(ctx, "events.manage", []) ? [null] : []),
    ...ctx.groups.filter((g) => canFor(ctx, "events.manage", [[g.id]])).map((g) => g.id),
  ]
  return {
    terms: KINDS[ctx.org.type].terms,
    noun: KINDS[ctx.org.type].noun,
    events: shown.map((e) =>
      view(
        ctx,
        e,
        n.find((c) => c.eventId === e.id),
        mine.find((m) => m.eventId === e.id)?.status ?? null
      )
    ),
    canCreate: creatable.length > 0,
    /** Who an event can be for: everyone (null) and groups this person runs events in. */
    audiences: creatable.map((id) =>
      id === null
        ? { id: null, name: `Everyone in the ${KINDS[ctx.org.type].noun}` }
        : { id, name: ctx.groups.find((g) => g.id === id)!.name }
    ),
  }
}

function checkTimes(input: { startsAt: Date; endsAt: Date }, creating: boolean) {
  const problem = eventProblem(input.startsAt, input.endsAt)
  if (problem) throw new ApiError(400, "bad_times", problem)
  if (creating && input.endsAt < new Date()) throw new ApiError(400, "past", "That's already over.")
}

export async function createEvent(slug: string, user: User, input: EventInput) {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  if (input.groupId && !ctx.groups.some((g) => g.id === input.groupId)) throw notFound("Group not found")
  needFor(ctx, "events.manage", input.groupId ? [[input.groupId]] : [])
  checkTimes(input, true)
  const [e] = await getDb()
    .insert(orgEvents)
    .values({ ...input, orgId: ctx.org.id, createdBy: user.id })
    .returning()
  await writeAudit(ctx, "event.create", `Created the event ${e!.title}`)
  return view(ctx, e!, undefined, null)
}

/** Changes an event. A larger capacity moves people up from the waitlist. */
export async function updateEvent(slug: string, user: User, id: string, input: EventInput) {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  const before = await eventIn(ctx, id)
  if (!runs(ctx, before)) throw notFound("Event not found")
  if (input.groupId !== before.groupId) {
    if (input.groupId && !ctx.groups.some((g) => g.id === input.groupId)) throw notFound("Group not found")
    needFor(ctx, "events.manage", input.groupId ? [[input.groupId]] : [])
  }
  if (before.cancelledAt) throw new ApiError(409, "cancelled", "This event was cancelled.")
  checkTimes(input, false)
  const moved = await getDb().transaction(async (tx) => {
    await tx.select({ id: orgEvents.id }).from(orgEvents).where(eq(orgEvents.id, id)).for("update")
    await tx.update(orgEvents).set(input).where(eq(orgEvents.id, id))
    return fillPlaces(tx, id, input.capacity)
  })
  await toldOfPlace(ctx, before, moved)
  const timesChanged = before.startsAt.getTime() !== input.startsAt.getTime() || before.location !== input.location
  if (timesChanged) await tell(ctx, id, `${input.title} has changed`, "Check its new time and place.")
  await writeAudit(ctx, "event.update", `Changed the event ${input.title}`)
  return eventDetail(slug, user, id)
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]

/** Moves the longest waiting into free places; returns who moved up. */
async function fillPlaces(tx: Tx, id: string, capacity: number | null) {
  const rows = await tx
    .select({ userId: eventRsvps.userId, status: eventRsvps.status, at: eventRsvps.at })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, id))
  const up = promote(
    capacity,
    rows.filter((r) => r.status === "going").length,
    rows.filter((r) => r.status === "waitlist")
  )
  if (up.length)
    await tx
      .update(eventRsvps)
      .set({ status: "going" })
      .where(and(eq(eventRsvps.eventId, id), inArray(eventRsvps.userId, up)))
  return up
}

async function toldOfPlace(ctx: OrgContext, e: OrgEvent, userIds: string[]) {
  if (!userIds.length) return
  await notify(userIds, {
    kind: "event_place",
    title: `You've got a place: ${e.title}`,
    body: "A place came free and you were next on the waitlist.",
    href: orgPages(ctx.org.slug).event(e.id),
    orgId: ctx.org.id,
  })
}

/** Tells everyone going or waiting. */
async function tell(ctx: OrgContext, id: string, title: string, body: string) {
  const people = await getDb()
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, id), inArray(eventRsvps.status, ["going", "waitlist"])))
  await notify(
    people.map((p) => p.userId),
    { kind: "event_update", title, body, href: orgPages(ctx.org.slug).event(id), orgId: ctx.org.id }
  )
}

/** Cancels an event, telling everyone going or waiting. It stays listed, marked cancelled. */
export async function cancelEvent(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  const e = await eventIn(ctx, id)
  if (!runs(ctx, e)) throw notFound("Event not found")
  if (e.cancelledAt) return
  await getDb().update(orgEvents).set({ cancelledAt: new Date() }).where(eq(orgEvents.id, id))
  await tell(ctx, id, `Cancelled: ${e.title}`, "The event won't go ahead.")
  await writeAudit(ctx, "event.cancel", `Cancelled the event ${e.title}`)
}

/** Going, or not: a place if there's one, else the waitlist; dropping out frees a place. */
export async function rsvp(slug: string, user: User, id: string, going: boolean) {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  const e = await eventIn(ctx, id)
  if (!sees(ctx, await seatsOf(ctx, user.id), e) || ctx.membership?.status !== "active")
    throw notFound("Event not found")
  if (e.cancelledAt) throw new ApiError(409, "cancelled", "This event was cancelled.")
  if (e.endsAt < new Date()) throw new ApiError(409, "over", "This event is over.")
  const moved = await getDb().transaction(async (tx) => {
    // One at a time per event, so the last place goes to one person.
    await tx.select({ id: orgEvents.id }).from(orgEvents).where(eq(orgEvents.id, id)).for("update")
    const [had] = await tx
      .select({ status: eventRsvps.status })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, user.id)))
    if (going) {
      if (had?.status === "going" || had?.status === "waitlist") return []
      const [n] = await tx
        .select({ going: sql.count() })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.status, "going")))
      const status = placeFor(e.capacity, Number(n?.going ?? 0))
      await tx
        .insert(eventRsvps)
        .values({ eventId: id, userId: user.id, status, at: new Date() })
        .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status, at: new Date() } })
      return []
    }
    await tx
      .insert(eventRsvps)
      .values({ eventId: id, userId: user.id, status: "not_going" })
      .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status: "not_going" } })
    return had?.status === "going" ? fillPlaces(tx, id, e.capacity) : []
  })
  await toldOfPlace(ctx, e, moved)
  return eventDetail(slug, user, id)
}

/** One event; for those who run it, who's going and who's waiting. */
export async function eventDetail(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needEvents(ctx)
  const e = await eventIn(ctx, id)
  if (!sees(ctx, await seatsOf(ctx, user.id), e)) throw notFound("Event not found")
  const [n, [mine]] = await Promise.all([
    counts([id]),
    getDb()
      .select({ status: eventRsvps.status })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, user.id))),
  ])
  const base = view(ctx, e, n[0], mine?.status ?? null)
  const people = base.canManage
    ? await getDb()
        .select({ name: users.name, email: users.email, status: eventRsvps.status, at: eventRsvps.at })
        .from(eventRsvps)
        .innerJoin(users, eq(eventRsvps.userId, users.id))
        .where(and(eq(eventRsvps.eventId, id), inArray(eventRsvps.status, ["going", "waitlist"])))
        .orderBy(asc(eventRsvps.at))
    : null
  return {
    ...base,
    people: people?.map((p) => ({ name: p.name ?? p.email, email: p.email, status: p.status })) ?? null,
  }
}

/** Events someone is going to or waiting for, in every organization: their calendar and bell. */
export async function myEvents(user: User, from: Date) {
  return getDb()
    .select({ e: orgEvents, status: eventRsvps.status, slug: sql.sql<string>`(select slug from organizations where id = ${orgEvents.orgId})` })
    .from(eventRsvps)
    .innerJoin(orgEvents, eq(eventRsvps.eventId, orgEvents.id))
    .where(
      and(
        eq(eventRsvps.userId, user.id),
        inArray(eventRsvps.status, ["going", "waitlist"]),
        gte(orgEvents.endsAt, from),
        sql.isNull(orgEvents.cancelledAt)
      )
    )
    .orderBy(asc(orgEvents.startsAt))
}

/** For a home: the next few events this person may see here. */
export async function homeEvents(ctx: OrgContext, user: User) {
  if (!ctx.modules.has("events")) return null
  const rows = await getDb()
    .select()
    .from(orgEvents)
    .where(and(eq(orgEvents.orgId, ctx.org.id), gte(orgEvents.endsAt, new Date()), sql.isNull(orgEvents.cancelledAt)))
    .orderBy(asc(orgEvents.startsAt))
    .limit(50)
  const seats = await seatsOf(ctx, user.id)
  const shown = rows.filter((e) => sees(ctx, seats, e)).slice(0, 4)
  const ids = shown.map((e) => e.id)
  const [n, mine] = await Promise.all([
    counts(ids),
    ids.length
      ? getDb()
          .select({ eventId: eventRsvps.eventId, status: eventRsvps.status })
          .from(eventRsvps)
          .where(and(eq(eventRsvps.userId, user.id), inArray(eventRsvps.eventId, ids)))
      : [],
  ])
  return shown.map((e) =>
    view(ctx, e, n.find((c) => c.eventId === e.id), mine.find((m) => m.eventId === e.id)?.status ?? null)
  )
}
