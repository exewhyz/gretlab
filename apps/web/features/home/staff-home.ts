import { type User } from "@workspace/db"
import { KINDS } from "@workspace/judge"

import { newApplications } from "@/features/admissions/server"
import { today } from "@/features/catalog/server"
import { pendingLeaveCount } from "@/features/leave/server"
import { heldAnywhere, type OrgContext } from "@/features/orgs/server"
import { dayOff } from "@/features/holidays/server"
import { staffToday } from "@/features/staff-attendance/server"
import { listTraining } from "@/features/training/server"
import { managedNav } from "./home-core"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

/** Staff who neither oversee the school nor teach: today, what waits for them, their pages. */
export async function staffHome(ctx: OrgContext) {
  const held = new Set(heldAnywhere(ctx))
  const modules = ctx.modules
  const base = `/orgs/${ctx.org.slug}`
  const links = managedNav(ctx).flatMap((g) =>
    g.items
      .filter((i) => i.key !== "overview")
      .map((i) => ({
        key: i.key,
        label: i.label,
        group: g.label,
        href: `${base}/manage${i.path}`,
      }))
  )
  if (modules.has("leave"))
    links.push({
      key: "leave",
      label: "Leave",
      group: `This ${KINDS[ctx.org.type].noun}`,
      href: `${base}/leave`,
    })
  const [day, leaveWaiting, applications, staffDay] = await Promise.all([
    today(),
    pendingLeaveCount(ctx),
    newApplications(ctx),
    staffToday(ctx),
  ])
  return {
    day,
    links,
    // No check-in on a day off (a holiday, or not a school day).
    checkIn: modules.has("staffAttendance") && !(await dayOff(ctx.org, day)),
    waiting: {
      leave:
        modules.has("leave") &&
        (held.has("leave.students") ||
          held.has("leave.staff") ||
          leaveWaiting > 0)
          ? leaveWaiting
          : null,
      applications:
        held.has("admissions.manage") && modules.has("admissions")
          ? applications
          : null,
    },
    staffToday: staffDay,
  }
}

/** A manager's team view of training: who's late or due soon, across what they see. */
export async function teamTraining(slug: string, user: User) {
  const list = await listTraining(slug, user)
  const sum = (k: "overdue" | "expired" | "due" | "expiring" | "done") =>
    list.trainings.reduce((n, t) => n + t.counts[k], 0)
  return {
    assigned: list.trainings.reduce((n, t) => n + t.people, 0),
    done: sum("done") + sum("expiring"),
    late: sum("overdue") + sum("expired"),
    soon: sum("due") + sum("expiring"),
    trainings: list.trainings
      .filter(
        (t) =>
          t.counts.overdue +
            t.counts.expired +
            t.counts.due +
            t.counts.expiring >
          0
      )
      .slice(0, 5)
      .map((t) => ({
        courseId: t.courseId,
        groupId: t.groupId,
        course: t.course,
        group: t.group,
        late: t.counts.overdue + t.counts.expired,
        soon: t.counts.due + t.counts.expiring,
      })),
  }
}
