import { randomBytes } from "node:crypto"

import {
  academicYears,
  auditLog,
  getDb,
  groupMembers,
  guardians,
  orgGroups,
  orgInvites,
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
  inAudience,
  type Audience,
  domainMatches,
  enabledModules,
  readAdmissionSettings,
  ORG_VIEW_PERMISSIONS,
  grantsPermission,
  isModuleKey,
  KINDS,
  type ModuleKey,
  moduleAvailable,
  MODULES,
  ORG_TYPE_CONFIG,
  readModuleChoices,
  isPermission,
  PERMISSIONS,
  SYSTEM_ROLES,
  type Grant,
  type Permission,
  type SystemRoleKey,
  changesBetween,
  listChanges,
  yearProblem,
  runProblem,
  type OrgType,
} from "@workspace/judge"
import type { z } from "zod"

import { ApiError, notFound } from "@/lib/api/route"
import {
  auditCsv,
  readAudit,
  writeEntry,
  type AuditFilters,
} from "@/features/audit/server"
import { notify } from "@/features/notifications/server"
import { orgReach, platformCan } from "@/features/platform/access"
import { freeHandle } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"
import { kindPolicies, kindRoleTemplates, moduleOptions } from "./kinds"

import { rolePermissions } from "./access"

import type {
  signupSchema,
  assignRoleSchema,
  importSchema,
  groupSchema,
  groupRunSchema,
  inviteSchema,
  memberUpdateSchema,
  orgCreateSchema,
  orgSettingsSchema,
  roleSchema,
} from "./schemas"
import { orgPages } from "@/lib/paths"

const { and, asc, count, desc, eq, ilike, inArray, isNull, or } = sql

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Keeps `IN (...)` valid when an organization has no groups yet. */
const NO_GROUP = "00000000-0000-0000-0000-000000000000"

const forbidden = (message = "You don't have permission to do that.") =>
  new ApiError(403, "forbidden", message)

/* ---------- who may do what ---------- */

interface OrgContext {
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

async function loadOrg(slug: string) {
  const [org] = await getDb()
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
  if (!org) throw notFound("Organization not found")
  return org
}

async function context(slug: string, user: User): Promise<OrgContext> {
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
  return {
    org,
    user,
    platformAdmin: reach === "act",
    platformViewer: reach !== null,
    membership: membership ?? null,
    // Roles only count while the person is an active member. Platform staff who may look
    // inside every organization see it as with a read-only role across it.
    grants: [
      ...(active ? rows.map((row) => ({ ...row, permissions: rolePermissions(row) })) : []),
      ...(reach === "view" ? [{ permissions: ORG_VIEW_PERMISSIONS, groupId: null, systemKey: null }] : []),
    ],
    groups,
    modules: enabledModules(org.type, org.modules, policies[org.type]),
  }
}

function chainOf(ctx: OrgContext, groupId: string) {
  const parents = new Map(ctx.groups.map((g) => [g.id, g.parentId]))
  return ancestry(groupId, (id) => parents.get(id))
}

const isOwner = (ctx: OrgContext) =>
  ctx.grants.some((g) => g.systemKey === "owner" && g.groupId === null)

function can(ctx: OrgContext, permission: Permission, groupId?: string | null) {
  if (ctx.platformAdmin) return true
  return allows(ctx.grants, permission, groupId ? chainOf(ctx, groupId) : null)
}

function need(
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
function heldFor(ctx: OrgContext, groupId: string | null): Set<string> {
  const chain = groupId ? chainOf(ctx, groupId) : null
  return new Set(
    ctx.grants
      .filter((g) => g.groupId === null || (chain && chain.includes(g.groupId)))
      .flatMap((g) => g.permissions)
  )
}

/** Nobody can hand out more than they have: the guard against giving yourself more. */
function needSubset(
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
function scopeOf(ctx: OrgContext, permission: Permission): "all" | Set<string> {
  if (can(ctx, permission)) return "all"
  const visible = new Set<string>()
  for (const group of ctx.groups) {
    if (can(ctx, permission, group.id)) visible.add(group.id)
  }
  return visible
}

async function audit(
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

const newToken = () => randomBytes(16).toString("base64url")

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

async function systemRole(tx: Tx | Db, orgId: string, key: SystemRoleKey) {
  const [role] = await tx
    .select()
    .from(orgRoles)
    .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.systemKey, key)))
  return role!
}

/** Adds someone as an active member with the Member role, if they aren't one already. */
async function admitMember(
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

async function giveRole(
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

/* ---------- platform ---------- */

/** Running colleges from the platform: the "Manage colleges" permission. */
async function requirePlatformAdmin(user: User) {
  if (!(await platformCan(user, "platform.orgs.create"))) throw forbidden()
}

export async function listAllOrganizations(user: User) {
  await requirePlatformAdmin(user)
  const db = getDb()
  const [rows, members] = await Promise.all([
    db.select().from(organizations).orderBy(asc(organizations.name)),
    db
      .select({ orgId: orgMembers.orgId, total: count() })
      .from(orgMembers)
      .where(eq(orgMembers.status, "active"))
      .groupBy(orgMembers.orgId),
  ])
  return rows.map((org) => ({
    ...org,
    members: members.find((m) => m.orgId === org.id)?.total ?? 0,
  }))
}

export async function createOrganization(
  user: User,
  input: z.infer<typeof orgCreateSchema>
) {
  await requirePlatformAdmin(user)
  return getDb().transaction(async (tx) => {
    const owner = await userByEmail(tx, input.ownerEmail)
    const org = await createOrgInTx(tx, input, owner.id)
    await audit(tx, { org, user }, "org.create", `Created ${org.name}`, {
      owner: input.ownerEmail,
    })
    return org
  })
}

/** A new organization with its system roles and an owner. */
async function createOrgInTx(
  tx: Tx,
  input: { name: string; slug: string; type: OrgType },
  ownerId: string,
  extra: {
    active?: boolean
    signupStatus?: string | null
    listed?: boolean
  } = {}
) {
  const [org] = await tx
    .insert(organizations)
    .values({
      name: input.name,
      slug: input.slug,
      type: input.type,
      groupLevels: ORG_TYPE_CONFIG[input.type].groupLevels,
      ...extra,
    })
    .returning()
  // Built-in roles carry the kind's names (Faculty, Mentor, Manager); permissions are the same.
  const names = KINDS[input.type].roleNames as Record<string, string>
  await tx.insert(orgRoles).values(
    Object.entries(SYSTEM_ROLES).map(([key, role]) => ({
      orgId: org!.id,
      systemKey: key,
      name: names[key] ?? role.name,
      description: role.description,
      permissions: [...role.permissions],
    }))
  )
  // And the kind's suggested roles (a school's Principal, Class teacher…), as ordinary roles.
  const suggested = (await kindRoleTemplates())[input.type]
  if (suggested.length)
    await tx.insert(orgRoles).values(
      suggested.map((r) => ({
        orgId: org!.id,
        systemKey: null,
        templateKey: r.key,
        name: r.name,
        description: r.description,
        permissions: [...r.permissions],
      }))
    ).onConflictDoNothing()
  await admitMember(tx, org!, ownerId, "created", false)
  await giveRole(tx, org!.id, ownerId, "owner", null)
  return org!
}

/* ---------- signing up a school ---------- */

/** Whether and how people may register their own school (a platform setting). */
export async function signupMode() {
  return (await getSettings())["orgs.self_signup"]
}

/**
 * Registers a school (or college, cohort…) with the person signing up as its owner. When
 * sign-ups are reviewed it waits, inactive, for a platform admin; when open it's ready at
 * once. The optional set-up adds the current academic year and grades with sections.
 */
export async function signUpOrganization(
  user: User,
  input: z.infer<typeof signupSchema>
) {
  const mode = await signupMode()
  if (mode === "off")
    throw new ApiError(
      403,
      "signup_off",
      "Registering a school here is switched off. Ask the site's admins."
    )
  const db = getDb()
  // A few a day per person, so the directory can't be flooded.
  const [recent] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorId, user.id),
        eq(auditLog.action, "org.signup"),
        sql.gt(auditLog.createdAt, new Date(Date.now() - 86_400_000))
      )
    )
  if (Number(recent?.n ?? 0) >= 3)
    throw new ApiError(
      429,
      "too_many",
      "You've registered 3 today. Try again tomorrow."
    )
  if (input.year) {
    const problem = yearProblem(input.year)
    if (problem) throw new ApiError(400, "bad_year", problem)
  }
  if (input.grades && input.grades.to < input.grades.from)
    throw new ApiError(
      400,
      "bad_grades",
      "The last grade can't come before the first."
    )
  if (
    input.grades &&
    new Set(input.grades.sections.map((s) => s.toLowerCase())).size !==
      input.grades.sections.length
  )
    throw new ApiError(400, "bad_grades", "Each section once.")
  const [taken] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, input.slug))
  if (taken)
    throw new ApiError(
      409,
      "slug_taken",
      "That web address is taken. Try another."
    )
  const pending = mode === "review"
  const org = await db.transaction(async (tx) => {
    const org = await createOrgInTx(
      tx,
      input,
      user.id,
      pending ? { active: false, signupStatus: "pending" } : {}
    )
    if (input.year)
      await tx
        .insert(academicYears)
        .values({ orgId: org.id, ...input.year, isCurrent: true })
    if (input.grades) {
      const levels = ORG_TYPE_CONFIG[input.type].groupLevels
      for (let n = input.grades.from; n <= input.grades.to; n++) {
        const [grade] = await tx
          .insert(orgGroups)
          .values({ orgId: org.id, name: `${levels[0] ?? "Grade"} ${n}` })
          .returning()
        if (levels.length > 1)
          await tx
            .insert(orgGroups)
            .values(
              input.grades.sections.map((name) => ({
                orgId: org.id,
                parentId: grade!.id,
                name,
              }))
            )
      }
    }
    await audit(
      tx,
      { org, user },
      "org.signup",
      `Registered ${org.name}${pending ? ", waiting for approval" : ""}`,
      {
        year: input.year?.name ?? null,
        grades: input.grades
          ? `${input.grades.from}-${input.grades.to} × ${input.grades.sections.length}`
          : null,
      }
    )
    return org
  })
  if (pending) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
    await notify(
      admins.map((a) => a.id),
      {
        kind: "school_signup",
        title: `${org.name} asks to join the platform`,
        body: `Registered by ${user.name ?? user.email}. Approve it in Organizations.`,
        href: "/admin/organizations",
      }
    )
  }
  return { slug: org.slug, name: org.name, pending }
}

export async function setOrganizationActive(
  user: User,
  id: string,
  active: boolean
) {
  await requirePlatformAdmin(user)
  const [before] = await getDb()
    .select({ signupStatus: organizations.signupStatus })
    .from(organizations)
    .where(eq(organizations.id, id))
  const approving = active && before?.signupStatus === "pending"
  const [org] = await getDb()
    .update(organizations)
    .set(approving ? { active, signupStatus: null } : { active })
    .where(eq(organizations.id, id))
    .returning()
  if (!org) throw notFound("Organization not found")
  await audit(
    getDb(),
    { org, user },
    approving ? "org.approve" : "org.active",
    approving ? "Approved the sign-up" : active ? "Reactivated" : "Suspended"
  )
  if (approving) {
    const owners = await getDb()
      .select({ id: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(
        and(eq(roleAssignments.orgId, org.id), eq(orgRoles.systemKey, "owner"))
      )
    await notify(
      owners.map((o) => o.id),
      {
        kind: "school_approved",
        title: `${org.name} is approved`,
        body: "It's ready to use: add your staff, classes and students.",
        href: orgPages(org.slug).home,
        orgId: org.id,
      }
    )
  }
  return org
}

/* ---------- directory, joining and leaving ---------- */

export async function listDirectory(query: string) {
  const db = getDb()
  const q = query.trim()
  const rows = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.listed, true),
        eq(organizations.active, true),
        q ? ilike(organizations.name, `%${q.replaceAll("%", "")}%`) : undefined
      )
    )
    .orderBy(asc(organizations.name))
    .limit(100)
  const members = rows.length
    ? await db
        .select({ orgId: orgMembers.orgId, total: count() })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.status, "active"),
            inArray(
              orgMembers.orgId,
              rows.map((r) => r.id)
            )
          )
        )
        .groupBy(orgMembers.orgId)
    : []
  return rows.map((org) => ({
    slug: org.slug,
    name: org.name,
    type: org.type,
    description: org.description,
    joinPolicy: org.joinPolicy,
    members: members.find((m) => m.orgId === org.id)?.total ?? 0,
  }))
}

/** How this person can get in: at once, by asking, or only with an invite. */
function joinOptionFor(org: Organization, user: User | null) {
  if (!org.active) return "closed" as const
  if (user && domainMatches(user.email, org.emailDomains))
    return "join" as const
  if (org.joinPolicy === "open") return "join" as const
  if (org.joinPolicy === "approval") return "request" as const
  return "invite_only" as const
}

export async function getOrganization(slug: string, viewer: User | null) {
  const org = await loadOrg(slug)
  const ctx = viewer ? await context(slug, viewer) : null
  const isMember = ctx?.membership?.status === "active"
  // Unlisted organizations are only visible to their members.
  if ((!org.listed || !org.active) && !isMember && !ctx?.platformViewer) {
    throw notFound("Organization not found")
  }
  const [counted] = await getDb()
    .select({ total: count() })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.status, "active")))
  const permissions = ctx ? heldAnywhere(ctx) : []
  const policies = await kindPolicies()
  return {
    slug: org.slug,
    name: org.name,
    type: org.type,
    description: org.description,
    website: org.website,
    groupLevels: org.groupLevels,
    members: counted?.total ?? 0,
    joinOption: joinOptionFor(org, viewer),
    membership: ctx?.membership
      ? {
          status: ctx.membership.status,
          shareProgress: ctx.membership.shareProgress,
          roles: [...new Set(ctx.grants.map((g) => g.systemKey ?? "custom"))],
        }
      : null,
    /** Management permissions this viewer has anywhere in the organization. */
    permissions,
    canManage: permissions.length > 0,
    /** Signed up on the site and waiting for a platform admin (shown to its members). */
    pendingApproval: isMember && org.signupStatus === "pending",
    /** Taking applications now (Admissions module): the page offers to apply. */
    admissionsOpen: (() => {
      const modules = enabledModules(org.type, org.modules, policies[org.type])
      const a = readAdmissionSettings(org.moduleSettings)
      return (
        modules.has("admissions") &&
        modules.has("records") &&
        a.open &&
        !!a.yearId
      )
    })(),
  }
}

export async function joinOrganization(
  slug: string,
  user: User,
  shareProgress: boolean
) {
  const org = await loadOrg(slug)
  const option = joinOptionFor(org, user)
  if (option === "closed")
    throw forbidden("This organization isn't taking members.")
  if (option === "invite_only") {
    throw forbidden("This organization only takes members with an invite link.")
  }
  const via = domainMatches(user.email, org.emailDomains) ? "domain" : "open"
  const joined = await getDb().transaction(async (tx) => {
    const result = await admitMember(
      tx,
      org,
      user.id,
      option === "join" ? via : "approval",
      shareProgress,
      option === "join" ? "active" : "pending"
    )
    await audit(
      tx,
      { org, user },
      option === "join" ? "member.join" : "member.request",
      option === "join" ? `${user.email} joined` : `${user.email} asked to join`
    )
    return { status: result.status }
  })
  // People who can let them in hear that someone is waiting.
  if (joined.status === "pending") {
    await notify(await membersWhoCan(org.id, "org.members.approve"), {
      kind: "join_request",
      title: `${user.name ?? user.email} asked to join ${org.name}`,
      body: "Approve or decline them under Manage › Members.",
      href: orgPages(org.slug).manage(`/members?status=pending`),
      orgId: org.id,
    })
  }
  return joined
}

/** Active members whose role gives them a permission for the whole organization. */
export async function membersWhoCan(orgId: string, permission: Permission) {
  const rows = await getDb()
    .select({
      userId: roleAssignments.userId,
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, roleAssignments.orgId),
        eq(orgMembers.userId, roleAssignments.userId)
      )
    )
    .where(
      and(
        eq(roleAssignments.orgId, orgId),
        isNull(roleAssignments.groupId),
        eq(orgMembers.status, "active")
      )
    )
  return [
    ...new Set(
      rows
        .filter((r) => grantsPermission(rolePermissions(r), permission))
        .map((r) => r.userId)
    ),
  ]
}

export async function leaveOrganization(slug: string, user: User) {
  const ctx = await context(slug, user)
  if (!ctx.membership) throw notFound("You aren't a member")
  if (isOwner(ctx) && (await ownerCount(ctx.org.id)) <= 1) {
    throw new ApiError(
      409,
      "last_owner",
      "You're the only owner. Make someone else an owner before leaving."
    )
  }
  await getDb().transaction(async (tx) => {
    await removeFromOrg(tx, ctx.org.id, user.id)
    await audit(tx, ctx, "member.leave", `${user.email} left`)
  })
}

async function removeFromOrg(tx: Tx, orgId: string, userId: string) {
  await tx
    .delete(roleAssignments)
    .where(
      and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.userId, userId))
    )
  const groupIds = tx
    .select({ id: orgGroups.id })
    .from(orgGroups)
    .where(eq(orgGroups.orgId, orgId))
  await tx
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        inArray(groupMembers.groupId, groupIds)
      )
    )
  await tx
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
}

async function ownerCount(orgId: string) {
  const owner = await systemRole(getDb(), orgId, "owner")
  const rows = await getDb()
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.userId, roleAssignments.userId),
        eq(orgMembers.orgId, roleAssignments.orgId),
        eq(orgMembers.status, "active")
      )
    )
    .where(
      and(eq(roleAssignments.roleId, owner.id), isNull(roleAssignments.groupId))
    )
  return new Set(rows.map((r) => r.userId)).size
}

export async function myOrganizations(user: User) {
  const db = getDb()
  const rows = await db
    .select({ org: organizations, membership: orgMembers })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, user.id))
    .orderBy(asc(organizations.name))
  const grants = rows.length
    ? await db
        .select({
          orgId: roleAssignments.orgId,
          name: orgRoles.name,
          systemKey: orgRoles.systemKey,
          permissions: orgRoles.permissions,
          group: orgGroups.name,
        })
        .from(roleAssignments)
        .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
        .leftJoin(orgGroups, eq(roleAssignments.groupId, orgGroups.id))
        .where(eq(roleAssignments.userId, user.id))
    : []
  return rows.map(({ org, membership }) => {
    const own = grants.filter((g) => g.orgId === org.id)
    return {
      slug: org.slug,
      name: org.name,
      type: org.type,
      status: membership.status,
      shareProgress: membership.shareProgress,
      // Everyone is a member, so that role is only worth naming when it's the only one.
      roles: (own.some((g) => g.systemKey !== "member")
        ? own.filter((g) => g.systemKey !== "member")
        : own
      ).map((g) => (g.group ? `${g.name} (${g.group})` : g.name)),
      canManage:
        membership.status === "active" &&
        own.some((g) => rolePermissions(g).length > 0),
    }
  })
}

export async function setShareProgress(
  slug: string,
  user: User,
  value: boolean
) {
  const ctx = await context(slug, user)
  if (!ctx.membership) throw notFound("You aren't a member")
  await getDb()
    .update(orgMembers)
    .set({ shareProgress: value })
    .where(
      and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, user.id))
    )
}

/* ---------- invites ---------- */

async function findInvite(token: string) {
  const [row] = await getDb()
    .select({
      invite: orgInvites,
      org: organizations,
      role: orgRoles,
      group: orgGroups,
    })
    .from(orgInvites)
    .innerJoin(organizations, eq(orgInvites.orgId, organizations.id))
    .leftJoin(orgRoles, eq(orgInvites.roleId, orgRoles.id))
    .leftJoin(orgGroups, eq(orgInvites.groupId, orgGroups.id))
    .where(eq(orgInvites.token, token))
  if (!row) throw notFound("This invite link doesn't exist.")
  const { invite } = row
  const problem = invite.revokedAt
    ? "This invite link was turned off."
    : invite.expiresAt && invite.expiresAt < new Date()
      ? "This invite link has expired."
      : invite.maxUses !== null && invite.uses >= invite.maxUses
        ? "This invite link has been used up."
        : !row.org.active
          ? "This organization isn't taking members."
          : null
  return { ...row, problem }
}

export async function getInvite(token: string, viewer: User | null) {
  const { invite, org, role, group, problem } = await findInvite(token)
  const wrongPerson =
    invite.email && viewer && viewer.email !== invite.email
      ? "This invite is for a different email address."
      : null
  return {
    org: {
      slug: org.slug,
      name: org.name,
      type: org.type,
      description: org.description,
    },
    role: role?.name ?? "Member",
    group: group?.name ?? null,
    forEmail: invite.email,
    problem: problem ?? wrongPerson,
  }
}

export async function acceptInvite(
  token: string,
  user: User,
  shareProgress: boolean
) {
  const { invite, org, problem } = await findInvite(token)
  if (problem) throw new ApiError(410, "invite_unusable", problem)
  if (invite.email && invite.email !== user.email) {
    throw forbidden("This invite is for a different email address.")
  }
  return getDb().transaction(async (tx) => {
    // Counted atomically, so a limited link can't be used more times than allowed.
    const [claimed] = await tx
      .update(orgInvites)
      .set({ uses: sql.sql`${orgInvites.uses} + 1` })
      .where(
        and(
          eq(orgInvites.id, invite.id),
          or(
            isNull(orgInvites.maxUses),
            sql.lt(orgInvites.uses, orgInvites.maxUses)
          )
        )
      )
      .returning()
    if (!claimed)
      throw new ApiError(
        410,
        "invite_unusable",
        "This invite link has been used up."
      )
    await admitMember(tx, org, user.id, "invite", shareProgress)
    if (invite.roleId)
      await giveRole(tx, org.id, user.id, invite.roleId, invite.groupId)
    if (invite.groupId) {
      const [inside] = await tx
        .select({ id: orgGroups.id })
        .from(orgGroups)
        .where(eq(orgGroups.parentId, invite.groupId))
        .limit(1)
      const [role] = invite.roleId
        ? await tx.select().from(orgRoles).where(eq(orgRoles.id, invite.roleId))
        : []
      const staff = role ? rolePermissions(role).length > 0 : false
      // A teacher's role can cover a branch without them sitting in it. A student joins
      // every last-level group inside the invite's group, as it is now.
      if (!inside) {
        await tx
          .insert(groupMembers)
          .values({ groupId: invite.groupId, userId: user.id })
          .onConflictDoNothing()
      } else if (!staff) {
        const all = await tx
          .select({ id: orgGroups.id, parentId: orgGroups.parentId })
          .from(orgGroups)
          .where(eq(orgGroups.orgId, org.id))
        const parentOf = new Map(all.map((g) => [g.id, g.parentId]))
        const leaves = all.filter(
          (g) =>
            !all.some((x) => x.parentId === g.id) &&
            ancestry(g.id, (x) => parentOf.get(x)).includes(invite.groupId!)
        )
        if (leaves.length) {
          await tx
            .insert(groupMembers)
            .values(leaves.map((g) => ({ groupId: g.id, userId: user.id })))
            .onConflictDoNothing()
        }
      }
    }
    await audit(
      tx,
      { org, user },
      "member.invite_used",
      `${user.email} joined with an invite`,
      {
        invite: invite.label || invite.id,
      }
    )
    return { slug: org.slug }
  })
}

export async function listInvites(slug: string, user: User) {
  const ctx = await context(slug, user)
  need(ctx, "org.members.invite")
  const rows = await getDb()
    .select({ invite: orgInvites, role: orgRoles.name, group: orgGroups.name })
    .from(orgInvites)
    .leftJoin(orgRoles, eq(orgInvites.roleId, orgRoles.id))
    .leftJoin(orgGroups, eq(orgInvites.groupId, orgGroups.id))
    .where(eq(orgInvites.orgId, ctx.org.id))
    .orderBy(desc(orgInvites.createdAt))
  return rows.map(({ invite, role, group }) => ({
    id: invite.id,
    token: invite.token,
    label: invite.label,
    role: role ?? "Member",
    group,
    email: invite.email,
    uses: invite.uses,
    maxUses: invite.maxUses,
    expiresAt: invite.expiresAt,
    revoked: invite.revokedAt !== null,
    createdAt: invite.createdAt,
  }))
}

export async function createInvite(
  slug: string,
  user: User,
  input: z.infer<typeof inviteSchema>
) {
  const ctx = await context(slug, user)
  need(ctx, "org.members.invite", input.groupId)
  if (input.groupId) groupIn(ctx, input.groupId)
  if (input.roleId) {
    const role = await roleIn(ctx, input.roleId)
    if (role.systemKey === "owner")
      throw forbidden("Owners can't be added by invite.")
    needSubset(ctx, rolePermissions(role), input.groupId)
  }
  return getDb().transaction(async (tx) => {
    const [invite] = await tx
      .insert(orgInvites)
      .values({
        orgId: ctx.org.id,
        token: newToken(),
        label: input.label,
        roleId: input.roleId,
        groupId: input.groupId,
        email: input.email,
        maxUses: input.email ? 1 : input.maxUses,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
        createdBy: user.id,
      })
      .returning()
    await audit(
      tx,
      ctx,
      "invite.create",
      `Created invite "${input.label || "link"}"`
    )
    return invite!
  })
}

export async function revokeInvite(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  need(ctx, "org.members.invite")
  await getDb().transaction(async (tx) => {
    const [invite] = await tx
      .update(orgInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(orgInvites.id, id), eq(orgInvites.orgId, ctx.org.id)))
      .returning()
    if (!invite) throw notFound("Invite not found")
    await audit(
      tx,
      ctx,
      "invite.revoke",
      `Turned off invite "${invite.label || "link"}"`
    )
  })
}

/* ---------- management ---------- */

function groupIn(ctx: OrgContext, groupId: string) {
  const group = ctx.groups.find((g) => g.id === groupId)
  if (!group) throw notFound("Group not found")
  return group
}

/*
 * People sit in the last level of the group tree: a section, a team, a subject. Being in
 * a section is what puts them in its year. Someone placed directly in a group that later
 * gets groups inside it is "not placed yet" until moved into one of them.
 */
const childrenOf = (ctx: OrgContext, id: string) =>
  ctx.groups.filter((g) => g.parentId === id)

const isLeaf = (ctx: OrgContext, id: string) => childrenOf(ctx, id).length === 0

/**
 * Where someone added to a group actually goes: the group itself if it's the last level,
 * otherwise every last-level group inside it. Adding to "3rd Year" puts them in each
 * section (or each lab inside each section).
 */
function leavesUnder(ctx: OrgContext, id: string): string[] {
  if (isLeaf(ctx, id)) return [id]
  return ctx.groups
    .filter(
      (g) => g.id !== id && isLeaf(ctx, g.id) && chainOf(ctx, g.id).includes(id)
    )
    .map((g) => g.id)
}

function needLeaf(ctx: OrgContext, id: string) {
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
async function settleBelow(
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

async function roleIn(ctx: OrgContext, roleId: string) {
  const [role] = await getDb()
    .select()
    .from(orgRoles)
    .where(and(eq(orgRoles.id, roleId), eq(orgRoles.orgId, ctx.org.id)))
  if (!role) throw notFound("Role not found")
  return role
}

export async function getManageSummary(slug: string, user: User) {
  const ctx = await context(slug, user)
  const permissions = heldAnywhere(ctx)
  if (permissions.length === 0) throw forbidden()
  const db = getDb()
  const total = async (query: Promise<{ total: number }[]>) =>
    (await query)[0]?.total ?? 0
  const [members, pending, invites] = await Promise.all([
    total(
      db
        .select({ total: count() })
        .from(orgMembers)
        .where(
          and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.status, "active"))
        )
    ),
    total(
      db
        .select({ total: count() })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, ctx.org.id),
            eq(orgMembers.status, "pending")
          )
        )
    ),
    total(
      db
        .select({ total: count() })
        .from(orgInvites)
        .where(
          and(eq(orgInvites.orgId, ctx.org.id), isNull(orgInvites.revokedAt))
        )
    ),
  ])
  return {
    org: {
      slug: ctx.org.slug,
      name: ctx.org.name,
      type: ctx.org.type,
      description: ctx.org.description,
      website: ctx.org.website ?? "",
      listed: ctx.org.listed,
      joinPolicy: ctx.org.joinPolicy,
      emailDomains: ctx.org.emailDomains,
      groupLevels: ctx.org.groupLevels,
      active: ctx.org.active,
      languages: ctx.org.languages,
      allowPaste: ctx.org.allowPaste,
      /** What this org chose, over its type's defaults. */
      moduleChoices: readModuleChoices(ctx.org.modules),
      /** The modules on right now (defaults + choices, limited to the type and ready ones). */
      modules: [...ctx.modules],
      /** Modules this kind may have here, with the platform's level (optional or on by default). */
      moduleOptions: await moduleOptions(ctx.org.type),
      /** What the kind is, in its own words (it can't be changed). */
      kind: {
        label: KINDS[ctx.org.type].label,
        description: KINDS[ctx.org.type].description,
        terms: KINDS[ctx.org.type].terms,
      },
    },
    permissions,
    /** Whether a permission reaches the whole organization, not just some groups. */
    orgWide: permissions.filter((p) => can(ctx, p)),
    isOwner: isOwner(ctx) || ctx.platformAdmin,
    counts: {
      members,
      pending,
      groups: ctx.groups.length,
      invites,
    },
  }
}

export async function updateSettings(
  slug: string,
  user: User,
  input: z.infer<typeof orgSettingsSchema>
) {
  const ctx = await context(slug, user)
  need(ctx, "org.settings.manage")
  // An organization's kind is chosen once, when it's created, and never changed.
  if (input.type !== undefined && input.type !== ctx.org.type)
    throw new ApiError(
      409,
      "kind_locked",
      `${ctx.org.name} is a ${KINDS[ctx.org.type].label.toLowerCase()}; the kind of an organization can't be changed. Create a new organization for another kind.`
    )
  input = { ...input, type: undefined }
  if (input.modules) {
    const type = ctx.org.type
    const policy = (await kindPolicies())[type]
    for (const [key, on] of Object.entries(input.modules)) {
      if (!on || !isModuleKey(key)) continue
      if (!moduleAvailable(type, key, policy)) {
        throw new ApiError(
          400,
          "module_unavailable",
          `${MODULES[key].label} isn't available for this kind of organization yet.`
        )
      }
    }
    input = {
      ...input,
      modules: { ...readModuleChoices(ctx.org.modules), ...input.modules },
    }
  }
  if (input.groupLevels) {
    const deepest = Math.max(
      0,
      ...ctx.groups.map((g) => chainOf(ctx, g.id).length)
    )
    if (input.groupLevels.length < deepest) {
      const deep = ctx.groups.filter(
        (g) => chainOf(ctx, g.id).length === deepest
      )
      throw new ApiError(
        400,
        "levels_in_use",
        `Groups go ${deepest} levels deep (for example ${deep
          .slice(0, 3)
          .map((g) => g.name)
          .join(", ")}). Delete or move those before removing a level.`
      )
    }
  }
  return getDb().transaction(async (tx) => {
    const [org] = await tx
      .update(organizations)
      .set({ ...input, website: input.website === "" ? null : input.website })
      .where(eq(organizations.id, ctx.org.id))
      .returning()
    const changes = changesBetween(ctx.org, org!, SETTING_LABELS)
    const moduleLabel = (key: string) =>
      MODULES[key as keyof typeof MODULES]?.label ?? key
    const lists = [
      listChanges(
        "Modules",
        [...ctx.modules].map(moduleLabel),
        [
          ...enabledModules(
            org!.type,
            org!.modules,
            (await kindPolicies())[org!.type]
          ),
        ].map(moduleLabel)
      ),
    ].filter(Boolean)
    const what = [...changes.map((c) => c.field), ...lists.map((l) => l!.label)]
    await audit(
      tx,
      ctx,
      "org.settings",
      what.length
        ? `Changed ${what.join(", ").toLowerCase()}`
        : "Saved the settings unchanged",
      { changes, lists }
    )
    return org!
  })
}

/** What someone is here, for reading and filtering the members list. */
export type MemberKind = "staff" | "learner" | "parent" | "other"

const MEMBERS_PER_PAGE = 100

/**
 * The members this person may see. With `page`, one page of 100 (filtered by `kind`) and
 * the counts of each kind, for the Members screen; without it, everyone, for pickers and
 * integrations.
 */
export async function listMembers(
  slug: string,
  user: User,
  filter: { groupId?: string; status?: string; q?: string }
): Promise<Awaited<ReturnType<typeof allMembers>>>
export async function listMembers(
  slug: string,
  user: User,
  filter: { groupId?: string; status?: string; q?: string; kind?: string; page: number }
): Promise<{
  members: Awaited<ReturnType<typeof allMembers>>
  total: number
  page: number
  pages: number
  counts: Record<MemberKind, number> & { all: number }
}>
export async function listMembers(
  slug: string,
  user: User,
  filter: { groupId?: string; status?: string; q?: string; kind?: string; page?: number }
) {
  const all = await allMembers(slug, user, filter)
  if (!filter.page) return all
  const kindOf = (m: (typeof all)[number]): MemberKind =>
    m.roles.some((r) => r.grants)
      ? "staff"
      : m.groupIds.length > 0
        ? "learner"
        : m.children.length > 0
          ? "parent"
          : "other"
  const counts = { all: all.length, staff: 0, learner: 0, parent: 0, other: 0 }
  for (const m of all) counts[kindOf(m)]++
  const shown = filter.kind ? all.filter((m) => kindOf(m) === filter.kind) : all
  const pages = Math.max(1, Math.ceil(shown.length / MEMBERS_PER_PAGE))
  const page = Math.min(Math.max(1, filter.page), pages)
  return {
    members: shown.slice((page - 1) * MEMBERS_PER_PAGE, page * MEMBERS_PER_PAGE),
    total: shown.length,
    page,
    pages,
    counts,
  }
}

async function allMembers(
  slug: string,
  user: User,
  filter: { groupId?: string; status?: string; q?: string }
) {
  const ctx = await context(slug, user)
  const scope = scopeOf(ctx, "org.members.view")
  const canApprove = can(ctx, "org.members.invite")
  if (scope !== "all" && scope.size === 0 && !canApprove) throw forbidden()
  const db = getDb()
  const rows = await db
    .select({ member: orgMembers, user: users })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        filter.status === "pending"
          ? eq(orgMembers.status, "pending")
          : undefined,
        filter.q
          ? or(
              ilike(users.email, `%${filter.q.replaceAll("%", "")}%`),
              ilike(users.name, `%${filter.q.replaceAll("%", "")}%`)
            )
          : undefined
      )
    )
    .orderBy(asc(users.name), asc(users.email))
  const ids = rows.map((r) => r.user.id)
  const [memberships, assignments, families] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(groupMembers)
          .where(
            and(
              inArray(groupMembers.userId, ids),
              inArray(groupMembers.groupId, [
                ...ctx.groups.map((g) => g.id),
                NO_GROUP,
              ])
            )
          ),
        db
          .select({ assignment: roleAssignments, role: orgRoles })
          .from(roleAssignments)
          .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
          .where(
            and(
              eq(roleAssignments.orgId, ctx.org.id),
              inArray(roleAssignments.userId, ids)
            )
          ),
        // Whose parent each one is here, so the list can say so.
        db
          .select({ parentId: guardians.parentId, name: users.name, email: users.email })
          .from(guardians)
          .innerJoin(users, eq(guardians.studentId, users.id))
          .where(
            and(eq(guardians.orgId, ctx.org.id), inArray(guardians.parentId, ids))
          ),
      ])
    : [[], [], []]

  const inScope = (userId: string) => {
    if (scope === "all") return true
    return memberships.some(
      (m) =>
        m.userId === userId && chainOf(ctx, m.groupId).some((g) => scope.has(g))
    )
  }
  return rows
    .filter(({ member, user: person }) =>
      member.status === "pending" ? canApprove : inScope(person.id)
    )
    .filter(({ user: person }) => {
      if (!filter.groupId) return true
      return memberships.some(
        (m) =>
          m.userId === person.id &&
          chainOf(ctx, m.groupId).includes(filter.groupId!)
      )
    })
    .map(({ member, user: person }) => ({
      userId: person.id,
      name: person.name,
      email: person.email,
      handle: person.handle,
      status: member.status,
      joinedVia: member.joinedVia,
      joinedAt: member.createdAt,
      shareProgress: member.shareProgress,
      groupIds: memberships
        .filter((m) => m.userId === person.id)
        .map((m) => m.groupId),
      roles: assignments
        .filter((a) => a.assignment.userId === person.id)
        .map((a) => ({
          assignmentId: a.assignment.id,
          roleId: a.role.id,
          name: a.role.name,
          systemKey: a.role.systemKey,
          groupId: a.assignment.groupId,
          /** Whether the role grants anything (else it's the plain Member role). */
          grants: rolePermissions(a.role).length > 0,
        })),
      /** The children they're a parent of here (names), if any. */
      children: families
        .filter((f) => f.parentId === person.id)
        .map((f) => f.name ?? f.email),
    }))
}

async function memberOf(ctx: OrgContext, userId: string) {
  const [row] = await getDb()
    .select({ member: orgMembers, user: users })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, userId)))
  if (!row) throw notFound("Member not found")
  return row
}

export async function updateMember(
  slug: string,
  user: User,
  memberId: string,
  input: z.infer<typeof memberUpdateSchema>
) {
  const ctx = await context(slug, user)
  const { member, user: person } = await memberOf(ctx, memberId)
  return getDb().transaction(async (tx) => {
    if (input.status === "active" && member.status === "pending") {
      need(ctx, "org.members.approve")
      await admitMember(tx, ctx.org, memberId, "approval", member.shareProgress)
      await audit(tx, ctx, "member.approve", `Approved ${person.email}`)
    }
    if (input.groupIds) {
      for (const id of input.groupIds) groupIn(ctx, id)
      const current = (
        await tx
          .select()
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.userId, memberId),
              inArray(groupMembers.groupId, [
                ...ctx.groups.map((g) => g.id),
                NO_GROUP,
              ])
            )
          )
      ).map((m) => m.groupId)
      // A group with groups inside stands for every last-level group in it.
      const wanted = [
        ...new Set(
          input.groupIds.flatMap((id) =>
            current.includes(id) ? [id] : leavesUnder(ctx, id)
          )
        ),
      ]
      const added = wanted.filter((id) => !current.includes(id))
      const removed = current.filter((id) => !wanted.includes(id))
      // Each group touched must be one this person may manage.
      for (const id of [...added, ...removed])
        need(ctx, "org.members.groups", id)
      if (removed.length) {
        await tx
          .delete(groupMembers)
          .where(
            and(
              eq(groupMembers.userId, memberId),
              inArray(groupMembers.groupId, removed)
            )
          )
      }
      if (added.length) {
        await tx
          .insert(groupMembers)
          .values(added.map((groupId) => ({ groupId, userId: memberId })))
          .onConflictDoNothing()
        for (const id of added) await settleBelow(tx, ctx, memberId, id)
      }
      if (added.length || removed.length) {
        const names = (ids: string[]) =>
          ids.map((id) => groupIn(ctx, id).name).join(", ")
        await audit(
          tx,
          ctx,
          "member.groups",
          `Moved ${person.email}${added.length ? ` into ${names(added)}` : ""}${removed.length ? ` out of ${names(removed)}` : ""}`
        )
      }
    }
  })
}

export async function removeMember(slug: string, user: User, memberId: string) {
  const ctx = await context(slug, user)
  const { member, user: person } = await memberOf(ctx, memberId)
  if (member.status === "pending") need(ctx, "org.members.approve")
  else need(ctx, "org.members.remove")
  const target = await context(slug, person)
  if (isOwner(target) && !isOwner(ctx) && !ctx.platformAdmin) {
    throw forbidden("Only an owner can remove an owner.")
  }
  if (isOwner(target) && (await ownerCount(ctx.org.id)) <= 1) {
    throw new ApiError(
      409,
      "last_owner",
      "This is the only owner; make someone else an owner first."
    )
  }
  await getDb().transaction(async (tx) => {
    await removeFromOrg(tx, ctx.org.id, memberId)
    await audit(
      tx,
      ctx,
      member.status === "pending" ? "member.decline" : "member.remove",
      member.status === "pending"
        ? `Declined ${person.email}`
        : `Removed ${person.email}`
    )
  })
}

export async function assignRole(
  slug: string,
  user: User,
  memberId: string,
  input: z.infer<typeof assignRoleSchema>
) {
  const ctx = await context(slug, user)
  need(ctx, "org.members.assign_roles", input.groupId)
  const { member, user: person } = await memberOf(ctx, memberId)
  if (member.status !== "active")
    throw new ApiError(409, "pending", "Approve the request first.")
  if (input.groupId) groupIn(ctx, input.groupId)
  const role = await roleIn(ctx, input.roleId)
  if (role.systemKey === "owner") {
    if (!isOwner(ctx) && !ctx.platformAdmin)
      throw forbidden("Only an owner can make owners.")
    if (input.groupId)
      throw new ApiError(
        400,
        "owner_scope",
        "Owners are always organization-wide."
      )
  }
  needSubset(ctx, rolePermissions(role), input.groupId)
  await getDb().transaction(async (tx) => {
    await giveRole(tx, ctx.org.id, memberId, role.id, input.groupId)
    await audit(
      tx,
      ctx,
      "role.assign",
      `Gave ${person.email} the ${role.name} role${input.groupId ? ` in ${groupIn(ctx, input.groupId).name}` : ""}`
    )
  })
}

export async function unassignRole(
  slug: string,
  user: User,
  assignmentId: string
) {
  const ctx = await context(slug, user)
  const [row] = await getDb()
    .select({ assignment: roleAssignments, role: orgRoles, user: users })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .innerJoin(users, eq(roleAssignments.userId, users.id))
    .where(
      and(
        eq(roleAssignments.id, assignmentId),
        eq(roleAssignments.orgId, ctx.org.id)
      )
    )
  if (!row) throw notFound("Role not found")
  need(ctx, "org.members.assign_roles", row.assignment.groupId)
  if (row.role.systemKey === "member") {
    throw new ApiError(
      400,
      "member_role",
      "Everyone in the organization keeps the Member role."
    )
  }
  if (row.role.systemKey === "owner") {
    if (!isOwner(ctx) && !ctx.platformAdmin)
      throw forbidden("Only an owner can remove an owner.")
    if ((await ownerCount(ctx.org.id)) <= 1) {
      throw new ApiError(
        409,
        "last_owner",
        "Every organization needs at least one owner."
      )
    }
  }
  needSubset(ctx, rolePermissions(row.role), row.assignment.groupId)
  await getDb().transaction(async (tx) => {
    await tx.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId))
    await audit(
      tx,
      ctx,
      "role.unassign",
      `Took the ${row.role.name} role from ${row.user.email}`
    )
  })
}

/* ---------- groups ---------- */

export async function listGroups(slug: string, user: User) {
  const ctx = await context(slug, user)
  const rows = ctx.groups.length
    ? await getDb()
        .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          inArray(
            groupMembers.groupId,
            ctx.groups.map((g) => g.id)
          )
        )
    : []
  const leadIds = [...new Set(ctx.groups.flatMap((g) => (g.leadId ? [g.leadId] : [])))]
  const leads = leadIds.length
    ? (
        await getDb()
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, leadIds))
      ).map((u) => ({ id: u.id, name: u.name ?? u.email }))
    : []
  const kind = KINDS[ctx.org.type]
  return {
    levels: ctx.org.groupLevels,
    run: {
      dates: kind.groupDates,
      lead: kind.leadPerGroup,
      leadTerm: kind.terms.groupLead,
      open: kind.openGroups,
    },
    canManageAll: can(ctx, "org.groups.manage"),
    groups: ctx.groups
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => {
        const direct = rows.filter((r) => r.groupId === g.id).length
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          parentId: g.parentId,
          depth: chainOf(ctx, g.id).length - 1,
          // Everyone in it or in a group inside it, counted once.
          members: new Set(
            rows
              .filter((r) => chainOf(ctx, r.groupId).includes(g.id))
              .map((r) => r.userId)
          ).size,
          // People sitting directly in a group that now has groups inside it.
          notPlaced: isLeaf(ctx, g.id) ? 0 : direct,
          canManage: can(ctx, "org.groups.manage", g.id),
          canEdit: can(ctx, "org.groups.edit", g.id),
          startsOn: g.startsOn,
          endsOn: g.endsOn,
          open: g.open,
          lead: g.leadId ? (leads.find((l) => l.id === g.leadId) ?? null) : null,
        }
      }),
  }
}

export async function createGroup(
  slug: string,
  user: User,
  input: z.infer<typeof groupSchema>
) {
  const ctx = await context(slug, user)
  // Top-level groups need the permission org-wide; subgroups, on their parent.
  need(ctx, "org.groups.create", input.parentId)
  if (input.parentId) {
    const depth = chainOf(ctx, groupIn(ctx, input.parentId).id).length
    if (depth >= ctx.org.groupLevels.length) {
      throw new ApiError(
        400,
        "too_deep",
        `Groups go ${ctx.org.groupLevels.length} level${ctx.org.groupLevels.length > 1 ? "s" : ""} deep here. Add a level in Settings first.`
      )
    }
  }
  return getDb().transaction(async (tx) => {
    const [group] = await tx
      .insert(orgGroups)
      .values({ orgId: ctx.org.id, ...input })
      .returning()
    await audit(tx, ctx, "group.create", `Created group ${group!.name}`)
    // A group's first group inside takes its people down with it, so they stay in the last
    // level. With other groups already inside, nobody sits directly in the parent anyway.
    let movedDown = 0
    if (input.parentId && isLeaf(ctx, input.parentId)) {
      const people = await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, input.parentId))
      if (people.length) {
        await tx
          .insert(groupMembers)
          .values(people.map((p) => ({ groupId: group!.id, userId: p.userId })))
          .onConflictDoNothing()
        await tx
          .delete(groupMembers)
          .where(eq(groupMembers.groupId, input.parentId))
        movedDown = people.length
      }
    }
    const [waiting] = input.parentId
      ? await tx
          .select({ total: count() })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, input.parentId))
      : []
    return { ...group!, movedDown, parentNotPlaced: waiting?.total ?? 0 }
  })
}

export async function updateGroup(
  slug: string,
  user: User,
  id: string,
  input: Pick<z.infer<typeof groupSchema>, "name" | "description">
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.groups.edit", id)
  await getDb().transaction(async (tx) => {
    await tx.update(orgGroups).set(input).where(eq(orgGroups.id, id))
    await audit(
      tx,
      ctx,
      "group.update",
      `Renamed ${group.name} to ${input.name}`
    )
  })
}

/**
 * A group's run and lead, for kinds that have them: a cohort's dates, a pod's mentor. The
 * lead is given the kind's instructor role on the group if nothing gives them teaching
 * there yet, so they can run it (it stays when they stop leading; take it off in People).
 */
export async function setGroupRun(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof groupRunSchema>
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.groups.edit", id)
  const kind = KINDS[ctx.org.type]
  const datesGiven = input.startsOn !== undefined || input.endsOn !== undefined
  if (datesGiven && !kind.groupDates)
    throw new ApiError(400, "not_for_kind", `${kind.terms.groups} don't run between dates in a ${kind.noun}.`)
  if (input.open !== undefined && !kind.openGroups)
    throw new ApiError(400, "not_for_kind", `People don't join ${kind.terms.groups.toLowerCase()} themselves in a ${kind.noun}.`)
  if (input.leadId !== undefined && !kind.leadPerGroup)
    throw new ApiError(400, "not_for_kind", `A ${kind.noun} names its ${kind.terms.groupLead.toLowerCase()}s per year, in Academic years.`)
  const startsOn = input.startsOn === undefined ? group.startsOn : input.startsOn
  const endsOn = input.endsOn === undefined ? group.endsOn : input.endsOn
  const problem = runProblem(startsOn, endsOn)
  if (problem) throw new ApiError(400, "bad_run", problem)
  let lead: { id: string; email: string; name: string | null } | null = null
  if (input.leadId) {
    const [row] = await getDb()
      .select({ id: users.id, email: users.email, name: users.name })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, input.leadId), eq(orgMembers.status, "active")))
    if (!row) throw new ApiError(400, "not_member", "The lead has to be an active member.")
    lead = row
  }
  const instructor = lead ? await systemRole(getDb(), ctx.org.id, "teacher") : null
  if (instructor) needSubset(ctx, rolePermissions(instructor), id)
  await getDb().transaction(async (tx) => {
    await tx
      .update(orgGroups)
      .set({
        startsOn,
        endsOn,
        ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
        ...(input.open !== undefined ? { open: input.open } : {}),
      })
      .where(eq(orgGroups.id, id))
    if (lead && instructor) {
      const [held] = await tx
        .select({ systemKey: orgRoles.systemKey, permissions: orgRoles.permissions, groupId: roleAssignments.groupId })
        .from(roleAssignments)
        .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
        .where(and(eq(roleAssignments.orgId, ctx.org.id), eq(roleAssignments.userId, lead.id)))
        .then((rows) =>
          rows.filter(
            (r) =>
              (r.groupId === null || chainOf(ctx, id).includes(r.groupId)) &&
              rolePermissions(r).includes("teaching.log")
          )
        )
      if (!held) await giveRole(tx, ctx.org.id, lead.id, instructor.id, id)
    }
    const parts = [
      datesGiven ? (startsOn ? `runs ${startsOn} to ${endsOn}` : "no dates") : null,
      input.leadId !== undefined
        ? lead
          ? `${kind.terms.groupLead} ${lead.name ?? lead.email}`
          : `no ${kind.terms.groupLead.toLowerCase()}`
        : null,
      input.open !== undefined ? (input.open ? "open to join" : "closed") : null,
    ].filter(Boolean)
    await audit(tx, ctx, "group.run", `${group.name}: ${parts.join(", ")}`)
  })
  return {
    startsOn,
    endsOn,
    leadId: input.leadId === undefined ? group.leadId : input.leadId,
    open: input.open ?? group.open,
  }
}

/* ---------- open groups (a community's) ---------- */

function needOpenGroups(ctx: OrgContext) {
  if (!KINDS[ctx.org.type].openGroups) throw notFound("Not part of this organization")
  if (ctx.membership?.status !== "active") throw forbidden("Join the organization first.")
}

/** Groups members may join themselves, with who leads them and whether this person is in. */
export async function openGroups(slug: string, user: User) {
  const ctx = await context(slug, user)
  needOpenGroups(ctx)
  const open = ctx.groups.filter((g) => g.open)
  const ids = open.map((g) => g.id)
  const [seats, leads] = await Promise.all([
    ids.length
      ? getDb()
          .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
          .from(groupMembers)
          .where(inArray(groupMembers.groupId, ids))
      : [],
    getDb()
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(open.flatMap((g) => (g.leadId ? [g.leadId] : [])))].concat(["00000000-0000-0000-0000-000000000000"]))),
  ])
  const kind = KINDS[ctx.org.type]
  return {
    terms: kind.terms,
    groups: open
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        members: seats.filter((s) => s.groupId === g.id).length,
        lead: g.leadId ? (leads.find((l) => l.id === g.leadId)?.name ?? null) : null,
        mine: seats.some((s) => s.groupId === g.id && s.userId === user.id),
      }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name)),
  }
}

/** Joins an open group, or leaves one. */
export async function joinOpenGroup(slug: string, user: User, id: string, join: boolean) {
  const ctx = await context(slug, user)
  needOpenGroups(ctx)
  const group = groupIn(ctx, id)
  if (!group.open) throw forbidden(`${group.name} isn't open to join; ask its ${KINDS[ctx.org.type].terms.groupLead.toLowerCase()}.`)
  await getDb().transaction(async (tx) => {
    if (join) {
      const [added] = await tx
        .insert(groupMembers)
        .values({ groupId: id, userId: user.id })
        .onConflictDoNothing()
        .returning()
      if (added) await audit(tx, ctx, "group.join", `Joined ${group.name}`)
    } else {
      const [gone] = await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, user.id)))
        .returning()
      if (gone) await audit(tx, ctx, "group.leave", `Left ${group.name}`)
    }
  })
  return openGroups(slug, user)
}

/**
 * Deletes a group and everything inside it. A group with people in it (or in a group
 * inside it) is only deleted with `force`: they're then taken out of it, not moved
 * anywhere, so nobody ends up counted in groups they weren't in. Otherwise it's refused
 * with the count, so the person can empty it first or confirm.
 */
export async function deleteGroup(
  slug: string,
  user: User,
  id: string,
  force: boolean
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  // Deleting needs the permission above the group, not just on it.
  need(ctx, "org.groups.delete", group.parentId)
  const doomed = ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(id))
    .map((g) => g.id)
  await getDb().transaction(async (tx) => {
    const people = await tx
      .selectDistinct({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, doomed))
    if (people.length > 0 && !force) {
      throw new ApiError(
        409,
        "group_not_empty",
        `${group.name} has ${people.length} ${people.length === 1 ? "person" : "people"} in it. Empty it first, or delete it and take them out of it.`
      )
    }
    // Their places in these groups go with the groups (the rows cascade).
    await tx.delete(orgGroups).where(inArray(orgGroups.id, doomed))
    await audit(
      tx,
      ctx,
      "group.delete",
      `Deleted group ${group.name}${doomed.length > 1 ? ` and ${doomed.length - 1} inside it` : ""}${
        people.length
          ? `; took ${people.length} ${people.length === 1 ? "person" : "people"} out of it`
          : ""
      }`
    )
  })
}

/* ---------- roles ---------- */

export async function listRoles(slug: string, user: User) {
  const ctx = await context(slug, user)
  // Role names and what they allow: whoever sees members anywhere (a class teacher their
  // class's) needs them to read the members list; changing roles is checked on change.
  if (!canAnywhere(ctx, "org.roles.manage") && !canAnywhere(ctx, "org.members.view"))
    need(ctx, "org.members.view")
  const db = getDb()
  const [roles, counts] = await Promise.all([
    db
      .select()
      .from(orgRoles)
      .where(eq(orgRoles.orgId, ctx.org.id))
      .orderBy(asc(orgRoles.createdAt)),
    db
      .select({ roleId: roleAssignments.roleId, total: count() })
      .from(roleAssignments)
      .where(eq(roleAssignments.orgId, ctx.org.id))
      .groupBy(roleAssignments.roleId),
  ])
  const order = ["owner", "admin", "teacher", "member"]
  return roles
    .sort(
      (a, b) =>
        (a.systemKey ? order.indexOf(a.systemKey) : 99) -
        (b.systemKey ? order.indexOf(b.systemKey) : 99)
    )
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: rolePermissions(role),
      systemKey: role.systemKey,
      templateKey: role.templateKey,
      assigned: counts.find((c) => c.roleId === role.id)?.total ?? 0,
    }))
}

/** The kind's suggested roles this organization doesn't have yet, for the Roles page. */
export async function suggestedRoles(slug: string, user: User) {
  const ctx = await context(slug, user)
  need(ctx, "org.roles.manage")
  const [templates, roles] = await Promise.all([
    kindRoleTemplates(),
    getDb()
      .select({ name: orgRoles.name, templateKey: orgRoles.templateKey })
      .from(orgRoles)
      .where(eq(orgRoles.orgId, ctx.org.id)),
  ])
  const have = new Set(roles.map((r) => r.templateKey).filter(Boolean))
  const names = new Set(roles.map((r) => r.name.toLowerCase()))
  const kind = KINDS[ctx.org.type]
  return {
    kind: kind.label,
    suggestions: templates[ctx.org.type]
      .filter((t) => !have.has(t.key))
      .map((t) => ({
        ...t,
        /** A role of this name exists already (made by hand): adding needs a rename first. */
        nameTaken: names.has(t.name.toLowerCase()),
        /** Whether this person may give everything it holds. */
        allowed: ctx.platformAdmin || isOwner(ctx) || t.permissions.every((p) => grantsPermission([...heldFor(ctx, null)], p)),
      })),
  }
}

/** Adds one of the kind's suggested roles; it's an ordinary role after that. */
export async function addSuggestedRole(slug: string, user: User, key: string) {
  const ctx = await context(slug, user)
  need(ctx, "org.roles.manage")
  const template = (await kindRoleTemplates())[ctx.org.type].find((t) => t.key === key)
  if (!template) throw notFound("No such suggested role")
  needSubset(ctx, template.permissions, null)
  return getDb().transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: orgRoles.id })
      .from(orgRoles)
      .where(and(eq(orgRoles.orgId, ctx.org.id), sql.sql`lower(${orgRoles.name}) = ${template.name.toLowerCase()}`))
    if (taken)
      throw new ApiError(409, "name_taken", `There's already a role called ${template.name}. Rename it first.`)
    const [role] = await tx
      .insert(orgRoles)
      .values({
        orgId: ctx.org.id,
        systemKey: null,
        templateKey: template.key,
        name: template.name,
        description: template.description,
        permissions: [...template.permissions],
      })
      .returning()
    await audit(tx, ctx, "role.create", `Added the suggested role ${template.name}`, { permissions: template.permissions })
    return role!
  })
}

export async function createRole(
  slug: string,
  user: User,
  input: z.infer<typeof roleSchema>
) {
  const ctx = await context(slug, user)
  need(ctx, "org.roles.manage")
  needSubset(ctx, input.permissions, null)
  return getDb().transaction(async (tx) => {
    const [role] = await tx
      .insert(orgRoles)
      .values({ orgId: ctx.org.id, systemKey: null, ...input })
      .returning()
    await audit(tx, ctx, "role.create", `Created role ${input.name}`, {
      permissions: input.permissions,
    })
    return role!
  })
}

export async function updateRole(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof roleSchema>
) {
  const ctx = await context(slug, user)
  need(ctx, "org.roles.manage")
  const role = await roleIn(ctx, id)
  if (role.systemKey) {
    throw new ApiError(
      400,
      "system_role",
      "Built-in roles can't be changed. Create your own role instead."
    )
  }
  // Both what it had and what it will have, so nobody can widen or narrow beyond their reach.
  needSubset(ctx, [...role.permissions, ...input.permissions], null)
  await getDb().transaction(async (tx) => {
    await tx.update(orgRoles).set(input).where(eq(orgRoles.id, id))
    const label = (p: string) => PERMISSIONS[p as Permission]?.label ?? p
    await audit(tx, ctx, "role.update", `Changed role ${input.name}`, {
      changes: changesBetween(role, input, {
        name: "Name",
        description: "Description",
      }),
      lists: [
        listChanges(
          "Permissions",
          role.permissions.map(label),
          input.permissions.map(label)
        ),
      ].filter(Boolean),
    })
  })
}

export async function deleteRole(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  need(ctx, "org.roles.manage")
  const role = await roleIn(ctx, id)
  if (role.systemKey)
    throw new ApiError(400, "system_role", "Built-in roles can't be deleted.")
  needSubset(ctx, role.permissions, null)
  await getDb().transaction(async (tx) => {
    await tx.delete(orgRoles).where(eq(orgRoles.id, id))
    await audit(tx, ctx, "role.delete", `Deleted role ${role.name}`)
  })
}

/* ---------- activity ---------- */

/** How organization settings are named in the activity log. */
const SETTING_LABELS = {
  name: "Name",
  description: "Description",
  website: "Website",
  type: "Kind",
  listed: "Listed in the directory",
  joinPolicy: "Who can join",
  emailDomains: "Email domains",
  groupLevels: "Group levels",
  languages: "Languages",
  allowPaste: "Pasting in the editor",
}

/** Manage › Activity: a page of the organization's log, filtered. */
export async function listAudit(
  slug: string,
  user: User,
  filters: AuditFilters
) {
  const ctx = await context(slug, user)
  need(ctx, "org.audit.view")
  return readAudit(ctx.org.id, filters)
}

/** The organization's log, filtered, as CSV. */
export async function exportAudit(
  slug: string,
  user: User,
  filters: AuditFilters
) {
  const ctx = await context(slug, user)
  need(ctx, "org.audit.view")
  await audit(getDb(), ctx, "org.audit_export", "Downloaded the activity log")
  return auditCsv(ctx.org.id, filters, `${ctx.org.slug}-activity.csv`)
}

/* ---------- for organization content (contests, assignments, problems, notices) ---------- */

export type { OrgContext }

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

/* ---------- bulk import ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportAction = "invite" | "add" | "update" | "unchanged" | "error"

/**
 * Adds many people at once. Without `commit` it only reports what would happen, row by
 * row, so mistakes are fixed before anything changes. Rows with errors are skipped.
 */
export async function importMembers(
  slug: string,
  user: User,
  input: z.infer<typeof importSchema>
) {
  const ctx = await context(slug, user)
  if (!canAnywhere(ctx, "org.members.import")) {
    throw forbidden(
      `This needs the "${PERMISSIONS["org.members.import"].label}" permission.`
    )
  }
  const db = getDb()
  const roles = await db
    .select()
    .from(orgRoles)
    .where(eq(orgRoles.orgId, ctx.org.id))
  const emails = [
    ...new Set(input.rows.map((r) => r.email.trim().toLowerCase())),
  ]
  const [people, members] = await Promise.all([
    db
      .select()
      .from(users)
      .where(inArray(users.email, emails.length ? emails : [""])),
    db.select().from(orgMembers).where(eq(orgMembers.orgId, ctx.org.id)),
  ])
  const groupKey = (parentId: string | null, name: string) =>
    `${parentId ?? ""}/${name.trim().toLowerCase()}`
  const existing = new Map(
    ctx.groups.map((g) => [groupKey(g.parentId, g.name), g.id])
  )
  const planned = new Map<string, { parentKey: string | null; name: string }>()
  const seen = new Set<string>()

  const report = input.rows.map((row, index) => {
    const email = row.email.trim().toLowerCase()
    const out = {
      line: index + 2,
      email,
      name: row.name.trim(),
      group: row.group.trim(),
      role: row.role.trim(),
      action: "add" as ImportAction,
      note: "",
      groupKey: null as string | null,
      roleId: null as string | null,
      /** Last-level groups it goes into, when the path stops at a group with groups inside. */
      spread: 0,
    }
    const fail = (note: string) => ({ ...out, action: "error" as const, note })
    if (!EMAIL.test(email)) return fail("Not an email address")
    if (seen.has(email)) return fail("Listed twice")
    seen.add(email)

    // Group path: each level by name, top first.
    if (out.group) {
      const parts = out.group.split(/\s*(?:\/|›|>)\s*/).filter(Boolean)
      if (parts.length > ctx.org.groupLevels.length) {
        return fail(
          `Groups go ${ctx.org.groupLevels.length} level(s) deep here`
        )
      }
      let parent: string | null = null
      let key: string | null = null
      for (const part of parts) {
        key = groupKey(parent, part)
        const id = existing.get(key)
        if (id) {
          parent = id
          continue
        }
        if (!input.createGroups)
          return fail(`No group "${part}"; tick "create missing groups"`)
        if (!canFor(ctx, "org.groups.manage", parent ? [[parent]] : [])) {
          return fail(
            `You can't create groups under ${parent ? "that group" : "the top level"}`
          )
        }
        if (!planned.has(key))
          planned.set(key, { parentKey: parent, name: part })
        parent = key
      }
      out.groupKey = key
      // Only into groups this person may import into (planned groups sit under an allowed one).
      const realGroup = existing.get(key!) ?? null
      if (realGroup && !can(ctx, "org.members.import", realGroup)) {
        return fail("You can't add people to that group")
      }
      // People go into the last level, unless a group is being created under this one now.
      if (realGroup && !isLeaf(ctx, realGroup)) {
        out.spread = leavesUnder(ctx, realGroup).length
      }
    } else if (!can(ctx, "org.members.import")) {
      return fail("Choose a group: you can only add people to your groups")
    }

    if (out.role) {
      // A role by its name here (Faculty), or a built-in one by its usual name (Teacher),
      // so a spreadsheet written for any kind still works.
      const wanted = out.role.toLowerCase()
      const role =
        roles.find((r) => r.name.toLowerCase() === wanted) ??
        roles.find(
          (r) =>
            r.systemKey &&
            (r.systemKey === wanted ||
              SYSTEM_ROLES[
                r.systemKey as keyof typeof SYSTEM_ROLES
              ]?.name.toLowerCase() === wanted)
        )
      if (!role) return fail(`No role "${out.role}"`)
      if (role.systemKey === "owner") return fail("Owners can't be imported")
      if (role.systemKey !== "member") {
        const scope = out.groupKey ? (existing.get(out.groupKey) ?? null) : null
        if (!can(ctx, "org.roles.manage", scope))
          return fail("You can't give roles")
        const held = heldFor(ctx, scope)
        if (
          !ctx.platformAdmin &&
          !isOwner(ctx) &&
          rolePermissions(role).some((p) => !held.has(p))
        ) {
          return fail(`You can't give the ${role.name} role`)
        }
        out.roleId = role.id
      }
    }

    const person = people.find((p) => p.email === email)
    const membership = person && members.find((m) => m.userId === person.id)
    out.action = !person
      ? "invite"
      : !membership || membership.status !== "active"
        ? "add"
        : out.groupKey || out.roleId
          ? "update"
          : "unchanged"
    out.note =
      out.action === "invite"
        ? "New account, ready when they first sign in"
        : out.action === "add"
          ? "Joins now"
          : out.action === "update"
            ? "Already a member; group or role added"
            : "Already a member"
    if (out.spread > 1)
      out.note += `; joins all ${out.spread} groups inside ${out.group}`
    return out
  })

  const counts = {
    invite: report.filter((r) => r.action === "invite").length,
    add: report.filter((r) => r.action === "add").length,
    update: report.filter((r) => r.action === "update").length,
    unchanged: report.filter((r) => r.action === "unchanged").length,
    error: report.filter((r) => r.action === "error").length,
    newGroups: planned.size,
  }
  const visible = report.map(
    ({ groupKey: _g, roleId: _r, spread: _s, ...row }) => row
  )
  if (!input.commit) return { committed: false, counts, rows: visible }

  await db.transaction(async (tx) => {
    // Create planned groups top-down, mapping planned keys to new ids.
    const created = new Map<string, string>()
    // A parent is either an existing group's id or the key of a group planned above.
    const idOf = (ref: string | null) =>
      ref === null
        ? null
        : ctx.groups.some((g) => g.id === ref)
          ? ref
          : (existing.get(ref) ?? created.get(ref) ?? null)
    // Parents of existing and newly created groups, to find the levels above a group.
    const parentOf = new Map<string, string | null>(
      ctx.groups.map((g) => [g.id, g.parentId])
    )
    const ancestorIds = (id: string) =>
      ancestry(id, (x) => parentOf.get(x)).slice(1)
    for (const [key, group] of planned) {
      const [row] = await tx
        .insert(orgGroups)
        .values({
          orgId: ctx.org.id,
          name: group.name,
          parentId: idOf(group.parentKey),
        })
        .returning()
      created.set(key, row!.id)
      parentOf.set(row!.id, row!.parentId)
    }
    for (const row of report) {
      if (row.action === "error" || row.action === "unchanged") continue
      const person = await userByEmail(tx, row.email)
      if (row.name && !person.name) {
        await tx
          .update(users)
          .set({ name: row.name })
          .where(eq(users.id, person.id))
      }
      await admitMember(tx, ctx.org, person.id, "import", false)
      const groupId = idOf(row.groupKey)
      if (groupId) {
        // An existing group with groups inside means every last-level group in it.
        const targets = ctx.groups.some((g) => g.id === groupId)
          ? leavesUnder(ctx, groupId)
          : [groupId]
        for (const target of targets) {
          await tx
            .insert(groupMembers)
            .values({ groupId: target, userId: person.id })
            .onConflictDoNothing()
          await tx
            .delete(groupMembers)
            .where(
              and(
                eq(groupMembers.userId, person.id),
                inArray(groupMembers.groupId, [
                  ...ancestorIds(target),
                  NO_GROUP,
                ])
              )
            )
        }
      }
      if (row.roleId)
        await giveRole(tx, ctx.org.id, person.id, row.roleId, groupId)
    }
    await audit(
      tx,
      ctx,
      "member.import",
      `Imported ${counts.invite + counts.add + counts.update} people${counts.newGroups ? `, created ${counts.newGroups} groups` : ""}`,
      counts
    )
  })
  return { committed: true, counts, rows: visible }
}

/* ---------- a group's people, and who an audience reaches ---------- */

/** Everyone in a group or a group inside it, with where each sits. */
export async function groupPeople(slug: string, user: User, groupId: string) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.view", groupId)
  const inside = ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(groupId))
    .map((g) => g.id)
  const rows = await getDb()
    .select({
      userId: groupMembers.userId,
      groupId: groupMembers.groupId,
      name: users.name,
      email: users.email,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(inArray(groupMembers.groupId, inside))
  const pathFrom = (id: string) =>
    chainOf(ctx, id)
      .slice(0, chainOf(ctx, id).indexOf(groupId))
      .reverse()
      .map((x) => groupIn(ctx, x).name)
      .join(" › ")
  const people = new Map<
    string,
    {
      userId: string
      name: string | null
      email: string
      direct: boolean
      in: string[]
    }
  >()
  for (const r of rows) {
    const p = people.get(r.userId) ?? {
      userId: r.userId,
      name: r.name,
      email: r.email,
      direct: false,
      in: [],
    }
    if (r.groupId === groupId) p.direct = true
    else p.in.push(pathFrom(r.groupId))
    people.set(r.userId, p)
  }
  const leaf = isLeaf(ctx, groupId)
  return {
    group: { id: group.id, name: group.name },
    /** Last-level groups inside this one, to place people into. */
    places: leaf
      ? []
      : inside
          .filter((id) => id !== groupId && isLeaf(ctx, id))
          .map((id) => ({
            id,
            path: chainOf(ctx, id)
              .slice(0, chainOf(ctx, id).indexOf(groupId))
              .reverse()
              .map((x) => groupIn(ctx, x).name)
              .join(" › "),
          })),
    /** Everyone can be added here; a group with groups inside spreads them into its last level. */
    canAdd: true,
    canManage: can(ctx, "org.members.manage", groupId),
    people: [...people.values()]
      .map((p) => ({ ...p, notPlaced: p.direct && !leaf }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
  }
}

export async function addToGroup(
  slug: string,
  user: User,
  groupId: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  const targets = leavesUnder(ctx, groupId)
  const members = await getDb()
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.status, "active"),
        inArray(orgMembers.userId, userIds.length ? userIds : [NO_GROUP])
      )
    )
  if (members.length !== new Set(userIds).size) {
    throw new ApiError(
      400,
      "not_member",
      "Only active members can be added to a group."
    )
  }
  await getDb().transaction(async (tx) => {
    await tx
      .insert(groupMembers)
      .values(
        targets.flatMap((target) =>
          userIds.map((userId) => ({ groupId: target, userId }))
        )
      )
      .onConflictDoNothing()
    for (const userId of userIds) {
      for (const target of targets) await settleBelow(tx, ctx, userId, target)
    }
    await audit(
      tx,
      ctx,
      "member.groups",
      `Added ${userIds.length} ${userIds.length === 1 ? "person" : "people"} to ${group.name}`
    )
  })
}

/**
 * Takes people out of a group and every group inside it: removing someone from 3rd Year
 * means from its sections too. Their membership of the organization stays.
 */
export async function removeFromGroup(
  slug: string,
  user: User,
  groupId: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  if (userIds.length === 0) return { removed: 0 }
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          inArray(groupMembers.groupId, insideIds(ctx, groupId)),
          inArray(groupMembers.userId, userIds)
        )
      )
      .returning({ userId: groupMembers.userId })
    const people = new Set(removed.map((r) => r.userId)).size
    await audit(
      tx,
      ctx,
      "member.groups",
      `Took ${people} ${people === 1 ? "person" : "people"} out of ${group.name}`
    )
    return { removed: people }
  })
}

/** How many members an audience reaches, and a few names, while it's being chosen. */
export async function previewAudience(
  slug: string,
  user: User,
  audience: Audience
) {
  const ctx = await context(slug, user)
  if (
    !["assignments.manage", "contests.manage", "notices.manage"].some((p) =>
      canAnywhere(ctx, p as Permission)
    )
  ) {
    throw forbidden()
  }
  checkAudience(ctx, audience)
  const db = getDb()
  const [members, memberships] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(
        and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.status, "active"))
      ),
    db
      .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        inArray(groupMembers.groupId, [
          ...ctx.groups.map((g) => g.id),
          NO_GROUP,
        ])
      ),
  ])
  const reached = members.filter((m) =>
    inAudience(
      memberships.filter((x) => x.userId === m.id).map((x) => x.groupId),
      audience,
      (id) => chainOf(ctx, id)
    )
  )
  return {
    count: reached.length,
    sample: reached.slice(0, 6).map((m) => m.name ?? m.email),
  }
}

/** Moves people sitting directly in a group into one of the last-level groups inside it. */
export async function placeInGroup(
  slug: string,
  user: User,
  groupId: string,
  into: string,
  userIds: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, groupId)
  need(ctx, "org.members.groups", groupId)
  if (!chainOf(ctx, into).includes(groupId) || into === groupId) {
    throw new ApiError(
      400,
      "not_inside",
      `Choose a group inside ${group.name}.`
    )
  }
  needLeaf(ctx, into)
  await getDb().transaction(async (tx) => {
    const waiting = (
      await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            inArray(groupMembers.userId, userIds.length ? userIds : [NO_GROUP])
          )
        )
    ).map((r) => r.userId)
    if (waiting.length === 0) return
    await tx
      .insert(groupMembers)
      .values(waiting.map((userId) => ({ groupId: into, userId })))
      .onConflictDoNothing()
    for (const userId of waiting) await settleBelow(tx, ctx, userId, into)
    await audit(
      tx,
      ctx,
      "member.groups",
      `Placed ${waiting.length} ${waiting.length === 1 ? "person" : "people"} from ${group.name} into ${groupIn(ctx, into).name}`
    )
  })
}

/** Everyone in a group and the groups inside it. */
function insideIds(ctx: OrgContext, id: string) {
  return ctx.groups
    .filter((g) => chainOf(ctx, g.id).includes(id))
    .map((g) => g.id)
}

/** Takes everyone out of a group and the groups inside it; the groups stay. */
export async function emptyGroup(slug: string, user: User, id: string) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  need(ctx, "org.members.groups", id)
  return getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(groupMembers)
      .where(inArray(groupMembers.groupId, insideIds(ctx, id)))
      .returning({ userId: groupMembers.userId })
    const people = new Set(removed.map((r) => r.userId)).size
    await audit(
      tx,
      ctx,
      "member.groups",
      `Emptied ${group.name} (${people} ${people === 1 ? "person" : "people"})`
    )
    return { removed: people }
  })
}

/**
 * Moves everyone in a group (and the groups inside it) into another group, which as
 * always means its last-level groups. Used before deleting a group.
 */
export async function moveGroupPeople(
  slug: string,
  user: User,
  id: string,
  into: string,
  /** Only these people; everyone in the group when left out. */
  only?: string[]
) {
  const ctx = await context(slug, user)
  const group = groupIn(ctx, id)
  const target = groupIn(ctx, into)
  need(ctx, "org.members.groups", id)
  need(ctx, "org.members.groups", into)
  const inside = insideIds(ctx, id)
  // Emptying a whole group (before deleting it) must send people outside it. Moving chosen
  // people can go anywhere else, like from Lab 1 to Lab 2 of the same section.
  if (into === id || (!only && inside.includes(into))) {
    throw new ApiError(
      400,
      "inside_itself",
      `Choose a group outside ${group.name}.`
    )
  }
  const targets = leavesUnder(ctx, into)
  return getDb().transaction(async (tx) => {
    const people = [
      ...new Set(
        (
          await tx
            .select({ userId: groupMembers.userId })
            .from(groupMembers)
            .where(inArray(groupMembers.groupId, inside))
        ).map((r) => r.userId)
      ),
    ].filter((userId) => !only || only.includes(userId))
    if (people.length) {
      // Out of where they were first, so a target inside the same group keeps them.
      await tx
        .delete(groupMembers)
        .where(
          and(
            inArray(groupMembers.groupId, inside),
            inArray(groupMembers.userId, people)
          )
        )
      await tx
        .insert(groupMembers)
        .values(
          targets.flatMap((t) =>
            people.map((userId) => ({ groupId: t, userId }))
          )
        )
        .onConflictDoNothing()
      for (const userId of people) {
        for (const t of targets) await settleBelow(tx, ctx, userId, t)
      }
    }
    await audit(
      tx,
      ctx,
      "member.groups",
      `Moved ${people.length} ${people.length === 1 ? "person" : "people"} from ${group.name} to ${target.name}`
    )
    return { moved: people.length }
  })
}
