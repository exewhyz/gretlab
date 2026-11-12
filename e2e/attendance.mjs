/**
 * The Attendance module: on by default for a school, off for a company and when switched
 * off; who may take or see a register (scoped to their groups); taking, correcting, periods,
 * statuses and excused-out percentages; the month report; and the pages.
 *   node e2e/attendance.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('att-school','att-co')`)
  psql(`delete from users where email like 'att-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["att-o", "att-t1", "att-t2", "att-s1", "att-s2", "att-s3"]
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
await admin("/admin/organizations", { body: { name: "Att School", slug: "att-school", type: "school", ownerEmail: "att-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Att Co", slug: "att-co", type: "company", ownerEmail: "att-o@example.com" } })
const O = "/orgs/att-school"
const orgId = psql(`select id from organizations where slug='att-school'`)
const [owner, t1, t2, s1] = await Promise.all(["att-o", "att-t1", "att-t2", "att-s1"].map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 1" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["att-t1", "att-s1", "att-s2", "att-s3"].map(uid) } })
await owner(`${O}/groups/${secB.id}/members`, { body: { userIds: [uid("att-t2")] } })
const teacher = (await owner(`${O}/roles`)).json.find((r) => r.systemKey === "teacher")
await owner(`${O}/members/${uid("att-t1")}/roles`, { body: { roleId: teacher.id, groupId: secA.id } })
await owner(`${O}/members/${uid("att-t2")}/roles`, { body: { roleId: teacher.id, groupId: secB.id } })

// ---------- the module
check("a school has attendance on by default", (await owner(O + "/manage")).json?.org.modules.includes("attendance"))
check("a company doesn't", [403, 404].includes((await owner("/orgs/att-co/attendance")).status))
await owner(O, { method: "PATCH", body: { modules: { attendance: false } } })
check("switched off, its pages are gone", (await t1(`${O}/attendance`)).status === 404)
check("switched off, the sidebar doesn't list it", !(await owner(O + "/manage")).json?.org.modules.includes("attendance"))
await owner(O, { method: "PATCH", body: { modules: { attendance: true } } })

// ---------- who may do what
const groups = (await t1(`${O}/attendance`)).json
check("a teacher may choose their section", groups?.choosable.includes(secA.id) && !groups.choosable.includes(secB.id), JSON.stringify(groups?.choosable))
const day = groups.today
const reg = (who, gid, d = day, period = "") => who(`${O}/attendance/register?${new URLSearchParams({ groupId: gid, day: d, period })}`)
const put = (who, gid, marks, d = day, period = "") => who(`${O}/attendance/register`, { method: "PUT", body: { groupId: gid, day: d, period, marks } })
const r0 = (await reg(t1, secA.id)).json
check("the register lists the section's students, not its teacher", r0?.students.length === 3 && !r0.students.some((s) => s.id === uid("att-t1")), JSON.stringify(r0?.students))
check("not taken yet", r0?.taken === false && r0.canMark === true)
check("a student can't see the register", (await reg(s1, secA.id)).status === 403)
check("another section's teacher can't take it", [403, 404].includes((await put(t2, secA.id, [])).status))
check("a day that hasn't come is refused", (await put(t1, secA.id, [], "2999-01-01")).json?.error?.code === "future_day")
check("only the section's students can be marked", (await put(t1, secA.id, [{ userId: uid("att-t2"), status: "present" }])).json?.error?.code === "not_in_class")
check("a bad status is refused", (await put(t1, secA.id, [{ userId: uid("att-s1"), status: "asleep" }])).status === 400)
check("a bad query is a 400, not a crash", (await t1(`${O}/attendance/register?groupId=nope&day=x`)).status === 400)

// ---------- taking and correcting
const marks = [
  { userId: uid("att-s1"), status: "present" },
  { userId: uid("att-s2"), status: "absent" },
  { userId: uid("att-s3"), status: "excused" },
]
check("the teacher takes the register", (await put(t1, secA.id, marks)).status === 200)
const r1 = (await reg(t1, secA.id)).json
const st = (r, h) => r.students.find((s) => s.id === uid(h))?.status
check("it's saved with each status", r1.taken && st(r1, "att-s1") === "present" && st(r1, "att-s2") === "absent" && st(r1, "att-s3") === "excused")
check("taken once per day: correcting replaces it", (await put(t1, secA.id, [...marks.slice(0, 1), { userId: uid("att-s2"), status: "late" }, marks[2]])).status === 200 && st((await reg(t1, secA.id)).json, "att-s2") === "late")
check("one register row, not two", psql(`select count(*) from teaching_sessions where group_id='${secA.id}' and kind='register' and period=''`) === "1")
check("a second period the same day is its own register", (await put(t1, secA.id, [{ userId: uid("att-s1"), status: "absent" }], day, "Period 2")).status === 200)
const log = (await owner(`${O}/audit?limit=200`)).json.entries
check("taking and correcting are in the activity log", ["attendance.take", "attendance.correct"].every((a) => log.some((e) => e.action === a)))
check("registers stay out of the teaching log", psql(`select count(*) from teaching_sessions where group_id='${secA.id}' and kind='class'`) === "0")

// ---------- the month
const month = (await t1(`${O}/attendance/month?${new URLSearchParams({ groupId: secA.id, month: day.slice(0, 7) })}`)).json
const row = (h) => month.students.find((s) => s.id === uid(h))
check("the month has a column per register", month?.columns.length === 2, JSON.stringify(month?.columns))
check("late counts as there", row("att-s2").summary.percent === 100)
check("absent in one of two lowers the figure", row("att-s1").summary.percent === 50)
check("excused-only means no figure", row("att-s3").summary.percent === null)
check("a student can't see the month", (await s1(`${O}/attendance/month?${new URLSearchParams({ groupId: secA.id, month: day.slice(0, 7) })}`)).status === 403)

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const tp = await page("att-t1@example.com")
await tp.goto(`${BASE}${O}/manage/attendance`)
await tp.getByTestId("register").waitFor({ timeout: 30000 })
check("the teacher's sidebar lists Attendance", (await tp.locator('nav[aria-label="Organization"]').innerText()).includes("Attendance"))
check("the register opens on their only section", (await tp.getByTestId("register-row").count()) === 3)
await tp.getByRole("button", { name: "All present" }).click()
await tp.getByRole("button", { name: "Save register" }).click()
await tp.getByText("Saved.").waitFor({ timeout: 15000 })
check("saving from the page works", st((await reg(t1, secA.id)).json, "att-s2") === "present")
await tp.screenshot({ path: SHOTS + "attendance-register.png", fullPage: true })
await tp.goto(`${BASE}${O}/manage/attendance-report`)
await tp.getByTestId("attendance-report").waitFor({ timeout: 30000 })
check("the report page shows the month", (await tp.getByTestId("report-percent").count()) === 3)
await tp.screenshot({ path: SHOTS + "attendance-report.png", fullPage: true })
const phone = await page("att-t1@example.com", 390)
await phone.goto(`${BASE}${O}/manage/attendance`)
await phone.getByTestId("register").waitFor({ timeout: 30000 })
check("the register fits a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
