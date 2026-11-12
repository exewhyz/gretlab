/**
 * The Subjects module: on for a school, off for a company; adding, renaming, duplicates and
 * bad codes; putting a subject on a class with its teacher (only someone who teaches there),
 * changing the teacher, taking it off; who may do each (a role with only "Assign subjects to
 * classes", scoped to one section); deleting; the page and its dialogs.
 *   node e2e/subjects.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('sub-school','sub-co')`)
  psql(`delete from users where email like 'sub-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["sub-o", "sub-t1", "sub-t2", "sub-tt", "sub-s1"]
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
await admin("/admin/organizations", { body: { name: "Sub School", slug: "sub-school", type: "school", ownerEmail: "sub-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Sub Co", slug: "sub-co", type: "company", ownerEmail: "sub-o@example.com" } })
const O = "/orgs/sub-school"
const orgId = psql(`select id from organizations where slug='sub-school'`)
const [owner, t1, tt] = await Promise.all(["sub-o", "sub-t1", "sub-tt"].map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 2" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["sub-t1", "sub-s1"].map(uid) } })
const roles = (await owner(`${O}/roles`)).json
const teacher = roles.find((r) => r.systemKey === "teacher")
await owner(`${O}/members/${uid("sub-t1")}/roles`, { body: { roleId: teacher.id, groupId: secA.id } })
await owner(`${O}/members/${uid("sub-t2")}/roles`, { body: { roleId: teacher.id, groupId: secB.id } })
const timetabler = (await owner(`${O}/roles`, { body: { name: "Timetabler", permissions: ["subjects.assign"] } })).json
await owner(`${O}/members/${uid("sub-tt")}/roles`, { body: { roleId: timetabler.id, groupId: secA.id } })

// ---------- the module
check("a school has subjects on by default", (await owner(O + "/manage")).json?.org.modules.includes("subjects"))
check("a company doesn't", [403, 404].includes((await owner("/orgs/sub-co/subjects")).status))

// ---------- the list of subjects
const add = (who, body) => who(`${O}/subjects`, { body })
const maths = await add(owner, { name: "Mathematics", code: "MATH" })
check("the owner adds a subject", maths.status === 200 && maths.json?.code === "MATH")
check("the same name, any case, is refused", (await add(owner, { name: "mathematics" })).json?.error?.code === "duplicate")
check("the same code is refused", (await add(owner, { name: "Maths 2", code: "math" })).json?.error?.code === "duplicate")
check("a bad code is refused", (await add(owner, { name: "Physics", code: "PH YS!" })).status === 400)
const phys = (await add(owner, { name: "Physics" })).json
check("a code is optional", phys?.code === "")
check("renaming works", (await owner(`${O}/subjects/${phys.id}`, { method: "PUT", body: { name: "Physical Science", code: "PHY" } })).json?.name === "Physical Science")
check("a teacher can't manage subjects", (await t1(`${O}/subjects`)).status === 403)
check("an assign-only role can't add subjects", (await add(tt, { name: "Art" })).status === 403)
check("an unknown id is a 404", (await owner(`${O}/subjects/not-a-uuid`, { method: "DELETE" })).status === 404)

// ---------- putting subjects on classes
const assign = (who, subjectId, groupId, teacherId = null) => who(`${O}/subjects/${subjectId}/classes`, { body: { groupId, teacherId } })
check("the teachers of a section are offered", (await owner(`${O}/subjects/teachers?groupId=${secA.id}`)).json?.some((t) => t.id === uid("sub-t1")))
check("Maths goes on Section A with its teacher", (await assign(owner, maths.json.id, secA.id, uid("sub-t1"))).status === 200)
check("a student can't be made the teacher", (await assign(owner, phys.id, secA.id, uid("sub-s1"))).json?.error?.code === "not_a_teacher")
check("another section's teacher can't teach it here", (await assign(owner, phys.id, secA.id, uid("sub-t2"))).json?.error?.code === "not_a_teacher")
check("changing the teacher keeps one row", (await assign(owner, maths.json.id, secA.id, null)).status === 200 && psql(`select count(*) from class_subjects where group_id='${secA.id}'`) === "1")
check("the assign-only role can put subjects on its section", (await assign(tt, phys.id, secA.id)).status === 200)
check("...but not on another section", (await assign(tt, phys.id, secB.id)).status === 403)
const list = (await tt(`${O}/subjects`)).json
check("the assign-only role sees the list, can only assign", list?.can.assign && !list.can.create && !list.can.delete, JSON.stringify(list?.can))
const use = list.subjects.find((s) => s.id === phys.id).classes[0]
check("it can take a subject off its section", (await tt(`${O}/subjects/classes/${use.id}`, { method: "DELETE" })).status === 200)
const log = (await owner(`${O}/audit`)).json
check("changes are in the activity log", ["subject.create", "subject.update", "subject.assign", "subject.unassign"].every((a) => log.some((e) => e.action === a)))
check("deleting a subject takes it off its classes", (await owner(`${O}/subjects/${maths.json.id}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from class_subjects where group_id='${secA.id}'`) === "0")

// ---------- the page
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("sub-o@example.com")
await op.goto(`${BASE}${O}/manage/subjects`)
await op.getByTestId("subjects").waitFor({ timeout: 30000 })
check("the owner's sidebar lists Subjects under Teaching", (await op.locator('nav[aria-label="Organization"]').innerText()).includes("Subjects"))
await op.getByRole("button", { name: "Add subject" }).click()
await op.getByLabel("Name").fill("English")
await op.getByRole("dialog").getByRole("button", { name: "Add subject" }).click()
await op.getByText("English").first().waitFor({ timeout: 15000 })
check("a subject is added from its dialog", (await op.getByTestId("subject-row").count()) === 2)
await op.getByTestId("subject-row").filter({ hasText: "English" }).getByRole("button", { name: "Add to a class" }).click()
const assignDialog = op.getByRole("dialog", { name: "Add English to a class" })
await assignDialog.waitFor({ timeout: 15000 })
await assignDialog.getByRole("button", { name: "Class", exact: true }).click()
const picker = op.getByTestId("group-picker")
await picker.getByLabel("Search groups").fill("Section A")
await picker.getByRole("option", { name: "Grade 2 › Section A", exact: true }).click()
await op.getByLabel("Teacher").selectOption({ label: "sub-t1 Name" })
await assignDialog.getByRole("button", { name: "Add to class", exact: true }).click()
await op.getByTestId("subject-row").filter({ hasText: "English" }).getByText(/sub-t1 Name/).waitFor({ timeout: 15000 }).catch(() => {})
const englishRow = await op.getByTestId("subject-row").filter({ hasText: "English" }).innerText()
check("it's put on a class with its teacher from the dialog", englishRow.includes("sub-t1 Name"), englishRow + " | db: " + psql(`select s.name, cs.teacher_id is not null from class_subjects cs join subjects s on s.id=cs.subject_id where cs.org_id='${orgId}'`))
await op.screenshot({ path: SHOTS + "subjects.png", fullPage: true })
const phone = await page("sub-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/subjects`)
await phone.getByTestId("subjects").waitFor({ timeout: 30000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
