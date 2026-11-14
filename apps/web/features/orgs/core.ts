import { randomBytes } from "node:crypto"

import {
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sql,
  users,
  type OrgGroup,
  type Organization,
  type User,
} from "@workspace/db"
import {
  allows,
  ancestry,
  audienceGroups,
  type Audience,
  enabledModules,
  ORG_VIEW_PERMISSIONS,
  grantsPermission,
  type ModuleKey,
  isPermission,
  PERMISSIONS,
  SYSTEM_ROLES,
  type Grant,
  type Permission,
  type SystemRoleKey,
} from "@workspace/judge"

import { ApiError, notFound } from "@/lib/api/route"
import { requestInfo } from "@/lib/api/request-context"
import { writeEntry } from "@/features/audit/server"
import { orgReach } from "@/features/platform/access"
import { freeHandle } from "@/features/catalog/server"
import { kindPolicies } from "./kinds"

import { rolePermissions } from "./access"

const { and, eq, inArray, isNull } = sql

/*
 * The organization context and the checks every organization function shares: who may
 * do what (roles, groups, platform reach, an API key's limits), the audit log, and the
 * group tree. features/orgs/server.ts and ./groups.ts are built on it.
 */

export type Db = ReturnType<typeof getDb>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Keeps `IN (...)` valid when an organization has no groups yet. */
export const NO_GROUP = "00000000-0000-0000-0000-000000000000"

export const forbidden = (message = "You don't have permission to do that.") =>
  new ApiError(403, "forbidden", message)

/* ---------- who may do what ---------- */

export interface OrgContext {
  org: Organization
  user: User
  /**
   * Platform staff who may act in any organization ("Act in organizations"; owners have
   * it): everything an admin can do, joined or not, logged as support.
   */
  platformAdmin: boolean
  /** Platform staff who may look inside any organization, read-only ("See inside organizations"). */
  platformViewer: boolean
  membership: typeof orgMembers.$inferSelect | null
  grants: (Grant & { systemKey: string | null })[]
  groups: OrgGroup[]
  /** The modules on here: the kind's, as the platform allows, as the org chose. */
  modules: Set<ModuleKey>
}

export async function loadOrg(slug: string) {
  const [org] = await getDb()
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
  if (!org) throw notFound("Organization not found")
  return org
}

export async function context(slug: string, user: User): Promise<OrgContext> {
  const org = await loadOrg(slug)
  const db = getDb()
  const [[membership], rows, groups, policies, reach] = await Promise.all([
    db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, user.id))),
    db
      .select({
        permissions: orgRoles.permissions,
        systemKey: orgRoles.systemKey,
        groupId: roleAssignments.groupId,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(
        and(
          eq(roleAssignments.orgId, org.id),
          eq(roleAssignments.userId, user.id)
        )
      ),
    db.select().from(orgGroups).where(eq(orgGroups.orgId, org.id)),
    kindPolicies(),
    orgReach(user),
  ])
  const active = membership?.status === "active"
  const ctx: OrgContext = {
    org,
    user,
    platformAdmin: reach === "act",
    platformViewer: reach !== null,
    membership: membership ?? null,
    // Roles only count while the person is an active member. Platform staff who may look
    // inside every organization see it as with a read-only role across it.
    grants: [
      ...(active
        ? rows.map((row) => ({ ...row, permissions: rolePermissions(row) }))
        : []),
      ...(reach === "view"
        ? [
            {
              permissions: ORG_VIEW_PERMISSIONS,
              groupId: null,
              systemKey: null,
            },
          ]
        : []),
    ],
    groups,
    modules: enabledModules(org.type, org.modules, policies[org.type]),
  }
  // An API key: its maker's roles here, narrowed to the key's permissions; no platform reach.
  const key = requestInfo().apiKey
  if (key) {
    if (key.orgId !== org.id) throw notFound("Organization not found")
    return {
      ...ctx,
      platformAdmin: false,
      platformViewer: false,
      grants: ctx.grants.map((g) => ({
        ...g,
        systemKey: null,
        permissions: (key.permissions as Permission[]).filter((p) =>
          grantsPermission(g.permissions, p)
        ),
      })),
    }
  }
  return ctx
}

export function chainOf(ctx: OrgContext, groupId: string) {
  const parents = new Map(ctx.groups.map((g) => [g.id, g.parentId]))
  return ancestry(groupId, (id) => parents.get(id))
}

export const isOwner = (ctx: OrgContext) =>
  ctx.grants.some((g) => g.systemKey === "owner" && g.groupId === null)

export function can(
  ctx: OrgContext,
  permission: Permission,
  groupId?: string | null
) {
  if (ctx.platformAdmin) return true
  return allows(ctx.grants, permission, groupId ? chainOf(ctx, groupId) : null)
}

export function need(
  ctx: OrgContext,
  permission: Permission,
  groupId?: string | null
) {
  if (!can(ctx, permission, groupId)) {
    throw forbidden(
      `This needs the "${PERMISSIONS[permission].label}" permission.`
    )
  }
}

/** Permissions this person holds for a group (or the whole organization). */
export function heldFor(ctx: OrgContext, groupId: string | null): Set<string> {
  const chain = groupId ? chainOf(ctx, groupId) : null
  return new Set(
    ctx.grants
      .filter((g) => g.groupId === null || (chain && chain.includes(g.groupId)))
      .flatMap((g) => g.permissions)
  )
}

/** Nobody can hand out more than they have: the guard against giving yourself more. */
export function needSubset(
  ctx: OrgContext,
  permissions: readonly string[],
  groupId: string | null
) {
  if (ctx.platformAdmin || isOwner(ctx)) return
  const held = [...heldFor(ctx, groupId)]
  // Holding a parent is holding every action under it, so it may be handed out.
  const extra = permissions.filter(
    (p) => !(isPermission(p) && grantsPermission(held, p))
  )
  if (extra.length) {
    throw forbidden(
      `You can't give permissions you don't have: ${extra
        .map((p) => (isPermission(p) ? PERMISSIONS[p].label : p))
        .join(", ")}.`
    )
  }
}

/** Permissions this person has somewhere in the organization, org-wide or in a group. */
export function heldAnywhere(ctx: OrgContext) {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => {
    const scope = scopeOf(ctx, p)
    return scope === "all" || scope.size > 0
  })
}

/** Every group this person may act on for a permission, or "all". */
export function scopeOf(
  ctx: OrgContext,
  permission: Permission
): "all" | Set<string> {
  if (can(ctx, permission)) return "all"
  const visible = new Set<string>()
  for (const group of ctx.groups) {
    if (can(ctx, permission, group.id)) visible.add(group.id)
  }
  return visible
}

export async function audit(
  tx: Tx | Db,
  ctx: {
    org: Organization
    user: User
    platformAdmin?: boolean
    membership?: { status: string } | null
  },
  action: string,
  summary: string,
  detail?: Record<string, unknown>
) {
  await writeEntry(tx, {
    orgId: ctx.org.id,
    actor: ctx.user,
    action,
    summary,
    detail,
    // Platform staff stepping in for support, not as a member.
    support: Boolean(ctx.platformAdmin) && ctx.membership?.status !== "active",
  })
}

export const newToken = () => randomBytes(16).toString("base64url")

export async function userByEmail(tx: Tx | Db, email: string) {
  const [found] = await tx.select().from(users).where(eq(users.email, email))
  if (found) return found
  // Someone who hasn't signed in yet: the account is waiting for their first sign-in.
  const [created] = await tx
    .insert(users)
    .values({ email, handle: await freeHandle(email) })
    .onConflictDoNothing({ target: users.email })
    .returning()
  if (created) return created
  const [raced] = await tx.select().from(users).where(eq(users.email, email))
  return raced!
}

export async function systemRole(
  tx: Tx | Db,
  orgId: string,
  key: SystemRoleKey
) {
  const [role] = await tx
    .select()
    .from(orgRoles)
    .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.systemKey, key)))
  return role!
}

/** Adds someone as an active member with the Member role, if they aren't one already. */
export async function admitMember(
  tx: Tx | Db,
  org: Organization,
  userId: string,
  joinedVia: string,
  shareProgress: boolean,
  status: "active" | "pending" = "active"
) {
  const [existing] = await tx
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, userId)))
  if (existing?.status === "active") return existing
  if (existing) {
    await tx
      .update(orgMembers)
      .set({ status, shareProgress, joinedVia })
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, userId)))
  } else {
    await tx
      .insert(orgMembers)
      .values({ orgId: org.id, userId, status, shareProgress, joinedVia })
  }
  if (status === "active") await giveRole(tx, org.id, userId, "member", null)
  return { status }
}

export async function giveRole(
  tx: Tx | Db,
  orgId: string,
  userId: string,
  role: SystemRoleKey | string,
  groupId: string | null
) {
  const roleId =
    role in SYSTEM_ROLES
      ? (await systemRole(tx, orgId, role as SystemRoleKey)).id
      : role
  const [already] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.roleId, roleId),
        eq(roleAssignments.userId, userId),
        groupId
          ? eq(roleAssignments.groupId, groupId)
          : isNull(roleAssignments.groupId)
      )
    )
  if (!already) {
    await tx.insert(roleAssignments).values({ orgId, userId, roleId, groupId })
  }
}

export function groupIn(ctx: OrgContext, groupId: string) {
  const group = ctx.groups.find((g) => g.id === groupId)
  if (!group) throw notFound("Group not found")
  return group
}

/*
 * People sit in the last level of the group tree: a section, a team, a subject. Being in
 * a section is what puts them in its year. Someone placed directly in a group that later
 * gets groups inside it is "not placed yet" until moved into one of them.
 */
export const childrenOf = (ctx: OrgContext, id: string) =>
  ctx.groups.filter((g) => g.parentId === id)

export const isLeaf = (ctx: OrgContext, id: string) =>
  childrenOf(ctx, id).length === 0

/**
 * Where someone added to a group actually goes: the group itself if it's the last level,
 * otherwise every last-level group inside it. Adding to "3rd Year" puts them in each
 * section (or each lab inside each section).
 */
export function leavesUnder(ctx: OrgContext, id: string): string[] {
  if (isLeaf(ctx, id)) return [id]
  return ctx.groups
    .filter(
      (g) => g.id !== id && isLeaf(ctx, g.id) && chainOf(ctx, g.id).includes(id)
    )
    .map((g) => g.id)
}

export function needLeaf(ctx: OrgContext, id: string) {
  if (isLeaf(ctx, id)) return
  const group = groupIn(ctx, id)
  throw new ApiError(
    400,
    "not_last_level",
    `People go into the last level. ${group.name} has ${childrenOf(ctx, id)
      .map((g) => g.name)
      .join(", ")} inside it; add them to one of those.`
  )
}

/** Once someone is in a group, they no longer sit directly in the groups above it. */
export async function settleBelow(
  tx: Tx | Db,
  ctx: OrgContext,
  userId: string,
  groupId: string
) {
  const above = chainOf(ctx, groupId).slice(1)
  if (above.length === 0) return
  await tx
    .delete(groupMembers)
    .where(
      and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, above))
    )
}

export async function roleIn(ctx: OrgContext, roleId: string) {
  const [role] = await getDb()
    .select()
    .from(orgRoles)
    .where(and(eq(orgRoles.id, roleId), eq(orgRoles.orgId, ctx.org.id)))
  if (!role) throw notFound("Role not found")
  return role
}

export async function memberOf(ctx: OrgContext, userId: string) {
  const [row] = await getDb()
    .select({ member: orgMembers, user: users })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, userId)))
  if (!row) throw notFound("Member not found")
  return row
}

/* ---------- for organization content (contests, assignments, problems, notices) ---------- */

/** Loads an organization and what this person may do in it. */
export async function orgContext(slug: string, user: User) {
  const ctx = await context(slug, user)
  if (!ctx.org.active && !ctx.platformViewer) {
    if (ctx.org.signupStatus === "pending")
      throw new ApiError(
        403,
        "pending_approval",
        `${ctx.org.name} is waiting for the platform's approval. You'll be told when it's ready.`
      )
    throw forbidden("This organization is suspended.")
  }
  return ctx
}

/** Groups must belong to this organization. */
export function checkAudience(ctx: OrgContext, audience: Audience) {
  for (const id of audienceGroups(audience)) groupIn(ctx, id)
}

/**
 * Allowed for content with this audience: covering all groups of any one condition is
 * enough, since everyone reached is in every condition. Organization-wide content needs
 * an organization-wide grant.
 */
export function canFor(
  ctx: OrgContext,
  permission: Permission,
  audience: Audience
) {
  if (ctx.platformAdmin) return true
  const conditions = audience.filter((c) => c.length > 0)
  return conditions.length === 0
    ? can(ctx, permission)
    : conditions.some((c) => c.every((id) => can(ctx, permission, id)))
}

export function needFor(
  ctx: OrgContext,
  permission: Permission,
  audience: Audience
) {
  if (!canFor(ctx, permission, audience)) {
    throw forbidden(
      audience.length === 0
        ? `"${PERMISSIONS[permission].label}" for the whole organization is needed for this.`
        : `"${PERMISSIONS[permission].label}" is needed for all the groups of one of its conditions.`
    )
  }
}

/** Whether this person has a permission anywhere in the organization. */
export function canAnywhere(ctx: OrgContext, permission: Permission) {
  const scope = scopeOf(ctx, permission)
  return scope === "all" || scope.size > 0
}

/** Ids of groups this person may act on with a permission, or "all". */
export const groupsFor = (ctx: OrgContext, permission: Permission) =>
  scopeOf(ctx, permission)

export async function writeAudit(
  ctx: OrgContext,
  action: string,
  summary: string,
  detail?: Record<string, unknown>
) {
  await audit(getDb(), ctx, action, summary, detail)
}

export { chainOf as groupChain }
