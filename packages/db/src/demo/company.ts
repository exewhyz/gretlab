import {
  certificates,
  courseClasses,
  courseItems,
  courseModules,
  courses,
  notes,
  orgEvents,
  eventRsvps,
  practiceAnswers,
  questions,
} from "../index.ts"

import {
  at,
  chance,
  day,
  db,
  emailFor,
  give,
  group,
  insertAll,
  join,
  makeOrg,
  makeUsers,
  person,
  random,
  remember,
  seat,
  shuffle,
  type UserRow,
} from "./shared.ts"
import { certCode } from "./cohort.ts"

/*
 * Acme Software: departments and teams with their managers, and assigned training:
 * information security (yearly, due soon; some people's last completion has expired),
 * POSH awareness (once, already overdue for a few), and secure code review for
 * engineering. Completions come from answered questions; certificates expire with renewal.
 */

const SLUG = "acme"
const LABEL = "Acme Software (company)"

type Q = { title: string; prompt: string; options: string[]; right: number; explanation: string }

const TRAININGS: { title: string; description: string; questions: Q[] }[] = [
  {
    title: "Information security essentials",
    description: "Phishing, passwords, devices and data: the basics everyone must know, renewed every year.",
    questions: [
      { title: "Spotting phishing", prompt: "An email from \"IT support\" asks you to confirm your password through a link. What do you do?", options: ["Click and confirm", "Report it to security and delete it", "Reply asking if it's real"], right: 1, explanation: "IT never asks for your password. Report it so others are warned." },
      { title: "Strong passwords", prompt: "Which is the strongest password?", options: ["Acme@2026", "correct horse battery staple", "P@ssw0rd!"], right: 1, explanation: "Length beats symbols: a few random words are long and memorable." },
      { title: "Lost laptops", prompt: "You've lost your work laptop. What first?", options: ["Wait a day to see if it turns up", "Tell IT security straight away", "Buy a new one"], right: 1, explanation: "IT can lock and wipe it remotely, but only if they know quickly." },
    ],
  },
  {
    title: "POSH awareness",
    description: "Prevention of sexual harassment at the workplace: what it is, and how to raise a concern.",
    questions: [
      { title: "Who to tell", prompt: "Where do you raise a harassment complaint?", options: ["Your team chat", "The Internal Committee", "Nobody"], right: 1, explanation: "The Internal Committee handles complaints confidentially." },
      { title: "Bystanders", prompt: "You see a colleague being harassed. What can you do?", options: ["Ignore it", "Support them and report it", "Post about it publicly"], right: 1, explanation: "Support the person and report it; don't spread it." },
    ],
  },
  {
    title: "Secure code review",
    description: "For engineers: injection, secrets in code, and reviewing dependencies.",
    questions: [
      { title: "SQL injection", prompt: "How do you keep user input out of SQL?", options: ["Escape quotes by hand", "Use parameterised queries", "Validate on the client"], right: 1, explanation: "Parameters keep data and code apart." },
      { title: "Secrets", prompt: "You find an API key committed to the repo. What now?", options: ["Delete the line", "Rotate the key and remove it from history", "Leave it, the repo is private"], right: 1, explanation: "Once committed, assume it's leaked: rotate it." },
    ],
  },
]

export async function buildCompany() {
  const mk = (name: string, local: string) => ({ name, email: emailFor(local, SLUG) })
  const [owner, ld, hr, trainer, compliance] = await makeUsers([
    mk("Ritu Chopra", "owner"),
    mk("Manish Pandey", "ld.admin"),
    mk(person("female").name, "hr"),
    mk(person().name, "trainer"),
    mk(person().name, "compliance"),
  ])
  const org = await makeOrg({
    slug: SLUG,
    name: "Acme Software",
    type: "company",
    description: "A product company in Bengaluru: onboarding, compliance and engineering training.",
    modules: { training: true, events: true },
    owner: owner!,
  })
  await join(org, [ld!, hr!, trainer!, compliance!])
  await give(org, ld!, "admin")
  await give(org, hr!, "hr_partner")
  await give(org, trainer!, "trainer")
  await give(org, compliance!, "compliance_officer")
  remember(LABEL, "L&D admin", ld!)
  remember(LABEL, "Compliance officer", compliance!)

  const depts = [
    { name: "Engineering", teams: ["Platform", "Mobile"] },
    { name: "Sales", teams: ["Inside sales"] },
    { name: "People", teams: ["HR operations"] },
  ]
  const deptIds: Record<string, string> = {}
  const employees: (UserRow & { team: string; dept: string })[] = []
  for (const d of depts) {
    deptIds[d.name] = await group(org, d.name)
    for (const t of d.teams) {
      const [manager] = await makeUsers([mk(person().name, t === "Platform" ? "manager" : `manager.${t.toLowerCase().replace(/ /g, ".")}`)])
      await join(org, [manager!])
      const team = await group(org, t, deptIds[d.name], { leadId: manager!.id })
      await give(org, manager!, "teacher", team)
      if (t === "Platform") remember(LABEL, "Manager (Platform team)", manager!)
      const made = await makeUsers(Array.from({ length: t === "Platform" ? 10 : 7 }, (_, i) => {
        const p = person()
        return { name: p.name, email: emailFor(t === "Platform" && i === 0 ? "employee" : `${p.first}.${p.last}`, SLUG) }
      }))
      await join(org, made)
      await seat(team, made)
      employees.push(...made.map((m) => ({ ...m, team, dept: d.name })))
    }
  }
  remember(LABEL, "Employee (Platform team)", employees[0]!)

  // The courses, their questions, and who has answered them (and when).
  const made: { course: string; questions: string[]; q: Q[] }[] = []
  for (const tr of TRAININGS) {
    const [course] = await db.insert(courses).values({ orgId: org.id, title: tr.title, description: tr.description, published: true }).returning({ id: courses.id })
    const [mod] = await db.insert(courseModules).values({ courseId: course!.id, title: "Module 1", summary: tr.description, position: 0 }).returning({ id: courseModules.id })
    const qs = await db
      .insert(questions)
      .values(tr.questions.map((q) => ({
        orgId: org.id, title: q.title, kind: "single" as const, prompt: q.prompt,
        options: q.options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })), correct: [String.fromCharCode(97 + q.right)],
        explanation: q.explanation, points: 1, sharing: "owner" as const,
      })))
      .returning({ id: questions.id })
    await insertAll(courseItems, qs.map((q, i) => ({ moduleId: mod!.id, itemType: "question" as const, itemId: q.id, position: i })))
    made.push({ course: course!.id, questions: qs.map((q) => q.id), q: tr.questions })
  }
  const [infosec, posh, secure] = made
  await insertAll(courseClasses, [
    ...Object.values(deptIds).map((g) => ({ courseId: infosec!.course, groupId: g, startsOn: day(-60), dueOn: day(6), renewMonths: 12, addedBy: compliance!.id })),
    ...Object.values(deptIds).map((g) => ({ courseId: posh!.course, groupId: g, startsOn: day(-45), dueOn: day(-4), renewMonths: null, addedBy: hr!.id })),
    { courseId: secure!.course, groupId: deptIds.Engineering!, startsOn: day(-20), dueOn: day(25), renewMonths: null, addedBy: trainer!.id },
  ])
  const answers: { userId: string; questionId: string; answer: string[]; correct: boolean; tries: number; answeredAt: Date }[] = []
  const certs: { e: UserRow & { dept: string }; course: string; title: string; when: Date; expires: Date }[] = []
  const answer = (who: UserRow, c: (typeof made)[number], when: Date) => {
    for (const [i, q] of c.questions.entries()) {
      answers.push({ userId: who.id, questionId: q, answer: [String.fromCharCode(97 + c.q[i]!.right)], correct: true, tries: chance(0.2) ? 2 : 1, answeredAt: new Date(when.getTime() + i * 60_000) })
    }
  }
  for (const e of shuffle(employees)) {
    const r = random()
    // Information security: most done this year; some last year (expired or about to); a few not yet.
    if (r < 0.55) {
      const when = at(-(15 + Math.floor(random() * 40)))
      answer(e, infosec!, when)
      if (chance(0.5)) certs.push({ e, course: infosec!.course, title: TRAININGS[0]!.title, when, expires: new Date(when.getTime() + 365 * 86_400_000) })
    } else if (r < 0.7) answer(e, infosec!, at(-(355 + Math.floor(random() * 30))))
    else if (r < 0.78) answer(e, infosec!, at(-400))
    // POSH: once; a few still haven't (overdue).
    if (chance(0.82)) answer(e, posh!, at(-(5 + Math.floor(random() * 35))))
    // Secure code review: engineers, under way.
    if (e.dept === "Engineering" && chance(0.4)) answer(e, secure!, at(-(1 + Math.floor(random() * 15))))
  }
  await insertAll(practiceAnswers, answers, 1000)
  await insertAll(certificates, certs.map((c) => ({
    code: certCode(), orgId: org.id, groupId: deptIds[c.e.dept], userId: c.e.id, kind: "course" as const, sourceId: c.course,
    title: c.title, detail: `Completed all 1 modules of the course in ${c.e.dept}, Acme Software.`, issuedBy: compliance!.id,
    issuedAt: c.when, expiresOn: c.expires.toISOString().slice(0, 10),
  })))

  await insertAll(notes, [
    { orgId: org.id, text: "Information security essentials is due this week for everyone. It takes ten minutes.", audience: [], authorId: compliance!.id, createdAt: at(-1) },
  ])
  const [townhall] = await db
    .insert(orgEvents)
    .values([
      { orgId: org.id, title: "Quarterly town hall", description: "Results, roadmap and Q&A with the leadership team.", startsAt: at(8, 9), endsAt: at(8, 10), location: "Cafeteria, 4th floor", link: "https://meet.example.com/acme-townhall", createdBy: ld!.id },
      { orgId: org.id, groupId: deptIds.Engineering!, title: "Brown-bag: our incident review process", description: "How we run blameless reviews.", startsAt: at(3, 7, 30), endsAt: at(3, 8, 30), location: "Room Kaveri", capacity: 25, createdBy: trainer!.id },
    ])
    .returning({ id: orgEvents.id })
  await insertAll(eventRsvps, employees.slice(0, 22).map((e) => ({ eventId: townhall!.id, userId: e.id, status: "going" as const })))
  console.log(`  company: ${employees.length} employees, ${answers.length} answers, ${certs.length} certificates`)
}
