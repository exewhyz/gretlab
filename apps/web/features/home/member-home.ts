import { getDb, groupMembers, guardians, sql, type User } from "@workspace/db"

import { listAssignments } from "@/features/assignments/server"
import { campusOf } from "@/features/campus/server"
import { today } from "@/features/catalog/server"
import { classAttendance, classStream } from "@/features/classes/server"
import { listContests } from "@/features/contests/server"
import { type OrgContext } from "@/features/orgs/server"
import { childOverview } from "@/features/parents/server"
import { dayOff } from "@/features/holidays/server"
import { classTimetable } from "@/features/timetable/server"
import { orgPages } from "@/lib/paths"
import { DAY_MS, pathName, weekdayOf } from "./home-core"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

const { and, eq, inArray } = sql

/**
 * A student's own home, built from the same functions as their class pages (called as
 * them), so it never shows more than those do.
 */
export async function studentHome(ctx: OrgContext, user: User) {
  const slug = ctx.org.slug
  const day = await today()
  const modules = ctx.modules
  const seats = await getDb()
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, user.id),
        inArray(
          groupMembers.groupId,
          ctx.groups.map((g) => g.id)
        )
      )
    )
  const quiet = <T>(p: Promise<T>) => p.catch(() => null)
  const [perGroup, work, contests, campus] = await Promise.all([
    Promise.all(
      seats.map(async ({ groupId }) => {
        const [att, week, stream] = await Promise.all([
          modules.has("attendance")
            ? quiet(classAttendance(slug, user, groupId))
            : null,
          modules.has("timetable")
            ? quiet(classTimetable(slug, user, groupId))
            : null,
          quiet(classStream(slug, user, groupId)),
        ])
        return { groupId, att: att?.mine ?? null, week, stream: stream ?? [] }
      })
    ),
    listAssignments(user).catch(() => []),
    listContests(user).catch(() => []),
    campusOf(ctx.org, user.id),
  ])

  // Attendance over every class they sit in; late counts as present.
  const marked = perGroup.reduce((sum, g) => sum + (g.att?.marked ?? 0), 0)
  const present = perGroup.reduce((sum, g) => sum + (g.att?.present ?? 0), 0)

  // Today's lessons, from the first of their classes with a timetable (none on a day off).
  const weekday = weekdayOf(day)
  const off = await dayOff(ctx.org, day)
  const week = perGroup.find((g) => g.week && g.week.periods.length)?.week
  const lessons =
    week && !off
      ? week.periods
          .map((p) => {
            if (p.isBreak)
              return {
                starts: p.starts,
                ends: p.ends,
                subject: p.name,
                teacher: "",
                isBreak: true,
              }
            const slot = week.slots.find(
              (s) => s.day === weekday && s.periodId === p.id
            )
            return slot
              ? {
                  starts: p.starts,
                  ends: p.ends,
                  subject: slot.subject,
                  teacher: slot.teacher ?? "",
                  isBreak: false,
                }
              : null
          })
          .filter((l): l is NonNullable<typeof l> => l !== null)
      : []
  while (lessons[0]?.isBreak) lessons.shift()
  while (lessons.at(-1)?.isBreak) lessons.pop()

  // What's coming: open work here, contests soon, library books due.
  const now = Date.now()
  const mine = work.filter((a) => a.org?.slug === slug && a.published)
  const open = mine
    .filter((a) => a.phase === "open" && !(a.total > 0 && a.earned >= a.total))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const dueThisWeek = open.filter(
    (a) => new Date(a.dueAt).getTime() - now < 7 * DAY_MS
  ).length
  const soonContests = contests.filter(
    (c) =>
      c.org?.slug === slug &&
      c.phase === "upcoming" &&
      new Date(c.startsAt).getTime() - now < 14 * DAY_MS
  )
  const loans = campus.library?.loans ?? []
  const coming = [
    ...open.slice(0, 4).map((a) => ({
      kind: a.exam ? "Exam" : "Assignment",
      title: a.title,
      detail: `${a.solved} of ${a.problemCount} solved`,
      at: new Date(a.dueAt).toISOString(),
      href: `/assignments/${a.slug}`,
      action: "Continue",
    })),
    ...soonContests.slice(0, 2).map((c) => ({
      kind: "Contest",
      title: c.title,
      detail: "Register on its page",
      at: new Date(c.startsAt).toISOString(),
      href: `/contests/${c.slug}`,
      action: "Open",
    })),
    ...loans.slice(0, 2).map((l) => ({
      kind: "Library",
      title: l.title,
      detail: l.status === "overdue" ? "Overdue" : "Due back",
      at: `${l.dueOn}T12:00:00.000Z`,
      href: orgPages(slug).books,
      action: "View",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  // Notices across their classes, newest first, each once.
  const seen = new Set<string>()
  const notices = perGroup
    .flatMap((g) =>
      g.stream
        .filter((x) => x.kind === "notice")
        .map((x) => ({
          id: x.id,
          at: new Date(x.at).toISOString(),
          text: "text" in x ? x.text : "",
          by: "by" in x ? x.by : null,
          group: pathName(ctx, g.groupId),
        }))
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .slice(0, 5)

  return {
    dayOff: off?.label ?? null,
    day,
    classes: seats.map((s) => ({
      id: s.groupId,
      name: pathName(ctx, s.groupId),
    })),
    tiles: {
      attendance:
        modules.has("attendance") && marked
          ? Math.round((100 * present) / marked)
          : null,
      dueThisWeek,
      classes: seats.length,
      booksOut: modules.has("library") ? loans.length : null,
    },
    lessons,
    coming,
    notices,
    campus,
  }
}

/** A parent's home: each linked child, as on their child page (features/parents). */
export async function parentHome(ctx: OrgContext, user: User) {
  const day = await today()
  const links = await getDb()
    .select({ id: guardians.studentId })
    .from(guardians)
    .where(
      and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, user.id))
    )
  const children = await Promise.all(
    links.map(async (l) => {
      const o = await childOverview(ctx.org.slug, user, l.id).catch(() => null)
      if (!o) return null
      const marked = o.classes.reduce(
        (sum, c) => sum + (c.attendance?.marked ?? 0),
        0
      )
      const present = o.classes.reduce(
        (sum, c) => sum + (c.attendance?.present ?? 0),
        0
      )
      const absentToday = o.absences.some(
        (a) => a.day === day && a.status === "absent"
      )
      const news = [
        ...o.absences.slice(0, 2).map((a) => ({
          kind: a.status === "late" ? "Late" : "Absent",
          tone: "bad" as const,
          // Say what happened, not only where: "Arrived late · Grade 6 › 6-A, Period 2".
          text: `${a.status === "late" ? "Arrived late" : "Absent"} · ${a.group}${a.period ? `, ${a.period}` : ""}`,
          at: `${a.day}T12:00:00.000Z`,
        })),
        ...o.classes
          .flatMap((c) => c.notices.map((n) => ({ ...n, group: c.name })))
          .slice(0, 2)
          .map((n) => ({
            kind: "Notice",
            tone: "plain" as const,
            text: n.text.length > 90 ? `${n.text.slice(0, 87)}…` : n.text,
            at: new Date(n.at).toISOString(),
          })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 3)
      return {
        id: l.id,
        name: o.child.name,
        classes: o.classes.map((c) => c.name),
        attendance: marked ? Math.round((100 * present) / marked) : null,
        absentToday,
        work: o.work.filter((w) => w.phase === "open").length,
        bus: o.campus?.transport?.ride
          ? `${o.campus.transport.ride.route}, ${o.campus.transport.ride.stop}`
          : null,
        news,
      }
    })
  )
  return {
    day,
    children: children.filter((c): c is NonNullable<typeof c> => c !== null),
  }
}
