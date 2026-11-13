/**
 * The header's Learn and Teach: Teach starts where each person's teaching side is (their
 * classes if they teach, the organizations they help run if they're staff who don't teach,
 * the platform's dashboard for platform staff), Teach doesn't list the playground (Learn
 * does), and students have no Teach at all.
 *   node e2e/teach-mode.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug='tm-school'`)
  psql(`delete from platform_staff where user_id in (select id from users where email like 'tm-%')`)
  psql(`delete from users where email like 'tm-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["tm-teacher", "tm-librarian", "tm-student"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
psql(`insert into users(email,name,role,handle) values ('tm-support@example.com','Support','teacher','tm-support')`)
psql(`insert into platform_staff(user_id, system_role) select id, 'support' from users where email='tm-support@example.com'`)
const cookie = async (email) => `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
const api = async (email, path, body) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: body ? "POST" : "GET", headers: { cookie: await cookie(email), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  return res.json().catch(() => null)
}
await api("admin@example.com", "/admin/organizations", { name: "Tm School", slug: "tm-school", type: "school", ownerEmail: "tm-o@example.com" })
const orgId = psql(`select id from organizations where slug='tm-school'`)
const role = (key) => psql(`select id from org_roles where org_id='${orgId}' and (system_key='${key}' or template_key='${key}')`)
const cls = (await api("tm-o@example.com", "/orgs/tm-school/groups", { name: "Tm 6-A" })).id
for (const [h, r, g] of [["tm-teacher", "teacher", cls], ["tm-librarian", "librarian", null], ["tm-student", null, null]]) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgId}', id, 'active', 'created' from users where email='${h}@example.com'`)
  psql(`insert into role_assignments(org_id,user_id,role_id) select '${orgId}', id, '${role("member")}' from users where email='${h}@example.com'`)
  if (r) psql(`insert into role_assignments(org_id,user_id,role_id,group_id) select '${orgId}', id, '${role(r)}', ${g ? `'${g}'` : "null"} from users where email='${h}@example.com'`)
}
psql(`insert into group_members(group_id,user_id) select '${cls}', id from users where email='tm-student@example.com'`)

const browser = await chromium.launch()
const view = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: (await cookie(email)).split("=").slice(1).join("="), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const main = (p) => p.getByRole("navigation", { name: "Main" })
const links = async (p) => (await main(p).getByRole("link").allInnerTexts()).map((t) => t.trim())

for (const [email, home, who] of [
  ["tm-teacher@example.com", "/teach", "a teacher"],
  ["tm-librarian@example.com", "/orgs", "staff who help run an organization without teaching"],
  ["tm-support@example.com", "/admin", "platform staff"],
]) {
  const p = await view(email)
  await p.goto(`${BASE}/problems`)
  await p.getByTestId("mode-toggle").waitFor({ timeout: 30000 })
  check(`Learn lists the playground, for ${who}`, (await links(p)).includes("Playground"), (await links(p)).join())
  await p.getByTestId("mode-toggle").getByRole("button", { name: "Teach" }).click()
  await p.waitForURL((u) => u.pathname === home, { timeout: 30000 }).catch(() => {})
  check(`Teach starts at ${home} for ${who}`, new URL(p.url()).pathname === home, p.url())
  if (home === "/admin") {
    // The platform's dashboard has its own frame (a sidebar, no site header).
    await p.getByRole("navigation", { name: "Dashboard" }).waitFor({ timeout: 15000 })
    check(`...and doesn't list the playground`, (await p.getByRole("link", { name: "Playground" }).count()) === 0)
  } else {
    await main(p).waitFor({ timeout: 15000 })
    check(`...and doesn't list the playground`, !(await links(p)).includes("Playground"), (await links(p)).join())
    check(`...and stays in Teach there`, (await p.getByTestId("mode-toggle").getByRole("button", { name: "Teach" }).getAttribute("aria-pressed")) === "true")
  }
  await p.context().close()
}
const s = await view("tm-student@example.com")
await s.goto(`${BASE}/problems`)
await main(s).waitFor({ timeout: 30000 })
check("students have no Teach, and keep the playground", (await s.getByTestId("mode-toggle").count()) === 0 && (await links(s)).includes("Playground"))
await s.goto(`${BASE}/orgs/tm-school`)
await s.waitForLoadState("networkidle")
check("an organization's own page doesn't switch anyone to Teach", (await s.getByTestId("mode-toggle").count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
