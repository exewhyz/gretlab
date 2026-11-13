import {
  academicYears,
  admissionApplications,
  attendance,
  classSubjects,
  classTeachers,
  enrolments,
  examMarks,
  examPapers,
  guardians,
  hostelBeds,
  hostelResidents,
  hostelRooms,
  hostels,
  leaveRequests,
  libraryBooks,
  libraryLoans,
  notes,
  organizations,
  orgEvents,
  eventRsvps,
  reportRemarks,
  staffAttendance,
  studentRecords,
  subjects,
  teachingSessions,
  termExams,
  timetablePeriods,
  timetableSlots,
  transportRiders,
  transportRoutes,
  transportStops,
} from "../index.ts"
import { eq } from "drizzle-orm"

import {
  academicYear,
  at,
  chance,
  db,
  day,
  emailFor,
  give,
  group,
  insertAll,
  int,
  join,
  makeOrg,
  makeUsers,
  normal,
  pastWorkdays,
  person,
  pick,
  random,
  remember,
  seat,
  shuffle,
  type Org,
  type UserRow,
} from "./shared.ts"

/*
 * Greenwood Public School: grades 6 to 10 in two sections each, about 180 students with
 * their parents, teachers with subjects and a timetable, a month of daily registers, unit
 * tests and half-yearly exams with marks and remarks, leave, staff attendance, admissions,
 * the library, buses and hostels, notices and events.
 */

const SLUG = "greenwood"
const SUBJECTS = [
  { name: "English", code: "ENG" },
  { name: "Hindi", code: "HIN" },
  { name: "Mathematics", code: "MAT" },
  { name: "Science", code: "SCI" },
  { name: "Social Science", code: "SST" },
  { name: "Computer Science", code: "CSC" },
]

export interface SchoolResult {
  org: Org
  grade10: string
  students: UserRow[]
}

export async function buildSchool(): Promise<SchoolResult> {
  const mk = (name: string, local = name.replace(/ /g, ".")) => ({ name, email: emailFor(local, SLUG) })
  // The people you'd sign in as, with easy addresses.
  const principalP = person("female", "Iyer")
  const [owner, principal, vice, office, librarian, transportMgr, warden, counselor, examCoord, admissionsOfficer] = await makeUsers([
    mk("Rajesh Malhotra", "owner"),
    mk(principalP.name, "principal"),
    mk(person("male").name, "vice.principal"),
    mk(person("female").name, "office"),
    mk(person("female").name, "librarian"),
    mk(person("male").name, "transport"),
    mk(person("male").name, "warden"),
    mk(person("female").name, "counselor"),
    mk(person("male").name, "exams"),
    mk(person("female").name, "admissions"),
  ])
  const org = await makeOrg({
    slug: SLUG,
    name: "Greenwood Public School",
    type: "school",
    description: "A CBSE school in Pune, grades 6 to 10, with a strong coding lab.",
    website: "https://greenwood.example.org",
    modules: {
      records: true, exams: true, admissions: true, leave: true, staffAttendance: true, attendance: true,
      timetable: true, subjects: true, parents: true, library: true, transport: true, hostel: true, events: true,
    },
    owner: owner!,
  })
  const staff = [principal!, vice!, office!, librarian!, transportMgr!, warden!, counselor!, examCoord!, admissionsOfficer!]
  await join(org, staff)
  await give(org, principal!, "principal")
  await give(org, vice!, "vice_principal")
  await give(org, office!, "office_staff")
  await give(org, librarian!, "librarian")
  await give(org, transportMgr!, "transport_manager")
  await give(org, warden!, "hostel_warden")
  await give(org, counselor!, "counselor")
  await give(org, examCoord!, "exam_coordinator")
  await give(org, admissionsOfficer!, "admissions_officer")
  remember("Greenwood Public School (school)", "Owner", owner!)
  remember("Greenwood Public School (school)", "Principal", principal!)
  remember("Greenwood Public School (school)", "Office staff", office!)
  remember("Greenwood Public School (school)", "Librarian", librarian!)

  // ---------- the year, grades and sections
  const ay = academicYear(4)
  const [year] = await db
    .insert(academicYears)
    .values({ orgId: org.id, name: ay.name, startsOn: ay.startsOn, endsOn: ay.endsOn, isCurrent: true })
    .returning({ id: academicYears.id })
  const grades: { id: string; n: number; sections: { id: string; name: string }[] }[] = []
  for (const n of [6, 7, 8, 9, 10]) {
    const id = await group(org, `Grade ${n}`)
    const sections = []
    for (const s of ["A", "B"]) sections.push({ id: await group(org, `${n}-${s}`, id), name: `${n}-${s}` })
    grades.push({ id, n, sections })
  }
  const sections = grades.flatMap((g) => g.sections.map((s) => ({ ...s, grade: g })))

  // ---------- teachers: two per subject, one class teacher for each section
  const subjectRows = await db
    .insert(subjects)
    .values(SUBJECTS.map((s) => ({ orgId: org.id, name: s.name, code: s.code })))
    .returning({ id: subjects.id, name: subjects.name })
  const teacherPeople = SUBJECTS.flatMap((s, i) => [0, 1].map((k) => ({ ...person(), subject: i, k })))
  const teachers = await makeUsers(
    teacherPeople.map((p, i) => ({ name: p.name, email: emailFor(i === 0 ? "teacher" : `${p.first}.${p.last}`, SLUG) }))
  )
  await join(org, teachers)
  remember("Greenwood Public School (school)", "Teacher (English, class teacher of 6-A)", teachers[0]!)
  // Subject x section: one of the subject's two teachers (grades 6-7-8 the first, 9-10 the second).
  const cs: { id: string; groupId: string; subjectId: string; teacherId: string }[] = []
  for (const sec of sections) {
    for (const [i, subj] of subjectRows.entries()) {
      const teacher = teachers[i * 2 + (sec.grade.n >= 9 ? 1 : 0)]!
      cs.push({ id: "", groupId: sec.id, subjectId: subj.id, teacherId: teacher.id })
    }
  }
  const csRows = await db
    .insert(classSubjects)
    .values(cs.map((c) => ({ orgId: org.id, groupId: c.groupId, subjectId: c.subjectId, teacherId: c.teacherId })))
    .returning({ id: classSubjects.id, groupId: classSubjects.groupId, subjectId: classSubjects.subjectId, teacherId: classSubjects.teacherId })
  // Subject teachers get the role in each section they teach.
  for (const sec of sections) {
    const ids = [...new Set(csRows.filter((c) => c.groupId === sec.id).map((c) => c.teacherId!))]
    for (const id of ids) await give(org, teachers.find((t) => t.id === id)!, "subject_teacher", sec.id)
  }
  // Class teachers: the first ten teachers, one section each.
  const classTeacherOf = new Map<string, UserRow>()
  for (const [i, sec] of sections.entries()) {
    const t = teachers[i % teachers.length]!
    classTeacherOf.set(sec.id, t)
    await db.insert(classTeachers).values({ orgId: org.id, yearId: year!.id, groupId: sec.id, teacherId: t.id })
    await give(org, t, "class_teacher", sec.id)
  }

  // ---------- timetable
  const times = [["08:00", "08:40"], ["08:40", "09:20"], ["09:20", "10:00"], ["10:00", "10:20"], ["10:20", "11:00"], ["11:00", "11:40"], ["11:40", "12:20"], ["12:20", "13:00"]]
  const periods = await db
    .insert(timetablePeriods)
    .values(times.map(([s, e], i) => ({ orgId: org.id, name: i === 3 ? "Break" : `Period ${i < 3 ? i + 1 : i}`, starts: s!, ends: e!, isBreak: i === 3, position: i })))
    .returning({ id: timetablePeriods.id, isBreak: timetablePeriods.isBreak })
  const slots = []
  for (const sec of sections) {
    const mine = csRows.filter((c) => c.groupId === sec.id)
    for (let d = 1; d <= 6; d++) {
      for (const [pi, p] of periods.filter((x) => !x.isBreak).entries()) {
        if (d === 6 && pi >= 4) continue // Saturdays end early
        const c = mine[(pi + d * 2) % mine.length]!
        slots.push({ orgId: org.id, groupId: sec.id, day: d, periodId: p.id, classSubjectId: c.id, room: `Room ${sec.grade.n}${sec.name.endsWith("A") ? "01" : "02"}` })
      }
    }
  }
  await insertAll(timetableSlots, slots)

  // ---------- students and parents
  const students: (UserRow & { section: string; rate: number; ability: number; gender: string })[] = []
  const parents: UserRow[] = []
  let admission = 1
  for (const sec of sections) {
    const people = Array.from({ length: 18 }, () => person())
    const first = sec === sections[0]
    const made = await makeUsers(people.map((p, i) => ({ name: p.name, email: emailFor(first && i === 0 ? "student" : `${p.first}.${p.last}`, SLUG) })))
    const parentPeople = people.map((p) => person(chance(0.6) ? "female" : "male", p.last, p.first))
    const madeParents = await makeUsers(parentPeople.map((p, i) => ({ name: p.name, email: emailFor(first && i === 0 ? "parent" : `${p.first}.${p.last}.parent`, SLUG) })))
    await join(org, [...made, ...madeParents])
    await seat(sec.id, made)
    await insertAll(studentRecords, made.map((s, i) => ({
      orgId: org.id,
      userId: s.id,
      admissionNo: `GPS-${ay.start - (sec.grade.n - 6)}-${String(admission++).padStart(4, "0")}`,
      gender: people[i]!.gender,
      birthDate: `${ay.start - sec.grade.n - 5}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
      phone: `98${int(10000000, 99999999)}`,
      address: `${int(1, 200)}, ${pick(["Baner", "Aundh", "Kothrud", "Wakad", "Viman Nagar", "Hadapsar"])}, Pune`,
      admittedOn: `${ay.start - (sec.grade.n - 6)}-04-0${int(1, 9)}`,
    })))
    await insertAll(enrolments, made.map((s, i) => ({ orgId: org.id, yearId: year!.id, userId: s.id, groupId: sec.id, rollNo: i + 1 })))
    await insertAll(guardians, made.map((s, i) => ({ orgId: org.id, parentId: madeParents[i]!.id, studentId: s.id, relation: parentPeople[i]!.gender === "female" ? "Mother" : "Father", createdBy: office!.id })))
    for (const [i, s] of made.entries())
      students.push({ ...s, section: sec.id, rate: chance(0.08) ? normal(0.7, 0.05, 0.55, 0.74) : normal(0.94, 0.04, 0.8, 1), ability: normal(68, 15, 25, 98), gender: people[i]!.gender })
    parents.push(...madeParents)
  }
  remember("Greenwood Public School (school)", "Student (6-A)", students[0]!)
  remember("Greenwood Public School (school)", "Parent", parents[0]!)

  // ---------- a month of daily registers
  const days = pastWorkdays(26)
  for (const sec of sections) {
    const sessions = await db
      .insert(teachingSessions)
      .values(days.map((d) => ({ orgId: org.id, groupId: sec.id, teacherId: classTeacherOf.get(sec.id)!.id, day: d, kind: "register" as const, minutes: 0, period: "" })))
      .returning({ id: teachingSessions.id, day: teachingSessions.day })
    const rows = []
    for (const s of students.filter((x) => x.section === sec.id)) {
      for (const sess of sessions) {
        const here = random() < s.rate
        const status = here ? (chance(0.05) ? "late" : "present") : chance(0.25) ? "excused" : "absent"
        rows.push({ sessionId: sess.id, userId: s.id, present: here, status: status as "present" | "late" | "absent" | "excused" })
      }
    }
    await insertAll(attendance, rows, 1000)
  }

  // ---------- exams: unit test 1 and the half-yearly, published, with marks
  const exams = await db
    .insert(termExams)
    .values([
      { orgId: org.id, yearId: year!.id, name: "Unit test 1", startsOn: `${ay.start}-07-15`, endsOn: `${ay.start}-07-20`, weight: 20, publishedAt: at(-90) },
      { orgId: org.id, yearId: year!.id, name: "Half-yearly", startsOn: `${ay.start}-09-20`, endsOn: `${ay.start}-09-30`, weight: 80, publishedAt: at(-30) },
    ])
    .returning({ id: termExams.id, name: termExams.name })
  for (const exam of exams) {
    const max = exam.name === "Unit test 1" ? 25 : 80
    const papers = await db
      .insert(examPapers)
      .values(sections.flatMap((sec) => subjectRows.map((subj) => ({ orgId: org.id, examId: exam.id, groupId: sec.id, subjectId: subj.id, maxMarks: max, passMarks: Math.round(max * 0.33) }))))
      .returning({ id: examPapers.id, groupId: examPapers.groupId, subjectId: examPapers.subjectId })
    const marks = []
    for (const p of papers) {
      const teacher = csRows.find((c) => c.groupId === p.groupId && c.subjectId === p.subjectId)!.teacherId
      for (const s of students.filter((x) => x.section === p.groupId)) {
        const absent = chance(0.015)
        marks.push({ paperId: p.id, userId: s.id, marks: absent ? null : Math.round((normal(s.ability, 9, 5, 100) / 100) * max * 2) / 2, absent, enteredBy: teacher })
      }
    }
    await insertAll(examMarks, marks, 1000)
    if (exam.name === "Half-yearly") {
      const remarks = students.filter(() => chance(0.5)).map((s) => ({
        orgId: org.id,
        examId: exam.id,
        userId: s.id,
        text: s.ability > 80 ? "Excellent work this term. Keep reading beyond the syllabus." : s.ability > 60 ? "Steady progress. More practice in problem-solving will help." : "Needs regular revision at home; let's meet to plan.",
        writtenBy: classTeacherOf.get(s.section)!.id,
      }))
      await insertAll(reportRemarks, remarks)
    }
  }

  // ---------- leave
  const leave = []
  for (const s of shuffle(students).slice(0, 14)) {
    const start = int(-20, 10)
    const status = start > 0 ? pick(["pending", "pending", "approved"]) : pick(["approved", "approved", "rejected"])
    const parent = parents[students.indexOf(s)]!
    leave.push({
      orgId: org.id, userId: s.id, kind: "student", type: pick(["sick", "family", "event"]), startsOn: day(start), endsOn: day(start + int(0, 2)),
      days: 1, reason: pick(["Fever and cold", "Family wedding in Nagpur", "Inter-school chess tournament", "Doctor's appointment"]),
      status, requestedBy: parent.id, decidedBy: status === "pending" ? null : classTeacherOf.get(s.section)!.id, decidedAt: status === "pending" ? null : at(start - 1),
    })
  }
  for (const t of shuffle(teachers).slice(0, 5)) {
    const start = int(-15, 12)
    const status = start > 0 ? "pending" : "approved"
    leave.push({
      orgId: org.id, userId: t.id, kind: "staff", type: pick(["casual", "sick", "earned"]), startsOn: day(start), endsOn: day(start + int(0, 1)),
      days: 1, reason: pick(["Personal work", "Unwell", "Family function"]), status, requestedBy: t.id, decidedBy: status === "pending" ? null : principal!.id, decidedAt: status === "pending" ? null : at(start - 2),
    })
  }
  await insertAll(leaveRequests, leave)

  // ---------- staff attendance for the month
  const sa = []
  for (const d of days) {
    for (const t of [...teachers, ...staff]) {
      const r = random()
      const status = r < 0.86 ? "present" : r < 0.94 ? "late" : r < 0.97 ? "half_day" : "absent"
      sa.push({ orgId: org.id, userId: t.id, day: d, status, checkIn: status === "absent" ? null : status === "late" ? `08:${int(16, 45)}` : `07:${int(40, 59)}`, markedBy: office!.id })
    }
  }
  await insertAll(staffAttendance, sa, 1000)

  // ---------- admissions: open for next year, with applications at every stage
  // Open for Grades 6 and 9.
  await db
    .update(organizations)
    .set({ moduleSettings: { admissions: { open: true, yearId: year!.id, gradeIds: [grades[0]!.id, grades[3]!.id], instructions: "Bring the birth certificate and last report card to the interview." } } })
    .where(eq(organizations.id, org.id))
  const applicants = await makeUsers(Array.from({ length: 9 }, () => {
    const p = person()
    return { name: p.name, email: emailFor(`${p.first}.${p.last}.applicant`, SLUG) }
  }))
  const statuses = ["submitted", "submitted", "submitted", "reviewing", "reviewing", "waitlisted", "rejected", "submitted", "reviewing"]
  await insertAll(admissionApplications, applicants.map((a, i) => {
    const child = person(undefined, a.name.split(" ")[1])
    return {
      orgId: org.id, number: `APP-${ay.start}-${String(i + 1).padStart(4, "0")}`, yearId: year!.id, gradeId: i % 2 ? grades[0]!.id : grades[3]!.id,
      applicantId: a.id, studentName: child.name, birthDate: `${ay.start - (i % 2 ? 11 : 14)}-0${int(1, 9)}-1${int(0, 9)}`, gender: child.gender,
      previousSchool: pick(["St. Mary's School", "Kendriya Vidyalaya", "DPS Pune", ""]), parentName: a.name, relation: pick(["Mother", "Father"]),
      phone: `97${int(10000000, 99999999)}`, address: "Pune", status: statuses[i]!, createdAt: at(-int(1, 25)),
      decidedBy: statuses[i] === "rejected" || statuses[i] === "waitlisted" ? admissionsOfficer!.id : null,
      decidedAt: statuses[i] === "rejected" || statuses[i] === "waitlisted" ? at(-3) : null,
    }
  }))
  remember("Greenwood Public School (school)", "Applicant (parent applying)", applicants[0]!)

  // ---------- library
  const TITLES: [string, string, string][] = [
    ["Wings of Fire", "A. P. J. Abdul Kalam", "Biography"], ["The Story of My Experiments with Truth", "M. K. Gandhi", "Biography"], ["Malgudi Days", "R. K. Narayan", "Fiction"],
    ["The Jungle Book", "Rudyard Kipling", "Fiction"], ["Harry Potter and the Philosopher's Stone", "J. K. Rowling", "Fiction"], ["Matilda", "Roald Dahl", "Fiction"],
    ["A Brief History of Time", "Stephen Hawking", "Science"], ["The Diary of a Young Girl", "Anne Frank", "Biography"], ["Ruskin Bond's Book of Nature", "Ruskin Bond", "Nature"],
    ["NCERT Mathematics Class 10", "NCERT", "Textbook"], ["NCERT Science Class 9", "NCERT", "Textbook"], ["Python for Kids", "Jason Briggs", "Computers"],
    ["The Secret Garden", "Frances Hodgson Burnett", "Fiction"], ["Panchatantra", "Vishnu Sharma", "Fiction"], ["The Discovery of India", "Jawaharlal Nehru", "History"],
    ["Charlie and the Chocolate Factory", "Roald Dahl", "Fiction"], ["Gitanjali", "Rabindranath Tagore", "Poetry"], ["Godaan", "Munshi Premchand", "Hindi"],
    ["Rich Dad Poor Dad", "Robert Kiyosaki", "Non-fiction"], ["Atlas of the World", "Oxford", "Reference"],
  ]
  const books = await db
    .insert(libraryBooks)
    .values(TITLES.map(([title, author, category], i) => ({ orgId: org.id, title, author, category, shelf: `${category[0]}-${(i % 6) + 1}`, copies: int(1, 4), isbn: `97881${int(10000000, 99999999)}` })))
    .returning({ id: libraryBooks.id })
  const loans = []
  for (const s of shuffle(students).slice(0, 34)) {
    const issued = int(-40, -1)
    const returned = issued < -15 && chance(0.7) ? issued + int(5, 14) : null
    loans.push({
      orgId: org.id, bookId: pick(books).id, userId: s.id, issuedOn: day(issued), dueOn: day(issued + 14),
      returnedOn: returned === null ? null : day(returned), status: returned === null ? "out" : "returned", issuedBy: librarian!.id,
    })
  }
  await insertAll(libraryLoans, loans)

  // ---------- buses
  const routes = [
    { name: "Route 1 · Baner", stops: ["Baner Road", "Balewadi Phata", "Pan Card Club", "Sus Road"] },
    { name: "Route 2 · Kothrud", stops: ["Karve Nagar", "Kothrud Depot", "Paud Road", "Chandni Chowk"] },
    { name: "Route 3 · Viman Nagar", stops: ["Viman Nagar", "Kalyani Nagar", "Koregaon Park", "Yerwada"] },
  ]
  const riders = []
  const riding = shuffle(students).slice(0, 60)
  for (const [ri, r] of routes.entries()) {
    const [route] = await db
      .insert(transportRoutes)
      .values({ orgId: org.id, name: r.name, vehicle: `MH-12-${pick(["AB", "CD", "EF"])}-${int(1000, 9999)}`, driver: person("male").name, driverPhone: `99${int(10000000, 99999999)}`, capacity: 40 })
      .returning({ id: transportRoutes.id })
    const stops = await db
      .insert(transportStops)
      .values(r.stops.map((name, i) => ({ routeId: route!.id, name, position: i, pickup: `07:${String(5 + i * 8).padStart(2, "0")}`, drop: `13:${String(20 + i * 8).padStart(2, "0")}` })))
      .returning({ id: transportStops.id })
    for (const s of riding.slice(ri * 20, ri * 20 + 20)) riders.push({ orgId: org.id, userId: s.id, routeId: route!.id, stopId: pick(stops).id })
  }
  await insertAll(transportRiders, riders)

  // ---------- hostels, for some grade 9 and 10 students
  const seniors = students.filter((s) => sections.find((x) => x.id === s.section)!.grade.n >= 9)
  for (const [name, gender] of [["Boys' hostel", "male"], ["Girls' hostel", "female"]] as const) {
    const [h] = await db.insert(hostels).values({ orgId: org.id, name, forWhom: gender === "male" ? "Boys" : "Girls", warden: warden!.name, wardenPhone: "9876500011" }).returning({ id: hostels.id })
    const beds: string[] = []
    for (let r = 1; r <= 5; r++) {
      const [room] = await db.insert(hostelRooms).values({ hostelId: h!.id, name: `${r < 3 ? "G" : "F"}-${r}`, floor: r < 3 ? "Ground" : "First" }).returning({ id: hostelRooms.id })
      const made = await db.insert(hostelBeds).values(["A", "B", "C"].map((label) => ({ roomId: room!.id, label }))).returning({ id: hostelBeds.id })
      beds.push(...made.map((b) => b.id))
    }
    const boarders = seniors.filter((s) => s.gender === gender).slice(0, 10)
    await insertAll(hostelResidents, boarders.map((s, i) => ({ orgId: org.id, userId: s.id, bedId: beds[i]!, since: `${ay.start}-06-0${int(1, 9)}` })))
  }

  // ---------- notices and events
  await insertAll(notes, [
    { orgId: org.id, text: "School reopens after the Diwali break on Monday. Uniform as usual.", audience: [], authorId: principal!.id, createdAt: at(-6) },
    { orgId: org.id, text: "Half-yearly report cards are out. Parents can see them under Results.", audience: [], authorId: examCoord!.id, createdAt: at(-30) },
    { orgId: org.id, text: "Grade 10: pre-board timetable will be shared next week.", audience: [[grades[4]!.id]], authorId: examCoord!.id, createdAt: at(-2) },
    { orgId: org.id, text: "6-A: bring your science project models on Thursday.", audience: [[grades[0]!.sections[0]!.id]], authorId: teachers[6]!.id, createdAt: at(-1) },
  ])
  const events = await db
    .insert(orgEvents)
    .values([
      { orgId: org.id, title: "Parent-teacher meeting", description: "Meet each subject teacher to go over the half-yearly results.", startsAt: at(5, 4), endsAt: at(5, 8), location: "School auditorium", createdBy: principal!.id },
      { orgId: org.id, title: "Annual sports day", description: "Track events, relays and the march past. Families welcome.", startsAt: at(19, 3), endsAt: at(19, 10), location: "School ground", createdBy: vice!.id },
      { orgId: org.id, groupId: grades[4]!.id, title: "Career talk: careers in technology", description: "For Grade 10, with alumni from IT companies.", startsAt: at(9, 6), endsAt: at(9, 7, 30), location: "", link: "https://meet.example.com/greenwood-careers", capacity: 60, createdBy: counselor!.id },
      { orgId: org.id, title: "Science exhibition", description: "Student projects from every grade.", startsAt: at(-12, 4), endsAt: at(-12, 9), location: "Science block", createdBy: principal!.id },
    ])
    .returning({ id: orgEvents.id })
  await insertAll(eventRsvps, parents.slice(0, 70).map((p) => ({ eventId: events[0]!.id, userId: p.id, status: "going" as const, at: at(-int(1, 4)) })))
  await insertAll(eventRsvps, students.filter((s) => s.section === grades[4]!.sections[0]!.id || s.section === grades[4]!.sections[1]!.id).slice(0, 25).map((s) => ({ eventId: events[2]!.id, userId: s.id, status: "going" as const })))

  console.log(`  school: ${students.length} students, ${parents.length} parents, ${teachers.length} teachers`)
  return { org, grade10: grades[4]!.id, students: students.filter((s) => grades[4]!.sections.some((x) => x.id === s.section)) }
}
