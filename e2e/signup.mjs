/**
 * Registering a school: off by default; reviewed (the school waits, inactive, platform
 * admins are told, the owner sees it waiting, approving opens it and tells the owner);
 * open (ready at once); the set-up (the current academic year, grades with sections);
 * checks (taken addresses, bad years and grades, a daily limit); the pages.
 *   node e2e/signup.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug like 'su-%'`)
  psql(`delete from audit_log where action='org.signup'`)
  psql(`delete from users where email like 'su-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["su-a", "su-b", "su-c"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Su ${h.slice(3)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [admin, a, b, c] = await Promise.all(["admin", "su-a", "su-b", "su-c"].map((h) => client(`${h}@example.com`)))
const mode = (m) => admin("/admin/settings", { method: "PATCH", body: { "orgs.self_signup": m } })
const school = (who, body) => who("/schools", { body: { type: "school", ...body } })
const setup = {
  year: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31" },
  grades: { from: 1, to: 3, sections: ["A", "B"] },
}

// ---------- off
check("sign-up is off by default", (await a("/schools/signup")).json?.mode === "off")
check("...so registering is refused", (await school(a, { name: "Su Alpha", slug: "su-alpha" })).json?.error?.code === "signup_off")
check("a bad setting value is refused", (await mode("maybe")).status === 400)

// ---------- reviewed
await mode("review")
const r1 = await school(a, { name: "Su Alpha School", slug: "su-alpha", ...setup })
check("a school registers, waiting for approval", r1.status === 200 && r1.json?.pending === true, JSON.stringify(r1.json))
const orgId = psql(`select id from organizations where slug='su-alpha'`)
check("...inactive until approved", psql(`select active||':'||coalesce(signup_status,'') from organizations where id='${orgId}'`) === "false:pending")
check("the person who registered owns it", psql(`select r.system_key from role_assignments ra join org_roles r on r.id=ra.role_id where ra.org_id='${orgId}' and ra.user_id='${uid("su-a")}' and r.system_key='owner'`) === "owner")
check("the set-up made the current year", psql(`select name||':'||is_current from academic_years where org_id='${orgId}'`) === "2026-2027:true")
check("...and grades with sections", psql(`select count(*) from org_groups where org_id='${orgId}' and parent_id is null`) === "3" && psql(`select string_agg(g.name||'/'||s.name, ',' order by g.name, s.name) from org_groups s join org_groups g on g.id=s.parent_id where s.org_id='${orgId}'`) === "Grade 1/A,Grade 1/B,Grade 2/A,Grade 2/B,Grade 3/A,Grade 3/B")
check("platform admins are told", psql(`select count(*) from notifications where kind='school_signup' and title like 'Su Alpha School%'`) !== "0")
const blocked = await a("/orgs/su-alpha/home")
check("its pages wait for approval, saying so", blocked.status === 403 && blocked.json?.error?.code === "pending_approval", JSON.stringify(blocked.json))
check("the owner's profile says it's waiting", (await a("/orgs/su-alpha")).json?.pendingApproval === true)
check("a taken address is refused", (await school(b, { name: "Su Copy", slug: "su-alpha" })).json?.error?.code === "slug_taken")
check("a year ending before it starts is refused", (await school(b, { name: "Su Beta", slug: "su-beta", year: { name: "2026", startsOn: "2026-06-01", endsOn: "2026-01-01" } })).status === 400)
check("grades the wrong way round are refused", (await school(b, { name: "Su Beta", slug: "su-beta", grades: { from: 5, to: 2, sections: ["A"] } })).status === 400)
check("a section twice is refused", (await school(b, { name: "Su Beta", slug: "su-beta", grades: { from: 1, to: 2, sections: ["A", "a"] } })).status === 400)
const list = (await admin("/admin/organizations")).json
check("admins see it waiting", list?.find((o) => o.slug === "su-alpha")?.signupStatus === "pending")
await admin(`/admin/organizations/${orgId}`, { method: "PATCH", body: { active: true } })
check("approving opens it", psql(`select active||':'||coalesce(signup_status,'none') from organizations where id='${orgId}'`) === "true:none" && (await a("/orgs/su-alpha/home")).status === 200)
check("...and tells the owner", psql(`select count(*) from notifications where user_id='${uid("su-a")}' and kind='school_approved'`) === "1")
check("...and it's in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action in ('org.signup','org.approve')`) === "2")
check("the new school starts with its modules and an owner's home", (await a("/orgs/su-alpha/home")).json?.views.includes("admin"))

// ---------- open
await mode("open")
const r2 = await school(b, { name: "Su Beta College", slug: "su-beta", type: "college", year: setup.year, grades: null })
check("open sign-up is ready at once", r2.json?.pending === false && psql(`select active from organizations where slug='su-beta'`) === "t", JSON.stringify(r2))
await school(c, { name: "Su C1", slug: "su-c1" })
await school(c, { name: "Su C2", slug: "su-c2" })
await school(c, { name: "Su C3", slug: "su-c3" })
check("at most three a day per person", (await school(c, { name: "Su C4", slug: "su-c4" })).status === 429)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
await mode("review")
const p = await view("su-b@example.com", 390)
await p.goto(`${BASE}/orgs`)
await p.getByTestId("signup-link").click()
await p.getByRole("heading", { name: "Register your school" }).waitFor({ timeout: 30000 })
await p.getByLabel("Name").fill("Su Gamma Public School")
check("the address follows the name", (await p.getByLabel("Web address").inputValue()) === "su-gamma-public-school")
await p.getByLabel("Last grade").fill("2")
check("the set-up is previewed", (await p.getByTestId("signup-preview").innerText()).includes("4 sections"))
check("no sideways scrolling on a phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await p.screenshot({ path: SHOTS + "signup.png", fullPage: true })
await p.getByRole("button", { name: "Register" }).click()
await p.getByTestId("signup-pending").waitFor({ timeout: 15000 })
check("registering from the page waits for approval", psql(`select signup_status from organizations where slug='su-gamma-public-school'`) === "pending")
const ap = await view("admin@example.com", 1440)
await ap.goto(`${BASE}/admin/organizations`)
const row = ap.getByRole("row").filter({ hasText: "Su Gamma Public School" })
await row.getByTestId("awaiting-approval").waitFor({ timeout: 30000 })
await row.getByRole("button", { name: "Approve" }).click()
await row.getByTestId("awaiting-approval").waitFor({ state: "detached", timeout: 15000 })
check("an admin approves from the page", psql(`select active from organizations where slug='su-gamma-public-school'`) === "t", psql(`select active||':'||coalesce(signup_status,'-') from organizations where slug='su-gamma-public-school'`))
await mode("off")
const off = await view("su-c@example.com", 1440)
await off.goto(`${BASE}/orgs`)
await off.getByRole("heading", { name: "Organizations" }).waitFor({ timeout: 30000 })
await off.waitForLoadState("networkidle")
check("with sign-up off there's no link", (await off.getByTestId("signup-link").count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
