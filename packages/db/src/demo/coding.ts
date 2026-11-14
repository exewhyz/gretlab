import {
  assignmentProblems,
  assignments,
  contestParticipants,
  contestProblems,
  contests,
  submissions,
} from "../index.ts"

import { at, chance, db, insertAll, random } from "./shared.ts"
import { accepted, wrong, type Problem } from "./cohort.ts"
import type { SchoolResult } from "./school.ts"

/*
 * The school's coding lab: Grade 10 has a Python assignment that closed last week (with
 * everyone's submissions) and one open now.
 */
export async function buildSchoolCoding(
  school: SchoolResult,
  library: Problem[]
) {
  const [closed, open] = await db
    .insert(assignments)
    .values([
      {
        slug: "greenwood-g10-python-basics",
        title: "Python basics",
        description: "Input, output and arithmetic.",
        opensAt: at(-21),
        dueAt: at(-7, 12),
        published: true,
        orgId: school.org.id,
        audience: [[school.grade10]],
      },
      {
        slug: "greenwood-g10-conditions",
        title: "Conditions and loops",
        description: "if, for and while.",
        opensAt: at(-3),
        dueAt: at(5, 12),
        published: true,
        orgId: school.org.id,
        audience: [[school.grade10]],
      },
    ])
    .returning({ id: assignments.id })
  const first = library.slice(0, 3)
  const second = library.slice(3, 6)
  await insertAll(assignmentProblems, [
    ...first.map((p, i) => ({
      assignmentId: closed!.id,
      problemId: p.id,
      position: i,
    })),
    ...second.map((p, i) => ({
      assignmentId: open!.id,
      problemId: p.id,
      position: i,
    })),
  ])
  const subs = []
  for (const s of school.students) {
    for (const p of first) {
      if (!chance(0.85)) continue
      const t = at(-20 + Math.floor(random() * 12), 10)
      if (chance(0.3))
        subs.push(wrong(s.id, p.id, new Date(t.getTime() - 1_800_000)))
      subs.push(accepted(s.id, p.id, t))
    }
    for (const p of second)
      if (chance(0.35))
        subs.push(accepted(s.id, p.id, at(-2 + Math.floor(random() * 2), 15)))
  }
  await insertAll(submissions, subs)

  // A contest Grade 10 sat ten days ago, with a standings table to look at.
  const [past] = await db
    .insert(contests)
    .values({
      slug: "greenwood-g10-coding-cup",
      title: "Grade 10 Coding Cup",
      description: "Ninety minutes, four problems, ICPC scoring.",
      startsAt: at(-10, 10),
      endsAt: at(-10, 11, 30),
      published: true,
      orgId: school.org.id,
      audience: [[school.grade10]],
    })
    .returning({ id: contests.id })
  const cup = library.slice(6, 10)
  await insertAll(
    contestProblems,
    cup.map((p, i) => ({
      contestId: past!.id,
      problemId: p.id,
      label: "ABCD"[i]!,
      position: i,
    }))
  )
  const sitters = school.students.filter(() => chance(0.7))
  await insertAll(
    contestParticipants,
    sitters.map((s) => ({
      contestId: past!.id,
      userId: s.id,
      registeredAt: at(-12, 9),
    }))
  )
  const contestSubs: (typeof submissions.$inferInsert)[] = []
  for (const s of sitters) {
    cup.forEach((p, i) => {
      if (!chance(0.8 - i * 0.18)) return
      const t = at(-10, 10, 5 + Math.floor(random() * 80))
      if (chance(0.35))
        contestSubs.push({
          ...wrong(s.id, p.id, new Date(t.getTime() - 300_000)),
          contestId: past!.id,
        })
      contestSubs.push({ ...accepted(s.id, p.id, t), contestId: past!.id })
    })
  }
  await insertAll(submissions, contestSubs)

  // One the platform runs next week, open to everyone.
  const [next] = await db
    .insert(contests)
    .values({
      slug: "gretlab-weekly-practice-round",
      title: "Weekly practice round",
      description:
        "Open to everyone. Two hours, five problems, from easy to hard.",
      startsAt: at(6, 13, 30),
      endsAt: at(6, 15, 30),
      published: true,
      orgId: null,
    })
    .returning({ id: contests.id })
  await insertAll(
    contestProblems,
    library
      .slice(10, 15)
      .map((p, i) => ({
        contestId: next!.id,
        problemId: p.id,
        label: "ABCDE"[i]!,
        position: i,
      }))
  )
  console.log(
    `  school coding lab: ${subs.length} submissions, 2 contests (${contestSubs.length} contest submissions)`
  )
}
