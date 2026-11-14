import {
  academicYears,
  classSubjects,
  classTeachers,
  getDb,
  guardians,
  hostelBeds,
  hostelResidents,
  hostelRooms,
  hostels,
  libraryLoans,
  orgMembers,
  sql,
  subjects,
  termExams,
  timetableSlots,
  transportRiders,
} from "@workspace/db"
import { KINDS, kindTerms, readAdmissionSettings } from "@workspace/judge"

import { newApplications } from "@/features/admissions/server"
import { today } from "@/features/catalog/server"
import { dayOff } from "@/features/holidays/server"
import { pendingLeaveCount } from "@/features/leave/server"
import { type OrgContext } from "@/features/orgs/server"
import { orgPages } from "@/lib/paths"
import {
  leaves,
  Mark,
  marksOf,
  pathName,
  percent,
  reachable,
  staffIds,
  studentsByGroup,
  TEACHING,
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

const { and, count, eq, lt, sql: raw } = sql

export async function adminHome(ctx: OrgContext) {
  const terms = kindTerms(ctx.org.type)
  const db = getDb()
  const day = await today()
  const modules = ctx.modules
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
      label: `${KINDS[ctx.org.type].noun.charAt(0).toUpperCase()}${KINDS[ctx.org.type].noun.slice(1)} profile`,
      done: ctx.org.description.trim().length > 0,
      href: "/settings",
    },
    ...(modules.has("records")
      ? [
          {
            key: "year",
            label: `Current ${terms.period.toLowerCase()}`,
            done: hasCurrentYear,
            href: "/academic-years",
          },
        ]
      : []),
    {
      key: "classes",
      label: `${terms.groups} and ${(ctx.org.groupLevels.at(-1) ?? "section").toLowerCase()}s`,
      done: classes.length > 0,
      href: "/groups",
    },
    ...(modules.has("records")
      ? [
          {
            key: "class-teachers",
            label: `${terms.groupLead}s`,
            done: Number(leadCount?.n ?? 0) > 0,
            href: "/academic-years",
          },
        ]
      : []),
    {
      key: "teachers",
      label: `Add ${terms.instructors.toLowerCase()}`,
      done: teachers.size > 0,
      href: "/members",
    },
    {
      key: "students",
      label: `Add ${terms.learners.toLowerCase()}`,
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
            label: `Link ${(terms.guardians ?? "parents").toLowerCase()}`,
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
            label: `This ${terms.period.toLowerCase()}'s ${terms.assessments.toLowerCase()}`,
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

  // On a day off (a holiday, or not a school day) no register is expected.
  const off = await dayOff(ctx.org, day)
  const notTaken = off ? [] : rows.filter((r) => !r.taken)
  const attention = [
    ...(newApps > 0
      ? [
          {
            kind: "Admissions",
            tone: "plain" as const,
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
            tone: "plain" as const,
            text: `${leaveWaiting} leave request${leaveWaiting === 1 ? "" : "s"} to decide`,
            action: "Decide",
            href: orgPages(ctx.org.slug).leave,
          },
        ]
      : []),
    ...(modules.has("attendance") && notTaken.length
      ? [
          {
            kind: "Register",
            tone: "bad" as const,
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
            tone: "plain" as const,
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
            tone: "plain" as const,
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
            tone: "plain" as const,
            text: `${students.size - linkedStudents} ${terms.learners.toLowerCase()} with no ${(terms.guardian ?? "parent").toLowerCase()} linked`,
            action: "Link",
            href: "/parents",
          },
        ]
      : []),
    ...(Number(pendingCount?.n ?? 0) > 0
      ? [
          {
            kind: "Joining",
            tone: "plain" as const,
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
    holiday: off?.holiday ?? null,
    /** Why today is off ("Holiday: Diwali", "Not a school day"), or null on a school day. */
    dayOff: off?.label ?? null,
    steps: reachable(ctx, steps),
    classes: modules.has("attendance") ? rows : [],
    trend,
    attention: reachable(ctx, attention),
    coverage,
  }
}
