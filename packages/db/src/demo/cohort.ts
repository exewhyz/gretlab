import {
  assignmentProblems,
  assignments,
  attendance,
  certificates,
  notes,
  orgEvents,
  submissions,
  teachingSessions,
} from "../index.ts"

import {
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
  type Org,
  type UserRow,
} from "./shared.ts"

/*
 * LaunchPad Bootcamp: a twelve-week full-stack cohort in its sixth week, three pods with
 * their mentors, weekly assignments from the problem library with real submissions (some
 * learners falling behind, so early warnings show), registers twice a week; and the spring
 * cohort, finished, its graduates with certificates.
 */

const SLUG = "launchpad"
const LABEL = "LaunchPad Bootcamp (cohort)"
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
export const certCode = () =>
  Array.from({ length: 10 }, (_, i) => (i === 5 ? "-" : "") + ALPHABET[Math.floor(random() * ALPHABET.length)]).join("")

export type Problem = { id: string; slug: string }

/** An accepted submission, as the judge leaves one. */
export function accepted(userId: string, problemId: string, when: Date) {
  return {
    userId, problemId, kind: "submit" as const, language: "python", entry: "main.py",
    files: [{ path: "main.py", content: "# solved in the demo data\nprint(input())\n" }],
    timeLimitMs: 2000, memoryLimitMb: 256, status: "done" as const, verdict: "AC" as const,
    score: 100, maxScore: 100, passedTests: 10, totalTests: 10, runtimeMs: int(20, 90), memoryKb: int(9000, 14000),
    attempts: 1, createdAt: when, queueAt: when, startedAt: when, finishedAt: new Date(when.getTime() + 1500),
  }
}

/** A wrong submission before the right one, now and then. */
export function wrong(userId: string, problemId: string, when: Date) {
  return { ...accepted(userId, problemId, when), verdict: "WA" as const, score: 40, passedTests: 4 }
}

export async function buildCohort(problems: Problem[]) {
  const mk = (name: string, local: string) => ({ name, email: emailFor(local, SLUG) })
  const [owner, manager, designer, ops] = await makeUsers([
    mk("Sanjana Bose", "owner"),
    mk("Karan Kapoor", "program.manager"),
    mk(person().name, "curriculum"),
    mk(person().name, "operations"),
  ])
  const org = await makeOrg({
    slug: SLUG,
    name: "LaunchPad Bootcamp",
    type: "cohort",
    description: "Twelve-week full-stack bootcamp: pods of eight, a mentor each, projects every week.",
    modules: { attendance: true, events: true },
    owner: owner!,
  })
  await join(org, [manager!, designer!, ops!])
  await give(org, manager!, "admin")
  await give(org, designer!, "curriculum_designer")
  await give(org, ops!, "operations")
  remember(LABEL, "Program manager", manager!)

  // The current cohort: week 6 of 12.
  const fall = await group(org, "Full-stack · Fall cohort", null, { startsOn: day(-37), endsOn: day(-37 + 83) })
  const mentors = await makeUsers([mk(person("female").name, "mentor"), mk(person("male").name, "mentor.two"), mk(person().name, "mentor.three")])
  await join(org, mentors)
  remember(LABEL, "Mentor (Pod A)", mentors[0]!)
  const learners: (UserRow & { pod: string; keen: number })[] = []
  for (const [i, name] of ["Pod A", "Pod B", "Pod C"].entries()) {
    const pod = await group(org, name, fall, { leadId: mentors[i]!.id })
    await give(org, mentors[i]!, "teacher", pod)
    const people = Array.from({ length: 8 }, () => person())
    const made = await makeUsers(people.map((p, k) => ({ name: p.name, email: emailFor(i === 0 && k === 0 ? "learner" : `${p.first}.${p.last}`, SLUG) })))
    await join(org, made)
    await seat(pod, made)
    for (const m of made) learners.push({ ...m, pod, keen: chance(0.15) ? normal(0.35, 0.1, 0.1, 0.5) : normal(0.88, 0.08, 0.6, 1) })
  }
  remember(LABEL, "Learner (Pod A)", learners[0]!)

  // Weekly assignments: weeks 1-5 closed, week 6 open.
  const work = []
  for (let w = 1; w <= 6; w++) {
    const opens = at(-37 + (w - 1) * 7, 4)
    const due = at(-37 + w * 7 - 1, 18)
    const [a] = await db
      .insert(assignments)
      .values({
        slug: `launchpad-fall-week-${w}`, title: `Week ${w}: ${["Python basics", "Loops and lists", "Functions", "Strings", "Dictionaries", "Problem-solving sprint"][w - 1]}`,
        description: "Solve each problem; ask your mentor if you're stuck for more than an hour.", opensAt: opens, dueAt: due,
        published: true, orgId: org.id, audience: [[fall]], allowLate: true, latePenaltyPercent: 10,
      })
      .returning({ id: assignments.id })
    const set = problems.slice((w - 1) * 2, (w - 1) * 2 + 2)
    await insertAll(assignmentProblems, set.map((p, i) => ({ assignmentId: a!.id, problemId: p.id, position: i, points: 100 })))
    work.push({ id: a!.id, set, opens, due, open: w === 6 })
  }
  const subs = []
  for (const l of learners) {
    for (const w of work) {
      for (const p of w.set) {
        if (random() > l.keen * (w.open ? 0.5 : 1)) continue
        const t = new Date(w.opens.getTime() + random() * (Math.min(w.due.getTime(), Date.now()) - w.opens.getTime()))
        if (chance(0.3)) subs.push(wrong(l.id, p.id, new Date(t.getTime() - 3_600_000)))
        subs.push(accepted(l.id, p.id, t))
      }
    }
  }
  await insertAll(submissions, subs)

  // Live sessions twice a week, with registers.
  const days = pastWorkdays(26, false).filter((_, i) => i % 5 === 1 || i % 5 === 3)
  const sessions = await db
    .insert(teachingSessions)
    .values(days.map((d) => ({ orgId: org.id, groupId: fall, teacherId: manager!.id, day: d, kind: "register" as const, minutes: 0, period: "" })))
    .returning({ id: teachingSessions.id })
  const rows = []
  for (const l of learners)
    for (const s of sessions) {
      const here = random() < Math.min(0.98, l.keen + 0.05)
      rows.push({ sessionId: s.id, userId: l.id, present: here, status: (here ? "present" : "absent") as "present" | "absent" })
    }
  await insertAll(attendance, rows)

  // The spring cohort: finished, most of it graduated.
  const spring = await group(org, "Full-stack · Spring cohort", null, { startsOn: day(-240), endsOn: day(-157) })
  const springPod = await group(org, "Spring pod", spring, { leadId: mentors[1]!.id })
  const alumni = await makeUsers(Array.from({ length: 10 }, (_, i) => {
    const p = person()
    return { name: p.name, email: emailFor(i === 0 ? "graduate" : `${p.first}.${p.last}`, SLUG) }
  }))
  await join(org, alumni)
  await seat(springPod, alumni)
  await insertAll(certificates, alumni.slice(0, 8).map((a) => ({
    code: certCode(), orgId: org.id, groupId: spring, userId: a.id, kind: "graduation" as const, sourceId: spring,
    title: "Full-stack · Spring cohort, LaunchPad Bootcamp", detail: `Completed the cohort, ${day(-240)} to ${day(-157)}.`,
    issuedBy: manager!.id, issuedAt: at(-150),
  })))
  remember(LABEL, "Graduate (spring cohort, with a certificate)", alumni[0]!)

  await insertAll(notes, [
    { orgId: org.id, text: "Demo day is in week 12: start thinking about your capstone idea.", audience: [[fall]], authorId: manager!.id, createdAt: at(-4) },
  ])
  await db.insert(orgEvents).values([
    { orgId: org.id, groupId: fall, title: "Office hours with mentors", description: "Bring your blockers.", startsAt: at(2, 12), endsAt: at(2, 13), location: "", link: "https://meet.example.com/launchpad-office-hours", createdBy: manager!.id },
    { orgId: org.id, title: "Alumni panel: first jobs after the bootcamp", description: "Spring graduates on interviews and first projects.", startsAt: at(10, 13), endsAt: at(10, 14, 30), location: "", link: "https://meet.example.com/launchpad-alumni", capacity: 100, createdBy: ops!.id },
  ])
  void pick
  console.log(`  cohort: ${learners.length} learners in 3 pods, ${subs.length} submissions`)
  return org as Org
}
