/**
 * Links lead only where the person can go: the sidebar, home cards and buttons follow the
 * same rule as the API (a class teacher sees their class's members, not the school's
 * Roles); cards for switched-off modules aren't shown; a gradebook shows only the buttons
 * whose actions are allowed; a page that's refused or missing says so instead of loading
 * forever; the platform's writers and reviewers reach the pages their roles name.
 *   node e2e/access-links.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from assignments where slug like 'al-%'`)
  psql(`delete from organizations where slug in ('al-school','al-co')`)
  psql(`delete from platform_staff where user_id in (select id from users where email like 'al-%')`)
  psql(`delete from users where email like 'al-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["al-teacher", "al-student", "al-employee", "al-manager"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
for (const [h, r] of [["al-editor", "content_editor"], ["al-support", "support"]]) {
  psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','teacher','${h}')`)
  psql(`insert into platform_staff(user_id, system_role) select id, '${r}' from users where email='${h}@example.com'`)
}
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
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()

// ---------- a school: a class teacher, and work set for the whole school
await admin("/admin/organizations", { body: { name: "Al School", slug: "al-school", type: "school", ownerEmail: "al-o@example.com" } })
const O = "/orgs/al-school"
const orgId = psql(`select id from organizations where slug='al-school'`)
const owner = await client("al-o@example.com")
const cls = (await owner(`${O}/groups`, { body: { name: "Al 6-A" } })).json.id
const role = (key) => psql(`select id from org_roles where org_id='${orgId}' and system_key='${key}'`)
for (const h of ["al-teacher", "al-student"]) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
  psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid(h)}','${role("member")}')`)
}
psql(`insert into role_assignments(org_id,user_id,role_id,group_id) values ('${orgId}','${uid("al-teacher")}','${role("teacher")}','${cls}')`)
psql(`insert into group_members(group_id,user_id) values ('${cls}','${uid("al-student")}')`)
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing='everyone' order by slug limit 1`)
const work = (slug, audience) => ({ title: slug, slug, description: "", opensAt: days(-1), dueAt: days(3), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience, problems: [{ problemId: problem, points: 100, rubric: [], outcomes: [] }], questions: [] })
const mine = (await owner(`${O}/assignments`, { body: work("al-class", [[cls]]) })).json?.id
const school = (await owner(`${O}/assignments`, { body: work("al-school-wide", []) })).json?.id
check("the owner set work for the class and for the whole school", Boolean(mine && school))

const teacher = await client("al-teacher@example.com")
const shell = (await teacher(`${O}/shell`)).json
check("a class teacher sees members in their class, not across the school", shell?.permissions.includes("org.members.view") && !shell.wholeOrg.includes("org.members.view"), JSON.stringify(shell?.wholeOrg))
check("...so their members page can read the role names", (await teacher(`${O}/roles`)).status === 200)
const list = (await teacher(`${O}/assignments`)).json ?? []
check("the assignments list says which ones they may edit", list.find((a) => a.id === mine)?.canEdit === true && list.find((a) => a.id === school)?.canEdit === false, JSON.stringify(list.map((a) => [a.slug, a.canEdit])))
check("...and the school-wide one's editor stays closed to them", (await teacher(`${O}/assignments/${school}`)).status === 403)
const book = (await teacher(`${O}/assignments/${school}/gradebook`)).json
check("its gradebook offers no edit, peer panel or LMS sending", book?.can && !book.can.edit && !book.can.peer && !book.can.sendGrades, JSON.stringify(book?.can))
const ownBook = (await teacher(`${O}/assignments/${mine}/gradebook`)).json
check("their own class's gradebook offers editing", ownBook?.can?.edit === true && ownBook.can.peer === true)

// ---------- a company: no attendance or timetable
await admin("/admin/organizations", { body: { name: "Al Co", slug: "al-co", type: "company", ownerEmail: "al-co-o@example.com" } })
const coId = psql(`select id from organizations where slug='al-co'`)
const co = await client("al-co-o@example.com")
const team = (await co(`/orgs/al-co/groups`, { body: { name: "Al Team" } })).json.id
const coRole = (key) => psql(`select id from org_roles where org_id='${coId}' and system_key='${key}'`)
for (const h of ["al-employee", "al-manager"]) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${coId}','${uid(h)}','active','created')`)
  psql(`insert into role_assignments(org_id,user_id,role_id) values ('${coId}','${uid(h)}','${coRole("member")}')`)
}
psql(`insert into role_assignments(org_id,user_id,role_id,group_id) values ('${coId}','${uid("al-manager")}','${coRole("teacher")}','${team}')`)
psql(`insert into group_members(group_id,user_id) values ('${team}','${uid("al-employee")}')`)
const coModules = (await co(`/orgs/al-co/shell`)).json?.modules ?? []
check("the company has no attendance or timetable", !coModules.includes("attendance") && !coModules.includes("timetable"), coModules.join())

// ---------- the platform: writers and reviewers reach their pages
const editor = await client("al-editor@example.com")
check("a content editor (create and edit, not manage) opens the problem bank", (await editor("/admin/problems")).status === 200 && (await editor("/admin/questions")).status === 200 && (await editor("/admin/library")).status === 200)
const support = await client("al-support@example.com")
check("Support (submissions) opens the plagiarism check's lists", (await support("/admin/problems")).status === 200 && (await support("/admin/contests")).status === 200)
check("...but still can't write problems", (await support("/admin/problems", { body: {} })).status === 403)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await token(email), domain: new URL(BASE).hostname, path: "/" }])
  const page = await ctx.newPage()
  const refused = []
  page.on("response", (r) => { if (r.url().includes("/api/v1/") && [403, 404].includes(r.status())) refused.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  return { page, refused }
}
const nav = (p) => p.getByRole("navigation", { name: "Organization" })

{
  const { page, refused } = await view("al-teacher@example.com")
  await page.goto(`${BASE}${O}`)
  await nav(page).waitFor({ timeout: 30000 })
  const items = await nav(page).innerText()
  check("the class teacher's sidebar has Members but not Roles", items.includes("Members") && !items.includes("Roles"), items.replace(/\s+/g, " "))
  await page.goto(`${BASE}${O}/manage/members`)
  await page.getByText("al-student Name").first().waitFor({ timeout: 30000 })
  check("...and their members page loads with nothing refused", refused.length === 0, refused.join())
  await page.goto(`${BASE}${O}/manage/assignments`)
  await page.getByRole("link", { name: "al-school-wide" }).waitFor({ timeout: 30000 })
  check("...the school-wide assignment links to its gradebook", (await page.getByRole("link", { name: "al-school-wide" }).getAttribute("href"))?.endsWith(`/assignments/${school}/grades`))
  await page.getByRole("link", { name: "al-school-wide" }).click()
  await page.getByText("Gradebook: al-school-wide").waitFor({ timeout: 30000 })
  check("...whose gradebook has no Edit button and refuses nothing", (await page.getByRole("link", { name: "Edit", exact: true }).count()) === 0 && refused.length === 0, refused.join())
  await page.goto(`${BASE}${O}/manage`)
  await page.waitForURL((u) => u.pathname === O, { timeout: 30000 })
  check("the old manage overview goes to the organization's home", new URL(page.url()).pathname === O)
  await page.goto(`${BASE}${O}/manage/invites`)
  await page.getByTestId("error-view").waitFor({ timeout: 30000 })
  check("a page their role doesn't open says so instead of loading forever", (await page.getByTestId("error-view").getAttribute("data-status")) === "403" && (await page.getByText("You don't have access to this").count()) === 1)
  await page.context().close()
}
{
  const { page, refused } = await view("al-employee@example.com")
  await page.goto(`${BASE}/orgs/al-co`)
  await page.getByTestId("student-home").waitFor({ timeout: 30000 })
  await page.waitForLoadState("networkidle")
  const text = await page.getByTestId("student-home").innerText()
  check("an employee's home has no attendance or timetable, and refuses nothing", !text.includes("Attendance") && !text.includes("timetable") && refused.length === 0, refused.join() + " | " + text.slice(0, 200))
  check("...and speaks of teams, not classes", text.includes("My teams") && !/\bclasses\b/.test(text))
  await page.context().close()
}
{
  const { page, refused } = await view("al-manager@example.com")
  await page.goto(`${BASE}/orgs/al-co`)
  await page.getByTestId("teacher-home").waitFor({ timeout: 30000 })
  await page.waitForLoadState("networkidle")
  check("a manager's home has no timetable day, registers or My week", (await page.getByTestId("my-day").count()) === 0 && (await page.getByText("Registers to take").count()) === 0 && (await page.getByRole("link", { name: /My week/ }).count()) === 0 && refused.length === 0, refused.join())
  await page.context().close()
}
{
  const { page } = await view("al-support@example.com")
  await page.goto(`${BASE}/admin`)
  await page.getByTestId("admin-overview").waitFor({ timeout: 30000 })
  check("Support's overview offers no New problem, New contest or notices", (await page.getByRole("link", { name: "New problem" }).count()) === 0 && (await page.getByRole("link", { name: "New contest" }).count()) === 0 && (await page.getByRole("link", { name: "Post a notice" }).count()) === 0)
  await page.context().close()
}
{
  const { page } = await view("al-student@example.com")
  await page.goto(`${BASE}/orgs/no-such-place-al`)
  await page.getByTestId("error-view").waitFor({ timeout: 30000 })
  check("an organization that doesn't exist shows Not found", (await page.getByTestId("error-view").getAttribute("data-status")) === "404")
  await page.context().close()
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
