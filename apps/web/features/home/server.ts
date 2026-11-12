import {
  academicYears,
  classTeachers,
  termExams,
  attendance,
  getDb,
  groupMembers,
  guardians,
  hostelBeds,
  hostelResidents,
  hostelRooms,
  hostels,
  libraryLoans,
  orgMembers,
  orgRoles,
  roleAssignments,
  sql,
  subjects,
  teachingSessions,
  timetableSlots,
  transportRiders,
  classSubjects,
  users,
  type User,
} from "@workspace/db"
import {
  enabledModules,
  ORG_NAV,
  PERMISSIONS,
  readAdmissionSettings,
  visibleOrgNav,
  type Permission,
} from "@workspace/judge"

import { listAssignments } from "@/features/assignments/server"
import { campusOf } from "@/features/campus/server"
import { today } from "@/features/catalog/server"
import { classAttendance, classStream } from "@/features/classes/server"
import { listContests } from "@/features/contests/server"
import { pendingLeaveCount } from "@/features/leave/server"
import { papersToMark } from "@/features/results/server"
import { staffToday } from "@/features/staff-attendance/server"
import { newApplications } from "@/features/admissions/server"
import { childOverview } from "@/features/parents/server"
import { rolePermissions } from "@/features/orgs/access"
import {
  canFor,
  groupChain,
  heldAnywhere,
  orgContext,
  type OrgContext,
} from "@/features/orgs/server"
import { classTimetable, periodsOf, slotsOf } from "@/features/timetable/server"

/*
 * The school's home (/orgs/:slug): one page per organization whose content depends on who
 * you are there. A person can be several at once (a teacher who is also a parent); `views`
 * lists theirs in order, admin first. The shell (sidebar and header) needs only
 * orgShell(); the dashboards need orgHome(), which computes only the views the person has.
 * Everything is read with the person's own permissions: a teacher's home counts only the
 * classes they're given.
 */

const { and, count, eq, inArray, lt, sql: raw } = sql

export type HomeView = "admin" | "teacher" | "student" | "parent" | "staff"

const TEACHING: Permission[] = ["attendance.mark", "teaching.log"]
const OVERSEEING: Permission[] = [
  "org.members.view",
  "org.settings.manage",
  "reports.view",
]

/** The leaf groups: classes or sections, where students actually sit. */
const leaves = (ctx: OrgContext) =>
  ctx.groups.filter((g) => !ctx.groups.some((c) => c.parentId === g.id))

const pathName = (ctx: OrgContext, groupId: string) =>
  [...groupChain(ctx, groupId)]
    .reverse()
    .map((id) => ctx.groups.find((g) => g.id === id)?.name ?? "")
    .join(" · ")

/** Groups (and everything under them) a role given for specific groups lets this person teach. */
function taughtGroups(ctx: OrgContext) {
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
function rolePermissionsHold(held: readonly string[], permission: Permission) {
  let p: string | undefined = permission
  while (p) {
    if (held.includes(p)) return true
    p = (PERMISSIONS[p as Permission] as { parent?: string }).parent
  }
  return false
}

async function viewsOf(ctx: OrgContext, user: User): Promise<HomeView[]> {
  const db = getDb()
  const held = heldAnywhere(ctx)
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
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
  if (ctx.membership?.status === "active" && held.length === 0) {
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

/** What the sidebar and header need, on every page of the school. */
export async function orgShell(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const views = await viewsOf(ctx, user)
  const permissions = heldAnywhere(ctx)
  const db = getDb()
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
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
        ? "Student"
        : views.includes("parent")
          ? "Parent"
          : "Member"),
    permissions,
    modules: [...modules],
    pending: Number(pending?.n ?? 0),
    leavePending: await pendingLeaveCount(ctx),
    admissionsNew: await newApplications(ctx),
    children: children.map((c) => ({ id: c.id, name: c.name ?? c.email })),
  }
}

/* ---------- the dashboards ---------- */

type Mark = {
  userId: string
  groupId: string
  day: string
  status: string
  present: boolean
  kind: string
}

/** Every attendance mark of these groups (registers and logged classes). */
async function marksOf(groupIds: string[]): Promise<Mark[]> {
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
function percent(marks: Mark[], min = 1) {
  const counted = marks.filter((m) => m.status !== "excused")
  if (counted.length < min) return null
  return Math.round(
    (100 * counted.filter((m) => m.present).length) / counted.length
  )
}

/** Students of each leaf group: members sitting there who hold no role that grants anything. */
async function studentsByGroup(ctx: OrgContext, groupIds: string[]) {
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
async function staffIds(
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
function todayOf(marks: Mark[], day: string, groupId: string) {
  const mine = marks.filter(
    (m) => m.groupId === groupId && m.day === day && m.kind === "register"
  )
  return {
    taken: mine.length > 0,
    present: new Set(mine.filter((m) => m.present).map((m) => m.userId)).size,
  }
}

async function adminHome(ctx: OrgContext) {
  const db = getDb()
  const day = await today()
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
  const classes = leaves(ctx)
  const classIds = classes.map((g) => g.id)
  const [
    byGroup,
    teachers,
    marks,
    [subjectCount],
    [slotCount],
    [linkCount],
    [pendingCount],
  ] = await Promise.all([
    studentsByGroup(ctx, classIds),
    staffIds(ctx, (perms) => TEACHING.some((p) => perms.includes(p))),
    marksOf(classIds),
    modules.has("subjects")
      ? db
          .select({ n: count() })
          .from(subjects)
          .where(eq(subjects.orgId, ctx.org.id))
      : [{ n: 0 }],
    modules.has("timetable")
      ? db
          .select({ n: count() })
          .from(timetableSlots)
          .where(eq(timetableSlots.orgId, ctx.org.id))
      : [{ n: 0 }],
    modules.has("parents")
      ? db
          .select({ n: count() })
          .from(guardians)
          .where(eq(guardians.orgId, ctx.org.id))
      : [{ n: 0 }],
    db
      .select({ n: count() })
      .from(orgMembers)
      .where(
        and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.status, "pending"))
      ),
  ])
  const students = new Map<string, string>()
  for (const list of byGroup.values())
    for (const s of list) students.set(s.id, s.name)

  // Today, class by class.
  const rows = classes
    .filter((g) => (byGroup.get(g.id)?.length ?? 0) > 0)
    .map((g) => {
      const t = todayOf(marks, day, g.id)
      return {
        id: g.id,
        name: pathName(ctx, g.id),
        students: byGroup.get(g.id)!.length,
        ...t,
      }
    })
  const taken = rows.filter((r) => r.taken)
  const presentToday = taken.reduce((sum, r) => sum + r.present, 0)
  const markedToday = taken.reduce((sum, r) => sum + r.students, 0)

  // The last ten days with registers, whole school.
  const registerDays = [
    ...new Set(marks.filter((m) => m.kind === "register").map((m) => m.day)),
  ]
    .sort()
    .slice(-10)
  const trend = registerDays.map((d) => ({
    day: d,
    percent:
      percent(marks.filter((m) => m.day === d && m.kind === "register")) ?? 0,
  }))

  // Students below 75% over at least four marks.
  const byStudent = new Map<string, Mark[]>()
  for (const m of marks)
    if (students.has(m.userId))
      byStudent.set(m.userId, [...(byStudent.get(m.userId) ?? []), m])
  const low = [...byStudent.entries()].filter(
    ([, ms]) => (percent(ms, 4) ?? 100) < 75
  )

  const [overdue, riders, beds, linkedStudents, teachersOnTimetable] =
    await Promise.all([
      modules.has("library")
        ? db
            .select({ n: count() })
            .from(libraryLoans)
            .where(
              and(
                eq(libraryLoans.orgId, ctx.org.id),
                eq(libraryLoans.status, "out"),
                lt(libraryLoans.dueOn, day)
              )
            )
            .then((r) => Number(r[0]?.n ?? 0))
        : null,
      modules.has("transport")
        ? db
            .select({ n: count() })
            .from(transportRiders)
            .where(eq(transportRiders.orgId, ctx.org.id))
            .then((r) => Number(r[0]?.n ?? 0))
        : null,
      modules.has("hostel")
        ? db
            .select({
              beds: count(hostelBeds.id),
              taken: raw<number>`count(${hostelResidents.userId})`.mapWith(
                Number
              ),
            })
            .from(hostelBeds)
            .innerJoin(hostelRooms, eq(hostelBeds.roomId, hostelRooms.id))
            .innerJoin(hostels, eq(hostelRooms.hostelId, hostels.id))
            .leftJoin(hostelResidents, eq(hostelResidents.bedId, hostelBeds.id))
            .where(eq(hostels.orgId, ctx.org.id))
            .then((r) => ({
              beds: Number(r[0]?.beds ?? 0),
              taken: Number(r[0]?.taken ?? 0),
            }))
        : null,
      modules.has("parents")
        ? db
            .selectDistinct({ id: guardians.studentId })
            .from(guardians)
            .where(eq(guardians.orgId, ctx.org.id))
            .then((r) => r.filter((x) => students.has(x.id)).length)
        : null,
      modules.has("timetable")
        ? db
            .selectDistinct({ id: classSubjects.teacherId })
            .from(timetableSlots)
            .innerJoin(
              classSubjects,
              eq(timetableSlots.classSubjectId, classSubjects.id)
            )
            .where(eq(timetableSlots.orgId, ctx.org.id))
            .then((r) => r.filter((x) => x.id && teachers.has(x.id)).length)
        : null,
    ])

  const hasCurrentYear = modules.has("records")
    ? (
        await db
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(
            and(
              eq(academicYears.orgId, ctx.org.id),
              eq(academicYears.isCurrent, true)
            )
          )
          .limit(1)
      ).length > 0
    : false

  // The newer processes: class teachers, exams and admissions.
  const year = hasCurrentYear
    ? (
        await db
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(
            and(
              eq(academicYears.orgId, ctx.org.id),
              eq(academicYears.isCurrent, true)
            )
          )
          .limit(1)
      )[0]
    : undefined
  const [[leadCount], [examCount], newApps, leaveWaiting] = await Promise.all([
    year
      ? db
          .select({ n: count() })
          .from(classTeachers)
          .where(eq(classTeachers.yearId, year.id))
      : [{ n: 0 }],
    modules.has("exams") && year
      ? db
          .select({ n: count() })
          .from(termExams)
          .where(eq(termExams.yearId, year.id))
      : [{ n: 0 }],
    newApplications(ctx),
    pendingLeaveCount(ctx),
  ])
  const admissionsSetUp =
    readAdmissionSettings(ctx.org.moduleSettings).yearId != null

  const steps = [
    {
      key: "profile",
      label: "School profile",
      done: ctx.org.description.trim().length > 0,
      href: "/settings",
    },
    ...(modules.has("records")
      ? [
          {
            key: "year",
            label: "Current academic year",
            done: hasCurrentYear,
            href: "/academic-years",
          },
        ]
      : []),
    {
      key: "classes",
      label: "Classes and sections",
      done: classes.length > 0,
      href: "/groups",
    },
    ...(modules.has("records")
      ? [
          {
            key: "class-teachers",
            label: "Class teachers",
            done: Number(leadCount?.n ?? 0) > 0,
            href: "/academic-years",
          },
        ]
      : []),
    {
      key: "teachers",
      label: "Add teachers",
      done: teachers.size > 0,
      href: "/members",
    },
    {
      key: "students",
      label: "Add students",
      done: students.size > 0,
      href: modules.has("records") ? "/students" : "/import",
    },
    ...(modules.has("subjects")
      ? [
          {
            key: "subjects",
            label: "Subjects",
            done: Number(subjectCount?.n ?? 0) > 0,
            href: "/subjects",
          },
        ]
      : []),
    ...(modules.has("timetable")
      ? [
          {
            key: "timetable",
            label: "Timetable",
            done: Number(slotCount?.n ?? 0) > 0,
            href: "/timetable",
          },
        ]
      : []),
    ...(modules.has("parents")
      ? [
          {
            key: "parents",
            label: "Link parents",
            done: Number(linkCount?.n ?? 0) > 0,
            href: "/parents",
          },
        ]
      : []),
    ...(modules.has("attendance")
      ? [
          {
            key: "attendance",
            label: "First attendance",
            done: registerDays.length > 0,
            href: "/attendance",
          },
        ]
      : []),
    ...(modules.has("exams")
      ? [
          {
            key: "exams",
            label: "This year's exams",
            done: Number(examCount?.n ?? 0) > 0,
            href: "/exams",
          },
        ]
      : []),
    ...(modules.has("admissions")
      ? [
          {
            key: "admissions",
            label: "Admissions",
            done: admissionsSetUp,
            href: "/admissions",
          },
        ]
      : []),
  ]

  const notTaken = rows.filter((r) => !r.taken)
  const attention = [
    ...(newApps > 0
      ? [
          {
            kind: "Admissions",
            tone: "plain",
            text: `${newApps} new application${newApps === 1 ? "" : "s"}`,
            action: "Review",
            href: "/admissions",
          },
        ]
      : []),
    ...(leaveWaiting > 0
      ? [
          {
            kind: "Leave",
            tone: "plain",
            text: `${leaveWaiting} leave request${leaveWaiting === 1 ? "" : "s"} to decide`,
            action: "Decide",
            href: `/orgs/${ctx.org.slug}/leave`,
          },
        ]
      : []),
    ...(modules.has("attendance") && notTaken.length
      ? [
          {
            kind: "Register",
            tone: "bad",
            text:
              notTaken.length === 1
                ? `${notTaken[0]!.name} not taken today`
                : `${notTaken.length} registers not taken today`,
            action: "Open",
            href: "/attendance",
          },
        ]
      : []),
    ...(low.length
      ? [
          {
            kind: "Attendance",
            tone: "plain",
            text: `${low.length} student${low.length === 1 ? "" : "s"} below 75%`,
            action: "View",
            href: "/attendance-report",
          },
        ]
      : []),
    ...(overdue
      ? [
          {
            kind: "Library",
            tone: "plain",
            text: `${overdue} book${overdue === 1 ? "" : "s"} overdue`,
            action: "Open",
            href: "/books",
          },
        ]
      : []),
    ...(linkedStudents != null && students.size - linkedStudents > 0
      ? [
          {
            kind: "Parents",
            tone: "plain",
            text: `${students.size - linkedStudents} students with no parent linked`,
            action: "Link",
            href: "/parents",
          },
        ]
      : []),
    ...(Number(pendingCount?.n ?? 0) > 0
      ? [
          {
            kind: "Joining",
            tone: "plain",
            text: `${pendingCount!.n} asking to join`,
            action: "Review",
            href: "/members",
          },
        ]
      : []),
  ]

  const coverage = [
    ...(linkedStudents != null
      ? [
          {
            label: "Students with a parent linked",
            value: linkedStudents,
            of: students.size,
          },
        ]
      : []),
    ...(teachersOnTimetable != null
      ? [
          {
            label: "Teachers on the timetable",
            value: teachersOnTimetable,
            of: teachers.size,
          },
        ]
      : []),
    ...(riders != null
      ? [{ label: "Students on a bus route", value: riders, of: students.size }]
      : []),
    ...(beds
      ? [{ label: "Hostel beds taken", value: beds.taken, of: beds.beds }]
      : []),
  ]

  return {
    day,
    tiles: {
      students: students.size,
      teachers: teachers.size,
      classes: classes.length,
      present: modules.has("attendance")
        ? { present: presentToday, of: markedToday, open: notTaken.length }
        : null,
    },
    steps,
    classes: modules.has("attendance") ? rows : [],
    trend,
    attention,
    coverage,
  }
}

async function teacherHome(ctx: OrgContext, user: User) {
  const day = await today()
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
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

  const toTake = modules.has("attendance")
    ? classes.filter((c) => !c.taken)
    : []
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
    todo: [
      ...toTake.map((c) => ({
        kind: "Register",
        tone: "bad",
        text: `${c.name} not taken today`,
        action: "Take",
        href: `/attendance?groupId=${c.id}`,
      })),
      ...(leaveWaiting > 0
        ? [
            {
              kind: "Leave",
              tone: "plain",
              text: `${leaveWaiting} leave request${leaveWaiting === 1 ? "" : "s"} to decide`,
              action: "Decide",
              href: `/orgs/${ctx.org.slug}/leave`,
            },
          ]
        : []),
      ...toMark.map((p) => ({
        kind: "Marks",
        tone: "plain",
        text: `${p.subject}, ${p.class}: ${p.entered} of ${p.students} in (${p.exam})`,
        action: "Enter",
        href: `/exams/${p.examId}/papers/${p.id}`,
      })),
      ...low.slice(0, 5).map((s) => ({
        kind: "Attendance",
        tone: "plain",
        text: `${s.name} (${s.group}) at ${s.percent}%`,
        action: "View",
        href: "/attendance-report",
      })),
    ],
    classes,
    attendanceOn: modules.has("attendance"),
  }
}

/** ISO weekday (1 Monday … 7 Sunday) of a "YYYY-MM-DD" day. */
const weekdayOf = (day: string) =>
  ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

const DAY_MS = 86_400_000

/**
 * A student's own home, built from the same functions as their class pages (called as
 * them), so it never shows more than those do.
 */
async function studentHome(ctx: OrgContext, user: User) {
  const slug = ctx.org.slug
  const day = await today()
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
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

  // Today's lessons, from the first of their classes with a timetable.
  const weekday = weekdayOf(day)
  const week = perGroup.find((g) => g.week && g.week.periods.length)?.week
  const lessons = week
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
      href: `/orgs/${slug}/books`,
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
async function parentHome(ctx: OrgContext, user: User) {
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
          text: `${a.group}${a.period ? `, ${a.period}` : ""}`,
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

/** Staff who neither oversee the school nor teach: today, what waits for them, their pages. */
async function staffHome(ctx: OrgContext) {
  const held = new Set(heldAnywhere(ctx))
  const modules = enabledModules(ctx.org.type, ctx.org.modules)
  const base = `/orgs/${ctx.org.slug}`
  const links = visibleOrgNav(ORG_NAV, {
    orgType: ctx.org.type,
    can: (p) => held.has(p),
    enabledModules: modules,
  }).flatMap((g) =>
    g.items
      .filter((i) => i.key !== "overview")
      .map((i) => ({
        key: i.key,
        label: i.label,
        group: g.group as string,
        href: `${base}/manage${i.path}`,
      }))
  )
  if (modules.has("leave"))
    links.push({
      key: "leave",
      label: "Leave",
      group: "This school",
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
    checkIn: modules.has("staffAttendance"),
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

/** The dashboards for the views this person has here. */
export async function orgHome(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const views = await viewsOf(ctx, user)
  const staff = views.includes("staff") ? await staffHome(ctx) : null
  const [admin, teacher, student, parent] = await Promise.all([
    views.includes("admin") ? adminHome(ctx) : null,
    views.includes("teacher") ? teacherHome(ctx, user) : null,
    views.includes("student") ? studentHome(ctx, user) : null,
    views.includes("parent") ? parentHome(ctx, user) : null,
  ])
  return { views, admin, teacher, student, parent, staff }
}

/** Which views a person has, for the page to decide what to render. */
export async function homeViews(slug: string, user: User) {
  const ctx = await orgContext(slug, user).catch(() => null)
  return ctx ? viewsOf(ctx, user) : []
}
