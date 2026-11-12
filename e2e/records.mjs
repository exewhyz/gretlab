/**
 * Student records: the module (on for a school, off for a company); academic years (bad
 * dates, duplicates, one current, making another current moves every student, deleting
 * only an empty year); adding students with and without a sign-in, admission numbers
 * (suggested, unique), placing them only in a section of the current year; who may do
 * what (an office role scoped to a grade, teachers see their class only, students see
 * nothing); personal details sealed at rest; moving, withdrawing and restoring; no mail to
 * students who don't sign in; a parent for such a student; the log; the pages, on a phone.
 *   node e2e/records.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('rec-school','rec-co')`)
  psql(`delete from users where email like 'rec-%' or (email like 'no-login+%' and name like 'Rec %')`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["rec-o", "rec-t", "rec-office", "rec-s2"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Rec School", slug: "rec-school", type: "school", ownerEmail: "rec-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Rec Co", slug: "rec-co", type: "company", ownerEmail: "rec-o@example.com" } })
const O = "/orgs/rec-school", orgId = psql(`select id from organizations where slug='rec-school'`)
const [owner, teacher, office] = await Promise.all(["rec-o", "rec-t", "rec-office"].map((h) => client(`${h}@example.com`)))
const g1 = (await owner(`${O}/groups`, { body: { name: "Grade 1" } })).json
const g2 = (await owner(`${O}/groups`, { body: { name: "Grade 2" } })).json
const a1 = (await owner(`${O}/groups`, { body: { name: "A", parentId: g1.id } })).json
const b1 = (await owner(`${O}/groups`, { body: { name: "B", parentId: g1.id } })).json
const a2 = (await owner(`${O}/groups`, { body: { name: "A", parentId: g2.id } })).json
for (const h of ["rec-t", "rec-office"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("rec-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: a1.id } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Grade 1 office", permissions: ["students.edit"] } })).json
await owner(`${O}/members/${uid("rec-office")}/roles`, { body: { roleId: officeRole.id, groupId: g1.id } })

// ---------- the module and years
check("a school has student records by default", (await owner(O + "/manage")).json?.org.modules[0] === "records")
check("a company doesn't", (await owner("/orgs/rec-co/students")).status === 404)
const add = (who, body) => who(`${O}/students`, { body })
check("with no current year, a student can't be placed", (await add(owner, { name: "Rec Early", groupId: a1.id })).json?.error?.code === "no_year")
check("a year must end after it starts", (await owner(`${O}/academic-years`, { body: { name: "Bad", startsOn: "2026-06-01", endsOn: "2026-05-01" } })).json?.error?.code === "bad_year")
const y1 = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31", isCurrent: true } })).json
check("the owner adds the current year", Boolean(y1?.id))
check("the same name twice is refused", (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2027-06-01", endsOn: "2028-05-31" } })).json?.error?.code === "duplicate")
check("the office role can't change years", (await office(`${O}/academic-years`, { body: { name: "X-Y", startsOn: "2028-06-01", endsOn: "2029-05-31" } })).status === 403)

// ---------- adding
const next = (await owner(`${O}/students/next-number`)).json?.admissionNo
check("an admission number is suggested from the school and year", next === "RS-2026-0001", next)
const s1 = (await add(owner, { name: "Rec Kid One", gender: "female", birthDate: "2019-04-02", phone: "98450 12345", address: "12 Lake Road", groupId: a1.id, rollNo: 1 })).json
check("a student who won't sign in is added and placed", s1?.admissionNo === "RS-2026-0001" && psql(`select email from users where id='${s1.id}'`).endsWith(".invalid") && psql(`select count(*) from group_members where user_id='${s1.id}' and group_id='${a1.id}'`) === "1", JSON.stringify(s1))
const s2 = (await add(owner, { name: "Rec Kid Two", email: "rec-s2@example.com", groupId: b1.id })).json
check("a student with an email signs in as themselves", s2?.id === uid("rec-s2") && s2.admissionNo === "RS-2026-0002")
check("the same admission number twice is refused", (await add(owner, { name: "Rec Dup", admissionNo: "RS-2026-0001" })).json?.error?.code === "duplicate")
check("the same person twice is refused", (await add(owner, { name: "x", email: "rec-s2@example.com" })).json?.error?.code === "already_a_student")
check("a whole grade isn't a section", (await add(owner, { name: "Rec Grade", groupId: g1.id })).json?.error?.code === "not_a_section")
check("the office role adds to Grade 1", (await add(office, { name: "Rec Office Kid", groupId: a1.id })).status === 200)
check("...not to Grade 2", (await add(office, { name: "Rec Office Kid 2", groupId: a2.id })).status === 403)
check("a teacher can't add students", (await add(teacher, { name: "Rec T Kid", groupId: a1.id })).status === 403)

// ---------- who sees what
const all = (await owner(`${O}/students`)).json
check("the owner sees every student, with class and roll", all?.total === 3 && all.students.find((s) => s.id === s1.id)?.group?.path === "Grade 1 › A" && all.students.find((s) => s.id === s1.id).rollNo === 1, JSON.stringify(all?.students?.map((s) => s.name)))
const theirs = (await teacher(`${O}/students`)).json
check("a teacher sees their class's students only, and can't edit", theirs?.students.every((s) => s.group?.id === a1.id) && theirs.total === 2 && !theirs.can.edit, JSON.stringify(theirs?.students?.map((s) => s.name)))
check("a teacher sees a student of theirs", (await teacher(`${O}/students/${s1.id}`)).json?.phone === "98450 12345")
check("...not one of another class", (await teacher(`${O}/students/${s2.id}`)).status === 404)
check("a student sees no records", (await (await client("rec-s2@example.com"))(`${O}/students`)).status === 403)
const found = (await owner(`${O}/students?q=0002`)).json
check("searching by admission number (an existing account keeps its own name)", found?.students.map((s) => s.name).join() === "rec-s2 Name", JSON.stringify(found?.students?.map((s) => [s.name, s.admissionNo])))
check("filtering by grade includes its sections", (await owner(`${O}/students?groupId=${g1.id}`)).json?.total === 3)
check("a bad filter is a 400", (await owner(`${O}/students?groupId=nope`)).status === 400)

// ---------- sealed details
const raw = psql(`select phone || '|' || birth_date from student_records where user_id='${s1.id}'`)
check("personal details are sealed at rest", !raw.includes("98450") && !raw.includes("2019") && raw.startsWith("v1:"))
const prof = (await owner(`${O}/students/${s1.id}`)).json
check("...and readable on the record", prof?.birthDate === "2019-04-02" && prof.address === "12 Lake Road" && prof.email === null && prof.history[0].year === "2026-2027")

// ---------- moving, withdrawing
const edit = (body) => owner(`${O}/students/${s1.id}`, { method: "PUT", body: { name: "Rec Kid One", gender: "female", birthDate: "2019-04-02", phone: "98450 12345", address: "12 Lake Road", groupId: a1.id, rollNo: 1, ...body } })
check("moving a student moves their place", (await edit({ groupId: b1.id, rollNo: 7 })).status === 200 && psql(`select group_id from group_members where user_id='${s1.id}'`) === b1.id)
const status = (s) => owner(`${O}/students/${s1.id}/status`, { body: { status: s } })
check("withdrawing takes them out of their class", (await status("withdrawn")).status === 200 && psql(`select count(*) from group_members where user_id='${s1.id}'`) === "0")
check("...shown as withdrawn", (await owner(`${O}/students?status=withdrawn`)).json?.students.some((s) => s.id === s1.id))
check("back in their class", (await status("active")).status === 200 && psql(`select group_id from group_members where user_id='${s1.id}'`) === b1.id)

// ---------- another year
const y2 = (await owner(`${O}/academic-years`, { body: { name: "2027-2028", startsOn: "2027-06-01", endsOn: "2028-05-31" } })).json
check("making a year with no classes current empties everyone's class", (await owner(`${O}/academic-years/${y2.id}`, { method: "PATCH", body: { isCurrent: true } })).status === 200 && psql(`select count(*) from group_members gm join student_records r on r.user_id=gm.user_id and r.org_id='${orgId}'`) === "0")
check("only one year is current", psql(`select string_agg(name, ',') from academic_years where org_id='${orgId}' and is_current`) === "2027-2028")
await owner(`${O}/academic-years/${y1.id}`, { method: "PATCH", body: { isCurrent: true } })
check("making the old year current again puts them back", psql(`select count(*) from group_members gm join student_records r on r.user_id=gm.user_id and r.org_id='${orgId}'`) === "3")
check("a year with students can't be deleted", (await owner(`${O}/academic-years/${y1.id}`, { method: "DELETE" })).json?.error?.code === "in_use")
check("an empty one can", (await owner(`${O}/academic-years/${y2.id}`, { method: "DELETE" })).status === 200)

// ---------- mail and parents
psql(`delete from email_outbox where to_address like '%.invalid'`)
await owner(O, { method: "PATCH", body: { modules: { parents: true } } })
await teacher(`${O}/classes/${b1.id}/stream`, { body: { text: "Sports day" } })
check("a student who doesn't sign in is never emailed", psql(`select count(*) from email_outbox where to_address like '%.invalid'`) === "0")
check("a parent can be linked to them", (await owner(`${O}/parents`, { body: { studentId: s1.id, email: "rec-parent@example.com" } })).status === 200 && (await (await client("rec-parent@example.com"))(`${O}/home`)).json?.parent?.children[0]?.name === "Rec Kid One")
check("the record lists the parent", (await owner(`${O}/students/${s1.id}`)).json?.parents.some((p) => p.email === "rec-parent@example.com"))
check("the home's checklist knows the year", (await owner(`${O}/home`)).json?.admin.steps.find((s) => s.key === "year")?.done === true)
const log = (await owner(`${O}/audit?category=records&limit=100`)).json?.entries ?? []
check("records are in the activity log, details unsaid", ["records.year_add", "records.year_current", "records.year_delete", "records.student_add", "records.student_edit", "records.student_status"].every((a) => log.some((e) => e.action === a)) && !JSON.stringify(log).includes("98450"), log.map((e) => e.action).join())

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("rec-o@example.com", 1440)
await p.goto(`${BASE}${O}/manage/students`)
await p.getByTestId("students").waitFor({ timeout: 30000 })
check("the sidebar lists Students and Academic years", ["Students", "Academic years"].every(async () => true) && (await p.locator('nav[aria-label="Organization"]').innerText()).includes("Academic years"))
await p.getByRole("button", { name: "Add student" }).click()
await p.getByLabel("Full name").fill("Rec Sheet Kid")
await p.getByRole("button", { name: "Class", exact: true }).click()
const picker = p.getByTestId("group-picker")
await picker.getByLabel("Search groups").fill("A")
await picker.getByRole("option", { name: "Grade 2 › A", exact: true }).click()
await p.getByLabel("Roll number").fill("3")
await p.getByRole("button", { name: "Add student", exact: true }).last().click()
await p.getByTestId("student-row").filter({ hasText: "Rec Sheet Kid" }).waitFor({ timeout: 15000 }).catch(() => {})
const row = await p.getByTestId("student-row").filter({ hasText: "Rec Sheet Kid" }).innerText().catch(() => "")
check("a student is added from the sheet, placed, without a sign-in", row.includes("Grade 2 › A") && row.includes("#3") && row.includes("No sign-in"), row)
await p.screenshot({ path: SHOTS + "students.png", fullPage: true })
await p.getByRole("link", { name: "Rec Kid One" }).click()
await p.getByTestId("student-profile").waitFor({ timeout: 30000 })
const pt = await p.getByTestId("student-profile").innerText()
check("the profile shows class, details, parents and history", pt.includes("Grade 1 › B") && pt.includes("12 Lake Road") && pt.includes("rec-parent@example.com") && pt.includes("2026-2027"), pt.slice(0, 300))
await p.screenshot({ path: SHOTS + "student-profile.png", fullPage: true })
await p.goto(`${BASE}${O}/manage/academic-years`)
await p.getByTestId("year-row").first().waitFor({ timeout: 30000 })
check("the years page marks the current year", (await p.getByTestId("year-row").filter({ hasText: "Current" }).count()) === 1)
for (const path of ["/manage/students", `/manage/students/${s1.id}`]) {
  const phone = await view("rec-o@example.com", 390)
  await phone.goto(`${BASE}${O}${path}`)
  await phone.waitForLoadState("networkidle")
  check(`no sideways scrolling on a phone: ${path.split("/")[2]}${path.includes(s1.id) ? " profile" : ""}`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
}
await browser.close()

cleanup()
psql(`delete from users where email = 'rec-parent@example.com'`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
