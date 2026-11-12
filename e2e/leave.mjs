/**
 * Leave: students (or their parents) and staff ask; class teachers decide their class's
 * students, the office (Approve staff leave) staff, and the school-wide approvers students
 * with no class teacher; days count school days; overlaps and balances are refused;
 * approving turns absences into excused, registers start students on leave as excused and
 * parents aren't told of an absence they asked for; taking back; kinds of staff leave; who
 * may; notifications; the log; the pages, on a phone too.
 *   node e2e/leave.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug = 'lv-school'`)
  psql(`delete from users where email like 'lv-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["lv-o", "lv-t", "lv-t2", "lv-office"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Lv ${h.slice(3)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Lv School", slug: "lv-school", type: "school", ownerEmail: "lv-o@example.com" } })
const O = "/orgs/lv-school", orgId = psql(`select id from organizations where slug='lv-school'`)
const [owner, t, t2, office] = await Promise.all(["lv-o", "lv-t", "lv-t2", "lv-office"].map((h) => client(`${h}@example.com`)))
const g6 = (await owner(`${O}/groups`, { body: { name: "Grade 6" } })).json
const a6 = (await owner(`${O}/groups`, { body: { name: "A", parentId: g6.id } })).json
const b6 = (await owner(`${O}/groups`, { body: { name: "B", parentId: g6.id } })).json
for (const h of ["lv-t", "lv-t2", "lv-office"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
const teacherRole = roles.find((r) => r.systemKey === "teacher").id
await owner(`${O}/members/${uid("lv-t")}/roles`, { body: { roleId: teacherRole, groupId: a6.id } })
await owner(`${O}/members/${uid("lv-t2")}/roles`, { body: { roleId: teacherRole, groupId: b6.id } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Office", permissions: ["leave.staff"] } })).json
await owner(`${O}/members/${uid("lv-office")}/roles`, { body: { roleId: officeRole.id } })
const year = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })).json
await owner(`${O}/academic-years/${year.id}/class-teachers`, { method: "PUT", body: { assignments: [{ groupId: a6.id, teacherId: uid("lv-t") }] } })
const s1 = (await owner(`${O}/students`, { body: { name: "Lv Kid One", email: "lv-s1@example.com", groupId: a6.id, rollNo: 1 } })).json
const s2 = (await owner(`${O}/students`, { body: { name: "Lv Kid Two", email: "lv-s2@example.com", groupId: b6.id, rollNo: 1 } })).json
await owner(`${O}/parents`, { body: { studentId: s1.id, email: "lv-p@example.com", name: "Lv Parent" } })
const [k1, k2, parent] = await Promise.all(["lv-s1", "lv-s2", "lv-p"].map((h) => client(`${h}@example.com`)))
check("the set-up worked", !!(s1?.id && s2?.id && year?.id))

// Days: the school's today, a Monday two weeks on, and the last weekday before today.
const home0 = (await parent(`${O}/leave`)).json
const today = home0?.today ?? new Date().toISOString().slice(0, 10)
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay()
let mon = add(today, 14)
while (dow(mon) !== 1) mon = add(mon, 1)
const [tue, wed, sat, sun] = [add(mon, 1), add(mon, 2), add(mon, 5), add(mon, 6)]
let past = add(today, -1)
while (dow(past) === 0 || dow(past) === 6) past = add(past, -1)

// ---------- who can ask for what
check("a school has leave on by default", (await owner(`${O}/shell`)).json?.modules.includes("leave"))
check("a parent can ask for their child", home0?.students.map((s) => `${s.name}:${s.self}`).join() === "Lv Kid One:false" && home0.staff === false && home0.balances === null, JSON.stringify(home0?.students))
const kidHome = (await k1(`${O}/leave`)).json
check("a student can ask for themselves", kidHome?.students.map((s) => s.self).join() === "true" && kidHome.staff === false)
const tHome = (await t(`${O}/leave`)).json
check("a teacher asks as staff, with balances for the year", tHome?.staff === true && tHome.balances?.types.find((x) => x.key === "casual")?.left === 12 && tHome.balances.year === "2026-2027", JSON.stringify(tHome?.balances))

// ---------- a parent asks, the class teacher decides
const ask = (who, body) => who(`${O}/leave`, { body: { reason: "", ...body } })
const r1 = await ask(parent, { studentId: s1.id, type: "sick", startsOn: mon, endsOn: wed, reason: "Fever" })
check("the parent asks for three school days", r1.status === 200 && r1.json?.days === 3 && r1.json.status === "pending", JSON.stringify(r1.json))
check("the class teacher is told", psql(`select count(*) from notifications where user_id='${uid("lv-t")}' and kind='leave_request'`) === "1")
check("the sidebar counts what waits for them", (await t(`${O}/shell`)).json?.leavePending === 1)
check("overlapping leave is refused", (await ask(parent, { studentId: s1.id, type: "family", startsOn: tue, endsOn: tue })).status === 409)
check("a weekend is refused", (await ask(parent, { studentId: s1.id, type: "family", startsOn: sat, endsOn: sun })).json?.error?.message?.includes("days off"))
check("a parent can't ask for someone else's child", (await ask(parent, { studentId: s2.id, type: "sick", startsOn: mon, endsOn: mon })).status === 404)
check("a made-up reason is refused", (await ask(parent, { studentId: s1.id, type: "holiday", startsOn: add(mon, 7), endsOn: add(mon, 7) })).status === 400)
check("the class teacher sees it to decide", (await t(`${O}/leave`)).json?.waiting.map((r) => r.name).join() === "Lv Kid One")
check("another section's teacher doesn't", (await t2(`${O}/leave`)).json?.waiting.length === 0)
check("...and can't decide it", (await t2(`${O}/leave/${r1.json.id}/decision`, { body: { status: "approved" } })).status === 404)
const d1 = await t(`${O}/leave/${r1.json.id}/decision`, { body: { status: "approved", note: "Get well soon" } })
check("the class teacher approves", d1.json?.status === "approved" && d1.json.decidedBy === "Lv t", JSON.stringify(d1.json))
check("deciding twice is refused", (await t(`${O}/leave/${r1.json.id}/decision`, { body: { status: "rejected" } })).status === 409)
check("the parent and the student are told", psql(`select count(*) from notifications where kind='leave_decision' and user_id in ('${uid("lv-p")}','${s1.id}')`) === "2")
const reg = (who, gid, d) => who(`${O}/attendance/register?${new URLSearchParams({ groupId: gid, day: d, period: "" })}`)
check("the register shows who's on leave that day", (await reg(t, a6.id, tue)).json?.students.find((x) => x.id === s1.id)?.onLeave === "Sick")

// ---------- no class teacher: the school-wide approvers
const r2 = await ask(k2, { type: "family", startsOn: mon, endsOn: mon })
check("a student asks for their own leave", r2.status === 200 && r2.json?.name === "Lv Kid Two", JSON.stringify(r2))
check("with no class teacher, it waits for the school-wide approvers", (await owner(`${O}/leave`)).json?.waiting.some((r) => r.id === r2.json.id) && !(await t(`${O}/leave`)).json?.waiting.some((r) => r.id === r2.json.id))
check("the student takes it back", (await k2(`${O}/leave/${r2.json.id}/cancel`, { body: {} })).status === 200 && psql(`select status from leave_requests where id='${r2.json.id}'`) === "cancelled")

// ---------- staff leave and balances
const tenDays = [mon, add(mon, 11)]
const s3 = await ask(t, { type: "casual", startsOn: tenDays[0], endsOn: tenDays[1], reason: "Wedding" })
check("a teacher asks for ten days of casual leave", s3.json?.days === 10 && s3.json.kind === "staff", JSON.stringify(s3.json))
check("more than is left is refused", (await ask(t, { type: "casual", startsOn: add(mon, 14), endsOn: add(mon, 16) })).json?.error?.code === "not_enough")
const s4 = await ask(t, { type: "unpaid", startsOn: add(mon, 14), endsOn: add(mon, 16) })
check("unpaid leave has no limit", s4.status === 200)
check("a half day counts half", (await ask(t, { type: "sick", startsOn: add(mon, 21), endsOn: add(mon, 21), halfDay: true })).json?.days === 0.5)
check("a teacher doesn't decide their own", !(await t(`${O}/leave`)).json?.waiting.some((r) => r.kind === "staff"))
check("...and can't", (await t(`${O}/leave/${s3.json.id}/decision`, { body: { status: "approved" } })).status === 403)
check("the office is told", psql(`select count(*) from notifications where user_id='${uid("lv-office")}' and kind='leave_request'`) === "3")
check("the office sees staff leave to decide, not students'", (await office(`${O}/leave`)).json?.waiting.every((r) => r.kind === "staff") && (await office(`${O}/leave`)).json.waiting.length === 3)
await office(`${O}/leave/${s3.json.id}/decision`, { body: { status: "approved" } })
check("refusing with a reason", (await office(`${O}/leave/${s4.json.id}/decision`, { body: { status: "rejected", note: "Exams that week" } })).json?.note === "Exams that week")
const bal = (await t(`${O}/leave`)).json?.balances.types
check("the balance counts approved and waiting days", bal?.find((x) => x.key === "casual")?.left === 2 && bal.find((x) => x.key === "sick")?.used === 0.5, JSON.stringify(bal))
check("the office lists decided staff leave", (await office(`${O}/leave/requests?kind=staff&status=approved`)).json?.total === 1)
check("a student can't list others' leave", (await k1(`${O}/leave/requests`)).status === 403)

// ---------- leave after the fact excuses absences
const putReg = (who, gid, marks, d) => who(`${O}/attendance/register`, { method: "PUT", body: { groupId: gid, day: d, period: "", marks } })
await putReg(t, a6.id, [{ userId: s1.id, status: "absent" }], past)
const absentNotes = () => psql(`select count(*) from notifications where user_id='${uid("lv-p")}' and kind='child_absent'`)
const before = absentNotes()
const late = await ask(parent, { studentId: s1.id, type: "sick", startsOn: past, endsOn: past, reason: "Doctor's note" })
check("leave can be asked for afterwards", late.status === 200, JSON.stringify(late.json))
const lateOk = await t(`${O}/leave/${late.json.id}/decision`, { body: { status: "approved" } })
check("approving it excuses the absence", lateOk.json?.excused === 1 && psql(`select a.status from attendance a join teaching_sessions s on s.id=a.session_id where a.user_id='${s1.id}' and s.day='${past}'`) === "excused")
await putReg(t, a6.id, [{ userId: s1.id, status: "absent" }], past)
check("a parent isn't told of an absence on leave they asked for", absentNotes() === before)
check("leave that's started can't be taken back", (await parent(`${O}/leave/${late.json.id}/cancel`, { body: {} })).status === 409)

// ---------- kinds of staff leave
check("a teacher can't change the kinds", (await t(`${O}/leave/types`, { method: "PUT", body: { types: [{ name: "Fun", days: 3 }] } })).status === 403)
check("bad days are refused", (await office(`${O}/leave/types`, { method: "PUT", body: { types: [{ name: "Casual leave", days: 400 }] } })).status === 400)
const kinds = (await office(`${O}/leave/types`, { method: "PUT", body: { types: [{ key: "casual", name: "Casual leave", days: 14 }, { name: "Maternity leave", days: 180 }] } })).json
check("the office sets the kinds, keeping keys", kinds?.types.map((x) => `${x.key}:${x.days}`).join() === "casual:14,maternity-leave:180", JSON.stringify(kinds))
check("balances follow", (await t(`${O}/leave`)).json?.balances.types.find((x) => x.key === "casual")?.left === 4)

const log = (await owner(`${O}/audit?category=leave&limit=100`)).json?.entries ?? []
check("leave is in the log", ["leave.request", "leave.approve", "leave.reject", "leave.cancel", "leave.types"].every((a) => log.some((e) => e.action === a)), log.map((e) => e.action).join())

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("lv-p@example.com", 390)
await p.goto(`${BASE}${O}/leave`)
await p.getByRole("button", { name: "Ask for leave" }).click()
await p.getByLabel("Reason").selectOption("family")
await p.getByLabel("First day").fill(add(mon, 7))
await p.getByLabel("Last day").fill(add(mon, 8))
check("the dialog counts school days", (await p.getByTestId("leave-days").innerText()).includes("2 days"))
await p.getByLabel("Details (optional)").fill("Cousin's wedding")
await p.getByRole("dialog").getByRole("button", { name: "Ask for leave" }).click()
await p.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 })
const newRow = p.getByTestId("leave-row").filter({ hasText: "Cousin's wedding" })
await newRow.waitFor({ timeout: 15000 })
check("the parent's request shows as waiting", (await newRow.innerText()).includes("Waiting"), await newRow.innerText())
check("no sideways scrolling on a phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await p.screenshot({ path: SHOTS + "leave-phone.png", fullPage: true })

const tp = await view("lv-t@example.com", 1440)
await tp.goto(`${BASE}${O}/leave`)
await tp.getByTestId("waiting").waitFor({ timeout: 30000 })
const nav = tp.getByRole("navigation", { name: "Organization" })
const leaveLink = await nav.getByRole("listitem").filter({ has: tp.getByRole("link", { name: "Leave", exact: true }) }).innerText().catch((e) => String(e))
check("the class teacher's sidebar shows a count", leaveLink.includes("1"), leaveLink)
await tp.screenshot({ path: SHOTS + "leave-decide.png", fullPage: true })
await tp.getByTestId("waiting").getByRole("button", { name: "Approve" }).click()
await tp.getByRole("dialog").getByRole("button", { name: "Approve" }).click()
await tp.getByText("Nothing waits for you.").waitFor({ timeout: 15000 })
check("the class teacher approves from the page", psql(`select status from leave_requests where reason='Cousin''s wedding'`) === "approved")
await tp.goto(`${BASE}${O}/manage/attendance`)
await tp.getByLabel("Day").fill(past)
await tp.getByTestId("register").waitFor({ timeout: 30000 })
check("the register marks who's on leave", (await tp.getByTestId("on-leave").innerText()).includes("Sick"))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
