import {
  academicYears,
  attendance,
  classSubjects,
  enrolments,
  examMarks,
  examPapers,
  guardians,
  notes,
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
  random,
  remember,
  seat,
  type UserRow,
} from "./shared.ts"

/*
 * Apex Coaching Centre: JEE and NEET courses with morning and evening batches that run
 * between dates, monthly tests with marks, daily registers, parents, a batch coordinator.
 */

const SLUG = "apex"
const LABEL = "Apex Coaching Centre (coaching)"

export async function buildCoaching() {
  const mk = (name: string, local: string) => ({ name, email: emailFor(local, SLUG) })
  const [owner, head, coordinator, counselor, frontDesk] = await makeUsers([
    mk("Vikram Saxena", "owner"),
    mk("Neha Agarwal", "center.head"),
    mk(person().name, "coordinator"),
    mk(person("female").name, "counselor"),
    mk(person().name, "front.desk"),
  ])
  const org = await makeOrg({
    slug: SLUG,
    name: "Apex Coaching Centre",
    type: "coaching",
    description: "JEE and NEET preparation in Kota, with weekly tests and doubt sessions.",
    modules: { records: true, exams: true, attendance: true, timetable: true, subjects: true, parents: true, admissions: true, events: true },
    owner: owner!,
  })
  await join(org, [head!, coordinator!, counselor!, frontDesk!])
  await give(org, head!, "center_head")
  await give(org, counselor!, "admissions_counselor")
  await give(org, frontDesk!, "front_desk")
  remember(LABEL, "Center head", head!)

  const ay = academicYear(4)
  const [year] = await db.insert(academicYears).values({ orgId: org.id, name: ay.name, startsOn: ay.startsOn, endsOn: ay.endsOn, isCurrent: true }).returning({ id: academicYears.id })
  const subjectRows = await db
    .insert(subjects)
    .values([["Physics", "PHY"], ["Chemistry", "CHE"], ["Mathematics", "MAT"], ["Biology", "BIO"]].map(([name, code]) => ({ orgId: org.id, name: name!, code: code! })))
    .returning({ id: subjects.id, code: subjects.code })
  const faculty = await makeUsers(["Physics", "Chemistry", "Mathematics", "Biology"].map((s, i) => {
    const p = person()
    return { name: p.name, email: emailFor(i === 0 ? "faculty" : `${p.first}.${p.last}`, SLUG) }
  }))
  await join(org, faculty)
  remember(LABEL, "Faculty (Physics)", faculty[0]!)

  const jee = await group(org, "JEE Advanced 2027")
  const neet = await group(org, "NEET 2027")
  const runFrom = day(-75)
  const runTo = day(200)
  const batches = [
    { id: await group(org, "JEE Morning batch", jee, { startsOn: runFrom, endsOn: runTo }), subjects: ["PHY", "CHE", "MAT"] },
    { id: await group(org, "JEE Evening batch", jee, { startsOn: runFrom, endsOn: runTo }), subjects: ["PHY", "CHE", "MAT"] },
    { id: await group(org, "NEET Morning batch", neet, { startsOn: runFrom, endsOn: runTo }), subjects: ["PHY", "CHE", "BIO"] },
  ]
  await give(org, coordinator!, "batch_coordinator", batches[0]!.id)
  remember(LABEL, "Batch coordinator (JEE Morning)", coordinator!)
  const students: (UserRow & { batch: string; ability: number; rate: number })[] = []
  let n = 1
  for (const b of batches) {
    const codes = b.subjects
    await insertAll(classSubjects, codes.map((c) => ({ orgId: org.id, groupId: b.id, subjectId: subjectRows.find((s) => s.code === c)!.id, teacherId: faculty[["PHY", "CHE", "MAT", "BIO"].indexOf(c)]!.id })))
    for (const c of codes) await give(org, faculty[["PHY", "CHE", "MAT", "BIO"].indexOf(c)]!, "teacher", b.id)
    const people = Array.from({ length: 22 }, () => person())
    const made = await makeUsers(people.map((p, i) => ({ name: p.name, email: emailFor(b === batches[0] && i === 0 ? "student" : `${p.first}.${p.last}`, SLUG) })))
    const parents = await makeUsers(people.map((p, i) => {
      const q = person(undefined, p.last, p.first)
      return { name: q.name, email: emailFor(b === batches[0] && i === 0 ? "parent" : `${q.first}.${q.last}.parent`, SLUG) }
    }))
    await join(org, [...made, ...parents])
    await seat(b.id, made)
    await insertAll(studentRecords, made.map((s, i) => ({ orgId: org.id, userId: s.id, admissionNo: `APX-${ay.start}-${String(n++).padStart(4, "0")}`, gender: people[i]!.gender, admittedOn: runFrom })))
    await insertAll(enrolments, made.map((s, i) => ({ orgId: org.id, yearId: year!.id, userId: s.id, groupId: b.id, rollNo: i + 1 })))
    await insertAll(guardians, made.map((s, i) => ({ orgId: org.id, parentId: parents[i]!.id, studentId: s.id, relation: "Parent" })))
    for (const s of made) students.push({ ...s, batch: b.id, ability: normal(60, 16, 15, 98), rate: normal(0.9, 0.07, 0.6, 1) })
    if (b === batches[0]) remember(LABEL, "Parent", parents[0]!)
    // Daily registers, six days a week.
    const sessions = await db
      .insert(teachingSessions)
      .values(pastWorkdays(30).map((d) => ({ orgId: org.id, groupId: b.id, teacherId: coordinator!.id, day: d, kind: "register" as const, minutes: 0, period: "" })))
      .returning({ id: teachingSessions.id })
    const rows = []
    for (const s of students.filter((x) => x.batch === b.id))
      for (const sess of sessions) {
        const here = random() < s.rate
        rows.push({ sessionId: sess.id, userId: s.id, present: here, status: (here ? "present" : "absent") as "present" | "absent" })
      }
    await insertAll(attendance, rows, 1000)
  }
  remember(LABEL, "Student (JEE Morning)", students[0]!)

  // Monthly tests, marked and published, out of 100 per subject.
  for (const [i, name] of ["Monthly test 1", "Monthly test 2"].entries()) {
    const [exam] = await db
      .insert(termExams)
      .values({ orgId: org.id, yearId: year!.id, name, weight: 50, startsOn: day(-50 + i * 28), endsOn: day(-50 + i * 28), publishedAt: at(-45 + i * 28) })
      .returning({ id: termExams.id })
    const papers = await db
      .insert(examPapers)
      .values(batches.flatMap((b) => b.subjects.map((c) => ({ orgId: org.id, examId: exam!.id, groupId: b.id, subjectId: subjectRows.find((s) => s.code === c)!.id, maxMarks: 100, passMarks: 35, heldOn: day(-50 + i * 28) }))))
      .returning({ id: examPapers.id, groupId: examPapers.groupId })
    const marks = []
    for (const p of papers)
      for (const s of students.filter((x) => x.batch === p.groupId))
        marks.push({ paperId: p.id, userId: s.id, marks: chance(0.02) ? null : Math.round(normal(s.ability + i * 4, 12, 0, 100)), absent: false, enteredBy: faculty[0]!.id })
    await insertAll(examMarks, marks, 1000)
  }
  await insertAll(notes, [
    { orgId: org.id, text: "Monthly test 3 is on Sunday, 9 am. Full syllabus till Rotational Motion.", audience: [[jee]], authorId: head!.id, createdAt: at(-2) },
    { orgId: org.id, text: "Doubt-clearing sessions every Saturday, 4 to 6 pm.", audience: [], authorId: coordinator!.id, createdAt: at(-9) },
  ])
  void int
  console.log(`  coaching: ${students.length} students`)
}
