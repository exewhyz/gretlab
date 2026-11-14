/**
 * The Parent accounts module: on for a school, off for a company; linking a parent (created
 * by email when new), relinking, bad input; a "Parent desk" role scoped to one section;
 * linking from a list; who sees which links; a parent sees only their own child (attendance,
 * timetable, work, notices), isn't a member, and gets copies of notices and an absence note
 * once; switching the module off; unlinking; the audit; the pages, on a phone too.
 *   node e2e/parents.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug in ('par-school','par-co')`)
  psql(`delete from users where email like 'par-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["par-o", "par-t1", "par-t2", "par-desk", "par-s1", "par-s2", "par-s3"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Par School", slug: "par-school", type: "school", ownerEmail: "par-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Par Co", slug: "par-co", type: "company", ownerEmail: "par-o@example.com" } })
const O = "/orgs/par-school"
const orgId = psql(`select id from organizations where slug='par-school'`)
const [owner, t1, t2, desk] = await Promise.all(["par-o", "par-t1", "par-t2", "par-desk"].map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 4" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["par-s1", "par-s2"].map(uid) } })
await owner(`${O}/groups/${secB.id}/members`, { body: { userIds: [uid("par-s3")] } })
const roles = (await owner(`${O}/roles`)).json
const teacher = roles.find((r) => r.systemKey === "teacher")
await owner(`${O}/members/${uid("par-t1")}/roles`, { body: { roleId: teacher.id, groupId: secA.id } })
await owner(`${O}/members/${uid("par-t2")}/roles`, { body: { roleId: teacher.id, groupId: secB.id } })
const deskRole = (await owner(`${O}/roles`, { body: { name: "Parent desk", permissions: ["parents.link"] } })).json
await owner(`${O}/members/${uid("par-desk")}/roles`, { body: { roleId: deskRole.id, groupId: secA.id } })

// ---------- the module
check("a school has parent accounts on by default", (await owner(O + "/manage")).json?.org.modules.includes("parents"))
check("a company doesn't", (await owner("/orgs/par-co/parents")).status === 404)
check("a student can't see the parents page", (await (await client("par-s1@example.com"))(`${O}/parents`)).status === 403)

// ---------- linking
const linkTo = (who, student, email, extra = {}) => who(`${O}/parents`, { body: { studentId: uid(student), email, ...extra } })
const first = await linkTo(owner, "par-s1", "Par-P1@Example.com", { name: "Priya P1", relation: "Mother" })
check("the owner links a new parent by email", first.status === 200, JSON.stringify(first.json))
check("the parent's account waits for their first sign-in", psql(`select name from users where email='par-p1@example.com'`) === "Priya P1")
check("linking again changes the relation, keeps one link", (await linkTo(owner, "par-s1", "par-p1@example.com", { relation: "Guardian" })).status === 200 && psql(`select count(*)||relation from guardians where org_id='${orgId}' group by relation`) === "1Guardian")
check("a bad email is refused", (await linkTo(owner, "par-s1", "not-an-email")).status === 400)
check("a student can't be their own parent", (await linkTo(owner, "par-s1", "par-s1@example.com")).json?.error?.code === "same_person")
check("someone who isn't a member isn't a student here", (await owner(`${O}/parents`, { body: { studentId: "00000000-0000-4000-8000-000000000000", email: "x-par@example.com" } })).status === 404)
check("the parent desk links in its section", (await linkTo(desk, "par-s2", "par-p2@example.com", { relation: "Father" })).status === 200)
check("...but not in another", (await linkTo(desk, "par-s3", "par-p2@example.com")).status === 403)
const found = (await desk(`${O}/parents/students?q=par-s`)).json
check("its student search offers only its section", found?.length === 2 && found.every((s) => s.classes[0] === "Grade 4 › Section A"), JSON.stringify(found))
check("a teacher can't link parents", (await linkTo(t1, "par-s2", "par-p9@example.com")).status === 403)
const imported = (await owner(`${O}/parents/import`, { body: { rows: [
  { studentEmail: "par-s3@example.com", parentEmail: "par-p3@example.com", parentName: "P3", relation: "Father" },
  { studentEmail: "nobody-par@example.com", parentEmail: "par-p4@example.com" },
  { studentEmail: "par-s1@example.com", parentEmail: "bad" },
] } })).json
check("a list links what it can and reports the rest", imported?.linked === 1 && imported.failed === 2 && imported.report[1].note.includes("isn't a member"), JSON.stringify(imported))

// ---------- who sees which links
const ownerList = (await owner(`${O}/parents`)).json
check("the owner sees every link", ownerList?.links.length === 3 && ownerList.can.link)
const t1List = (await t1(`${O}/parents`)).json
check("a teacher sees their section's parents, read only", t1List?.links.length === 2 && !t1List.can.link && t1List.links.every((l) => !l.canRemove), JSON.stringify(t1List))
const deskList = (await desk(`${O}/parents`)).json
check("the parent desk may remove links in its section", deskList?.links.length === 2 && deskList.links.every((l) => l.canRemove))
const s3link = ownerList.links.find((l) => l.student.email === "par-s3@example.com")
check("...and not another's", (await desk(`${O}/parents/${s3link.id}`, { method: "DELETE" })).status === 403)

// ---------- the parent
const p1 = await client("par-p1@example.com")
check("a parent is told they're linked", (await p1("/me/notifications")).json?.notifications.some((n) => n.kind === "parent_linked" && n.title.includes("par-s1 Name")))
check("the site knows they're a parent", (await p1("/me")).json?.user.parent === true)
const kids = (await p1("/me/children")).json
check("they see their child", kids?.length === 1 && kids[0].name === "par-s1 Name" && kids[0].org.slug === "par-school", JSON.stringify(kids))
check("...and not another", (await p1(`${O}/children/${uid("par-s2")}`)).status === 404)
check("a bad id is a 404", (await p1(`${O}/children/nope`)).status === 404)
check("a parent isn't a member: no class page", (await p1(`${O}/classes/${secA.id}`)).status === 404)
check("...and no manage pages", [403, 404].includes((await p1(`${O}/parents`)).status))

// Copies of notices, and an absence note once.
await t1(`${O}/classes/${secA.id}/stream`, { body: { text: "Sports day on Friday" } })
const notes1 = (await p1("/me/notifications")).json.notifications
check("a parent gets a copy of a class notice", notes1.some((n) => n.kind === "child_update" && n.title === "par-s1 Name: New notice in Section A" && n.href === `${O}/children/${uid("par-s1")}`), JSON.stringify(notes1.map((n) => n.title)))
const today = (await t1(`${O}/attendance`)).json.today
const mark = (status) => t1(`${O}/attendance/register`, { method: "PUT", body: { groupId: secA.id, day: today, period: "", marks: [{ userId: uid("par-s1"), status }, { userId: uid("par-s2"), status: "absent" }] } })
await mark("absent")
await mark("absent")
const absent = (await p1("/me/notifications")).json.notifications.filter((n) => n.kind === "child_absent")
check("a parent hears once when their child is absent", absent.length === 1 && absent[0].title === "par-s1 Name was marked absent today", JSON.stringify(absent))
await mark("present")
await mark("absent")
check("...and again after a correction back to absent", (await p1("/me/notifications")).json.notifications.filter((n) => n.kind === "child_absent").length === 2)
const settings = (await p1("/me/notifications/settings")).json
const studentSettings = (await (await client("par-s1@example.com"))("/me/notifications/settings")).json
check("parents can choose parent emails; students don't see them", JSON.stringify(settings).includes("parent.absence") && !JSON.stringify(studentSettings).includes("parent.absence"))

// The child's page: attendance, timetable, work.
const P = [{ name: "Period 1", starts: "09:00", ends: "09:45", isBreak: false }]
const periods = (await owner(`${O}/timetable/periods`, { method: "PUT", body: { days: [1, 2, 3, 4, 5], periods: P } })).json.periods
const maths = (await owner(`${O}/subjects`, { body: { name: "Mathematics", code: "MATH" } })).json
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: secA.id, teacherId: uid("par-t1") } })
const cs = psql(`select id from class_subjects where group_id='${secA.id}'`)
await owner(`${O}/timetable/slots`, { method: "PUT", body: { groupId: secA.id, day: 1, periodId: periods[0].id, classSubjectId: cs } })
const view = (await p1(`${O}/children/${uid("par-s1")}`)).json
const cls = view?.classes?.[0]
check("the child's page has their class's attendance", cls?.name === "Grade 4 › Section A" && cls.attendance?.marked === 1 && cls.attendance.percent === 0, JSON.stringify(cls?.attendance))
check("...recent absences", view?.absences.length === 1 && view.absences[0].group === "Grade 4 › Section A")
check("...the timetable", cls?.timetable?.slots.length === 1 && cls.timetable.slots[0].code === "MATH")
check("...and class notices", cls?.notices.some((n) => n.text === "Sports day on Friday"))

// ---------- switching off, unlinking
await owner(O, { method: "PATCH", body: { modules: { parents: false } } })
check("switched off, a parent sees nothing", (await p1(`${O}/children/${uid("par-s1")}`)).status === 404 && (await p1("/me/children")).json?.length === 0)
await t1(`${O}/classes/${secA.id}/stream`, { body: { text: "Quiet notice" } })
check("...and gets no copies", !(await p1("/me/notifications")).json.notifications.some((n) => n.title.includes("Quiet") || (n.kind === "child_update" && n.body.includes("Quiet"))))
await owner(O, { method: "PATCH", body: { modules: { parents: true } } })
check("the owner unlinks", (await owner(`${O}/parents/${s3link.id}`, { method: "DELETE" })).status === 200)
check("the unlinked parent loses the child", (await (await client("par-p3@example.com"))(`${O}/children/${uid("par-s3")}`)).status === 404)
const log = (await owner(`${O}/audit?limit=200`)).json.entries
check("changes are in the activity log", ["parent.link", "parent.import", "parent.unlink"].every((a) => log.some((e) => e.action === a)))

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("par-o@example.com")
await op.goto(`${BASE}${O}/manage/parents`)
await op.getByTestId("parent-links").waitFor({ timeout: 30000 })
check("the owner's sidebar lists Parents under People", (await op.locator('nav[aria-label="Organization"]').innerText()).includes("Parents"))
await op.getByRole("button", { name: "Add parent" }).click()
const add = op.getByRole("dialog", { name: "Add parent" })
await add.getByLabel("Student").fill("par-s2")
await add.getByRole("button", { name: /par-s2 Name/ }).click()
await add.getByLabel("Parent's email").fill("par-p5@example.com")
await add.getByLabel("Parent's name").fill("Pat Five")
await add.getByLabel("Relation").selectOption("Mother")
await add.getByRole("button", { name: "Link parent" }).click()
await op.getByText("Pat Five").waitFor({ timeout: 15000 }).catch(() => {})
check("a parent is linked from the dialog", (await op.getByTestId("parent-link").filter({ hasText: "Pat Five" }).count()) === 1)
await op.getByRole("button", { name: "Add from a list" }).click()
const list = op.getByRole("dialog", { name: "Add parents from a list" })
await list.getByLabel("Parents list").fill("student email, parent email, name, relation\npar-s3@example.com, par-p6@example.com, Pat Six, Father")
await list.getByRole("button", { name: "Link 1 parents" }).click()
await list.getByTestId("import-report").waitFor({ timeout: 15000 })
check("a list is linked from its dialog, skipping the header", (await list.getByTestId("import-report").innerText()).includes("Linked 1."))
await list.getByRole("button", { name: "Done" }).click()
await op.getByTestId("parent-link").filter({ hasText: "Pat Six" }).waitFor({ timeout: 15000 }).catch(() => {})
await op.getByLabel("Search parents and students").fill("Pat Six")
// The search runs on the server; the previous list stays until it answers.
await op.waitForFunction(() => document.querySelectorAll('[data-testid="parent-link"]').length === 1, null, { timeout: 15000 }).catch(() => {})
check("the search narrows the list", (await op.getByTestId("parent-link").count()) === 1)
await op.screenshot({ path: SHOTS + "parents.png", fullPage: true })

const pp = await page("par-p1@example.com")
await pp.goto(`${BASE}/children`)
await pp.getByTestId("children").waitFor({ timeout: 30000 })
check("the header offers My children", (await pp.getByRole("link", { name: "My children" }).count()) >= 1)
await pp.getByRole("link", { name: /par-s1 Name/ }).click()
await pp.getByTestId("child-page").waitFor({ timeout: 30000 })
await pp.getByTestId("attendance-card").waitFor({ timeout: 15000 }).catch(() => {})
const body = await pp.getByTestId("child-page").innerText()
check("the child's page shows attendance, timetable and notices", body.includes("0%") && body.includes("MATH") && body.includes("Sports day on Friday"), body.slice(0, 300))
await pp.screenshot({ path: SHOTS + "child.png", fullPage: true })
for (const [email, path] of [["par-p1@example.com", `${O}/children/${uid("par-s1")}`], ["par-o@example.com", `${O}/manage/parents`]]) {
  const phone = await page(email, 390)
  await phone.goto(BASE + path)
  await phone.waitForLoadState("networkidle")
  check(`no sideways scrolling on a phone: ${path.split("/").slice(3, 4)}`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
