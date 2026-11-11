import {
  getDb,
  platformRoles,
  platformStaff,
  sql,
  type User,
} from "@workspace/db"
import {
  grantsPlatformPermission,
  isPlatformPermission,
  isPlatformRoleKey,
  PLATFORM_ROLES,
  type PlatformPermission,
  type PlatformRoleKey,
} from "@workspace/judge"

import { isAdminEmail } from "@/lib/admin-emails"

/*
 * What someone may do on the platform. Read from the database on every request, never
 * from the session, so taking a role away takes effect at once.
 *
 * ADMIN_EMAILS are always owners. Staff listed in `platform_staff` have their role. Anyone
 * else falls back to their account role: admin is an Owner, teacher a Content admin (how
 * the platform worked before roles).
 */

export interface PlatformAccess {
  permissions: PlatformPermission[]
  owner: boolean
  /** The role's name, for display; null for people with no platform access. */
  role: { key: PlatformRoleKey | null; id: string | null; name: string } | null
}

const NONE: PlatformAccess = { permissions: [], owner: false, role: null }

const system = (key: PlatformRoleKey): PlatformAccess => ({
  permissions: [...PLATFORM_ROLES[key].permissions],
  owner: key === "owner",
  role: { key, id: null, name: PLATFORM_ROLES[key].name },
})

// One lookup per user object, so one request asks once.
const cache = new WeakMap<User, Promise<PlatformAccess>>()

export function platformAccess(user: User | null): Promise<PlatformAccess> {
  if (!user) return Promise.resolve(NONE)
  let found = cache.get(user)
  if (!found) {
    found = resolve(user)
    cache.set(user, found)
  }
  return found
}

async function resolve(user: User): Promise<PlatformAccess> {
  if (user.disabled) return NONE
  if (isAdminEmail(user.email)) return system("owner")
  const [row] = await getDb()
    .select({ staff: platformStaff, role: platformRoles })
    .from(platformStaff)
    .leftJoin(platformRoles, sql.eq(platformStaff.roleId, platformRoles.id))
    .where(sql.eq(platformStaff.userId, user.id))
  if (row) {
    if (row.staff.systemRole && isPlatformRoleKey(row.staff.systemRole)) {
      return system(row.staff.systemRole)
    }
    if (row.role) {
      return {
        permissions: row.role.permissions.filter(isPlatformPermission),
        owner: false,
        role: { key: null, id: row.role.id, name: row.role.name },
      }
    }
  }
  if (user.role === "admin") return system("owner")
  if (user.role === "teacher") return system("content_admin")
  return NONE
}

export async function platformCan(
  user: User | null,
  permission: PlatformPermission
) {
  return grantsPlatformPermission(
    (await platformAccess(user)).permissions,
    permission
  )
}
