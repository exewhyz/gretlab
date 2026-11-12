import { getDb, groupMembers, orgMembers, sql, users } from "@workspace/db"
import type { Permission } from "@workspace/judge"

import { canFor, groupChain, type OrgContext } from "@/features/orgs/server"

/*
 * People helpers for the modules that act on students by the groups they sit in (Parent
 * accounts, Transport, Hostel): who's an active member and where they sit, and whether a
 * permission scoped to groups covers them.
 */

const { and, eq, inArray } = sql

/** Active members, with the groups each sits in directly. */
export async function studentsWithGroups(ctx: OrgContext, userIds?: string[]) {
  const db = getDb()
  const where = [
    eq(orgMembers.orgId, ctx.org.id),
    eq(orgMembers.status, "active"),
  ]
  if (userIds) {
    if (userIds.length === 0) return []
    where.push(inArray(orgMembers.userId, userIds))
  }
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(...where))
  const groupIds = ctx.groups.map((g) => g.id)
  const seats =
    people.length && groupIds.length
      ? await db
          .select()
          .from(groupMembers)
          .where(
            and(
              inArray(groupMembers.groupId, groupIds),
              inArray(
                groupMembers.userId,
                people.map((p) => p.id)
              )
            )
          )
      : []
  return people.map((p) => ({
    ...p,
    groupIds: seats.filter((s) => s.userId === p.id).map((s) => s.groupId),
  }))
}

/** Whether this permission covers a student: across the organization, or in a group they sit in. */
export const covers = (
  ctx: OrgContext,
  permission: Permission,
  groupIds: string[]
) =>
  canFor(ctx, permission, []) ||
  groupIds.some((g) => canFor(ctx, permission, [[g]]))

export const pathName = (ctx: OrgContext, groupId: string) =>
  [...groupChain(ctx, groupId)]
    .reverse()
    .map((id) => ctx.groups.find((g) => g.id === id)?.name ?? "")
    .join(" › ")

export const anyGroupGrant = (ctx: OrgContext, permission: Permission) =>
  canFor(ctx, permission, []) ||
  ctx.groups.some((g) => canFor(ctx, permission, [[g.id]]))
