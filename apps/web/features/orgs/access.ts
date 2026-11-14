import {
  getDb,
  groupMembers,
  organizations,
  orgGroups,
  orgMembers,
  orgRoles,
  roleAssignments,
  sql,
  type User,
} from "@workspace/db"
import {
  allowsFor,
  ancestry,
  inAudience,
  SYSTEM_ROLES,
  type Audience,
  type Grant,
  type Permission,
  type SystemRoleKey,
} from "@workspace/judge"

import { orgReach } from "@/features/platform/access"
import { orgPages } from "@/lib/paths"

const { and, eq, inArray } = sql

/** Built-in roles take their permissions from code, so they gain new ones automatically. */
export function rolePermissions(role: {
  systemKey: string | null
  permissions: string[]
}): readonly string[] {
  return role.systemKey && role.systemKey in SYSTEM_ROLES
    ? SYSTEM_ROLES[role.systemKey as SystemRoleKey].permissions
    : role.permissions
}

interface OrgStanding {
  active: boolean
  grants: Grant[]
  groupIds: string[]
  chainOf: (groupId: string) => string[]
}

/** Everything needed to decide what one person may see and manage, loaded once. */
export interface Viewpoint {
  user: User | null
  /** Platform teachers and admins: they run platform content. */
  platformStaff: boolean
  /** Platform staff who may act inside any organization ("Act in organizations"). */
  platformAdmin: boolean
  orgs: Map<string, OrgStanding>
}

export async function viewpoint(user: User | null): Promise<Viewpoint> {
  const vp: Viewpoint = {
    user,
    platformStaff: user?.role === "teacher" || user?.role === "admin",
    platformAdmin: (await orgReach(user)) === "act",
    orgs: new Map(),
  }
  if (!user) return vp
  const db = getDb()
  const memberships = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.userId, user.id))
  if (memberships.length === 0) return vp
  const orgIds = memberships.map((m) => m.orgId)
  const [grants, groups, mine] = await Promise.all([
    db
      .select({
        orgId: roleAssignments.orgId,
        groupId: roleAssignments.groupId,
        systemKey: orgRoles.systemKey,
        permissions: orgRoles.permissions,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(
        and(
          eq(roleAssignments.userId, user.id),
          inArray(roleAssignments.orgId, orgIds)
        )
      ),
    db
      .select({
        id: orgGroups.id,
        orgId: orgGroups.orgId,
        parentId: orgGroups.parentId,
      })
      .from(orgGroups)
      .where(inArray(orgGroups.orgId, orgIds)),
    db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, user.id)),
  ])
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]))
  const chainOf = (id: string) => ancestry(id, (x) => parentOf.get(x))
  for (const m of memberships) {
    const active = m.status === "active"
    vp.orgs.set(m.orgId, {
      active,
      // Roles only count while the membership is active.
      grants: active
        ? grants
            .filter((g) => g.orgId === m.orgId)
            .map((g) => ({
              permissions: rolePermissions(g),
              groupId: g.groupId,
            }))
        : [],
      groupIds: mine
        .map((g) => g.groupId)
        .filter((id) => groups.some((g) => g.id === id && g.orgId === m.orgId)),
      chainOf,
    })
  }
  return vp
}

export type Access = "manage" | "take" | "none"

/**
 * What a person may do with content: manage it, take part in it, or nothing.
 * Platform content (no organization) is for everyone and run by platform staff.
 * Organization content is for its active members who meet every audience condition, and
 * run by those whose permission covers all groups of one condition.
 */
export function accessTo(
  vp: Viewpoint,
  content: { orgId: string | null; audience: Audience },
  permission: Permission
): Access {
  if (content.orgId === null) return vp.platformStaff ? "manage" : "take"
  if (vp.platformAdmin) return "manage"
  const standing = vp.orgs.get(content.orgId)
  if (!standing?.active) return "none"
  if (
    allowsFor(standing.grants, permission, content.audience, standing.chainOf)
  ) {
    return "manage"
  }
  return inAudience(standing.groupIds, content.audience, standing.chainOf)
    ? "take"
    : "none"
}

/** Organizations this person is an active member of. */
export const activeOrgIds = (vp: Viewpoint) =>
  [...vp.orgs].filter(([, s]) => s.active).map(([id]) => id)

/** An organization's rules for its own content: languages and pasting. */
export async function orgPolicy(orgId: string | null) {
  if (!orgId) return { languages: null, allowPaste: true }
  const [org] = await getDb()
    .select({
      languages: organizations.languages,
      allowPaste: organizations.allowPaste,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  return {
    languages: org?.languages ?? null,
    allowPaste: org?.allowPaste ?? true,
  }
}

/** A problem's languages narrowed by an organization's, null meaning no limit. */
export function narrowLanguages(
  problem: string[] | null,
  org: string[] | null
) {
  if (!org) return problem
  return problem ? problem.filter((l) => org.includes(l)) : org
}

/**
 * The classes a piece of content is for, as links its viewer can open: groups they sit
 * in or under, or every group for someone who manages it. Empty for platform content.
 */
export async function classLinks(
  vp: Viewpoint,
  content: { orgId: string | null; audience: Audience },
  manages: boolean
) {
  if (!content.orgId) return []
  const ids = [...new Set(content.audience.flat())]
  if (ids.length === 0) return []
  const standing = vp.orgs.get(content.orgId)
  const under = new Set(
    standing ? standing.groupIds.flatMap((id) => standing.chainOf(id)) : []
  )
  const open = ids.filter((id) => manages || under.has(id))
  if (open.length === 0) return []
  const db = getDb()
  const [rows, [org]] = await Promise.all([
    db
      .select({ id: orgGroups.id, name: orgGroups.name })
      .from(orgGroups)
      .where(
        and(eq(orgGroups.orgId, content.orgId), inArray(orgGroups.id, open))
      ),
    db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, content.orgId)),
  ])
  return rows
    .map((g) => ({ name: g.name, href: orgPages(org!.slug).cls(g.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
