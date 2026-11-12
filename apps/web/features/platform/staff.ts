import {
  getDb,
  platformRoles,
  platformStaff,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  grantsPlatformPermission,
  isPlatformPermission,
  isPlatformRoleKey,
  changesBetween,
  listChanges,
  PLATFORM_PERMISSIONS,
  mayGrantPlatformRole,
  PLATFORM_ROLES,
  type PlatformPermission,
} from "@workspace/judge"

import { auditCsv, readAudit, writeEntry, type AuditFilters } from "@/features/audit/server"

import { isAdminEmail } from "@/lib/admin-emails"
import { ApiError, notFound } from "@/lib/api/route"

import { platformAccess } from "./access"

/*
 * Platform staff and roles. The rules match organizations': nobody gives more than they
 * hold, only owners make owners, the last owner stays, and every change is logged.
 */

const { and, asc, count, eq, inArray, isNull } = sql

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

/** A role named by a built-in key ("owner") or a custom role's id. */
async function roleOf(role: string) {
  if (isPlatformRoleKey(role)) {
    return {
      systemRole: role,
      roleId: null,
      name: PLATFORM_ROLES[role].name,
      permissions: [
        ...PLATFORM_ROLES[role].permissions,
      ] as PlatformPermission[],
      owner: role === "owner",
    }
  }
  const [custom] = await getDb()
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.id, role))
  if (!custom)
    throw new ApiError(400, "unknown_role", "That role doesn't exist.")
  return {
    systemRole: null,
    roleId: custom.id,
    name: custom.name,
    permissions: custom.permissions.filter(isPlatformPermission),
    owner: false,
  }
}

export async function writePlatformAudit(
  actor: User,
  action: string,
  summary: string,
  detail?: Record<string, unknown>
) {
  await writeEntry(getDb(), { orgId: null, actor, action, summary, detail })
}

async function needRoles(
  actor: User,
  permission: PlatformPermission = "platform.roles.manage"
) {
  const access = await platformAccess(actor)
  if (!grantsPlatformPermission(access.permissions, permission)) {
    throw forbidden("This needs the Manage staff and roles permission.")
  }
  return access
}

/** Everyone with platform access, and how they got it. */
export async function listStaff(actor: User) {
  await needRoles(actor)
  const db = getDb()
  const rows = await db
    .select({ user: users, staff: platformStaff })
    .from(users)
    .leftJoin(platformStaff, eq(platformStaff.userId, users.id))
    .where(
      sql.or(
        sql.isNotNull(platformStaff.userId),
        inArray(users.role, ["teacher", "admin"])
      )
    )
    .orderBy(asc(users.email))
  const out = []
  for (const { user } of rows) {
    const access = await platformAccess(user)
    if (!access.role) continue
    out.push({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: access.role,
      permissions: access.permissions,
      /** How they got it: set here, from ADMIN_EMAILS, or from their account role. */
      source: isAdminEmail(user.email)
        ? ("admin_emails" as const)
        : rows.find((r) => r.user.id === user.id)?.staff
          ? ("role" as const)
          : ("account" as const),
    })
  }
  return out
}

export async function listRoles(actor: User) {
  await needRoles(actor)
  const [custom, holders] = await Promise.all([
    getDb().select().from(platformRoles).orderBy(asc(platformRoles.name)),
    getDb()
      .select({
        roleId: platformStaff.roleId,
        systemRole: platformStaff.systemRole,
        n: count(),
      })
      .from(platformStaff)
      .groupBy(platformStaff.roleId, platformStaff.systemRole),
  ])
  return [
    ...Object.entries(PLATFORM_ROLES).map(([key, r]) => ({
      id: key,
      name: r.name,
      description: r.description,
      permissions: [...r.permissions],
      builtIn: true,
      members: holders.find((h) => h.systemRole === key)?.n ?? 0,
    })),
    ...custom.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions.filter(isPlatformPermission),
      builtIn: false,
      members: holders.find((h) => h.roleId === r.id)?.n ?? 0,
    })),
  ]
}

/** How many owners the platform has: ADMIN_EMAILS, owner roles, and admins without a role. */
async function ownerCount() {
  const db = getDb()
  const candidates = await db
    .select({ user: users })
    .from(users)
    .leftJoin(platformStaff, eq(platformStaff.userId, users.id))
    .where(
      sql.or(
        eq(platformStaff.systemRole, "owner"),
        and(eq(users.role, "admin"), isNull(platformStaff.userId))
      )
    )
  return candidates.filter(({ user }) => !user.disabled).length
}

/** Gives someone a platform role (making them staff); `email` may be new to the site. */
export async function setStaffRole(
  actor: User,
  input: { email: string; role: string }
) {
  const access = await needRoles(actor, "platform.roles.assign")
  const role = await roleOf(input.role)
  if (
    !mayGrantPlatformRole(
      access.permissions,
      role.permissions,
      role.owner,
      access.owner
    )
  ) {
    throw forbidden(
      role.owner
        ? "Only owners make owners."
        : "You can only give roles with permissions you hold yourself."
    )
  }
  const email = input.email.trim().toLowerCase()
  if (isAdminEmail(email)) {
    throw new ApiError(
      409,
      "admin_email",
      "This person is an owner through ADMIN_EMAILS."
    )
  }
  const db = getDb()
  let [target] = await db.select().from(users).where(eq(users.email, email))
  if (!target) {
    ;[target] = await db
      .insert(users)
      .values({ email, role: "student" })
      .returning()
  }
  const before = await platformAccess(target!)
  if (before.owner && !access.owner)
    throw forbidden("Only owners change owners.")
  if (before.owner && !role.owner && (await ownerCount()) <= 1) {
    throw new ApiError(
      409,
      "last_owner",
      "The platform needs at least one owner."
    )
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(platformStaff)
      .values({
        userId: target!.id,
        systemRole: role.systemRole,
        roleId: role.roleId,
        addedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: platformStaff.userId,
        set: {
          systemRole: role.systemRole,
          roleId: role.roleId,
          addedBy: actor.id,
        },
      })
    // The account role follows, so older checks of "staff" stay right.
    await tx
      .update(users)
      .set({ role: role.owner ? "admin" : "teacher" })
      .where(eq(users.id, target!.id))
  })
  await writePlatformAudit(
    actor,
    "staff.role",
    `Gave ${email} the ${role.name} role`,
    {
      user: email,
      role: role.name,
    }
  )
  return { email, role: role.name }
}

/** Takes someone's platform access away. */
export async function removeStaff(actor: User, userId: string) {
  const access = await needRoles(actor, "platform.roles.assign")
  const [target] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, userId))
  if (!target) throw notFound("Not found")
  if (isAdminEmail(target.email)) {
    throw new ApiError(
      409,
      "admin_email",
      "Owners through ADMIN_EMAILS are removed from that setting."
    )
  }
  const before = await platformAccess(target)
  if (!before.role) throw notFound("They aren't platform staff.")
  if (before.owner && !access.owner)
    throw forbidden("Only owners change owners.")
  if (
    !before.owner &&
    !before.permissions.every((p) => access.permissions.includes(p))
  ) {
    throw forbidden(
      "You can only remove people whose permissions you hold yourself."
    )
  }
  if (before.owner && (await ownerCount()) <= 1) {
    throw new ApiError(
      409,
      "last_owner",
      "The platform needs at least one owner."
    )
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(platformStaff).where(eq(platformStaff.userId, userId))
    await tx.update(users).set({ role: "student" }).where(eq(users.id, userId))
  })
  await writePlatformAudit(
    actor,
    "staff.remove",
    `Removed ${target.email} from platform staff`,
    {
      user: target.email,
    }
  )
}

const cleanPermissions = (permissions: string[]) =>
  [...new Set(permissions)].filter(isPlatformPermission)

/** A custom role: never with permissions the creator doesn't hold. */
export async function saveRole(
  actor: User,
  id: string | null,
  input: { name: string; description: string; permissions: string[] }
) {
  const access = await needRoles(actor)
  const permissions = cleanPermissions(input.permissions)
  // Holding a parent permission is holding its finer actions, so it may be handed out.
  const ungranted = permissions.filter(
    (p) => !grantsPlatformPermission(access.permissions, p)
  )
  if (ungranted.length) {
    throw forbidden("A role can't have permissions you don't hold.")
  }
  if (id && isPlatformRoleKey(id))
    throw forbidden("Built-in roles can't be changed.")
  const [before] = id
    ? await getDb().select().from(platformRoles).where(eq(platformRoles.id, id))
    : []
  const values = {
    name: input.name.trim(),
    description: input.description.trim(),
    permissions,
  }
  const [row] = id
    ? await getDb()
        .update(platformRoles)
        .set(values)
        .where(eq(platformRoles.id, id))
        .returning()
    : await getDb().insert(platformRoles).values(values).returning()
  if (!row) throw notFound("Role not found")
  await writePlatformAudit(
    actor,
    id ? "role.update" : "role.create",
    `${id ? "Changed" : "Created"} the ${row.name} role`,
    {
      changes: before
        ? changesBetween(before, values, { name: "Name", description: "Description" })
        : [],
      lists: [
        listChanges(
          "Permissions",
          (before?.permissions ?? []).map(permissionLabel),
          permissions.map(permissionLabel)
        ),
      ].filter(Boolean),
    }
  )
  return row
}

export async function deleteRole(actor: User, id: string) {
  await needRoles(actor)
  if (isPlatformRoleKey(id)) throw forbidden("Built-in roles can't be deleted.")
  const [held] = await getDb()
    .select({ n: count() })
    .from(platformStaff)
    .where(eq(platformStaff.roleId, id))
  if ((held?.n ?? 0) > 0) {
    throw new ApiError(
      409,
      "role_in_use",
      "People have this role. Give them another first."
    )
  }
  const [row] = await getDb()
    .delete(platformRoles)
    .where(eq(platformRoles.id, id))
    .returning()
  if (!row) throw notFound("Role not found")
  await writePlatformAudit(actor, "role.delete", `Deleted the ${row.name} role`)
}

const permissionLabel = (p: string) =>
  PLATFORM_PERMISSIONS[p as PlatformPermission]?.label ?? p

async function needAuditView(actor: User) {
  if (
    !(await platformAccess(actor)).permissions.includes("platform.audit.view")
  ) {
    throw forbidden("This needs the See the activity log permission.")
  }
}

/** The platform's activity log, a page at a time, filtered. */
export async function platformActivity(actor: User, filters: AuditFilters) {
  await needAuditView(actor)
  return readAudit(null, filters)
}

/** The platform's activity log, filtered, as CSV. */
export async function exportPlatformActivity(actor: User, filters: AuditFilters) {
  await needAuditView(actor)
  await writePlatformAudit(actor, "staff.audit_export", "Downloaded the platform activity log")
  return auditCsv(null, filters, "platform-activity.csv")
}
