/**
 * The Timetable module: periods and school days; filling a class's week with its subjects;
 * a teacher can't be in two classes in one period; breaks and non-school days refused;
 * an editor scoped to one section; a student and a teacher see the class's week; a
 * teacher's own week; the pages, on a phone too.
 *   node e2e/timetable.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('tt-school','tt-co')`)
  psql(`delete from users where email like 'tt-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["tt-o", "tt-t1", "tt-t2", "tt-ed", "tt-s1"]
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
await admin("/admin/organizations", { body: { name: "TT School", slug: "tt-school", type: "school", ownerEmail: "tt-o@example.com" } })
await admin("/admin/organizations", { body: { name: "TT Co", slug: "tt-co", type: "company", ownerEmail: "tt-o@example.com" } })
const O = "/orgs/tt-school"
const orgId = psql(`select id from organizations where slug='tt-school'`)
const [owner, t1, t2, ed, s1] = await Promise.all(people.map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 3" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: [uid("tt-s1")] } })
const roles = (await owner(`${O}/roles`)).json
const teacher = roles.find((r) => r.systemKey === "teacher")
// tt-t1 teaches the whole grade (both sections); tt-t2 only Section B.
await owner(`${O}/members/${uid("tt-t1")}/roles`, { body: { roleId: teacher.id, groupId: grade.id } })
await owner(`${O}/members/${uid("tt-t2")}/roles`, { body: { roleId: teacher.id, groupId: secB.id } })
const editorRole = (await owner(`${O}/roles`, { body: { name: "Timetable editor", permissions: ["timetable.edit"] } })).json
await owner(`${O}/members/${uid("tt-ed")}/roles`, { body: { roleId: editorRole.id, groupId: secA.id } })
const maths = (await owner(`${O}/subjects`, { body: { name: "Mathematics", code: "MATH" } })).json
const sci = (await owner(`${O}/subjects`, { body: { name: "Science", code: "SCI" } })).json
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: secA.id, teacherId: uid("tt-t1") } })
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: secB.id, teacherId: uid("tt-t1") } })
await owner(`${O}/subjects/${sci.id}/classes`, { body: { groupId: secB.id, teacherId: uid("tt-t2") } })
const csOf = (subjectId, groupId) => psql(`select id from class_subjects where subject_id='${subjectId}' and group_id='${groupId}'`)

// ---------- the module
check("a school has timetables on by default", (await owner(O + "/manage")).json?.org.modules.includes("timetable"))
check("a company doesn't", (await owner("/orgs/tt-co/timetable")).status === 404)
check("a teacher can't manage the timetable", (await t1(`${O}/timetable`)).status === 403)

// ---------- periods and days
const setPeriods = (who, body) => who(`${O}/timetable/periods`, { method: "PUT", body })
const P = [
  { name: "Period 1", starts: "09:00", ends: "09:45", isBreak: false },
  { name: "Recess", starts: "09:45", ends: "10:00", isBreak: true },
  { name: "Period 2", starts: "10:00", ends: "10:45", isBreak: false },
]
check("an end before the start is refused", (await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: [{ ...P[0], ends: "08:00" }] })).json?.error?.code === "bad_time")
check("a time that isn't HH:MM is refused", (await setPeriods(owner, { days: [1], periods: [{ ...P[0], starts: "9am" }] })).status === 400)
check("the timetable editor role can't change periods", (await setPeriods(ed, { days: [1], periods: P })).status === 403)
const saved = await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: P })
check("the owner sets periods and days", saved.status === 200 && saved.json?.periods.length === 3 && saved.json.days.join() === "1,2,3,4,5", JSON.stringify(saved.json))
const [p1, recess, p2] = saved.json.periods

// ---------- filling cells
const put = (who, groupId, day, periodId, classSubjectId) => who(`${O}/timetable/slots`, { method: "PUT", body: { groupId, day, periodId, classSubjectId } })
const mathsA = csOf(maths.id, secA.id), mathsB = csOf(maths.id, secB.id), sciB = csOf(sci.id, secB.id)
check("Maths goes in Section A, Monday period 1", (await put(owner, secA.id, 1, p1.id, mathsA)).status === 200)
const busy = await put(owner, secB.id, 1, p1.id, mathsB)
check("the same teacher can't be in Section B then too", busy.status === 409 && busy.json?.error?.code === "teacher_busy" && busy.json.error.message.includes("Section A"), JSON.stringify(busy.json))
check("a different teacher can", (await put(owner, secB.id, 1, p1.id, sciB)).status === 200)
check("refilling the same cell replaces it", (await put(owner, secA.id, 1, p1.id, mathsA)).status === 200 && psql(`select count(*) from timetable_slots where group_id='${secA.id}'`) === "1")
check("a break can't be filled", (await put(owner, secA.id, 1, recess.id, mathsA)).json?.error?.code === "break")
check("a day that isn't a school day can't", (await put(owner, secA.id, 6, p1.id, mathsA)).json?.error?.code === "not_a_school_day")
check("another class's subject can't", (await put(owner, secA.id, 2, p1.id, sciB)).json?.error?.code === "not_this_class")
check("a bad id is refused", (await put(owner, secA.id, 2, "nope", mathsA)).status === 400)

// ---------- the scoped editor
check("the editor fills Section A", (await put(ed, secA.id, 2, p2.id, mathsA)).status === 200)
check("...but not Section B", (await put(ed, secB.id, 2, p2.id, sciB)).status === 403)
const setup = (await ed(`${O}/timetable`)).json
check("the editor can choose only Section A", setup?.can.edit && !setup.can.periods && setup.choosable.join() === secA.id, JSON.stringify(setup?.choosable))
check("the editor sees the class's subjects to choose from", (await ed(`${O}/classes/${secA.id}/timetable`)).json?.subjects.length === 1)
check("clearing a cell works", (await put(ed, secA.id, 2, p2.id, null)).status === 200 && psql(`select count(*) from timetable_slots where group_id='${secA.id}'`) === "1")

// ---------- who sees what
const studentView = await s1(`${O}/classes/${secA.id}/timetable`)
check("a student sees their class's week", studentView.status === 200 && studentView.json.slots.length === 1 && studentView.json.slots[0].teacher === "tt-t1 Name" && !studentView.json.canEdit && studentView.json.subjects.length === 0, JSON.stringify(studentView.json))
check("...but not another class's", (await s1(`${O}/classes/${secB.id}/timetable`)).status === 404)
check("a teacher sees a class they teach", (await t2(`${O}/classes/${secB.id}/timetable`)).json?.slots.length === 1)
const mine = (await t1(`${O}/timetable/mine`)).json
check("a teacher's own week lists where they teach", mine?.slots.length === 1 && mine.slots[0].group.includes("Section A"), JSON.stringify(mine?.slots))

// ---------- a period becomes a break, then is removed
const again = await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: [{ ...p1, isBreak: true }, recess, p2] })
check("turning a period into a break clears its cells", again.status === 200 && psql(`select count(*) from timetable_slots where org_id='${orgId}'`) === "0")
await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: P.map((p, i) => ({ ...saved.json.periods[i], ...p })) })
await put(owner, secA.id, 3, p2.id, mathsA)
await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: [{ ...p1, ...P[0] }, recess] })
check("removing a period removes its cells", psql(`select count(*) from timetable_slots where org_id='${orgId}'`) === "0")
await setPeriods(owner, { days: [1, 2, 3, 4, 5], periods: [{ ...p1, ...P[0] }, recess, P[2]] })
const log = (await owner(`${O}/audit?limit=200`)).json.entries
check("changes are in the activity log", ["timetable.periods", "timetable.slot"].every((a) => log.some((e) => e.action === a)))

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("tt-o@example.com")
await op.goto(`${BASE}${O}/manage/timetable`)
await op.getByRole("button", { name: "Periods and days" }).waitFor({ timeout: 30000 })
check("the owner's sidebar lists Timetable under Teaching", (await op.locator('nav[aria-label="Organization"]').innerText()).includes("Timetable"))
await op.getByRole("button", { name: "Periods and days" }).click()
const dialog = op.getByRole("dialog", { name: "Periods and days" })
await dialog.getByRole("button", { name: "Add period" }).click()
check("the dialog lists the periods, and adds one", (await dialog.getByLabel(/^Period \d name$/).count()) === 4)
await dialog.getByRole("button", { name: "Save" }).click()
await dialog.waitFor({ state: "hidden", timeout: 15000 })
check("saving the dialog stores the new period", psql(`select count(*) from timetable_periods where org_id='${orgId}'`) === "4")
await op.getByRole("button", { name: "Class", exact: true }).click()
const picker = op.getByTestId("group-picker")
await picker.getByLabel("Search groups").fill("Section A")
await picker.getByRole("option", { name: "Grade 3 › Section A", exact: true }).click()
await op.getByTestId("week-grid").waitFor({ timeout: 15000 })
await op.getByLabel("Tue Period 1").selectOption({ label: "Mathematics" })
await op.getByTestId("cell-2-Period 1").getByText("tt-t1 Name").waitFor({ timeout: 15000 }).catch(() => {})
check("a cell is filled from the grid", psql(`select count(*) from timetable_slots where group_id='${secA.id}' and day=2`) === "1")
await op.goto(`${BASE}${O}/manage/timetable`)
await op.getByRole("button", { name: "Class", exact: true }).click()
await picker.getByLabel("Search groups").fill("Section B")
await picker.getByRole("option", { name: "Grade 3 › Section B", exact: true }).click()
await op.getByLabel("Tue Period 1").selectOption({ label: "Mathematics" })
await op.getByText(/already teaches/).waitFor({ timeout: 15000 }).catch(() => {})
check("a clash is explained on the page", (await op.getByText(/already teaches Grade 3 › Section A/).count()) === 1)
await op.screenshot({ path: SHOTS + "timetable.png", fullPage: true })

const sp = await page("tt-s1@example.com")
await sp.goto(`${BASE}${O}/classes/${secA.id}?tab=timetable`)
await sp.getByTestId("week-grid").waitFor({ timeout: 30000 }).catch(() => {})
check("a student sees the Timetable tab on their class", (await sp.getByTestId("cell-2-Period 1").innerText().catch(() => "")).includes("MATH"))
const tp = await page("tt-t1@example.com")
await tp.goto(`${BASE}${O}/manage/my-timetable`)
await tp.getByTestId("week-grid").waitFor({ timeout: 30000 }).catch(() => {})
check("a teacher's My timetable shows their classes", (await tp.getByTestId("cell-2-Period 1").innerText().catch(() => "")).includes("Section A"))
const phone = await page("tt-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/timetable`)
await phone.getByRole("button", { name: "Periods and days" }).waitFor({ timeout: 30000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
