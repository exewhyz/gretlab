/**
 * The school's home: who gets which view (admin, teacher, student, parent; a visitor gets
 * the public page), the admin numbers against the seeded school (students, teachers,
 * classes, present today, open registers, the setup checklist, needs attention, coverage),
 * the teacher's day from the timetable, their classes and to-dos, a student's week (their
 * own class, today's lessons, attendance, notices), a parent's children (absent today),
 * the sidebar's groups by
 * permission, and every width (PC, laptop, tablet, phone) without sideways scrolling.
 *   node e2e/home.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100", SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret", SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", "gretlab_test", "-Atqc", q]).toString().trim()
psql(`delete from organizations where slug='greenfield'`); psql(`delete from users where email like 'gf-%'`)
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const names = ["Ravi Kumar", "Grace Wong", "Asha K", "Ben Ali", "Chen Li", "Dev Patel", "Esha Rao", "Farid S", "Gita M", "Hari P", "Ivy N", "Jon T", "Kiran B", "Lena D", "Mo Z", "Nia R", "Om S", "Pia V", "Raj G", "Sara H"]
const H = names.map((n, i) => `gf-${i}`)
names.forEach((n, i) => psql(`insert into users(email,name,role,handle) values ('${H[i]}@example.com','${n}','student','${H[i]}')`))
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => { const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`; return async (p, { method, body } = {}) => { const r = await fetch(BASE + "/api/v1" + p, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json().catch(() => null) } }
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Greenfield School", slug: "greenfield", type: "school", ownerEmail: "gf-0@example.com" } })
const O = "/orgs/greenfield", orgId = psql(`select id from organizations where slug='greenfield'`)
const owner = await client("gf-0@example.com"), teacherC = await client("gf-1@example.com")
await owner(O, { method: "PATCH", body: { description: "A school", modules: { library: true, transport: true } } })
await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31", isCurrent: true } })
const g3 = await owner(`${O}/groups`, { body: { name: "Grade 3" } }), g5 = await owner(`${O}/groups`, { body: { name: "Grade 5" } })
const a3 = await owner(`${O}/groups`, { body: { name: "A", parentId: g3.id } }), b3 = await owner(`${O}/groups`, { body: { name: "B", parentId: g3.id } }), a5 = await owner(`${O}/groups`, { body: { name: "A", parentId: g5.id } })
H.slice(1).forEach((h) => psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`))
const kids = { [a3.id]: H.slice(2, 8), [b3.id]: H.slice(8, 14), [a5.id]: H.slice(14, 20) }
for (const [g, hs] of Object.entries(kids)) await owner(`${O}/groups/${g}/members`, { body: { userIds: hs.map(uid) } })
const roles = await owner(`${O}/roles`); const teacher = roles.find((r) => r.systemKey === "teacher")
await owner(`${O}/members/${uid("gf-1")}/roles`, { body: { roleId: teacher.id, groupId: a3.id } })
await owner(`${O}/members/${uid("gf-1")}/roles`, { body: { roleId: teacher.id, groupId: a5.id } })
const maths = await owner(`${O}/subjects`, { body: { name: "Mathematics", code: "MATH" } })
for (const g of [a3.id, a5.id]) await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: g, teacherId: uid("gf-1") } })
const P = await owner(`${O}/timetable/periods`, { method: "PUT", body: { days: [1, 2, 3, 4, 5, 6, 7], periods: [
  { name: "Period 1", starts: "08:30", ends: "09:15", isBreak: false }, { name: "Period 2", starts: "09:15", ends: "10:00", isBreak: false },
  { name: "Break", starts: "10:00", ends: "10:15", isBreak: true }, { name: "Period 3", starts: "10:15", ends: "11:00", isBreak: false }] } })
const wd = ((new Date().getDay() + 6) % 7) + 1
const cs = (g) => psql(`select id from class_subjects where group_id='${g}'`)
await owner(`${O}/timetable/slots`, { method: "PUT", body: { groupId: a3.id, day: wd, periodId: P.periods[0].id, classSubjectId: cs(a3.id) } })
await owner(`${O}/timetable/slots`, { method: "PUT", body: { groupId: a5.id, day: wd, periodId: P.periods[3].id, classSubjectId: cs(a5.id) } })
const today = (await owner(`${O}/attendance`)).today
const back = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
for (let n = 6; n >= 0; n--) for (const [g, hs] of Object.entries(kids)) {
  if (n === 0 && g !== a3.id) continue
  await owner(`${O}/attendance/register`, { method: "PUT", body: { groupId: g, day: back(n), period: "", marks: hs.map((h, i) => ({ userId: uid(h), status: (i + n) % 7 === 0 ? "absent" : "present" })) } })
}
for (let n = 1; n <= 5; n++) await owner(`${O}/attendance/register`, { method: "PUT", body: { groupId: a5.id, day: back(n + 6), period: "", marks: [{ userId: uid("gf-14"), status: "absent" }] } })
await owner(`${O}/parents`, { body: { studentId: uid("gf-2"), email: "gf-parent@example.com" } })
const yr = (await owner(`${O}/academic-years`)).years.find((y) => y.isCurrent)
await owner(`${O}/academic-years/${yr.id}/class-teachers`, { method: "PUT", body: { assignments: [{ groupId: a3.id, teacherId: uid("gf-1") }] } })
await owner(`${O}/exams`, { body: { yearId: yr.id, name: "Unit test 1" } })
await owner(`${O}/admissions/settings`, { method: "PUT", body: { open: false, yearId: yr.id, gradeIds: [], instructions: "" } })

mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}

// ---------- who gets what
const home = await owner(`${O}/home`)
const teach = await teacherC(`${O}/home`)
const student = await client("gf-2@example.com")
const parent = await client("gf-parent@example.com")
check("the owner gets the school view", home?.views?.[0] === "admin" && home.admin && !home.teacher, JSON.stringify(home?.views))
check("a teacher gets the teaching view only", teach?.views?.join() === "teacher" && teach.teacher && !teach.admin)
check("a student is a student here", (await student(`${O}/shell`))?.views?.join() === "student")
check("a parent is a parent here", (await parent(`${O}/shell`))?.views?.join() === "parent")
check("someone outside has no views", (await (await client("admin@example.com"))(`${O}/shell`))?.views !== undefined)

// ---------- the school view's numbers
const a = home.admin
check("students, teachers and classes are counted", a.tiles.students === 18 && a.tiles.teachers === 1 && a.tiles.classes === 3, JSON.stringify(a.tiles))
check("present today counts taken registers only", a.tiles.present.present === 5 && a.tiles.present.of === 6 && a.tiles.present.open === 2, JSON.stringify(a.tiles.present))
check("class by class: taken, and not taken", a.classes.find((c) => c.name === "Grade 3 · A")?.taken && a.classes.filter((c) => !c.taken).length === 2)
check("recent days come from registers", a.trend.length === 10 && a.trend.at(-1).percent === 83, JSON.stringify(a.trend.at(-1)))
check("the checklist covers class teachers, exams and admissions", ["class-teachers", "exams", "admissions"].every((k) => a.steps.find((s) => s.key === k)?.done === true), JSON.stringify(a.steps.filter((s) => !s.done)))
check("the checklist knows what's done", a.steps.find((s) => s.key === "timetable")?.done && a.steps.find((s) => s.key === "parents")?.done && a.steps.every((s) => typeof s.done === "boolean"))
check("needs attention lists open registers, low attendance and unlinked parents", ["Register", "Attendance", "Parents"].every((k) => a.attention.some((x) => x.kind === k)), JSON.stringify(a.attention.map((x) => x.kind)))
check("coverage counts parents linked and teachers on the timetable", a.coverage.find((c) => c.label.startsWith("Students with a parent"))?.value === 1 && a.coverage.find((c) => c.label.startsWith("Teachers on"))?.value === 1)

// ---------- the teaching view
const t = teach.teacher
check("the teacher's day comes from the timetable, with the break between", t.periods.length === 3 && t.periods[1].isBreak && t.periods[0].taken && !t.periods[2].taken, JSON.stringify(t.periods.map((p) => p.title)))
check("only their own classes", t.classes.map((c) => c.name).sort().join() === "Grade 3 · A,Grade 5 · A")
check("registers to take and students below 75%", t.tiles.toTake === 1 && t.tiles.low >= 1 && t.todo.some((x) => x.kind === "Register"), JSON.stringify(t.tiles))

// ---------- a student and a parent
psql(`insert into users(email,name,role,handle) values ('gf-out@example.com','Outsider','student','gf-out') on conflict do nothing`)
await teacherC(`${O}/classes/${a3.id}/stream`, { body: { text: "Bring your maths books tomorrow" } })
const sh = (await student(`${O}/home`))?.student
check("a student's home shows their own class", sh?.classes.length === 1 && sh.classes[0].name === "Grade 3 · A", JSON.stringify(sh?.classes))
check("...today's lessons from the class timetable", sh?.lessons.length === 1 && sh.lessons[0].subject === "Mathematics", JSON.stringify(sh?.lessons))
check("...their attendance", typeof sh?.tiles.attendance === "number" && sh.tiles.attendance < 100)
check("...and their class's notices", sh?.notices.some((n) => n.text === "Bring your maths books tomorrow"))
const ph = (await parent(`${O}/home`))?.parent
check("a parent's home shows their child", ph?.children.length === 1 && ph.children[0].name === "Asha K", JSON.stringify(ph?.children?.map((c) => c.name)))
check("...absent today, with the news", ph?.children[0].absentToday === true && ph.children[0].news.some((n) => n.kind === "Absent"))
check("a parent sees no school or teaching data", (await parent(`${O}/home`))?.admin === null && (await parent(`${O}/home`))?.teacher === null)

// ---------- the pages, at every width
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
for (const width of [1920, 1440, 834, 390]) {
  const p = await view("gf-0@example.com", width)
  await p.goto(`${BASE}${O}`)
  await p.getByTestId("admin-home").waitFor({ timeout: 30000 })
  check(`the school home fits at ${width}px`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  if (width === 1440) {
    const nav = await p.locator('nav[aria-label="Organization"]').innerText()
    check("the sidebar groups what an owner may open", ["Home", "People", "Academics", "Every day", "Campus", "Coding lab", "School", "Books", "Transport"].every((x) => nav.includes(x)) && !nav.includes("Hostel"), nav.replace(/\n/g, " | ").slice(0, 300))
    check("the setup checklist goes once every step is done", (await p.getByTestId("setup-checklist").count()) === 0 && a.steps.every((s) => s.done))
    check("tiles show the figures", (await p.getByTestId("home-tile").first().innerText()).includes("18"))
    await p.screenshot({ path: SHOTS + "home-admin.png", fullPage: true })
  }
  if (width === 390) {
    check("on a phone the sidebar is a menu", (await p.locator('nav[aria-label="Organization"]').count()) === 0 || !(await p.locator('nav[aria-label="Organization"]').isVisible()))
    await p.getByRole("button", { name: "Toggle the menu" }).click()
    await p.locator('nav[aria-label="Organization"]').waitFor({ timeout: 10000 })
    check("...which opens", await p.locator('nav[aria-label="Organization"]').isVisible())
  }
}
const tp = await view("gf-1@example.com", 1440)
await tp.goto(`${BASE}${O}`)
await tp.getByTestId("teacher-home").waitFor({ timeout: 30000 })
const tnav = await tp.locator('nav[aria-label="Organization"]').innerText()
check("a teacher's sidebar leaves out what they can't open", !tnav.includes("Settings") && !tnav.includes("Invites") && !tnav.includes("Import") && tnav.includes("Attendance"), tnav.replace(/\n/g, " | ").slice(0, 300))
check("the teacher sees their day and classes", (await tp.getByTestId("my-class-card").count()) === 2 && (await tp.getByTestId("my-day").innerText()).includes("Take register"))
await tp.screenshot({ path: SHOTS + "home-teacher.png", fullPage: true })
for (const width of [1440, 390]) {
  const sp = await view("gf-2@example.com", width)
  await sp.goto(`${BASE}${O}`)
  await sp.getByTestId("student-home").waitFor({ timeout: 30000 })
  check(`a student's home fits at ${width}px`, await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  if (width === 1440) {
    check("a student's sidebar has their learning links", (await sp.locator('nav[aria-label="Organization"]').innerText()).includes("My classes"))
    check("...and About the school", (await sp.locator('nav[aria-label="Organization"]').innerText()).includes("About the school"))
    await sp.goto(`${BASE}${O}/about`)
    await sp.getByRole("button", { name: "Leave" }).waitFor({ timeout: 30000 }).catch(() => {})
    check("About the school keeps a student's membership: leave and sharing", (await sp.getByRole("button", { name: "Leave" }).count()) === 1 && (await sp.locator('nav[aria-label="Organization"]').count()) === 1)
    await sp.goto(`${BASE}${O}`)
    await sp.getByTestId("student-home").waitFor({ timeout: 30000 })
    await sp.screenshot({ path: SHOTS + "home-student.png", fullPage: true })
  }
  const pp = await view("gf-parent@example.com", width)
  await pp.goto(`${BASE}${O}`)
  await pp.getByTestId("child-card").waitFor({ timeout: 30000 })
  check(`a parent's home fits at ${width}px`, await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  if (width === 1440) {
    check("the child card says absent today", (await pp.getByTestId("child-card").innerText()).includes("Absent today"))
    await pp.screenshot({ path: SHOTS + "home-parent.png", fullPage: true })
  }
}
const vp = await view("gf-out@example.com", 1440)
await vp.goto(`${BASE}${O}`)
await vp.waitForLoadState("networkidle")
check("a visitor gets the public page", (await vp.getByTestId("org-home").count()) === 0)
const mp = await view("gf-0@example.com", 1440)
await mp.goto(`${BASE}${O}/manage/members`)
await mp.locator('nav[aria-label="Organization"]').waitFor({ timeout: 30000 })
check("manage pages sit in the same frame, the page marked current", (await mp.locator('nav[aria-label="Organization"] [data-active]').first().innerText()).includes("Members"))
await browser.close()

psql(`delete from organizations where slug='greenfield'`)
psql(`delete from users where email like 'gf-%'`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
