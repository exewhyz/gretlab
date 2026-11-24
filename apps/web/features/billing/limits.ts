import { getDb, organizations, sql, subscriptions } from "@workspace/db"
import {
  LIMIT_GRACE_DAYS,
  SYSTEM_ROLES,
  limitState,
  readPlanFeatures,
} from "@workspace/judge"

import { ApiError } from "@/lib/api/errors"

/*
 * Plan limits (AGENTS.md › Plans and billing): students and staff in use against what the plan
 * bought. At 90% the owners hear of it; past the limit there are 30 days' grace, then adding
 * people pauses (new members, new staff roles). Running work is never stopped. Organizations
 * without plan limits (planFeatures null) are never counted against anything.
 *
 * This file imports nothing from features/orgs: the organization code calls needRoom from the
 * helpers every join goes through (admitMember, giveRole), so it must stand on its own.
 */

const { eq } = sql
const q = sql.sql

/** System roles that grant something (everyone but Member): holding one makes you staff. */
const GRANTING_SYSTEM = Object.entries(SYSTEM_ROLES)
  .filter(([, r]) => r.permissions.length > 0)
  .map(([key]) => key)

/** Whether a role (by its system key and stored permissions) makes its holder staff. */
const grantingRole = q`(r.system_key = any(${q.param(GRANTING_SYSTEM)}::text[])
  or (r.system_key is null and jsonb_array_length(r.permissions) > 0))`

/**
 * Students (active members holding no granting role, seated in a group) and staff (active
 * members holding one), counted in one query.
 */
export async function usageOf(orgId: string) {
  const [row] = (await getDb().execute(q`
    with active as (
      select m.user_id,
        exists (select 1 from role_assignments ra join org_roles r on r.id = ra.role_id
                where ra.org_id = ${orgId} and ra.user_id = m.user_id and ${grantingRole}) as staff
      from org_members m
      where m.org_id = ${orgId} and m.status = 'active'
    )
    select
      count(*) filter (where staff) as staff,
      count(*) filter (where not staff and exists (
        select 1 from group_members gm join org_groups g on g.id = gm.group_id
        where gm.user_id = active.user_id and g.org_id = ${orgId})) as students
    from active`)) as unknown as { staff: string; students: string }[]
  return { students: Number(row?.students ?? 0), staff: Number(row?.staff ?? 0) }
}

/** Whether this person already holds a role that makes them staff here. */
async function isStaff(orgId: string, userId: string) {
  const rows = (await getDb().execute(q`
    select 1 from role_assignments ra join org_roles r on r.id = ra.role_id
    where ra.org_id = ${orgId} and ra.user_id = ${userId} and ${grantingRole} limit 1`)) as unknown[]
  return rows.length > 0
}

/** Whether a role (by id) makes its holder staff. */
export async function roleGrants(roleId: string) {
  const rows = (await getDb().execute(q`
    select 1 from org_roles r where r.id = ${roleId} and ${grantingRole}`)) as unknown[]
  return rows.length > 0
}

async function planOf(orgId: string) {
  const [row] = await getDb()
    .select({ planFeatures: organizations.planFeatures, sub: subscriptions })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.orgId, organizations.id))
    .where(eq(organizations.id, orgId))
  return row ?? null
}

/** Where an organization stands against its plan's students and staff. */
export async function limitsOf(orgId: string, now = new Date()) {
  const plan = await planOf(orgId)
  if (!plan || !readPlanFeatures(plan.planFeatures) || !plan.sub)
    return { limited: false as const }
  const usage = await usageOf(orgId)
  const overSince = plan.sub.overSince
  return {
    limited: true as const,
    status: plan.sub.status,
    students: {
      used: usage.students,
      bought: plan.sub.students,
      state: limitState(usage.students, plan.sub.students, overSince, now),
    },
    staff: {
      used: usage.staff,
      bought: plan.sub.staff,
      state: limitState(usage.staff, plan.sub.staff, overSince, now),
    },
    overSince,
    graceEnds: overSince
      ? new Date(overSince.getTime() + LIMIT_GRACE_DAYS * 86_400_000)
      : null,
  }
}

const full = (what: string, bought: number) =>
  new ApiError(
    403,
    "plan_full",
    `This organization's plan is full (${bought.toLocaleString("en-IN")} ${what}), and its 30 days' grace are over. The owners can add more from Plan and billing.`
  )

/**
 * Before adding people: refuses when the plan is paused, or when this would go past what's
 * bought and the grace is over. Going over starts the grace (over_since). Organizations without
 * plan limits always have room.
 */
export async function needRoom(
  orgId: string,
  adding: { members?: number; staff?: number; userId?: string }
) {
  const plan = await planOf(orgId)
  if (!plan || !readPlanFeatures(plan.planFeatures) || !plan.sub) return
  const sub = plan.sub
  if (sub.status === "paused")
    throw new ApiError(
      403,
      "plan_paused",
      "This organization's plan is paused until it's paid. The owners can pay from Plan and billing."
    )
  const members = adding.members ?? 0
  let staff = adding.staff ?? 0
  if (staff > 0 && adding.userId && (await isStaff(orgId, adding.userId))) staff = 0
  if (members === 0 && staff === 0) return
  const usage = await usageOf(orgId)
  const now = new Date()
  const over =
    usage.students + members > sub.students || usage.staff + staff > sub.staff
  if (!over) return
  const since = sub.overSince ?? now
  if (members > 0 && limitState(usage.students + members, sub.students, since, now) === "paused")
    throw full("students", sub.students)
  if (staff > 0 && limitState(usage.staff + staff, sub.staff, since, now) === "paused")
    throw full("staff", sub.staff)
  // Allowed, and now over: the grace starts today (if it hadn't).
  if (!sub.overSince)
    await getDb()
      .update(subscriptions)
      .set({ overSince: now })
      .where(eq(subscriptions.orgId, orgId))
}
