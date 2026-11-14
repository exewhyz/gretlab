/**
 * Kinds of organization: each kind starts with its own structure and role names; the kind
 * can't be changed after creation; modules are limited to what the kind can support; the
 * platform decides each kind's modules (off, optional, on from the start), applied to its
 * organizations at once, by staff allowed to; each kind's words in the frame and homes; the
 * create form explains the kind and asks to confirm; the admin's kinds page.
 *   node e2e/org-kinds.mjs [base-url] [screenshot-dir]
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
const KINDS = ["school", "college", "coaching", "cohort", "company", "community", "other"]
const cleanup = () => {
  psql(`delete from organizations where slug like 'ok-%'`)
  psql(`delete from org_kind_policies`)
  psql(`delete from users where email like 'ok-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('ok-helper@example.com','Ok Helper','teacher','ok-helper')`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const helper = await client("ok-helper@example.com")
for (const k of KINDS) await admin("/admin/organizations", { body: { name: `Ok ${k}`, slug: `ok-${k}`, type: k, ownerEmail: "ok-o@example.com" } })
const owner = await client("ok-o@example.com")
const summary = async (k) => (await owner(`/orgs/ok-${k}/manage`)).json

// ---------- each kind starts as itself
check("every kind can be created, coaching institutes too", KINDS.every((k) => psql(`select type from organizations where slug='ok-${k}'`) === k))
const levels = Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, (await summary(k))?.org.groupLevels.join(" › ")])))
check("each kind starts with its own levels", levels.school === "Grade › Section" && levels.college === "Department › Batch" && levels.coaching === "Course › Batch" && levels.cohort === "Cohort › Pod" && levels.company === "Department › Team", JSON.stringify(levels))
const roleNames = (k) => psql(`select string_agg(r.name, ',' order by r.system_key) from org_roles r join organizations o on o.id=r.org_id where o.slug='ok-${k}' and r.system_key is not null`)
check("roles carry the kind's names", roleNames("school") === "Admin,Member,Owner,Teacher" && roleNames("college") === "Admin,Member,Owner,Faculty" && roleNames("cohort") === "Program manager,Learner,Owner,Mentor" && roleNames("company") === "L&D admin,Employee,Owner,Manager", [roleNames("college"), roleNames("cohort"), roleNames("company")].join(" | "))
check("the summary says what the kind is, in its words", (await summary("cohort"))?.org.kind.terms.learners === "Learners" && (await summary("college"))?.org.kind.terms.instructors === "Faculty")

// ---------- the kind is fixed
const patch = (k, body) => owner(`/orgs/ok-${k}`, { method: "PATCH", body })
const locked = await patch("school", { type: "college" })
check("changing the kind is refused", locked.status === 409 && locked.json?.error?.code === "kind_locked", JSON.stringify(locked.json))
check("...even for a platform admin", (await admin(`/orgs/ok-school`, { method: "PATCH", body: { type: "cohort" } })).status === 409)
check("...and nothing changed", psql(`select type from organizations where slug='ok-school'`) === "school")
check("saving the same kind is fine", (await patch("school", { type: "school", description: "Same kind" })).status === 200)

// ---------- modules by kind
check("a kind can't have what it can't support", (await patch("cohort", { modules: { records: true } })).json?.error?.code === "module_unavailable")
check("a community offers only what it can run: the coding lab and events, on from the start", (await summary("community"))?.org.moduleOptions.map((o) => `${o.key}:${o.level}`).join() === "coding:default,events:default")
const collegeOpts = (await summary("college"))?.org.moduleOptions ?? []
check("a college's parents module is optional, its records on from the start", collegeOpts.find((o) => o.key === "parents")?.level === "optional" && collegeOpts.find((o) => o.key === "records")?.level === "default", JSON.stringify(collegeOpts))
check("a college starts without parent accounts, a school with them", !(await summary("college"))?.org.modules.includes("parents") && (await summary("school"))?.org.modules.includes("parents"))

// ---------- the platform decides per kind
const kinds = (await admin("/admin/kinds")).json
check("the admin sees every kind with its modules", kinds?.kinds.map((k) => k.key).join() === KINDS.join() && kinds.kinds.find((k) => k.key === "company")?.levels.records === null, JSON.stringify(kinds?.kinds?.map((k) => k.key)))
check("platform staff without the permission can't", (await helper("/admin/kinds")).status === 403 && (await helper("/admin/kinds/school", { method: "PUT", body: { modules: { library: "off" } } })).status === 403)
check("a module a kind can't support can't be allowed", (await admin("/admin/kinds/company", { method: "PUT", body: { modules: { records: "default" } } })).status === 400)
check("an unknown kind is refused", (await admin("/admin/kinds/zoo", { method: "PUT", body: { modules: {} } })).status === 404)
await patch("school", { modules: { library: true } })
check("a school switches the library on", (await summary("school"))?.org.modules.includes("library"))
await admin("/admin/kinds/school", { method: "PUT", body: { modules: { library: "off" } } })
check("switched off for schools, it's off for every school at once", !(await summary("school"))?.org.modules.includes("library") && (await owner("/orgs/ok-school/books")).status === 404)
check("...and can't be switched back on", (await patch("school", { modules: { library: true } })).json?.error?.code === "module_unavailable")
await admin("/admin/kinds/college", { method: "PUT", body: { modules: { parents: "default" } } })
check("made on from the start for colleges, colleges have it", (await summary("college"))?.org.modules.includes("parents"))
check("...unless a college turned it off itself", (await patch("college", { modules: { parents: false } })).status === 200 && !(await summary("college"))?.org.modules.includes("parents"))
check("the platform's choices are in its log", psql(`select count(*) from audit_log where org_id is null and action='platform.kind_policy'`) === "2")

// ---------- words
const shell = async (k) => (await owner(`/orgs/ok-${k}/shell`)).json
check("the frame speaks the kind's language", (await shell("cohort"))?.terms.groups === "Cohorts" && (await shell("coaching"))?.noun === "institute" && (await shell("company"))?.noun === "company")
check("the home does too", (await owner("/orgs/ok-college/home")).json?.terms.instructors === "Faculty")

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const a = await view("admin@example.com", 1440)
await a.goto(`${BASE}/admin/organizations`)
await a.getByTestId("kind-picker").waitFor({ timeout: 30000 })
await a.getByLabel("Name").fill("Ok Made College")
await a.getByLabel("Owner's email").fill("ok-o@example.com")
await a.getByTestId("kind-college").click()
check("choosing a kind shows what it decides", (await a.getByTestId("kind-decides").innerText()).includes("faculty advisor"))
check("...and creating waits for the warning to be confirmed", await a.getByRole("button", { name: "Create organization" }).isDisabled())
await a.getByRole("checkbox", { name: /I understand this will be a college/ }).click()
await a.getByRole("button", { name: "Create organization" }).click()
await a.getByText("Created Ok Made College").waitFor({ timeout: 15000 })
check("the admin creates a college from the page", psql(`select type from organizations where slug='ok-made-college'`) === "college")
await a.screenshot({ path: SHOTS + "kind-picker.png", fullPage: true })
await a.goto(`${BASE}/admin/kinds`)
await a.getByTestId("admin-kinds").waitFor({ timeout: 30000 })
await a.getByRole("tab", { name: "Cohort program" }).click()
await a.getByLabel("Leave for Cohort program").selectOption("default")
await a.waitForResponse((r) => r.url().includes("/admin/kinds/cohort") && r.request().method() === "PUT")
check("the kinds page sets a module for a kind", (await admin("/admin/kinds")).json?.kinds.find((k) => k.key === "cohort")?.levels.leave === "default")
check("...showing what each kind can't have", (await a.getByRole("row", { name: /^Student records/ }).innerText()).includes("Not for this kind"))
await a.screenshot({ path: SHOTS + "admin-kinds.png", fullPage: true })
const o = await view("ok-o@example.com", 1440)
await o.goto(`${BASE}/orgs/ok-school/manage/settings`)
await o.getByTestId("org-kind").waitFor({ timeout: 30000 })
check("Settings shows the kind, without a way to change it", (await o.getByTestId("org-kind").inputValue()) === "School" && (await o.getByTestId("org-kind").getAttribute("readonly")) !== null)
await o.goto(`${BASE}/orgs/ok-cohort`)
const nav = o.getByRole("navigation", { name: "Organization" })
await nav.waitFor({ timeout: 30000 })
check("a cohort program's frame says program, not school", (await nav.innerText()).includes("About the program") && !(await nav.innerText()).includes("school"), (await nav.innerText()).replace(/\n/g, " | "))
await browser.close()

// Put the kinds back through the API, so the server's cached policies are cleared too.
await admin("/admin/kinds/school", { method: "PUT", body: { modules: { library: "optional" } } })
await admin("/admin/kinds/college", { method: "PUT", body: { modules: { parents: "optional" } } })
await admin("/admin/kinds/cohort", { method: "PUT", body: { modules: { leave: "optional" } } })
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
