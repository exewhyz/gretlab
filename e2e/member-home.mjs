/**
 * The member's home (/home): signed-in people land there from /, visitors still go to the
 * problems; it gathers their schools (and requests waiting), children, work due, contests,
 * practice with the streak and activity, and the daily challenge, leaving out what's
 * switched off; the page on a laptop and a phone, and Home in the header.
 *   node e2e/member-home.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('mh-school','mh-club')`)
  psql(`delete from users where email like 'mh-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["mh-o", "mh-s", "mh-new"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Mh ${h.slice(3)} Learner','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const cookieFor = async (email) => `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
const client = async (email) => {
  const cookie = await cookieFor(email)
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Mh School", slug: "mh-school", type: "school", ownerEmail: "mh-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Mh Club", slug: "mh-club", type: "community", ownerEmail: "mh-o@example.com" } })
const school = psql(`select id from organizations where slug='mh-school'`)
const club = psql(`select id from organizations where slug='mh-club'`)
psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${school}','${uid("mh-s")}','active','created'), ('${club}','${uid("mh-s")}','pending','request')`)
const owner = await client("mh-o@example.com")
const g = (await owner(`/orgs/mh-school/groups`, { body: { name: "Grade 4" } })).json
const sec = (await owner(`/orgs/mh-school/groups`, { body: { name: "A", parentId: g.id } })).json
await owner(`/orgs/mh-school/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })
const kid = (await owner(`/orgs/mh-school/students`, { body: { name: "Mh Kid", groupId: sec.id } })).json
await owner(`/orgs/mh-school/parents`, { body: { studentId: kid.id, email: "mh-p@example.com", name: "Mh Parent" } })
const [student, fresh, parent] = await Promise.all(["mh-s", "mh-new", "mh-p"].map((h) => client(`${h}@example.com`)))

// ---------- where / leads
const root = async (cookie) => (await fetch(BASE + "/", { redirect: "manual", headers: cookie ? { cookie } : {} })).headers.get("location") ?? ""
check("a visitor still goes from / to the problems", (await root(null)).endsWith("/problems"), await root(null))
check("someone signed in goes from / to their home", (await root(await cookieFor("mh-s@example.com"))).endsWith("/home"))

// ---------- what it gathers
const d = (await student("/me/dashboard")).json
check("the home lists their schools, with requests waiting apart", d?.orgs.map((o) => o.name).join() === "Mh School" && d.pendingOrgs.map((o) => o.name).join() === "Mh Club", JSON.stringify({ orgs: d?.orgs, pending: d?.pendingOrgs }))
check("...and greets them by name", d?.name === "Mh s Learner")
check("practice shows twelve weeks of activity and the solved counts", d?.practice?.activity.length === 84 && typeof d.practice.solved === "number" && d.practice.totalBy.easy > 0, JSON.stringify(d?.practice)?.slice(0, 200))
check("work and contests are there, even when empty", Array.isArray(d?.work.next) && d.work.open >= 0 && Array.isArray(d.contests))
const pd = (await parent("/me/dashboard")).json
check("a parent sees their child, linked to the child's page", pd?.children.length === 1 && pd.children[0].name === "Mh Kid" && pd.children[0].org.slug === "mh-school", JSON.stringify(pd?.children))
check("someone new has no schools yet", (await fresh("/me/dashboard")).json?.orgs.length === 0)
check("a visitor gets no home", (await fetch(BASE + "/api/v1/me/dashboard")).status === 401)
await admin("/admin/settings", { method: "PATCH", body: { "contests.enabled": false } })
check("a feature switched off is left out", (await student("/me/dashboard")).json?.features.contests === false && (await student("/me/dashboard")).json.contests.length === 0)
await admin("/admin/settings", { method: "PATCH", body: { "contests.enabled": true } })

// ---------- the page
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("mh-s@example.com", 1440)
await p.goto(`${BASE}/`)
await p.getByTestId("member-home").waitFor({ timeout: 30000 })
check("signing in lands on the home page", p.url().endsWith("/home"))
check("the header has Home, marked current", (await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).getAttribute("aria-current")) === "page")
check("tiles for work and practice", (await p.getByTestId("member-tile").count()) === 4)
check("their school is a card that opens it", (await p.getByTestId("member-org").getAttribute("href")) === "/orgs/mh-school")
check("the practice card has the activity heatmap", await p.getByTestId("heatmap").isVisible())
await p.screenshot({ path: SHOTS + "member-home.png", fullPage: true })
const phone = await view("mh-p@example.com", 390)
await phone.goto(`${BASE}/home`)
await phone.getByTestId("member-child").waitFor({ timeout: 30000 })
check("a parent's home links their child", (await phone.getByTestId("member-child").getAttribute("href")) === `/orgs/mh-school/children/${kid.id}`)
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await phone.screenshot({ path: SHOTS + "member-home-phone.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
