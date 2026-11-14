/**
 * Staff data screens say who's who and lead with what needs a look: Reports counts only
 * students (not parents or a librarian); Members says who each person is and filters by it;
 * the attendance report opens on every class's month, lowest first; a parent's home leads
 * with their school and child and keeps the coding lab to one line.
 *   node e2e/data-screens.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug='ds-school'`)
  psql(`delete from users where email like 'ds-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["ds-s1", "ds-s2", "ds-t", "ds-lib", "ds-p"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const token = (email) => encode({ token: { email }, secret: SECRET })
const client = async (email) => {
  const cookie = `next-auth.session-token=${await token(email)}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Ds School", slug: "ds-school", type: "school", ownerEmail: "ds-o@example.com" } })
const O = "/orgs/ds-school"
const orgId = psql(`select id from organizations where slug='ds-school'`)
const owner = await client("ds-o@example.com")
const grade = (await owner(`${O}/groups`, { body: { name: "Ds 6" } })).json
const a = (await owner(`${O}/groups`, { body: { name: "A", parentId: grade.id } })).json
const b = (await owner(`${O}/groups`, { body: { name: "B", parentId: grade.id } })).json
for (const h of ["ds-s1", "ds-s2", "ds-t", "ds-lib", "ds-p"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${a.id}/members`, { body: { userIds: ["ds-s1", "ds-t"].map(uid) } })
await owner(`${O}/groups/${b.id}/members`, { body: { userIds: [uid("ds-s2")] } })
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("ds-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: a.id } })
await owner(`${O}/members/${uid("ds-lib")}/roles`, { body: { roleId: roles.find((r) => r.name === "Librarian").id, groupId: null } })
psql(`insert into guardians(org_id,parent_id,student_id) values ('${orgId}','${uid("ds-p")}','${uid("ds-s1")}')`)

// ---------- who counts as a student
const report = (await owner(`${O}/reports`)).json
const emails = report?.students.map((s) => s.email) ?? []
check("Reports counts the two students", report?.summary.students === 2 && emails.includes("ds-s1@example.com") && emails.includes("ds-s2@example.com"), emails.join())
check("...not the parent, the librarian or the teacher", !emails.some((e) => ["ds-p@example.com", "ds-lib@example.com", "ds-t@example.com"].includes(e)))

// ---------- who's who on Members
const members = (await owner(`${O}/members`)).json ?? []
const m = (h) => members.find((x) => x.email === `${h}@example.com`)
check("Members knows whose parent someone is", m("ds-p")?.children.join() === "ds-s1 Name")
check("...and whose role grants something", m("ds-lib")?.roles.some((r) => r.grants) && !m("ds-s1")?.roles.some((r) => r.grants))

// ---------- attendance across the school
const day = (await owner(`${O}/attendance`)).json.today
await owner(`${O}/attendance/register`, { method: "PUT", body: { groupId: a.id, day, period: "", marks: [{ userId: uid("ds-s1"), status: "absent" }] } })
await owner(`${O}/attendance/register`, { method: "PUT", body: { groupId: b.id, day, period: "", marks: [{ userId: uid("ds-s2"), status: "present" }] } })
const overview = (await owner(`${O}/attendance/overview?month=${day.slice(0, 7)}`)).json
const rowA = overview?.rows.find((r) => r.id === a.id)
check("the month overview has every section, with days taken and the share present", overview?.rows.length === 2 && rowA?.days === 1 && rowA.percent === 0 && rowA.below === 1, JSON.stringify(overview?.rows))
check("...and only sections, not the grade above them", !overview?.rows.some((r) => r.id === grade.id))
const teacher = await client("ds-t@example.com")
check("a class teacher's overview is their own class", (await teacher(`${O}/attendance/overview?month=${day.slice(0, 7)}`)).json?.rows.map((r) => r.id).join() === a.id)
check("a bad month is refused", (await owner(`${O}/attendance/overview?month=soon`)).status === 400)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await token(email), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
{
  const p = await view("ds-o@example.com")
  await p.goto(`${BASE}${O}/manage/members`)
  const kinds = p.getByTestId("member-kinds")
  await kinds.waitFor({ timeout: 30000 })
  check("Members shows how many of each", /Students\s*2/.test(await kinds.innerText()) && /Parents\s*1/.test(await kinds.innerText()), await kinds.innerText())
  await kinds.getByRole("button", { name: /Parents/ }).click()
  check("...and filters to them", (await p.getByTestId("member-row").count()) === 1 && (await p.getByTestId("member-row").innerText()).includes("Parent of ds-s1 Name"))
  await p.goto(`${BASE}${O}/manage/attendance-report`)
  await p.getByTestId("attendance-overview").waitFor({ timeout: 30000 })
  check("the attendance report opens on every class, lowest first", (await p.getByTestId("overview-row").count()) === 2 && (await p.getByTestId("overview-row").first().innerText()).includes("A"))
  await p.getByTestId("overview-row").first().getByRole("button", { name: "Open" }).click()
  await p.getByTestId("attendance-report").waitFor({ timeout: 30000 })
  check("...and opens a class's register grid from there", true)
  await p.goto(`${BASE}${O}/manage/reports`)
  await p.getByTestId("stats").waitFor({ timeout: 30000 })
  check("Reports leads with its figures in one line", (await p.getByTestId("stats").innerText()).includes("Students"))
  await p.screenshot({ path: SHOTS + "data-reports.png", fullPage: true })
  await p.context().close()
}
{
  const p = await view("ds-p@example.com", 390)
  await p.goto(`${BASE}/home`)
  await p.getByTestId("member-home").waitFor({ timeout: 30000 })
  check("a parent's home leads with their school and child", (await p.getByTestId("member-child").count()) === 1)
  check("...and keeps the coding lab to one line", (await p.getByTestId("coding-invite").count()) === 1 && (await p.getByTestId("member-tile").count()) === 0)
  check("...with no sideways scrolling", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await p.screenshot({ path: SHOTS + "data-parent-home.png", fullPage: true })
  await p.context().close()
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
