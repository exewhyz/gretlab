import {
  getDb,
  orgMembers,
  sql,
  transportRiders,
  transportRoutes,
  transportStops,
  users,
  type User,
} from "@workspace/db"
import { enabledModules, seatsLeft, stopsProblem } from "@workspace/judge"
import { z } from "zod"

import {
  anyGroupGrant,
  covers,
  pathName,
  studentsWithGroups,
} from "@/features/campus/people"
import { notify } from "@/features/notifications/server"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * The Transport module: routes (`transport_routes`: vehicle, driver, seats) with ordered
 * stops (`transport_stops`: morning pick-up and afternoon drop-off times), and riders
 * (`transport_riders`: one route and stop per person per organization). "Set routes and
 * stops" (`transport.routes`) is organization-wide; "Assign riders" (`transport.assign`) is
 * scoped to the riders' groups, so a class teacher can be given their class only. A rider
 * is told when they're put on a route or taken off it (event `campus.update`, copied to
 * their parents). Rules in packages/judge/src/transport.ts.
 */

const { and, asc, count, eq, ilike, inArray, or } = sql

const time = z.union([
  z.literal(""),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times look like 07:30"),
])

export const routeSchema = z.object({
  name: z.string().trim().min(1, "Name the route").max(80),
  vehicle: z.string().trim().max(40).default(""),
  driver: z.string().trim().max(80).default(""),
  driverPhone: z.string().trim().max(30).default(""),
  capacity: z.number().int().min(1).max(500).nullable().default(null),
  stops: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().max(80),
        pickup: time.default(""),
        drop: time.default(""),
      })
    )
    .min(1, "Add at least one stop")
    .max(60),
})

export const riderSchema = z.object({
  userId: z.uuid(),
  routeId: z.uuid(),
  stopId: z.uuid(),
})

export const ridersImportSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase(),
        route: z.string().trim(),
        stop: z.string().trim(),
      })
    )
    .min(1)
    .max(3000),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

function needModule(ctx: OrgContext) {
  if (!ctx.modules.has("transport")) {
    throw notFound("Transport isn't switched on for this organization.")
  }
}

const mayRoutes = (ctx: OrgContext) => canFor(ctx, "transport.routes", [])

async function routesOf(orgId: string) {
  const db = getDb()
  const routes = await db
    .select()
    .from(transportRoutes)
    .where(eq(transportRoutes.orgId, orgId))
    .orderBy(asc(transportRoutes.name))
  const ids = routes.map((r) => r.id)
  const [stops, riders] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(transportStops)
          .where(inArray(transportStops.routeId, ids))
          .orderBy(asc(transportStops.position)),
        db
          .select({
            routeId: transportRiders.routeId,
            stopId: transportRiders.stopId,
            n: count(),
          })
          .from(transportRiders)
          .where(inArray(transportRiders.routeId, ids))
          .groupBy(transportRiders.routeId, transportRiders.stopId),
      ])
    : [[], []]
  return routes.map((r) => {
    const mine = riders.filter((x) => x.routeId === r.id)
    const riding = mine.reduce((sum, x) => sum + Number(x.n), 0)
    const left = seatsLeft(r.capacity, riding)
    return {
      id: r.id,
      name: r.name,
      vehicle: r.vehicle,
      driver: r.driver,
      driverPhone: r.driverPhone,
      capacity: r.capacity,
      riders: riding,
      seatsLeft: Number.isFinite(left) ? left : null,
      stops: stops
        .filter((s) => s.routeId === r.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          pickup: s.pickup,
          drop: s.drop,
          riders: Number(mine.find((x) => x.stopId === s.id)?.n ?? 0),
        })),
    }
  })
}

/** Manage › Transport: every route with its stops and riders count, and what this person may do. */
export async function transportSetup(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    routes: mayRoutes(ctx),
    assign: anyGroupGrant(ctx, "transport.assign"),
  }
  if (!can.routes && !can.assign)
    throw forbidden("Running transport isn't part of your role.")
  return { can, routes: await routesOf(ctx.org.id) }
}

async function routeOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Route not found")
  const [route] = await getDb()
    .select()
    .from(transportRoutes)
    .where(
      and(eq(transportRoutes.id, id), eq(transportRoutes.orgId, ctx.org.id))
    )
  if (!route) throw notFound("Route not found")
  return route
}

/** Adds a route, or changes one (stops kept by id, so riders keep their stop). */
export async function saveRoute(
  slug: string,
  user: User,
  input: z.infer<typeof routeSchema>,
  id?: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!mayRoutes(ctx))
    throw forbidden("Setting routes isn't part of your role.")
  const problem = stopsProblem(input.stops)
  if (problem) throw new ApiError(400, "bad_stops", problem)
  const db = getDb()
  const existing = id ? await routeOf(ctx, id) : null
  const [clash] = await db
    .select({ id: transportRoutes.id })
    .from(transportRoutes)
    .where(
      and(
        eq(transportRoutes.orgId, ctx.org.id),
        ilike(transportRoutes.name, input.name)
      )
    )
  if (clash && clash.id !== existing?.id) {
    throw new ApiError(
      409,
      "duplicate",
      `There's already a route called ${input.name}.`
    )
  }
  const { stops, ...fields } = input
  const saved = await db.transaction(async (tx) => {
    let routeId = existing?.id
    if (existing) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(transportRiders)
        .where(eq(transportRiders.routeId, existing.id))
      if (fields.capacity != null && Number(n) > fields.capacity) {
        throw new ApiError(
          400,
          "over_capacity",
          `${n} people ride this route; give it at least that many seats.`
        )
      }
      const old = await tx
        .select()
        .from(transportStops)
        .where(eq(transportStops.routeId, existing.id))
      const keep = new Set(stops.flatMap((s) => (s.id ? [s.id] : [])))
      if (stops.some((s) => s.id && !old.some((o) => o.id === s.id)))
        throw notFound("Stop not found")
      const gone = old.filter((o) => !keep.has(o.id)).map((o) => o.id)
      if (gone.length) {
        const [used] = await tx
          .select({ n: count() })
          .from(transportRiders)
          .where(inArray(transportRiders.stopId, gone))
        if (Number(used?.n ?? 0) > 0) {
          throw new ApiError(
            400,
            "stop_in_use",
            "Someone gets on at a stop you removed. Move them first."
          )
        }
        await tx.delete(transportStops).where(inArray(transportStops.id, gone))
      }
      await tx
        .update(transportRoutes)
        .set(fields)
        .where(eq(transportRoutes.id, existing.id))
    } else {
      const [created] = await tx
        .insert(transportRoutes)
        .values({ ...fields, orgId: ctx.org.id })
        .returning({ id: transportRoutes.id })
      routeId = created!.id
    }
    for (const [position, s] of stops.entries()) {
      const values = {
        name: s.name.trim(),
        pickup: s.pickup,
        drop: s.drop,
        position,
      }
      if (s.id)
        await tx
          .update(transportStops)
          .set(values)
          .where(eq(transportStops.id, s.id))
      else
        await tx.insert(transportStops).values({ ...values, routeId: routeId! })
    }
    return routeId!
  })
  await writeAudit(
    ctx,
    existing ? "transport.route_edit" : "transport.route_add",
    `${existing ? "Changed" : "Added"} the ${input.name} route (${stops.length} stops)`
  )
  return (await routesOf(ctx.org.id)).find((r) => r.id === saved)
}

export async function deleteRoute(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!mayRoutes(ctx))
    throw forbidden("Setting routes isn't part of your role.")
  const route = await routeOf(ctx, id)
  await getDb().delete(transportRoutes).where(eq(transportRoutes.id, id))
  await writeAudit(
    ctx,
    "transport.route_delete",
    `Removed the ${route.name} route`
  )
  return { deleted: true }
}

/** A route's riders that this person may see: everyone for route keepers, else their groups'. */
export async function routeRiders(slug: string, user: User, routeId: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const route = await routeOf(ctx, routeId)
  const all = mayRoutes(ctx)
  if (!all && !anyGroupGrant(ctx, "transport.assign"))
    throw forbidden("Running transport isn't part of your role.")
  const rows = await getDb()
    .select({ userId: transportRiders.userId, stopId: transportRiders.stopId })
    .from(transportRiders)
    .where(eq(transportRiders.routeId, route.id))
  const people = await studentsWithGroups(
    ctx,
    rows.map((r) => r.userId)
  )
  return people
    .filter((p) => all || covers(ctx, "transport.assign", p.groupIds))
    .map((p) => ({
      id: p.id,
      name: p.name ?? p.email,
      email: p.email,
      classes: p.groupIds.map((g) => pathName(ctx, g)),
      stopId: rows.find((r) => r.userId === p.id)!.stopId,
      canChange: covers(ctx, "transport.assign", p.groupIds),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Members this person may put on a route, matching a search, with their current route. */
export async function searchRiders(slug: string, user: User, q: string) {
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
    .filter((p) => covers(ctx, "transport.assign", p.groupIds))
    .slice(0, 20)
  const current = people.length
    ? await db
        .select({ userId: transportRiders.userId, route: transportRoutes.name })
        .from(transportRiders)
        .innerJoin(
          transportRoutes,
          eq(transportRiders.routeId, transportRoutes.id)
        )
        .where(
          and(
            eq(transportRiders.orgId, ctx.org.id),
            inArray(
              transportRiders.userId,
              people.map((p) => p.id)
            )
          )
        )
    : []
  return people.map((p) => ({
    id: p.id,
    name: p.name ?? p.email,
    email: p.email,
    classes: p.groupIds.map((g) => pathName(ctx, g)),
    route: current.find((c) => c.userId === p.id)?.route ?? null,
  }))
}

/** Puts one member on a route and stop (moving them if they rode another). */
async function place(
  ctx: OrgContext,
  person: { id: string; groupIds: string[] },
  route: typeof transportRoutes.$inferSelect,
  stop: typeof transportStops.$inferSelect
) {
  if (!covers(ctx, "transport.assign", person.groupIds)) {
    throw forbidden("Assigning this member isn't part of your role.")
  }
  await getDb().transaction(async (tx) => {
    // One desk at a time per route, so two can't fill its last seat together.
    await tx.execute(
      sql.sql`select id from ${transportRoutes} where ${transportRoutes.id} = ${route.id} for update`
    )
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(transportRiders)
      .where(
        and(
          eq(transportRiders.routeId, route.id),
          sql.ne(transportRiders.userId, person.id)
        )
      )
    if (seatsLeft(route.capacity, Number(n)) <= 0) {
      throw new ApiError(409, "full", `Every seat on ${route.name} is taken.`)
    }
    await tx
      .insert(transportRiders)
      .values({
        orgId: ctx.org.id,
        userId: person.id,
        routeId: route.id,
        stopId: stop.id,
      })
      .onConflictDoUpdate({
        target: [transportRiders.orgId, transportRiders.userId],
        set: { routeId: route.id, stopId: stop.id },
      })
  })
  const times = [
    stop.pickup && `picked up ${stop.pickup}`,
    stop.drop && `dropped ${stop.drop}`,
  ]
    .filter(Boolean)
    .join(", ")
  await notify([person.id], {
    kind: "transport",
    title: `Your bus: ${route.name}, from ${stop.name}`,
    body: [times, route.vehicle && `Vehicle ${route.vehicle}`]
      .filter(Boolean)
      .join(". "),
    href: "/classes",
    orgId: ctx.org.id,
  })
}

async function stopOf(routeId: string, stopId: string) {
  const [stop] = await getDb()
    .select()
    .from(transportStops)
    .where(
      and(eq(transportStops.id, stopId), eq(transportStops.routeId, routeId))
    )
  if (!stop) throw notFound("Stop not found")
  return stop
}

export async function assignRider(
  slug: string,
  user: User,
  input: z.infer<typeof riderSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const route = await routeOf(ctx, input.routeId)
  const stop = await stopOf(route.id, input.stopId)
  const [person] = await studentsWithGroups(ctx, [input.userId])
  if (!person) throw notFound("Member not found")
  await place(ctx, person, route, stop)
  await writeAudit(
    ctx,
    "transport.assign",
    `Put ${person.name ?? person.email} on ${route.name} at ${stop.name}`
  )
  return { assigned: true }
}

export async function unassignRider(slug: string, user: User, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw notFound("Rider not found")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const [person] = await studentsWithGroups(ctx, [userId])
  const db = getDb()
  const [ride] = await db
    .select({ route: transportRoutes.name })
    .from(transportRiders)
    .innerJoin(transportRoutes, eq(transportRiders.routeId, transportRoutes.id))
    .where(
      and(
        eq(transportRiders.orgId, ctx.org.id),
        eq(transportRiders.userId, userId)
      )
    )
  if (!ride) throw notFound("Rider not found")
  if (!covers(ctx, "transport.assign", person?.groupIds ?? [])) {
    throw forbidden("Assigning this member isn't part of your role.")
  }
  await db
    .delete(transportRiders)
    .where(
      and(
        eq(transportRiders.orgId, ctx.org.id),
        eq(transportRiders.userId, userId)
      )
    )
  await writeAudit(
    ctx,
    "transport.unassign",
    `Took ${person?.name ?? person?.email ?? "someone"} off ${ride.route}`
  )
  if (person) {
    await notify([person.id], {
      kind: "transport",
      title: `You're no longer on the ${ride.route} bus`,
      href: "/classes",
      orgId: ctx.org.id,
    })
  }
  return { removed: true }
}

/** Riders from a pasted list: member email, route name, stop name. A report per line. */
export async function importRiders(
  slug: string,
  user: User,
  input: z.infer<typeof ridersImportSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!anyGroupGrant(ctx, "transport.assign"))
    throw forbidden("Assigning riders isn't part of your role.")
  const db = getDb()
  const routes = await db
    .select()
    .from(transportRoutes)
    .where(eq(transportRoutes.orgId, ctx.org.id))
  const stops = routes.length
    ? await db
        .select()
        .from(transportStops)
        .where(
          inArray(
            transportStops.routeId,
            routes.map((r) => r.id)
          )
        )
    : []
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
  const report: { line: number; note: string }[] = []
  let placed = 0
  for (const [i, row] of input.rows.entries()) {
    const line = i + 1
    const person = members.get(row.email)
    const route = routes.find(
      (r) => r.name.toLowerCase() === row.route.toLowerCase()
    )
    const stop =
      route &&
      stops.find(
        (s) =>
          s.routeId === route.id &&
          s.name.toLowerCase() === row.stop.toLowerCase()
      )
    if (!person)
      report.push({
        line,
        note: `${row.email || "(blank)"} isn't a member here`,
      })
    else if (!route)
      report.push({ line, note: `No route called "${row.route}"` })
    else if (!stop)
      report.push({
        line,
        note: `${route.name} has no stop called "${row.stop}"`,
      })
    else {
      try {
        await place(ctx, person, route, stop)
        placed++
      } catch (error) {
        report.push({
          line,
          note: error instanceof ApiError ? error.message : "Couldn't assign",
        })
      }
    }
  }
  if (placed)
    await writeAudit(
      ctx,
      "transport.import",
      `Put ${placed} riders on routes from a list`
    )
  return { placed, failed: report.length, report }
}

/** A member's ride in one organization, or null. */
export async function rideOf(orgId: string, userId: string) {
  const [row] = await getDb()
    .select({
      route: transportRoutes.name,
      vehicle: transportRoutes.vehicle,
      driver: transportRoutes.driver,
      driverPhone: transportRoutes.driverPhone,
      stop: transportStops.name,
      pickup: transportStops.pickup,
      drop: transportStops.drop,
    })
    .from(transportRiders)
    .innerJoin(transportRoutes, eq(transportRiders.routeId, transportRoutes.id))
    .innerJoin(transportStops, eq(transportRiders.stopId, transportStops.id))
    .where(
      and(eq(transportRiders.orgId, orgId), eq(transportRiders.userId, userId))
    )
  return row ?? null
}
