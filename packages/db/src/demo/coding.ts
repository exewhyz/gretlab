import { assignmentProblems, assignments, submissions } from "../index.ts"

import { at, chance, db, insertAll, random } from "./shared.ts"
import { accepted, wrong, type Problem } from "./cohort.ts"
import type { SchoolResult } from "./school.ts"

/*
 * The school's coding lab: Grade 10 has a Python assignment that closed last week (with
 * everyone's submissions) and one open now.
 */
export async function buildSchoolCoding(school: SchoolResult, library: Problem[]) {
  const [closed, open] = await db
    .insert(assignments)
    .values([
      { slug: "greenwood-g10-python-basics", title: "Python basics", description: "Input, output and arithmetic.", opensAt: at(-21), dueAt: at(-7, 12), published: true, orgId: school.org.id, audience: [[school.grade10]] },
      { slug: "greenwood-g10-conditions", title: "Conditions and loops", description: "if, for and while.", opensAt: at(-3), dueAt: at(5, 12), published: true, orgId: school.org.id, audience: [[school.grade10]] },
    ])
    .returning({ id: assignments.id })
  const first = library.slice(0, 3)
  const second = library.slice(3, 6)
  await insertAll(assignmentProblems, [
    ...first.map((p, i) => ({ assignmentId: closed!.id, problemId: p.id, position: i })),
    ...second.map((p, i) => ({ assignmentId: open!.id, problemId: p.id, position: i })),
  ])
  const subs = []
  for (const s of school.students) {
    for (const p of first) {
      if (!chance(0.85)) continue
      const t = at(-20 + Math.floor(random() * 12), 10)
      if (chance(0.3)) subs.push(wrong(s.id, p.id, new Date(t.getTime() - 1_800_000)))
      subs.push(accepted(s.id, p.id, t))
    }
    for (const p of second) if (chance(0.35)) subs.push(accepted(s.id, p.id, at(-2 + Math.floor(random() * 2), 15)))
  }
  await insertAll(submissions, subs)
  console.log(`  school coding lab: ${subs.length} submissions`)
}
