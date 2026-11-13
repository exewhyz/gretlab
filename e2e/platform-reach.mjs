/**
 * Platform staff inside organizations they haven't joined: those with "Act in
 * organizations" (owners, Support, Organizations manager, or a custom role with it) can do
 * everything an admin can, leave included, logged as support; those with "See inside
 * organizations" (Auditor) see people, grades, attendance, leave and the log but change
 * nothing; other staff see nothing; suspended organizations stay open to the first two.
 *   node e2e/platform-reach.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug='pr-school'`)
  psql(`delete from platform_staff where user_id in (select id from users where email like 'pr-%')`)
  psql(`delete from platform_roles where name like 'pr %'`)
  psql(`delete from users where email like 'pr-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["pr-teacher", "pr-student", "pr-parent"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
for (const [h, r] of [["pr-support", "support"], ["pr-auditor", "auditor"], ["pr-content", "content_admin"]]) {
  psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','teacher','${h}')`)
  psql(`insert into platform_staff(user_id, system_role) select id, '${r}' from users where email='${h}@example.com'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Pr School", slug: "pr-school", type: "school", ownerEmail: "pr-o@example.com" } })
const O = "/orgs/pr-school"
const orgId = psql(`select id from organizations where slug='pr-school'`)
const owner = await client("pr-o@example.com")
await owner(O, { method: "PATCH", body: { modules: { leave: true } } })
const cls = (await owner(`${O}/groups`, { body: { name: "Pr 6-A" } })).json.id
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const role = (key) => psql(`select id from org_roles where org_id='${orgId}' and system_key='${key}'`)
for (const h of ["pr-teacher", "pr-student"]) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
  psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid(h)}','${role("member")}')`)
}
psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid("pr-teacher")}','${role("teacher")}')`)
psql(`insert into group_members(group_id,user_id) values ('${cls}','${uid("pr-student")}')`)
// A student's leave and a teacher's, waiting.
const leave = (who, kind, type) => psql(`insert into leave_requests(org_id,user_id,kind,type,starts_on,ends_on,days,reason,requested_by) values ('${orgId}','${uid(who)}','${kind}','${type}',to_char(now() + interval '3 day','YYYY-MM-DD'),to_char(now() + interval '3 day','YYYY-MM-DD'),1,'pr reason','${uid(who)}') returning id`)
const studentLeave = leave("pr-student", "student", "sick")
const staffLeave = leave("pr-teacher", "staff", "casual")
const [support, auditor, content] = await Promise.all(["pr-support", "pr-auditor", "pr-content"].map((h) => client(`${h}@example.com`)))
check("none of the platform staff joined it", psql(`select count(*) from org_members where org_id='${orgId}' and user_id in (select id from users where email in ('admin@example.com','pr-support@example.com','pr-auditor@example.com'))`) === "0")

// ---------- acting: the platform owner and Support
for (const [who, api] of [["the platform owner", admin], ["Support (Act in organizations)", support]]) {
  const home = (await api(`${O}/leave`)).json
  check(`${who} sees the leave waiting to be decided`, home?.waiting?.length === 2 && home.canDecide === true, JSON.stringify(home).slice(0, 200))
  check(`...and every request`, (await api(`${O}/leave/requests?status=pending`)).json?.total === 2)
}
check("the platform owner decides a student's leave", (await admin(`${O}/leave/${studentLeave}/decision`, { body: { status: "approved", note: "" } })).status === 200)
check("Support decides a teacher's", (await support(`${O}/leave/${staffLeave}/decision`, { body: { status: "approved", note: "" } })).status === 200)
check("Support changes settings and makes groups", (await support(O, { method: "PATCH", body: { description: "Changed by support" } })).status === 200 && (await support(`${O}/groups`, { body: { name: "Pr 6-B" } })).status === 200)
check("...and it's logged as platform support", Number(psql(`select count(*) from audit_log where org_id='${orgId}' and support and actor_label like '%pr-support%'`)) >= 2)
const roles = await support(`/admin/roles`)
check("a custom platform role can carry it too", (await admin("/admin/roles", { body: { name: "pr Org helper", description: "", permissions: ["platform.orgs.act"] } })).status === 200)
void roles

// ---------- looking: the Auditor
check("the Auditor sees members, records and the log", (await auditor(`${O}/members`)).status === 200 && (await auditor(`${O}/audit`)).status === 200)
const ah = (await auditor(`${O}/leave`)).json
check("...and everyone's leave, deciding none", ah?.canSeeAll === true && ah.canDecide === false && (await auditor(`${O}/leave/requests?status=approved`)).json?.total === 2, JSON.stringify(ah).slice(0, 200))
check("...but can't decide it", [403, 404].includes((await auditor(`${O}/leave/${staffLeave}/decision`, { body: { status: "rejected", note: "" } })).status))
check("...or change anything", (await auditor(O, { method: "PATCH", body: { description: "x" } })).status === 403 && [403, 404].includes((await auditor(`${O}/groups`, { body: { name: "Pr 6-C" } })).status))
check("...and its home is the read-only overview", (await auditor(`${O}/home`)).json?.views?.includes("admin"))

// ---------- other staff, and suspension
check("platform staff without either see nothing inside", [403, 404].includes((await content(`${O}/members`)).status) && [403, 404].includes((await content(`${O}/leave`)).status))
psql(`update organizations set active=false where slug='pr-school'`)
check("a suspended organization stays open to those who act and look", (await support(`${O}/members`)).status === 200 && (await auditor(`${O}/members`)).status === 200)
check("...and closed to its own members", (await (await client("pr-teacher@example.com"))(`${O}/leave`)).status === 403)
psql(`update organizations set active=true where slug='pr-school'`)

// ---------- the pages
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "pr-auditor@example.com" }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
const p = await ctx.newPage()
await p.goto(`${BASE}${O}/leave`)
await p.getByRole("tab", { name: "All requests" }).click({ timeout: 30000 })
await p.getByText("pr reason").first().waitFor({ timeout: 15000 })
check("the Auditor reads everyone's leave on the page, with nothing to approve", (await p.getByRole("button", { name: "Approve" }).count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
