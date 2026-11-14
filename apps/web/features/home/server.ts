/*
 * The organization's home on the server: the shell (sidebar data) and the dashboard for
 * each view live here; the dashboards themselves are in admin-home, teacher-home,
 * member-home (student and parent) and staff-home, on shared helpers in home-core.
 */
import {
  getDb,
  guardians,
  orgMembers,
  orgRoles,
  roleAssignments,
  sql,
  users,
  type User,
} from "@workspace/db"
import { KINDS, kindTerms } from "@workspace/judge"

import { newApplications } from "@/features/admissions/server"
import { homeEvents } from "@/features/events/server"
import { pendingLeaveCount } from "@/features/leave/server"
import { canFor, heldAnywhere, orgContext } from "@/features/orgs/server"
import { homeRuns } from "@/features/runs/server"
import { myTraining } from "@/features/training/server"
import { adminHome } from "./admin-home"
import { viewsOf } from "./home-core"
import { parentHome, studentHome } from "./member-home"
import { staffHome, teamTraining } from "./staff-home"
import { teacherHome } from "./teacher-home"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

const { and, count, eq } = sql
export type { HomeView } from "./home-core"

/** What the sidebar and header need, on every page of the school. */
export async function orgShell(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const views = await viewsOf(ctx, user)
  const permissions = heldAnywhere(ctx)
  const db = getDb()
  const modules = ctx.modules
  const [children, [pending], roles] = await Promise.all([
    views.includes("parent")
      ? db
          .select({
            id: guardians.studentId,
            name: users.name,
            email: users.email,
          })
          .from(guardians)
          .innerJoin(users, eq(guardians.studentId, users.id))
          .where(
            and(
              eq(guardians.orgId, ctx.org.id),
              eq(guardians.parentId, user.id)
            )
          )
      : [],
    permissions.includes("org.members.invite")
      ? db
          .select({ n: count() })
          .from(orgMembers)
          .where(
            and(
              eq(orgMembers.orgId, ctx.org.id),
              eq(orgMembers.status, "pending")
            )
          )
      : [{ n: 0 }],
    db
      .select({ name: orgRoles.name, systemKey: orgRoles.systemKey })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(
        and(
          eq(roleAssignments.orgId, ctx.org.id),
          eq(roleAssignments.userId, user.id)
        )
      ),
  ])
  // Everyone is a member, so that role is named only when it's the only one.
  const roleNames = [
    ...new Set(
      roles.filter((r) => r.systemKey !== "member").map((r) => r.name)
    ),
  ]
  return {
    org: {
      slug: ctx.org.slug,
      name: ctx.org.name,
      type: ctx.org.type,
      active: ctx.org.active,
    },
    views,
    /** How the header names you here: your roles, else what you are. */
    role:
      roleNames.join(", ") ||
      (views.includes("student")
        ? kindTerms(ctx.org.type).learner
        : views.includes("parent")
          ? (kindTerms(ctx.org.type).guardian ?? "Parent")
          : "Member"),
    permissions,
    /** Of those, the ones held across the whole organization (not just in some groups). */
    wholeOrg: permissions.filter((p) => canFor(ctx, p, [])),
    modules: [...modules],
    pending: Number(pending?.n ?? 0),
    /** The kind's words, for the frame (My classes, About the school). */
    terms: kindTerms(ctx.org.type),
    noun: KINDS[ctx.org.type].noun,
    leavePending: await pendingLeaveCount(ctx),
    admissionsNew: await newApplications(ctx),
    children: children.map((c) => ({ id: c.id, name: c.name ?? c.email })),
  }
}

/** The dashboards for the views this person has here. */
export async function orgHome(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const views = await viewsOf(ctx, user)
  const staff = views.includes("staff") ? await staffHome(ctx) : null
  const [admin, teacher, student, parent, runs] = await Promise.all([
    views.includes("admin") ? adminHome(ctx) : null,
    views.includes("teacher") ? teacherHome(ctx, user) : null,
    views.includes("student") ? studentHome(ctx, user) : null,
    views.includes("parent") ? parentHome(ctx, user) : null,
    homeRuns(ctx, user),
  ])
  const [mine, team, events] = await Promise.all([
    views.includes("student") ? myTraining(ctx, user) : null,
    views.includes("teacher") && ctx.modules.has("training")
      ? teamTraining(slug, user)
      : null,
    homeEvents(ctx, user),
  ])
  return {
    views,
    runs,
    training: { mine, team },
    events,
    /** Kinds where members join groups themselves: the home points them to those. */
    openGroups: KINDS[ctx.org.type].openGroups,
    admin,
    teacher,
    student,
    parent,
    staff,
    terms: kindTerms(ctx.org.type),
  }
}

/** Which views a person has, for the page to decide what to render. */
export async function homeViews(slug: string, user: User) {
  const ctx = await orgContext(slug, user).catch(() => null)
  return ctx ? viewsOf(ctx, user) : []
}
