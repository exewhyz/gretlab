/**
 * Platform staff and roles: who may do what on the platform dashboard, and the rules that
 * keep it safe (no granting beyond your own permissions, owners, ADMIN_EMAILS, the log).
 *   node e2e/platform.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()

const cleanup = () => {
  psql(`delete from platform_staff where user_id in (select id from users where email like 'plat-%')`)
  psql(`delete from platform_roles where name like 'plat %'`)
  psql(`delete from users where email like 'plat-%'`)
}
cleanup()
// A legacy teacher (account role teacher, no platform role yet), a student, and others.
for (const [email, role] of [["plat-teacher@example.com", "teacher"], ["plat-a@example.com", "student"], ["plat-b@example.com", "student"], ["plat-c@example.com", "student"]]) {
  psql(`insert into users(email,name,role,handle) values ('${email}','${email.split("@")[0]}','${role}','${email.split("@")[0]}')`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [owner, teacher, a, b, c] = await Promise.all(["admin@example.com", "plat-teacher@example.com", "plat-a@example.com", "plat-b@example.com", "plat-c@example.com"].map(client))
const give = (api, email, role) => api("/admin/staff", { method: "PUT", body: { email, role } })
const can = async (api, path) => (await api(path)).status === 200

// ---------- who is what
const me = (await owner("/me")).json.user.platform
check("ADMIN_EMAILS are owners", me.owner && me.role === "Owner" && me.permissions.length >= 10 && ["platform.work.manage", "platform.work.grade"].every((x) => me.permissions.includes(x)))
check("a teacher from before roles is a Content admin", (await teacher("/me")).json.user.platform.role === "Content admin")
check("students have no platform access", (await a("/me")).json.user.platform.permissions.length === 0 && (await a("/admin/problems")).status === 403)
check("a Content admin works on the library", await can(teacher, "/admin/problems") && await can(teacher, "/admin/questions") && await can(teacher, "/admin/assignments"))
check("but not settings, users, colleges or staff", !(await can(teacher, "/admin/settings")) && !(await can(teacher, "/admin/users")) && !(await can(teacher, "/admin/organizations")) && !(await can(teacher, "/admin/staff")))

// ---------- built-in roles
check("an owner gives a role, even to someone new to the site", (await give(owner, "plat-new@example.com", "reviewer")).status === 200 && psql(`select role from users where email='plat-new@example.com'`) === "teacher")
const fresh = await client("plat-new@example.com")
check("a Reviewer sees grades and submissions", await can(fresh, "/admin/assignments") && await can(fresh, "/admin/submissions"))
check("and changes nothing", !(await can(fresh, "/admin/problems")) && (await fresh("/admin/assignments", { body: {} })).status === 403)
await give(owner, "plat-a@example.com", "support")
check("Support manages users and colleges, not content", await can(a, "/admin/users") && await can(a, "/admin/organizations") && !(await can(a, "/admin/problems")))
check("access changes at once", (await give(owner, "plat-new@example.com", "content_admin")).status === 200 && await can(fresh, "/admin/problems"))

// ---------- custom roles and the rules
const helper = await owner("/admin/roles", { body: { name: "plat Library helper", description: "Writes questions.", permissions: ["platform.library.manage"] } })
check("an owner makes a custom role", helper.status === 200, JSON.stringify(helper.json).slice(0, 120))
await give(owner, "plat-b@example.com", helper.json.id)
check("someone with it has exactly that", await can(b, "/admin/questions") && !(await can(b, "/admin/assignments")) && (await b("/me")).json.user.platform.role === "plat Library helper")
const manager = await owner("/admin/roles", { body: { name: "plat Role manager", permissions: ["platform.roles.manage", "platform.library.manage"] } })
await give(owner, "plat-c@example.com", manager.json.id)
check("a role manager can't make owners", (await give(c, "plat-teacher@example.com", "owner")).status === 403)
check("or give roles with permissions they don't hold", (await give(c, "plat-teacher@example.com", "content_admin")).status === 403)
check("but can give ones within theirs", (await give(c, "plat-teacher@example.com", helper.json.id)).status === 200)
check("nor make a role beyond theirs", (await c("/admin/roles", { body: { name: "plat Sneaky", permissions: ["platform.settings.manage"] } })).status === 403)
check("built-in roles can't be changed", (await owner("/admin/roles/owner", { method: "PUT", body: { name: "Boss", permissions: [] } })).status === 403)
check("a role people hold can't be deleted", (await owner(`/admin/roles/${helper.json.id}`, { method: "DELETE" })).json?.error?.code === "role_in_use")
check("owners from ADMIN_EMAILS can't be removed here", (await owner(`/admin/staff/${psql("select id from users where email='admin@example.com'")}`, { method: "DELETE" })).json?.error?.code === "admin_email")
check("support can't block someone with more access", (await a(`/admin/users/${psql("select id from users where email='admin@example.com'")}`, { method: "PATCH", body: { disabled: true } })).status === 403)
check("the users page no longer changes roles", (await owner(`/admin/users/${psql("select id from users where email='plat-b@example.com'")}`, { method: "PATCH", body: { role: "admin" } })).status === 400)
const removed = await owner(`/admin/staff/${psql("select id from users where email='plat-new@example.com'")}`, { method: "DELETE" })
check("removing staff takes access away at once", removed.status === 200 && !(await can(fresh, "/admin/problems")) && psql(`select role from users where email='plat-new@example.com'`) === "student")
const staffList = (await owner("/admin/staff")).json
check("the staff list says how each got access", staffList.find((s) => s.email === "admin@example.com")?.source === "admin_emails" && staffList.find((s) => s.email === "plat-b@example.com")?.source === "role")

// ---------- the activity log
const log = (await owner("/admin/activity")).json
check("every change is in the activity log", log.some((e) => e.summary === "Gave plat-new@example.com the Reviewer role") && log.some((e) => e.summary === "Removed plat-new@example.com from platform staff") && log.some((e) => e.summary.startsWith("Created the plat Library helper")))
check("only for those allowed to see it", (await b("/admin/activity")).status === 403 && (await a("/admin/activity")).status === 200)

// ---------- the pages
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const helperPage = await open("plat-b@example.com")
await helperPage.goto(`${BASE}/admin`)
const nav = helperPage.getByRole("navigation", { name: "Dashboard" })
await nav.waitFor({ timeout: 30000 })
await helperPage.waitForTimeout(500)
const items = await nav.innerText()
check("the dashboard shows only what the role allows", items.includes("Questions") && !items.includes("Assignments") && !items.includes("Settings") && !items.includes("Staff and roles"), items.replace(/\n/g, " | "))
const ownerPage = await open("admin@example.com")
await ownerPage.goto(`${BASE}/admin/staff`)
await ownerPage.getByTestId("staff-row").first().waitFor({ timeout: 30000 })
check("owners see Staff and roles", (await ownerPage.getByTestId("staff-row").count()) >= 4)
await ownerPage.screenshot({ path: SHOTS + "staff.png", fullPage: true })
await ownerPage.getByRole("tab", { name: /Roles/ }).click()
await ownerPage.getByTestId("role-row").first().waitFor({ timeout: 15000 })
check("and the roles, built in and custom", (await ownerPage.getByTestId("role-row").filter({ hasText: "Built in" }).count()) === 4 && (await ownerPage.getByTestId("role-row").filter({ hasText: "plat Library helper" }).count()) === 1)
await ownerPage.screenshot({ path: SHOTS + "roles.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
