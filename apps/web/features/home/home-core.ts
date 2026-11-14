import {
  attendance,
  getDb,
  groupMembers,
  guardians,
  orgMembers,
  orgRoles,
  roleAssignments,
  sql,
  teachingSessions,
  users,
  type User,
} from "@workspace/db"
import {
  KINDS,
  ORG_NAV,
  PERMISSIONS,
  visibleOrgNav,
  type Permission,
} from "@workspace/judge"

import { rolePermissions } from "@/features/orgs/access"
import {
  canFor,
  groupChain,
  heldAnywhere,
  type OrgContext,
} from "@/features/orgs/server"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

const { and, eq, inArray } = sql

export type HomeView = "admin" | "teacher" | "student" | "parent" | "staff"

export const TEACHING: Permission[] = ["attendance.mark", "teaching.log"]

export const OVERSEEING: Permission[] = [
  "org.members.view",
  "org.settings.manage",
  "reports.view",
]

/** The leaf groups: classes or sections, where students actually sit. */
export const leaves = (ctx: OrgContext) =>
  ctx.groups.filter((g) => !ctx.groups.some((c) => c.parentId === g.id))

export const pathName = (ctx: OrgContext, groupId: string) =>
  [...groupChain(ctx, groupId)]
    .reverse()
    .map((id) => ctx.groups.find((g) => g.id === id)?.name ?? "")
    .join(" · ")

/** Groups (and everything under them) a role given for specific groups lets this person teach. */
export function taughtGroups(ctx: OrgContext) {
  const roots = new Set(
    ctx.grants
      .filter(
        (g) =>
          g.groupId &&
          TEACHING.some(
            (p) =>
              g.permissions.includes(p) || rolePermissionsHold(g.permissions, p)
          )
      )
      .map((g) => g.groupId!)
  )
  return leaves(ctx).filter((g) =>
    groupChain(ctx, g.id).some((id) => roots.has(id))
  )
}

/** A permission held through its parent ("Manage attendance" holds "Take attendance"). */
export function rolePermissionsHold(
  held: readonly string[],
  permission: Permission
) {
  let p: string | undefined = permission
  while (p) {
    if (held.includes(p)) return true
    p = (PERMISSIONS[p as Permission] as { parent?: string }).parent
  }
  return false
}

export async function viewsOf(
  ctx: OrgContext,
  user: User
): Promise<HomeView[]> {
  const db = getDb()
  const held = heldAnywhere(ctx)
  const modules = ctx.modules
  const views: HomeView[] = []
  if (OVERSEEING.some((p) => canFor(ctx, p, []))) views.push("admin")
  if (taughtGroups(ctx).length > 0) views.push("teacher")
  // Office staff with narrower roles (leave, staff attendance, fees) still get a home.
  if (
    views.length === 0 &&
    ctx.membership?.status === "active" &&
    held.length > 0
  )
    views.push("staff")
  // In a community, members have a home before joining any group: its groups and events.
  if (
    ctx.membership?.status === "active" &&
    held.length === 0 &&
    KINDS[ctx.org.type].openGroups
  ) {
    views.push("student")
  } else if (ctx.membership?.status === "active" && held.length === 0) {
    const [seat] = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, user.id),
          inArray(
            groupMembers.groupId,
            ctx.groups
              .map((g) => g.id)
              .concat(["00000000-0000-0000-0000-000000000000"])
          )
        )
      )
      .limit(1)
    if (seat) views.push("student")
  }
  if (modules.has("parents")) {
    const [child] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(
        and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, user.id))
      )
      .limit(1)
    if (child) views.push("parent")
  }
  return views
}

/** The management pages ("/attendance", "/roles") this person's sidebar opens here. */
export function managedNav(ctx: OrgContext) {
  const held = new Set(heldAnywhere(ctx))
  return visibleOrgNav(ORG_NAV, {
    orgType: ctx.org.type,
    can: (p) => held.has(p),
    canWholeOrg: (p) => canFor(ctx, p, []),
    enabledModules: ctx.modules,
  })
}

/**
 * Keeps the items whose link this person can open: a management page ("/exams/x") only if
 * their sidebar has it (so no card leads to a refusal or a switched-off module); a full
 * address (their own leave, a class) always.
 */
export function reachable<T extends { href: string }>(
  ctx: OrgContext,
  items: T[]
): T[] {
  const paths = new Set(
    managedNav(ctx).flatMap((g) => g.items.map((i) => i.path))
  )
  return items.filter(
    (i) =>
      i.href.startsWith("/orgs/") ||
      paths.has(i.href.match(/^\/[^/?#]*/)?.[0] ?? "")
  )
}

export type Mark = {
  userId: string
  groupId: string
  day: string
  status: string
  present: boolean
  kind: string
}

/** Every attendance mark of these groups (registers and logged classes). */
export async function marksOf(groupIds: string[]): Promise<Mark[]> {
  if (groupIds.length === 0) return []
  return getDb()
    .select({
      userId: attendance.userId,
      groupId: teachingSessions.groupId,
      day: teachingSessions.day,
      status: attendance.status,
      present: attendance.present,
      kind: teachingSessions.kind,
    })
    .from(attendance)
    .innerJoin(teachingSessions, eq(attendance.sessionId, teachingSessions.id))
    .where(inArray(teachingSessions.groupId, groupIds))
}

/** Percent present over counted marks (excused left out), or null with fewer than `min`. */
export function percent(marks: Mark[], min = 1) {
  const counted = marks.filter((m) => m.status !== "excused")
  if (counted.length < min) return null
  return Math.round(
    (100 * counted.filter((m) => m.present).length) / counted.length
  )
}

/** Students of each leaf group: members sitting there who hold no role that grants anything. */
export async function studentsByGroup(ctx: OrgContext, groupIds: string[]) {
  const db = getDb()
  const [seats, staff] = await Promise.all([
    groupIds.length
      ? db
          .select({
            groupId: groupMembers.groupId,
            userId: groupMembers.userId,
            name: users.name,
            email: users.email,
          })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .innerJoin(
            orgMembers,
            and(
              eq(orgMembers.userId, groupMembers.userId),
              eq(orgMembers.orgId, ctx.org.id),
              eq(orgMembers.status, "active")
            )
          )
          .where(inArray(groupMembers.groupId, groupIds))
      : [],
    staffIds(ctx),
  ])
  const by = new Map<string, { id: string; name: string }[]>()
  for (const s of seats) {
    if (staff.has(s.userId)) continue
    by.set(s.groupId, [
      ...(by.get(s.groupId) ?? []),
      { id: s.userId, name: s.name ?? s.email },
    ])
  }
  return by
}

/**
 * Members holding a role that grants anything (staff, not students). With a filter, only
 * roles it accepts count; owners and admins hold every permission, so they're never
 * counted as teachers by what their role allows.
 */
export async function staffIds(
  ctx: OrgContext,
  permissionFilter?: (perms: readonly string[]) => boolean
) {
  const rows = await getDb()
    .select({
      userId: roleAssignments.userId,
      systemKey: orgRoles.systemKey,
      permissions: orgRoles.permissions,
    })
    .from(roleAssignments)
    .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
    .where(eq(roleAssignments.orgId, ctx.org.id))
  return new Set(
    rows
      .filter((r) => {
        const perms = rolePermissions(r)
        if (
          permissionFilter &&
          (r.systemKey === "owner" || r.systemKey === "admin")
        )
          return false
        return (
          perms.length > 0 && (!permissionFilter || permissionFilter(perms))
        )
      })
      .map((r) => r.userId)
  )
}

/** Today's register for each group: taken or not, and who was there. */
export function todayOf(marks: Mark[], day: string, groupId: string) {
  const mine = marks.filter(
    (m) => m.groupId === groupId && m.day === day && m.kind === "register"
  )
  return {
    taken: mine.length > 0,
    present: new Set(mine.filter((m) => m.present).map((m) => m.userId)).size,
  }
}

/** ISO weekday (1 Monday … 7 Sunday) of a "YYYY-MM-DD" day. */
export const weekdayOf = (day: string) =>
  ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

export const DAY_MS = 86_400_000
