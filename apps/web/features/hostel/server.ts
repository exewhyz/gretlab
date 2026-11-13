import {
  getDb,
  hostelBeds,
  hostelResidents,
  hostelRooms,
  hostels,
  orgMembers,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  bedLabels,
  bedsToRemove,
  enabledModules,
  roomRun,
} from "@workspace/judge"
import { z } from "zod"

import {
  anyGroupGrant,
  covers,
  pathName,
  studentsWithGroups,
} from "@/features/campus/people"
import { today } from "@/features/catalog/server"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * The Hostel module: hostels (`hostels`: who it's for, warden), rooms (`hostel_rooms`),
 * lettered beds (`hostel_beds`) and residents (`hostel_residents`: one bed per person per
 * organization, one person per bed, enforced by unique indexes). "Set hostels, rooms and
 * beds" (`hostel.rooms`) is organization-wide; "Allot beds" (`hostel.allot`) is scoped to the
 * residents' groups. A resident is told when they're given a bed, moved or moved out (event
 * `campus.update`, copied to their parents). Rules in packages/judge/src/hostel.ts.
 */

const { and, asc, count, eq, ilike, inArray, or } = sql

export const hostelSchema = z.object({
  name: z.string().trim().min(1, "Name the hostel").max(80),
  forWhom: z.string().trim().max(40).default(""),
  warden: z.string().trim().max(80).default(""),
  wardenPhone: z.string().trim().max(30).default(""),
})

export const roomsSchema = z.object({
  prefix: z.string().max(20).default(""),
  from: z.number().int().min(0).max(100_000),
  to: z.number().int().min(0).max(100_000),
  floor: z.string().trim().max(20).default(""),
  beds: z.number().int().min(1).max(40),
})

export const roomSchema = z.object({
  name: z.string().trim().min(1).max(40),
  floor: z.string().trim().max(20).default(""),
  beds: z.number().int().min(1).max(40),
})

export const allotSchema = z.object({ userId: z.uuid(), bedId: z.uuid() })

export const residentsImportSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase(),
        hostel: z.string().trim(),
        room: z.string().trim(),
        bed: z.string().trim().toUpperCase().default(""),
      })
    )
    .min(1)
    .max(3000),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("hostel")) {
    throw notFound("Hostels aren't switched on for this organization.")
  }
}

const mayRooms = (ctx: OrgContext) => canFor(ctx, "hostel.rooms", [])

function needRooms(ctx: OrgContext) {
  if (!mayRooms(ctx))
    throw forbidden("Setting hostels and rooms isn't part of your role.")
}

const uuidOr404 = (id: string, what: string) => {
  if (!z.uuid().safeParse(id).success) throw notFound(`${what} not found`)
}

async function hostelOf(ctx: OrgContext, id: string) {
  uuidOr404(id, "Hostel")
  const [h] = await getDb()
    .select()
    .from(hostels)
    .where(and(eq(hostels.id, id), eq(hostels.orgId, ctx.org.id)))
  if (!h) throw notFound("Hostel not found")
  return h
}

async function roomOf(ctx: OrgContext, id: string) {
  uuidOr404(id, "Room")
  const [row] = await getDb()
    .select({ room: hostelRooms, hostel: hostels })
    .from(hostelRooms)
    .innerJoin(hostels, eq(hostelRooms.hostelId, hostels.id))
    .where(and(eq(hostelRooms.id, id), eq(hostels.orgId, ctx.org.id)))
  if (!row) throw notFound("Room not found")
  return row
}

/** Manage › Hostel: hostels with their numbers, and what this person may do. */
export async function hostelSetup(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    rooms: mayRooms(ctx),
    allot: anyGroupGrant(ctx, "hostel.allot"),
  }
  if (!can.rooms && !can.allot)
    throw forbidden("Running hostels isn't part of your role.")
  const db = getDb()
  const list = await db
    .select()
    .from(hostels)
    .where(eq(hostels.orgId, ctx.org.id))
    .orderBy(asc(hostels.name))
  const ids = list.map((h) => h.id)
  const counts = ids.length
    ? await db
        .select({
          hostelId: hostelRooms.hostelId,
          rooms: sql.sql<number>`count(distinct ${hostelRooms.id})`.mapWith(
            Number
          ),
          beds: sql.sql<number>`count(${hostelBeds.id})`.mapWith(Number),
          taken: sql.sql<number>`count(${hostelResidents.userId})`.mapWith(
            Number
          ),
        })
        .from(hostelRooms)
        .leftJoin(hostelBeds, eq(hostelBeds.roomId, hostelRooms.id))
        .leftJoin(hostelResidents, eq(hostelResidents.bedId, hostelBeds.id))
        .where(inArray(hostelRooms.hostelId, ids))
        .groupBy(hostelRooms.hostelId)
    : []
  return {
    can,
    hostels: list.map((h) => {
      const c = counts.find((x) => x.hostelId === h.id)
      return {
        id: h.id,
        name: h.name,
        forWhom: h.forWhom,
        warden: h.warden,
        wardenPhone: h.wardenPhone,
        rooms: c?.rooms ?? 0,
        beds: c?.beds ?? 0,
        taken: c?.taken ?? 0,
      }
    }),
  }
}

async function nameFree(ctx: OrgContext, name: string, except?: string) {
  const [clash] = await getDb()
    .select({ id: hostels.id })
    .from(hostels)
    .where(and(eq(hostels.orgId, ctx.org.id), ilike(hostels.name, name)))
  if (clash && clash.id !== except) {
    throw new ApiError(
      409,
      "duplicate",
      `There's already a hostel called ${name}.`
    )
  }
}

export async function addHostel(
  slug: string,
  user: User,
  input: z.infer<typeof hostelSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  await nameFree(ctx, input.name)
  const [h] = await getDb()
    .insert(hostels)
    .values({ ...input, orgId: ctx.org.id })
    .returning()
  await writeAudit(ctx, "hostel.add", `Added the ${input.name} hostel`)
  return h
}

export async function updateHostel(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof hostelSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  await hostelOf(ctx, id)
  await nameFree(ctx, input.name, id)
  await getDb().update(hostels).set(input).where(eq(hostels.id, id))
  await writeAudit(ctx, "hostel.edit", `Changed the ${input.name} hostel`)
  return { saved: true }
}

/** How many people sleep in these rooms. */
async function residentsIn(roomIds: string[]) {
  if (roomIds.length === 0) return 0
  const [row] = await getDb()
    .select({ n: count() })
    .from(hostelResidents)
    .innerJoin(hostelBeds, eq(hostelResidents.bedId, hostelBeds.id))
    .where(inArray(hostelBeds.roomId, roomIds))
  return Number(row?.n ?? 0)
}

export async function deleteHostel(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  const h = await hostelOf(ctx, id)
  const rooms = await getDb()
    .select({ id: hostelRooms.id })
    .from(hostelRooms)
    .where(eq(hostelRooms.hostelId, id))
  if (await residentsIn(rooms.map((r) => r.id))) {
    throw new ApiError(
      400,
      "occupied",
      "People still live here. Move them out first."
    )
  }
  await getDb().delete(hostels).where(eq(hostels.id, id))
  await writeAudit(ctx, "hostel.delete", `Removed the ${h.name} hostel`)
  return { deleted: true }
}

/** A hostel's rooms and beds, with who's in each bed (named where this person may see). */
export async function hostelRoomsList(
  slug: string,
  user: User,
  hostelId: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const h = await hostelOf(ctx, hostelId)
  const all = mayRooms(ctx)
  if (!all && !anyGroupGrant(ctx, "hostel.allot"))
    throw forbidden("Running hostels isn't part of your role.")
  const db = getDb()
  const rooms = await db
    .select()
    .from(hostelRooms)
    .where(eq(hostelRooms.hostelId, h.id))
    .orderBy(asc(hostelRooms.floor), asc(hostelRooms.name))
  const roomIds = rooms.map((r) => r.id)
  const beds = roomIds.length
    ? await db
        .select({
          id: hostelBeds.id,
          roomId: hostelBeds.roomId,
          label: hostelBeds.label,
          userId: hostelResidents.userId,
        })
        .from(hostelBeds)
        .leftJoin(hostelResidents, eq(hostelResidents.bedId, hostelBeds.id))
        .where(inArray(hostelBeds.roomId, roomIds))
        .orderBy(asc(hostelBeds.label))
    : []
  const people = new Map(
    (
      await studentsWithGroups(
        ctx,
        beds.flatMap((b) => (b.userId ? [b.userId] : []))
      )
    ).map((p) => [p.id, p])
  )
  return {
    hostel: { id: h.id, name: h.name },
    rooms: rooms
      .sort(
        (a, b) =>
          a.floor.localeCompare(b.floor, undefined, { numeric: true }) ||
          a.name.localeCompare(b.name, undefined, { numeric: true })
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        floor: r.floor,
        beds: beds
          .filter((b) => b.roomId === r.id)
          .sort(
            (a, b) =>
              a.label.length - b.label.length || a.label.localeCompare(b.label)
          )
          .map((b) => {
            const p = b.userId ? people.get(b.userId) : undefined
            const shown = p && (all || covers(ctx, "hostel.allot", p.groupIds))
            return {
              id: b.id,
              label: b.label,
              taken: Boolean(b.userId),
              resident: shown
                ? {
                    id: p.id,
                    name: p.name ?? p.email,
                    classes: p.groupIds.map((g) => pathName(ctx, g)),
                    canChange: covers(ctx, "hostel.allot", p.groupIds),
                  }
                : null,
            }
          }),
      })),
  }
}

/** Adds a run of rooms (A-101 to A-120), each with this many beds; names already there are skipped. */
export async function addRooms(
  slug: string,
  user: User,
  hostelId: string,
  input: z.infer<typeof roomsSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  const h = await hostelOf(ctx, hostelId)
  const names = roomRun(input.prefix.trim(), input.from, input.to)
  if (!names)
    throw new ApiError(
      400,
      "bad_run",
      "Give a run like 101 to 120 (at most 200 rooms at a time)."
    )
  const db = getDb()
  const existing = new Set(
    (
      await db
        .select({ name: hostelRooms.name })
        .from(hostelRooms)
        .where(eq(hostelRooms.hostelId, h.id))
    ).map((r) => r.name.toLowerCase())
  )
  const fresh = names.filter((n) => !existing.has(n.toLowerCase()))
  if (fresh.length) {
    await db.transaction(async (tx) => {
      const created = await tx
        .insert(hostelRooms)
        .values(
          fresh.map((name) => ({ hostelId: h.id, name, floor: input.floor }))
        )
        .returning({ id: hostelRooms.id })
      await tx
        .insert(hostelBeds)
        .values(
          created.flatMap((r) =>
            bedLabels(input.beds).map((label) => ({ roomId: r.id, label }))
          )
        )
    })
    await writeAudit(
      ctx,
      "hostel.rooms_add",
      `Added ${fresh.length} rooms to ${h.name}, ${input.beds} beds each`
    )
  }
  return { added: fresh.length, skipped: names.length - fresh.length }
}

/** Renames a room or changes its beds (removed from the end, never an occupied one). */
export async function updateRoom(
  slug: string,
  user: User,
  roomId: string,
  input: z.infer<typeof roomSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  const { room, hostel } = await roomOf(ctx, roomId)
  const db = getDb()
  const beds = await db
    .select({
      id: hostelBeds.id,
      label: hostelBeds.label,
      userId: hostelResidents.userId,
    })
    .from(hostelBeds)
    .leftJoin(hostelResidents, eq(hostelResidents.bedId, hostelBeds.id))
    .where(eq(hostelBeds.roomId, room.id))
  const labels = beds
    .map((b) => b.label)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
  const remove = bedsToRemove(
    labels,
    input.beds,
    new Set(beds.filter((b) => b.userId).map((b) => b.label))
  )
  if (!remove)
    throw new ApiError(
      400,
      "bed_in_use",
      "Someone sleeps in a bed you'd remove. Move them first."
    )
  const [clash] = await db
    .select({ id: hostelRooms.id })
    .from(hostelRooms)
    .where(
      and(
        eq(hostelRooms.hostelId, hostel.id),
        ilike(hostelRooms.name, input.name)
      )
    )
  if (clash && clash.id !== room.id)
    throw new ApiError(
      409,
      "duplicate",
      `${hostel.name} already has a room ${input.name}.`
    )
  await db.transaction(async (tx) => {
    await tx
      .update(hostelRooms)
      .set({ name: input.name, floor: input.floor })
      .where(eq(hostelRooms.id, room.id))
    if (remove.length) {
      await tx
        .delete(hostelBeds)
        .where(
          and(eq(hostelBeds.roomId, room.id), inArray(hostelBeds.label, remove))
        )
    }
    const add = bedLabels(input.beds).filter((l) => !labels.includes(l))
    if (add.length)
      await tx
        .insert(hostelBeds)
        .values(add.map((label) => ({ roomId: room.id, label })))
  })
  await writeAudit(
    ctx,
    "hostel.room_edit",
    `Changed room ${input.name} in ${hostel.name} (${input.beds} beds)`
  )
  return { saved: true }
}

export async function deleteRoom(slug: string, user: User, roomId: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  needRooms(ctx)
  const { room, hostel } = await roomOf(ctx, roomId)
  if (await residentsIn([room.id]))
    throw new ApiError(
      400,
      "occupied",
      "Someone lives in this room. Move them out first."
    )
  await getDb().delete(hostelRooms).where(eq(hostelRooms.id, room.id))
  await writeAudit(
    ctx,
    "hostel.room_delete",
    `Removed room ${room.name} from ${hostel.name}`
  )
  return { deleted: true }
}

/* ---------- residents ---------- */

async function bedOf(ctx: OrgContext, bedId: string) {
  uuidOr404(bedId, "Bed")
  const [row] = await getDb()
    .select({ bed: hostelBeds, room: hostelRooms, hostel: hostels })
    .from(hostelBeds)
    .innerJoin(hostelRooms, eq(hostelBeds.roomId, hostelRooms.id))
    .innerJoin(hostels, eq(hostelRooms.hostelId, hostels.id))
    .where(and(eq(hostelBeds.id, bedId), eq(hostels.orgId, ctx.org.id)))
  if (!row) throw notFound("Bed not found")
  return row
}

type Place = Awaited<ReturnType<typeof bedOf>>

const where = (p: Place) =>
  `${p.hostel.name}, room ${p.room.name}, bed ${p.bed.label}`

/** Gives one member a bed (moving them if they had another). */
async function allotTo(
  ctx: OrgContext,
  person: { id: string; groupIds: string[] },
  place: Place
) {
  if (!covers(ctx, "hostel.allot", person.groupIds))
    throw forbidden("Allotting beds to this member isn't part of your role.")
  const db = getDb()
  const [holder] = await db
    .select({ userId: hostelResidents.userId })
    .from(hostelResidents)
    .where(eq(hostelResidents.bedId, place.bed.id))
  if (holder && holder.userId !== person.id)
    throw new ApiError(
      409,
      "taken",
      `Bed ${place.bed.label} in room ${place.room.name} is taken.`
    )
  if (holder) return
  const since = await today()
  try {
    await db
      .insert(hostelResidents)
      .values({
        orgId: ctx.org.id,
        userId: person.id,
        bedId: place.bed.id,
        since,
      })
      .onConflictDoUpdate({
        target: [hostelResidents.orgId, hostelResidents.userId],
        set: { bedId: place.bed.id, since },
      })
  } catch (error) {
    // Someone else took the bed a moment ago (unique bed index).
    if (
      String(
        (error as { cause?: { code?: string } })?.cause?.code ??
          (error as { code?: string })?.code
      ) === "23505"
    ) {
      throw new ApiError(
        409,
        "taken",
        `Bed ${place.bed.label} in room ${place.room.name} was just taken.`
      )
    }
    throw error
  }
  await notify([person.id], {
    kind: "hostel",
    title: `Your hostel bed: ${where(place)}`,
    body: place.hostel.warden
      ? `Warden: ${[place.hostel.warden, place.hostel.wardenPhone].filter(Boolean).join(", ")}`
      : undefined,
    href: "/classes",
    orgId: ctx.org.id,
  })
}

export async function allotBed(
  slug: string,
  user: User,
  input: z.infer<typeof allotSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const place = await bedOf(ctx, input.bedId)
  const [person] = await studentsWithGroups(ctx, [input.userId])
  if (!person) throw notFound("Member not found")
  await allotTo(ctx, person, place)
  await writeAudit(
    ctx,
    "hostel.allot",
    `Gave ${person.name ?? person.email} ${where(place)}`
  )
  return { allotted: true }
}

export async function vacate(slug: string, user: User, userId: string) {
  uuidOr404(userId, "Resident")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const db = getDb()
  const [row] = await db
    .select({ bedId: hostelResidents.bedId })
    .from(hostelResidents)
    .where(
      and(
        eq(hostelResidents.orgId, ctx.org.id),
        eq(hostelResidents.userId, userId)
      )
    )
  if (!row) throw notFound("Resident not found")
  const [person] = await studentsWithGroups(ctx, [userId])
  if (!covers(ctx, "hostel.allot", person?.groupIds ?? []))
    throw forbidden("Allotting beds to this member isn't part of your role.")
  const place = await bedOf(ctx, row.bedId)
  await db
    .delete(hostelResidents)
    .where(
      and(
        eq(hostelResidents.orgId, ctx.org.id),
        eq(hostelResidents.userId, userId)
      )
    )
  await writeAudit(
    ctx,
    "hostel.vacate",
    `Moved ${person?.name ?? person?.email ?? "someone"} out of ${where(place)}`
  )
  if (person) {
    await notify([person.id], {
      kind: "hostel",
      title: `You've moved out of ${place.hostel.name}`,
      href: "/classes",
      orgId: ctx.org.id,
    })
  }
  return { vacated: true }
}

/** Members this person may give a bed, matching a search, with where they sleep now. */
export async function searchResidents(slug: string, user: User, q: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const term = q.trim()
  if (term.length < 2) return []
  const db = getDb()
  const matches = await db
    .select({ id: users.id })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.status, "active"),
        or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`))
      )
    )
    .limit(200)
  const people = (
    await studentsWithGroups(
      ctx,
      matches.map((m) => m.id)
    )
  )
    .filter((p) => covers(ctx, "hostel.allot", p.groupIds))
    .slice(0, 20)
  const stays = await Promise.all(people.map((p) => stayOf(ctx.org.id, p.id)))
  return people.map((p, i) => ({
    id: p.id,
    name: p.name ?? p.email,
    email: p.email,
    classes: p.groupIds.map((g) => pathName(ctx, g)),
    now: stays[i]
      ? `${stays[i]!.hostel} ${stays[i]!.room}-${stays[i]!.bed}`
      : null,
  }))
}

/** Residents from a pasted list: email, hostel, room, bed (blank for the first free one). */
export async function importResidents(
  slug: string,
  user: User,
  input: z.infer<typeof residentsImportSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!anyGroupGrant(ctx, "hostel.allot"))
    throw forbidden("Allotting beds isn't part of your role.")
  const db = getDb()
  const emails = [...new Set(input.rows.map((r) => r.email))]
  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, emails))
  const members = new Map(
    (
      await studentsWithGroups(
        ctx,
        found.map((f) => f.id)
      )
    ).map((m) => [m.email, m])
  )
  const beds = await db
    .select({
      bedId: hostelBeds.id,
      label: hostelBeds.label,
      room: hostelRooms.name,
      hostel: hostels.name,
      taken: hostelResidents.userId,
    })
    .from(hostelBeds)
    .innerJoin(hostelRooms, eq(hostelBeds.roomId, hostelRooms.id))
    .innerJoin(hostels, eq(hostelRooms.hostelId, hostels.id))
    .leftJoin(hostelResidents, eq(hostelResidents.bedId, hostelBeds.id))
    .where(eq(hostels.orgId, ctx.org.id))
  const report: { line: number; note: string }[] = []
  let allotted = 0
  for (const [i, row] of input.rows.entries()) {
    const line = i + 1
    const person = members.get(row.email)
    const inRoom = beds
      .filter(
        (b) =>
          b.hostel.toLowerCase() === row.hostel.toLowerCase() &&
          b.room.toLowerCase() === row.room.toLowerCase()
      )
      .sort(
        (a, b) =>
          a.label.length - b.label.length || a.label.localeCompare(b.label)
      )
    const bed = row.bed
      ? inRoom.find((b) => b.label === row.bed)
      : inRoom.find((b) => !b.taken)
    if (!person)
      report.push({
        line,
        note: `${row.email || "(blank)"} isn't a member here`,
      })
    else if (inRoom.length === 0)
      report.push({ line, note: `No room ${row.room} in ${row.hostel}` })
    else if (!bed)
      report.push({
        line,
        note: row.bed
          ? `Room ${row.room} has no bed ${row.bed}`
          : `Room ${row.room} is full`,
      })
    else {
      try {
        await allotTo(ctx, person, await bedOf(ctx, bed.bedId))
        bed.taken = person.id
        allotted++
      } catch (error) {
        report.push({
          line,
          note: error instanceof ApiError ? error.message : "Couldn't allot",
        })
      }
    }
  }
  if (allotted)
    await writeAudit(
      ctx,
      "hostel.import",
      `Gave ${allotted} people beds from a list`
    )
  return { allotted, failed: report.length, report }
}

/** Where a member sleeps in one organization, or null. */
export async function stayOf(orgId: string, userId: string) {
  const [row] = await getDb()
    .select({
      hostel: hostels.name,
      warden: hostels.warden,
      wardenPhone: hostels.wardenPhone,
      room: hostelRooms.name,
      floor: hostelRooms.floor,
      bed: hostelBeds.label,
      since: hostelResidents.since,
    })
    .from(hostelResidents)
    .innerJoin(hostelBeds, eq(hostelResidents.bedId, hostelBeds.id))
    .innerJoin(hostelRooms, eq(hostelBeds.roomId, hostelRooms.id))
    .innerJoin(hostels, eq(hostelRooms.hostelId, hostels.id))
    .where(
      and(eq(hostelResidents.orgId, orgId), eq(hostelResidents.userId, userId))
    )
  return row ?? null
}
