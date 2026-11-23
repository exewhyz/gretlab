import {
  academicTerms,
  academicYears,
  attendance,
  classSubjects,
  enrolments,
  examMarks,
  examPapers,
  hostelBeds,
  hostelResidents,
  hostelRooms,
  hostels,
  libraryBooks,
  libraryLoans,
  notes,
  orgEvents,
  studentRecords,
  subjects,
  teachingSessions,
  termExams,
} from "../index.ts"

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
  type UserRow,
} from "./shared.ts"

/*
 * Northfield Institute of Technology: CSE and ECE departments with batches, courses with
 * credits, the odd and even semesters, mid-semester marks (end-semester still to come),
 * course-wise attendance with some students short of 75%, heads of department, faculty
 * advisors, a library and a hostel.
 */

const SLUG = "northfield"
const LABEL = "Northfield Institute of Technology (college)"

const COURSES: Record<string, { name: string; code: string; credits: number }[]> = {
  "CSE 2nd year": [
    { name: "Data Structures", code: "CS201", credits: 4 },
    { name: "Database Management Systems", code: "CS202", credits: 4 },
    { name: "Discrete Mathematics", code: "MA201", credits: 3 },
    { name: "Data Structures Lab", code: "CS291", credits: 1.5 },
  ],
  "CSE 3rd year": [
    { name: "Operating Systems", code: "CS301", credits: 4 },
    { name: "Computer Networks", code: "CS302", credits: 4 },
    { name: "Software Engineering", code: "CS303", credits: 3 },
  ],
  "ECE 2nd year": [
    { name: "Signals and Systems", code: "EC201", credits: 4 },
    { name: "Digital Electronics", code: "EC202", credits: 4 },
    { name: "Network Theory", code: "EC203", credits: 3 },
  ],
}

export async function buildCollege() {
  const mk = (name: string, local: string) => ({ name, email: emailFor(local, SLUG) })
  const [owner, dean, examCell, admissionsOffice, librarian, warden] = await makeUsers([
    mk("Dr. Suresh Kulkarni", "owner"),
    mk("Dr. Meenakshi Rao", "dean"),
    mk(person().name, "exam.cell"),
    mk(person().name, "admissions"),
    mk(person().name, "librarian"),
    mk(person("male").name, "warden"),
  ])
  const org = await makeOrg({
    slug: SLUG,
    name: "Northfield Institute of Technology",
    type: "college",
    description: "An engineering college with Computer Science and Electronics departments.",
    modules: { records: true, exams: true, attendance: true, timetable: true, subjects: true, library: true, hostel: true, leave: true, events: true },
    owner: owner!,
  })
  await join(org, [dean!, examCell!, admissionsOffice!, librarian!, warden!])
  await give(org, dean!, "dean")
  await give(org, examCell!, "exam_cell")
  await give(org, admissionsOffice!, "admissions_office")
  await give(org, librarian!, "librarian")
  await give(org, warden!, "hostel_warden")
  remember(LABEL, "Dean", dean!)
  remember(LABEL, "Exam cell", examCell!)

  const ay = academicYear(7)
  const [year] = await db
    .insert(academicYears)
    .values({ orgId: org.id, name: ay.name, startsOn: ay.startsOn, endsOn: ay.endsOn, isCurrent: true })
    .returning({ id: academicYears.id })
  const [odd, even] = await db
    .insert(academicTerms)
    .values([
      { orgId: org.id, yearId: year!.id, name: "Odd semester", startsOn: `${ay.start}-07-15`, endsOn: `${ay.start}-12-10`, position: 0 },
      { orgId: org.id, yearId: year!.id, name: "Even semester", startsOn: `${ay.start + 1}-01-05`, endsOn: `${ay.start + 1}-05-20`, position: 1 },
    ])
    .returning({ id: academicTerms.id })
  void even

  // Departments and batches.
  const cse = await group(org, "Computer Science and Engineering")
  const ece = await group(org, "Electronics and Communication")
  const batches = [
    { name: "CSE 2nd year", dept: cse, id: await group(org, "CSE 2nd year", cse) },
    { name: "CSE 3rd year", dept: cse, id: await group(org, "CSE 3rd year", cse) },
    { name: "ECE 2nd year", dept: ece, id: await group(org, "ECE 2nd year", ece) },
  ]

  // Heads of department and faculty.
  const [hodCse, hodEce] = await makeUsers([mk("Dr. Arvind Menon", "hod.cse"), mk("Dr. Kavita Joshi", "hod.ece")])
  await join(org, [hodCse!, hodEce!])
  await give(org, hodCse!, "hod", cse)
  await give(org, hodEce!, "hod", ece)
  remember(LABEL, "Head of department (CSE)", hodCse!)
  const allCourses = Object.values(COURSES).flat()
  const faculty = await makeUsers(allCourses.map((_, i) => {
    const p = person()
    return { name: `Prof. ${p.name}`, email: emailFor(i === 0 ? "faculty" : `${p.first}.${p.last}`, SLUG) }
  }))
  await join(org, faculty)
  remember(LABEL, "Faculty (Data Structures)", faculty[0]!)
  const subjectRows = await db
    .insert(subjects)
    .values(allCourses.map((c) => ({ orgId: org.id, name: c.name, code: c.code, credits: c.credits })))
    .returning({ id: subjects.id, code: subjects.code })
  const subjectOf = (code: string) => subjectRows.find((s) => s.code === code)!.id

  const students: (UserRow & { batch: string; rate: number; ability: number })[] = []
  let roll = 1
  for (const b of batches) {
    const courses = COURSES[b.name]!
    await insertAll(classSubjects, courses.map((c) => ({ orgId: org.id, groupId: b.id, subjectId: subjectOf(c.code), teacherId: faculty[allCourses.findIndex((x) => x.code === c.code)]!.id })))
    for (const c of courses) await give(org, faculty[allCourses.findIndex((x) => x.code === c.code)]!, "teacher", b.id)
    const people = Array.from({ length: 30 }, () => person())
    const made = await makeUsers(people.map((p, i) => ({ name: p.name, email: emailFor(b.name === "CSE 2nd year" && i === 0 ? "student" : `${p.first}.${p.last}`, SLUG) })))
    await join(org, made)
    await seat(b.id, made)
    const batchYear = ay.start - (b.name.includes("3rd") ? 2 : 1)
    await insertAll(studentRecords, made.map((s, i) => ({
      orgId: org.id, userId: s.id, admissionNo: `NIT${batchYear}${b.name.startsWith("CSE") ? "CS" : "EC"}${String(roll++).padStart(3, "0")}`,
      gender: people[i]!.gender, birthDate: `${batchYear - 18}-0${int(1, 9)}-1${int(0, 9)}`, admittedOn: `${batchYear}-08-01`,
    })))
    await insertAll(enrolments, made.map((s, i) => ({ orgId: org.id, yearId: year!.id, userId: s.id, groupId: b.id, rollNo: i + 1 })))
    for (const s of made) students.push({ ...s, batch: b.id, rate: chance(0.12) ? normal(0.66, 0.06, 0.5, 0.74) : normal(0.88, 0.06, 0.76, 1), ability: normal(66, 14, 25, 97) })
    // A faculty advisor for each batch: the batch's first course's teacher.
    await give(org, faculty[allCourses.findIndex((x) => x.code === courses[0]!.code)]!, "faculty_advisor", b.id)

    // Course attendance: three lectures a week for the last eight weeks.
    const days = pastWorkdays(40, false)
    for (const [ci, c] of courses.entries()) {
      const lectureDays = days.filter((_, i) => (i + ci) % 5 < 3)
      const sessions = await db
        .insert(teachingSessions)
        .values(lectureDays.map((d) => ({ orgId: org.id, groupId: b.id, teacherId: faculty[allCourses.findIndex((x) => x.code === c.code)]!.id, day: d, kind: "register" as const, minutes: 0, period: "", subjectId: subjectOf(c.code) })))
        .returning({ id: teachingSessions.id })
      const rows = []
      for (const s of students.filter((x) => x.batch === b.id))
        for (const sess of sessions) {
          const here = random() < s.rate
          rows.push({ sessionId: sess.id, userId: s.id, present: here, status: (here ? (chance(0.04) ? "late" : "present") : "absent") as "present" | "late" | "absent" })
        }
      await insertAll(attendance, rows, 1000)
    }
  }
  remember(LABEL, "Student (CSE 2nd year)", students[0]!)

  // Mid-semester assessments, marked; end-semester set up, still to come.
  const [mid, end] = await db
    .insert(termExams)
    .values([
      { orgId: org.id, yearId: year!.id, name: "Mid-semester", termId: odd!.id, weight: 30, startsOn: `${ay.start}-09-15`, endsOn: `${ay.start}-09-22`, publishedAt: at(-40) },
      { orgId: org.id, yearId: year!.id, name: "End semester", termId: odd!.id, weight: 70, startsOn: day(18), endsOn: day(30) },
    ])
    .returning({ id: termExams.id })
  for (const exam of [mid!, end!]) {
    const papers = await db
      .insert(examPapers)
      .values(batches.flatMap((b) => COURSES[b.name]!.map((c) => ({ orgId: org.id, examId: exam.id, groupId: b.id, subjectId: subjectOf(c.code), maxMarks: 100, passMarks: 40 }))))
      .returning({ id: examPapers.id, groupId: examPapers.groupId, subjectId: examPapers.subjectId })
    if (exam === end) continue
    const marks = []
    for (const p of papers)
      for (const s of students.filter((x) => x.batch === p.groupId))
        marks.push({ paperId: p.id, userId: s.id, marks: Math.round(normal(s.ability, 12, 8, 100)), absent: false, enteredBy: examCell!.id })
    await insertAll(examMarks, marks, 1000)
  }

  // Library and hostel.
  const books = await db
    .insert(libraryBooks)
    .values([
      ["Introduction to Algorithms", "Cormen, Leiserson, Rivest, Stein"], ["Operating System Concepts", "Silberschatz, Galvin, Gagne"],
      ["Computer Networking: A Top-Down Approach", "Kurose, Ross"], ["Database System Concepts", "Silberschatz, Korth, Sudarshan"],
      ["Signals and Systems", "Oppenheim, Willsky"], ["Digital Design", "M. Morris Mano"], ["Clean Code", "Robert C. Martin"],
      ["The Pragmatic Programmer", "Hunt, Thomas"], ["Engineering Mathematics", "B. S. Grewal"], ["Let Us C", "Yashavant Kanetkar"],
    ].map(([title, author], i) => ({ orgId: org.id, title: title!, author: author!, category: i < 6 ? "Textbook" : "Reference", copies: int(2, 6), shelf: `T-${i + 1}` })))
    .returning({ id: libraryBooks.id })
  await insertAll(libraryLoans, shuffle(students).slice(0, 25).map((s) => {
    const issued = int(-30, -2)
    const back = issued < -18 && chance(0.6)
    return { orgId: org.id, bookId: pick(books).id, userId: s.id, issuedOn: day(issued), dueOn: day(issued + 21), returnedOn: back ? day(issued + int(5, 18)) : null, status: back ? "returned" : "out", issuedBy: librarian!.id }
  }))
  const [h] = await db.insert(hostels).values({ orgId: org.id, name: "Aryabhata hostel", forWhom: "Students", warden: warden!.name, wardenPhone: "9822012345" }).returning({ id: hostels.id })
  const beds: string[] = []
  for (let r = 101; r <= 110; r++) {
    const [room] = await db.insert(hostelRooms).values({ hostelId: h!.id, name: String(r), floor: "First" }).returning({ id: hostelRooms.id })
    beds.push(...(await db.insert(hostelBeds).values([{ roomId: room!.id, label: "A" }, { roomId: room!.id, label: "B" }]).returning({ id: hostelBeds.id })).map((b) => b.id))
  }
  await insertAll(hostelResidents, shuffle(students).slice(0, 18).map((s, i) => ({ orgId: org.id, userId: s.id, bedId: beds[i]!, since: `${ay.start}-07-20` })))

  await insertAll(notes, [
    { orgId: org.id, text: "End-semester examinations begin in about three weeks. Check your attendance: below 75% in a course means you can't sit its paper.", audience: [], authorId: examCell!.id, createdAt: at(-3) },
    { orgId: org.id, text: "CSE: guest lecture on distributed systems this Friday, 3 pm, Seminar hall.", audience: [[cse]], authorId: hodCse!.id, createdAt: at(-1) },
  ])
  await db.insert(orgEvents).values([
    { orgId: org.id, title: "TechFest 2026", description: "Hackathon, robotics and a project expo.", startsAt: at(24, 4), endsAt: at(25, 12), location: "Main campus", createdBy: dean!.id },
    { orgId: org.id, groupId: cse, title: "Placement preparation workshop", description: "Resume reviews and mock interviews.", startsAt: at(7, 8), endsAt: at(7, 11), location: "Seminar hall", capacity: 80, createdBy: hodCse!.id },
  ])
  console.log(`  college: ${students.length} students, ${faculty.length} faculty`)
}
