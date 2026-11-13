/**
 * Roles by kind: a new organization starts with its kind's suggested roles (a school's
 * Principal, Class teacher, Librarian…, a company's HR partner, Trainer…) beside the
 * built-in ones; they're ordinary roles (edit, delete); the Roles page offers back the ones
 * an organization doesn't have; platform staff set each kind's list (add, edit, remove,
 * back to default), refused when unsound; new built-in platform roles; the pages.
 *   node e2e/roles.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 400)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug like 'rl-%'`)
  psql(`delete from platform_staff where user_id in (select id from users where email like 'rl-%')`)
  psql(`delete from users where email like 'rl-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["rl-t", "rl-s", "rl-comms"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const make = (slug, type) => admin("/admin/organizations", { body: { name: slug, slug, type, ownerEmail: "rl-o@example.com" } })
await make("rl-school", "school")
await make("rl-co", "company")
const owner = await client("rl-o@example.com")
const O = "/orgs/rl-school"
const roles = async (slug = "rl-school") => (await owner(`/orgs/${slug}/roles`)).json ?? []

// ---------- a new organization
const r0 = await roles()
check("a new school starts with the built-in roles and its suggested ones", r0.filter((r) => r.systemKey).length === 4 && r0.filter((r) => r.templateKey).length === 11, JSON.stringify(r0.map((r) => r.name)))
check("...a principal, class and subject teachers, a librarian…", ["Principal", "Class teacher", "Subject teacher", "Librarian", "Exam coordinator"].every((n) => r0.some((r) => r.name === n)))
const co = await roles("rl-co")
check("a company gets its own: HR partner, Trainer, Compliance officer, Team lead", ["HR partner", "Trainer", "Compliance officer", "Team lead"].every((n) => co.some((r) => r.name === n)) && !co.some((r) => r.name === "Principal"))
check("nothing suggested is missing yet", (await owner(`${O}/roles/suggested`)).json?.suggestions.length === 0)

// ---------- they're ordinary roles
const librarian = r0.find((r) => r.name === "Librarian")
check("a suggested role can be changed", (await owner(`${O}/roles/${librarian.id}`, { method: "PUT", body: { name: "Head librarian", description: "x", permissions: ["library.manage"] } })).status === 200)
const principal = r0.find((r) => r.name === "Principal")
check("...and deleted", (await owner(`${O}/roles/${principal.id}`, { method: "DELETE" })).status === 200)
const sug = (await owner(`${O}/roles/suggested`)).json
check("the Roles page offers back what's missing", sug?.kind === "School" && sug.suggestions.map((s) => s.key).join() === "principal", JSON.stringify(sug))
check("adding it makes it again", (await owner(`${O}/roles/suggested`, { body: { key: "principal" } })).status === 200 && (await roles()).some((r) => r.name === "Principal" && r.templateKey === "principal"))
check("...once", (await owner(`${O}/roles/suggested`, { body: { key: "principal" } })).status !== 200 || (await roles()).filter((r) => r.name === "Principal").length === 1)
const cls = (await owner(`${O}/groups`, { body: { name: "Rl Grade 5" } })).json
psql(`insert into org_members(org_id,user_id,status,joined_via) select o.id, u.id, 'active', 'created' from organizations o, users u where o.slug='rl-school' and u.email in ('rl-t@example.com','rl-s@example.com')`)
const teacher = await client("rl-t@example.com")
check("someone who can't manage roles isn't offered them", (await teacher(`${O}/roles/suggested`)).status === 403)
const memberId = uid("rl-t")
const classTeacher = (await roles()).find((r) => r.name === "Class teacher")
check("a class teacher is given the role for their class", (await owner(`${O}/members/${memberId}/roles`, { body: { roleId: classTeacher.id, groupId: cls.id } })).status === 200)
check("...and can run that class's register", (await teacher(`${O}/classes/${cls.id}`)).status === 200)

// ---------- the platform decides each kind's list
const helper = await client("rl-s@example.com")
const kinds = (await admin("/admin/kinds")).json
const school = kinds?.kinds.find((k) => k.key === "school")
check("the kinds page lists each kind's suggested roles", school?.roles.length === 11 && school.rolesChanged === false)
const put = (kind, roles, who = admin) => who(`/admin/kinds/${kind}/roles`, { method: "PUT", body: { roles } })
const nurse = { key: "nurse", name: "School nurse", description: "Health records and sick leave.", permissions: ["students.view", "leave.students"], scope: "organization" }
check("staff without the permission can't change them", (await put("school", [nurse], helper)).status === 403)
check("two roles of one name are refused", (await put("school", [nurse, { ...nurse, key: "nurse2" }])).status === 400)
check("a built-in role's name is refused", (await put("school", [{ ...nurse, name: "Teacher" }])).status === 400)
check("an unknown permission is refused", (await put("school", [{ ...nurse, permissions: ["made.up"] }])).status === 400)
check("a role is added to the school list", (await put("school", [...school.roles, nurse])).json?.kinds.find((k) => k.key === "school")?.roles.some((r) => r.key === "nurse"))
check("...existing schools are offered it", (await owner(`${O}/roles/suggested`)).json?.suggestions.map((s) => s.name).join() === "School nurse")
await make("rl-school2", "school")
check("...and new schools start with it", (await roles("rl-school2")).some((r) => r.name === "School nurse" && r.templateKey === "nurse"))
check("back to the default", (await put("school", null)).json?.kinds.find((k) => k.key === "school")?.rolesChanged === false && (await owner(`${O}/roles/suggested`)).json?.suggestions.length === 0)
check("the platform's changes are logged", Number(psql(`select count(*) from audit_log where org_id is null and action='platform.kind_roles'`)) >= 2)

// ---------- platform roles
const staff = (await admin("/admin/roles")).json
const builtIns = JSON.stringify(staff)
check("the platform has more built-in roles", ["Organizations manager", "Communications", "Content editor", "Auditor"].every((n) => builtIns.includes(n)))
check("a communications person is given that role", (await admin("/admin/staff", { method: "PUT", body: { email: "rl-comms@example.com", role: "communications" } })).status === 200)
const comms = await client("rl-comms@example.com")
check("...and may edit emails, not organizations", (await comms("/admin/emails")).status === 200 && (await comms("/admin/kinds")).status === 403 && (await comms("/admin/organizations")).status === 403)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const o = await view("rl-o@example.com")
const counselor = (await roles()).find((r) => r.name === "Counselor")
await owner(`${O}/roles/${counselor.id}`, { method: "DELETE" })
await o.goto(`${BASE}${O}/manage/roles`)
await o.getByTestId("suggested-role").first().waitFor({ timeout: 30000 })
await o.getByRole("button", { name: "Add Counselor" }).click()
await o.getByTestId("suggested-roles").waitFor({ state: "detached", timeout: 15000 })
check("the owner adds a suggested role from the page", (await roles()).some((r) => r.name === "Counselor"))
check("...shown as suggested", (await o.getByText("Suggested", { exact: true }).count()) >= 1)
await o.screenshot({ path: SHOTS + "org-roles.png", fullPage: true })
const a = await view("admin@example.com")
await a.goto(`${BASE}/admin/kinds`)
await a.getByTestId("kind-roles").waitFor({ timeout: 30000 })
await a.getByRole("tab", { name: "Company" }).click()
await a.getByTestId("kind-roles").getByRole("button", { name: "Add role" }).click()
await a.getByLabel("Role name").fill("Safety officer")
await a.getByLabel("What it's for").fill("Workplace safety training.")
await a.getByTestId("template-editor").getByRole("button", { name: "Add role" }).click()
await a.getByRole("row", { name: /Safety officer/ }).waitFor({ timeout: 15000 })
check("platform staff add a role to a kind from the page", (await admin("/admin/kinds")).json?.kinds.find((k) => k.key === "company")?.roles.some((r) => r.name === "Safety officer" && r.key === "safety_officer"))
await a.screenshot({ path: SHOTS + "kind-roles.png", fullPage: true })
await browser.close()

await put("company", null)
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
