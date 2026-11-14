import { type User } from "@workspace/db"

import { today } from "@/features/catalog/server"
import { holidayOn } from "@/features/holidays/server"
import { pendingLeaveCount } from "@/features/leave/server"
import { type OrgContext } from "@/features/orgs/server"
import { papersToMark } from "@/features/results/server"
import { periodsOf, slotsOf } from "@/features/timetable/server"
import { orgPages } from "@/lib/paths"
import {
  marksOf,
  pathName,
  percent,
  reachable,
  studentsByGroup,
  taughtGroups,
  todayOf,
} from "./home-core"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

export async function teacherHome(ctx: OrgContext, user: User) {
  const day = await today()
  const modules = ctx.modules
  const mine = taughtGroups(ctx)
  const ids = mine.map((g) => g.id)
  const [byGroup, marks] = await Promise.all([
    studentsByGroup(ctx, ids),
    marksOf(ids),
  ])
  const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

  // Today's periods from the timetable, when it's on.
  let periods: {
    time: string
    title: string
    detail: string
    groupId: string | null
    isBreak: boolean
  }[] = []
  if (modules.has("timetable")) {
    const [all, slots] = await Promise.all([
      periodsOf(ctx.org.id),
      slotsOf(ctx.org.id, null, user.id),
    ])
    const todays = slots.filter((s) => s.day === weekday)
    periods = all
      .map((p) => {
        const slot = todays.find((s) => s.periodId === p.id)
        if (p.isBreak)
          return {
            time: `${p.starts}–${p.ends}`,
            title: p.name,
            detail: "",
            groupId: null,
            isBreak: true,
          }
        if (!slot) return null
        return {
          time: `${p.starts}–${p.ends}`,
          title: `${pathName(ctx, slot.groupId)} · ${slot.subject}`,
          detail: [
            slot.room && `Room ${slot.room}`,
            `${byGroup.get(slot.groupId)?.length ?? 0} students`,
          ]
            .filter(Boolean)
            .join(" · "),
          groupId: slot.groupId,
          isBreak: false,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    // Breaks only between lessons.
    while (periods[0]?.isBreak) periods.shift()
    while (periods.at(-1)?.isBreak) periods.pop()
  }

  const classes = mine
    .map((g) => {
      const list = byGroup.get(g.id) ?? []
      const t = todayOf(marks, day, g.id)
      return {
        id: g.id,
        name: pathName(ctx, g.id),
        students: list.length,
        attendance: percent(marks.filter((m) => m.groupId === g.id)),
        taken: t.taken,
      }
    })
    .filter((c) => c.students > 0)

  const low: { name: string; group: string; percent: number }[] = []
  for (const c of classes) {
    for (const s of byGroup.get(c.id) ?? []) {
      const p = percent(
        marks.filter((m) => m.userId === s.id && m.groupId === c.id),
        4
      )
      if (p != null && p < 75)
        low.push({ name: s.name, group: c.name, percent: p })
    }
  }
  low.sort((a, b) => a.percent - b.percent)

  const holiday = await holidayOn(ctx.org.id, day)
  const toTake =
    modules.has("attendance") && !holiday ? classes.filter((c) => !c.taken) : []
  // The newer processes: marks still to enter in their subjects, leave waiting for them.
  const [toMark, leaveWaiting] = await Promise.all([
    papersToMark(ctx),
    pendingLeaveCount(ctx),
  ])
  return {
    day,
    checkIn: modules.has("staffAttendance"),
    tiles: {
      lessons: periods.filter((p) => !p.isBreak).length,
      toTake: toTake.length,
      students: classes.reduce((sum, c) => sum + c.students, 0),
      low: low.length,
    },
    periods: periods.map((p) => ({
      ...p,
      taken: p.groupId
        ? (classes.find((c) => c.id === p.groupId)?.taken ?? false)
        : false,
    })),
    todo: reachable(ctx, [
      ...toTake.map((c) => ({
        kind: "Register",
        tone: "bad" as const,
        text: `${c.name} not taken today`,
        action: "Take",
        href: `/attendance?groupId=${c.id}`,
      })),
      ...(leaveWaiting > 0
        ? [
            {
              kind: "Leave",
              tone: "plain" as const,
              text: `${leaveWaiting} leave request${leaveWaiting === 1 ? "" : "s"} to decide`,
              action: "Decide",
              href: orgPages(ctx.org.slug).leave,
            },
          ]
        : []),
      ...toMark.map((p) => ({
        kind: "Marks",
        tone: "plain" as const,
        text: `${p.subject}, ${p.class}: ${p.entered} of ${p.students} in (${p.exam})`,
        action: "Enter",
        href: `/exams/${p.examId}/papers/${p.id}`,
      })),
      ...low.slice(0, 5).map((s) => ({
        kind: "Attendance",
        tone: "plain" as const,
        text: `${s.name} (${s.group}) at ${s.percent}%`,
        action: "View",
        href: "/attendance-report",
      })),
    ]),
    classes,
    attendanceOn: modules.has("attendance"),
    holiday,
  }
}
