/**
 * Promotion and import: importing students from a spreadsheet (a preview that refuses bad
 * lines, then all at once; dates read day-first; scoped roles); records for people
 * already in classes (staff left out); promoting a year (suggested destinations, the top
 * grade graduating, a student held back or leaving, graduates leaving their classes now,
 * nobody moving until the new year is current, running it again skipping everyone); who
 * may; the log; the pages, on a phone too.
 *   node e2e/promotion.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug = 'pro-school'`)
  psql(`delete from users where email like 'pro-%' or (email like 'no-login+%' and name like 'Pro %')`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["pro-o", "pro-t", "pro-office", "pro-e1", "pro-old1", "pro-old2"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Pro ${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Pro School", slug: "pro-school", type: "school", ownerEmail: "pro-o@example.com" } })
const O = "/orgs/pro-school", orgId = psql(`select id from organizations where slug='pro-school'`)
const [owner, teacher, office] = await Promise.all(["pro-o", "pro-t", "pro-office"].map((h) => client(`${h}@example.com`)))
const G = {}
for (const grade of ["Grade 1", "Grade 2", "Grade 3"]) {
  G[grade] = (await owner(`${O}/groups`, { body: { name: grade } })).json
  for (const sec of grade === "Grade 3" ? ["A"] : ["A", "B"]) G[`${grade} › ${sec}`] = (await owner(`${O}/groups`, { body: { name: sec, parentId: G[grade].id } })).json
}
for (const h of ["pro-t", "pro-office", "pro-old1", "pro-old2"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("pro-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: G["Grade 2 › A"].id } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Grade 1 office", permissions: ["students.edit"] } })).json
await owner(`${O}/members/${uid("pro-office")}/roles`, { body: { roleId: officeRole.id, groupId: G["Grade 1"].id } })
const y1 = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31", isCurrent: true } })).json
const y2 = (await owner(`${O}/academic-years`, { body: { name: "2027-2028", startsOn: "2027-06-01", endsOn: "2028-05-31" } })).json

// ---------- import
const row = (o) => ({ name: "", email: "", admissionNo: "", gender: "", birthDate: "", phone: "", address: "", class: "", rollNo: "", ...o })
const rows = [
  row({ name: "Pro Kid A1", gender: "F", birthDate: "02/04/2019", class: "Grade 1 / A", rollNo: "1", phone: "98450 11111" }),
  row({ name: "Pro Kid A2", email: "pro-e1@example.com", gender: "male", class: "grade 1 › a", rollNo: "2" }),
  row({ name: "Pro Kid B1", class: "Grade 1 / B" }),
  row({ name: "Pro Kid 2A", class: "Grade 2 / A" }),
  row({ name: "Pro Kid 2B", class: "Grade 2 / B" }),
  row({ name: "Pro Kid 3A", class: "Grade 3 / A" }),
  row({ name: "Pro Bad Class", class: "Grade 9 / A" }),
  row({ name: "Pro Whole Grade", class: "Grade 1" }),
  row({ name: "Pro Bad Gender", gender: "x" }),
  row({ name: "Pro Bad Date", birthDate: "yesterday" }),
  row({ name: "", class: "Grade 1 / A" }),
  row({ name: "Pro Dup No", admissionNo: "PS-2026-0001" }),
]
const preview = (await owner(`${O}/students/import`, { body: { rows } })).json
check("a preview adds the good lines and explains the rest", preview?.summary.add === 6 && preview.summary.error === 6 && preview.rows[6].note.includes('No class "Grade 9 / A"') && preview.rows[7].note.includes("section") && preview.rows[11].note.includes("already used"), JSON.stringify(preview?.rows?.map((r) => r.note)))
check("...and adds nothing yet", psql(`select count(*) from student_records where org_id='${orgId}'`) === "0")
const done = (await owner(`${O}/students/import`, { body: { rows: rows.slice(0, 6), commit: true } })).json
check("committing adds them all, numbered in order", done?.committed && done.summary.add === 6 && psql(`select string_agg(admission_no, ',' order by admission_no) from student_records where org_id='${orgId}'`) === "PS-2026-0001,PS-2026-0002,PS-2026-0003,PS-2026-0004,PS-2026-0005,PS-2026-0006")
const a1 = psql(`select u.id from users u where u.name='Pro Kid A1'`)
check("a day-first date is read, and sealed", !psql(`select birth_date from student_records where user_id='${a1}'`).includes("2019") && (await owner(`${O}/students/${a1}`)).json?.birthDate === "2019-04-02")
check("they're placed in their classes", psql(`select count(*) from group_members gm join student_records r on r.user_id = gm.user_id and r.org_id='${orgId}'`) === "6")
check("someone already a student can't be imported again", (await owner(`${O}/students/import`, { body: { rows: [row({ name: "x", email: "pro-e1@example.com" })] } })).json?.rows[0].note.includes("already has"))
const scoped = (await office(`${O}/students/import`, { body: { rows: [row({ name: "Pro Office 1", class: "Grade 1 / A" }), row({ name: "Pro Office 2", class: "Grade 2 / A" })] } })).json
check("a grade-scoped role imports into its grade only", scoped?.summary.add === 1 && scoped.rows[1].note.includes("can't add"))
check("a teacher can't import", (await teacher(`${O}/students/import`, { body: { rows: [row({ name: "x" })] } })).status === 403)

// ---------- people already in classes
for (const h of ["pro-old1", "pro-old2", "pro-t"]) psql(`insert into group_members(group_id,user_id) values ('${G["Grade 2 › A"].id}','${uid(h)}') on conflict do nothing`)
check("people in a class with no record are counted, staff left out", (await owner(`${O}/students/unrecorded`)).json?.count === 2)
check("records are created for them", (await owner(`${O}/students/unrecorded`, { method: "POST" })).json?.added === 2 && psql(`select count(*) from enrolments where user_id in ('${uid("pro-old1")}','${uid("pro-old2")}') and year_id='${y1.id}'`) === "2")
check("...and none are left", (await owner(`${O}/students/unrecorded`)).json?.count === 0)

// ---------- promotion
const plan = (await owner(`${O}/academic-years/promotion?from=${y1.id}&to=${y2.id}`)).json
const sug = Object.fromEntries((plan?.sections ?? []).map((s) => [s.path, s.suggested]))
check("each class is suggested the next grade's same section", sug["Grade 1 › A"] === G["Grade 2 › A"].id && sug["Grade 1 › B"] === G["Grade 2 › B"].id && sug["Grade 2 › A"] === G["Grade 3 › A"].id && sug["Grade 2 › B"] === G["Grade 3 › A"].id, JSON.stringify(sug))
check("the top grade graduates", sug["Grade 3 › A"] === "graduate")
const sections = Object.fromEntries(plan.sections.map((s) => [s.groupId, s.suggested]))
const heldBack = psql(`select id from users where name='Pro Kid B1'`), leaving = psql(`select id from users where name='Pro Kid 2B'`)
const body = (apply, extra = {}) => ({ fromYearId: y1.id, toYearId: y2.id, sections, exceptions: { [heldBack]: "repeat", [leaving]: "withdraw" }, apply, ...extra })
check("a teacher can't promote", (await teacher(`${O}/academic-years/promotion`, { body: body(false) })).status === 403)
const counts = (await owner(`${O}/academic-years/promotion`, { body: body(false) })).json?.counts
check("a preview counts who moves, stays, graduates and leaves", counts?.moved === 5 && counts.repeated === 1 && counts.graduated === 1 && counts.withdrawn === 1 && counts.skipped === 0, JSON.stringify(counts))
check("...and changes nothing", psql(`select count(*) from enrolments where year_id='${y2.id}'`) === "0")
const applied = (await owner(`${O}/academic-years/promotion`, { body: body(true) })).json
check("promoting enrols everyone in the new year", applied?.applied && psql(`select count(*) from enrolments where year_id='${y2.id}'`) === "6")
check("the held-back student keeps their class", psql(`select group_id from enrolments where year_id='${y2.id}' and user_id='${heldBack}'`) === G["Grade 1 › B"].id)
const grad = psql(`select id from users where name='Pro Kid 3A'`)
check("graduates and leavers are marked, and leave their classes now", psql(`select status from enrolments where year_id='${y1.id}' and user_id='${grad}'`) === "graduated" && psql(`select count(*) from group_members where user_id in ('${grad}','${leaving}')`) === "0")
check("everyone else stays put until the new year is current", psql(`select group_id from group_members where user_id='${a1}'`) === G["Grade 1 › A"].id)
check("running it again skips everyone", (await owner(`${O}/academic-years/promotion`, { body: body(true) })).json?.counts.skipped === 6)
await owner(`${O}/academic-years/${y2.id}`, { method: "PATCH", body: { isCurrent: true } })
check("making the new year current moves them up", psql(`select group_id from group_members where user_id='${a1}'`) === G["Grade 2 › A"].id)
const log = (await owner(`${O}/audit?category=records&limit=100`)).json?.entries ?? []
check("import, records and promotion are in the log", ["records.import", "records.adopt", "records.promote"].every((a) => log.some((e) => e.action === a)), log.map((e) => e.action).join())

// ---------- the pages
await owner(`${O}/academic-years/${y1.id}`, { method: "PATCH", body: { isCurrent: true } })
psql(`delete from enrolments where year_id='${y2.id}'`)
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("pro-o@example.com", 1440)
await p.goto(`${BASE}${O}/manage/academic-years`)
await p.getByRole("link", { name: "Promote students" }).click()
await p.getByTestId("promotion-row").first().waitFor({ timeout: 30000 })
check("the wizard lists each class with its suggested destination", (await p.getByLabel("Grade 2 › A goes to").inputValue()) === G["Grade 3 › A"].id && (await p.getByLabel("Grade 1 › A goes to").inputValue()) === G["Grade 2 › A"].id)
await p.getByRole("button", { name: "Preview" }).click()
await p.getByTestId("promotion-preview").waitFor({ timeout: 15000 })
check("the preview says what will happen", (await p.getByTestId("promotion-preview").innerText()).includes("move up"))
await p.getByRole("button", { name: "Promote", exact: true }).click()
await p.getByRole("alertdialog").getByRole("button", { name: "Promote" }).click()
await p.getByTestId("promotion-done").waitFor({ timeout: 15000 })
check("promoting from the page", psql(`select count(*) from enrolments where year_id='${y2.id}'`) !== "0")
await p.screenshot({ path: SHOTS + "promotion.png", fullPage: true })
psql(`insert into group_members(group_id,user_id) values ('${G["Grade 1 › A"].id}','${uid("pro-e1")}') on conflict do nothing`)
psql(`delete from student_records where user_id='${uid("pro-e1")}'`)
await p.goto(`${BASE}${O}/manage/students`)
await p.getByTestId("unrecorded").waitFor({ timeout: 30000 })
await p.getByTestId("unrecorded").getByRole("button", { name: "Create records" }).click()
await p.getByRole("alertdialog").getByRole("button", { name: "Create records" }).click()
await p.getByTestId("unrecorded").waitFor({ state: "detached", timeout: 15000 }).catch(() => {})
check("records are created from the banner", psql(`select count(*) from student_records where user_id='${uid("pro-e1")}'`) === "1")
await p.getByRole("button", { name: "Import" }).click()
await p.getByLabel("Or paste the CSV").fill("name,gender,date of birth,class,roll\nPro Page Kid,F,05/06/2019,Grade 1 / B,9\nPro Page Bad,,,Grade 9 / Z,\n")
await p.getByRole("button", { name: /Check 2 lines/ }).click()
await p.getByTestId("import-report").waitFor({ timeout: 15000 })
check("the import dialog previews each line", (await p.getByTestId("import-line").count()) === 2 && (await p.getByTestId("import-report").innerText()).includes("1 to add, 1 with problems"))
await p.getByRole("button", { name: "Add 1 students" }).click()
await p.getByText("Added 1 students.").waitFor({ timeout: 15000 })
check("...and adds the good ones", psql(`select count(*) from users where name='Pro Page Kid'`) === "1")
const phone = await view("pro-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/academic-years/promote`)
await phone.getByTestId("promotion").waitFor({ timeout: 30000 })
await phone.waitForLoadState("networkidle")
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
