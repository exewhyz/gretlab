/**
 * Kinds of organization and their modules: a school, cohort and company get their type's
 * group levels, the sidebar names groups for the type, modules can't be switched on before
 * they're ready or for a type that can't use them, and the Settings page shows the Modules
 * card only where it applies.
 *   node e2e/org-types.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('typ-school','typ-cohort','typ-company')`)
  psql(`delete from users where email like 'typ-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('typ-o@example.com','typ owner','student','typ-o')`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const owner = await client("typ-o@example.com")
const make = (slug, type) => admin("/admin/organizations", { body: { name: slug, slug, type, ownerEmail: "typ-o@example.com" } })

// ---------- creating each kind
check("a school can be created", (await make("typ-school", "school")).status === 200)
check("a cohort program can be created", (await make("typ-cohort", "cohort")).status === 200)
check("a company can be created", (await make("typ-company", "company")).status === 200)
check("an unknown kind is refused", (await make("typ-bad", "castle")).status === 400)
const school = (await owner("/orgs/typ-school/manage")).json
check("a school starts with Grade › Section", school?.org.groupLevels.join() === "Grade,Section", JSON.stringify(school?.org.groupLevels))
check("a cohort starts with Cohort", (await owner("/orgs/typ-cohort/manage")).json?.org.groupLevels.join() === "Cohort")
check("a company starts with Team", (await owner("/orgs/typ-company/manage")).json?.org.groupLevels.join() === "Team")
check("a school starts with its ready default modules on", school?.org.modules.join() === "attendance,subjects" && JSON.stringify(school?.org.moduleChoices) === "{}", JSON.stringify(school?.org.modules))

// ---------- switching modules
const patch = (slug, modules) => owner(`/orgs/${slug}`, { method: "PATCH", body: { modules } })
const early = await patch("typ-school", { timetable: true })
check("a module that isn't ready can't be switched on", early.status === 400 && early.json?.error?.code === "module_unavailable", JSON.stringify(early.json))
check("a company can't switch on a school module", (await patch("typ-company", { hostel: true })).json?.error?.code === "module_unavailable")
check("switching one off is fine", (await patch("typ-school", { attendance: false })).status === 200)
check("...and is remembered", (await owner("/orgs/typ-school/manage")).json?.org.moduleChoices.attendance === false)
check("an unknown module is refused", (await patch("typ-school", { teleport: true })).status === 400)

// ---------- the pages
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "typ-o@example.com" }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
const page = await ctx.newPage()
const navOf = async (slug) => {
  await page.goto(`${BASE}/orgs/${slug}/manage`)
  await page.locator('nav[aria-label="Organization"]').getByText("Overview").waitFor({ timeout: 30000 })
  return page.locator('nav[aria-label="Organization"]').innerText()
}
check("a school's sidebar calls groups Classes", (await navOf("typ-school")).includes("Classes"))
check("a company's sidebar calls groups Teams", (await navOf("typ-company")).includes("Teams"))
await page.goto(`${BASE}/orgs/typ-school/manage/settings`)
await page.getByTestId("org-modules").waitFor({ timeout: 30000 })
check("a school's settings list its modules", (await page.getByTestId("module-hostel").count()) === 1 && (await page.getByTestId("module-timetable").innerText()).includes("Coming soon") && !(await page.getByTestId("module-attendance").innerText()).includes("Coming soon"))
await page.screenshot({ path: SHOTS + "org-modules.png", fullPage: true })
await page.goto(`${BASE}/orgs/typ-company/manage/settings`)
await page.getByRole("button", { name: "Save settings" }).waitFor({ timeout: 30000 })
check("a company has no Modules card", (await page.getByTestId("org-modules").count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
