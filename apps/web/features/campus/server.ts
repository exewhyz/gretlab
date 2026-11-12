import { getDb, orgMembers, organizations, sql, type User } from "@workspace/db"
import { enabledModules } from "@workspace/judge"

import { loansOf } from "@/features/books/server"
import { stayOf } from "@/features/hostel/server"
import { rideOf } from "@/features/transport/server"

/*
 * A person's life at school beyond their classes: library books now, and their bus route
 * and hostel bed as those modules arrive. One summary per organization, shown on My
 * classes and, for a parent, on their child's page. Each part is null when its module is
 * off there.
 */

const { and, asc, eq } = sql

type Org = Pick<typeof organizations.$inferSelect, "id" | "type" | "modules">

export async function campusOf(org: Org, userId: string) {
  const modules = enabledModules(org.type, org.modules)
  const [library, transport, hostel] = await Promise.all([
    modules.has("library")
      ? loansOf(org.id, userId).then((loans) => ({ loans }))
      : null,
    modules.has("transport")
      ? rideOf(org.id, userId).then((ride) => ({ ride }))
      : null,
    modules.has("hostel")
      ? stayOf(org.id, userId).then((stay) => ({ stay }))
      : null,
  ])
  return { library, transport, hostel }
}

export type Campus = Awaited<ReturnType<typeof campusOf>>

const CAMPUS_MODULES = ["library", "transport", "hostel"] as const

/** Every organization this person is an active member of that has a campus module on. */
export async function myCampus(user: User) {
  const orgs = await getDb()
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      type: organizations.type,
      modules: organizations.modules,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.userId, user.id),
        eq(orgMembers.status, "active"),
        eq(organizations.active, true)
      )
    )
    .orderBy(asc(organizations.name))
  const withModules = orgs.filter((o) => {
    const on = enabledModules(o.type, o.modules)
    return CAMPUS_MODULES.some((m) => on.has(m))
  })
  return Promise.all(
    withModules.map(async (o) => ({
      slug: o.slug,
      name: o.name,
      ...(await campusOf(o, user.id)),
    }))
  )
}
