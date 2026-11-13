/**
 * Every link works for the person it's shown to. As each kind of person (platform admin,
 * school owner, teacher, office staff, student, parent) this opens their home and follows
 * the links on each page, one page of each kind (ids collapsed), and fails on any that
 * answers an error or lands on a "not found" or "not part of your role" page. Downloads
 * (/api/… PDFs and CSVs) are fetched and must answer 200.
 *   node e2e/links.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const LIMIT = Number(process.env.LINKS_LIMIT ?? 90)
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 2000)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug = 'lk-school'`)
  psql(`delete from users where email like 'lk-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["lk-o", "lk-t", "lk-off"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Lk ${h.slice(3)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  call.cookie = cookie
  return call
}

// ---------- a small school with something in every part
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Lk School", slug: "lk-school", type: "school", ownerEmail: "lk-o@example.com" } })
const O = "/orgs/lk-school", orgId = psql(`select id from organizations where slug='lk-school'`)
const owner = await client("lk-o@example.com")
await owner(O, { method: "PATCH", body: { description: "A school", modules: { library: true, transport: true, hostel: true } } })
const g = (await owner(`${O}/groups`, { body: { name: "Grade 2" } })).json
const sec = (await owner(`${O}/groups`, { body: { name: "A", parentId: g.id } })).json
for (const h of ["lk-t", "lk-off"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("lk-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: sec.id } })
const office = (await owner(`${O}/roles`, { body: { name: "Office", permissions: ["leave.staff", "staff_attendance.mark", "admissions.manage"] } })).json
await owner(`${O}/members/${uid("lk-off")}/roles`, { body: { roleId: office.id } })
const year = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })).json
await owner(`${O}/academic-years/${year.id}/class-teachers`, { method: "PUT", body: { assignments: [{ groupId: sec.id, teacherId: uid("lk-t") }] } })
const kid = (await owner(`${O}/students`, { body: { name: "Lk Kid", email: "lk-s@example.com", groupId: sec.id, rollNo: 1 } })).json
await owner(`${O}/parents`, { body: { studentId: kid.id, email: "lk-p@example.com", name: "Lk Parent" } })
const maths = (await owner(`${O}/subjects`, { body: { name: "Mathematics" } })).json
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: sec.id, teacherId: uid("lk-t") } })
const exam = (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Unit test" } })).json
await owner(`${O}/exams/${exam.id}/papers`, { body: { groupIds: [sec.id], maxMarks: 20, passMarks: 7 } })
const paper = psql(`select id from exam_papers where exam_id='${exam.id}'`)
await owner(`/orgs/lk-school/exam-papers/${paper}/marks`, { method: "PUT", body: { marks: [{ userId: kid.id, marks: 15 }] } })
await owner(`${O}/exams/${exam.id}/publish`, { body: { published: true } })
await owner(`${O}/admissions/settings`, { method: "PUT", body: { open: true, yearId: year.id, gradeIds: [], instructions: "" } })
check("the set-up worked", !!(kid?.id && exam?.id && paper))

// ---------- crawling as each person
const browser = await chromium.launch()
const reached = new Set()
const skip = (path) =>
  /^\/(sign-in|join\/|api\/auth|lti\/)/.test(path) || path.startsWith("/playground") || path === "/"
// One page of each kind: ids, numbers and long slugs collapsed.
const shape = (path) =>
  path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")
    .replace(/\/(problems|lists|contests|assignments|u|courses|questions|certificates)\/[^/]+/g, "/$1/:slug")
const BROKEN = /(^|\n)(Not found|Page not found|404|.*isn't part of your role.*|You can't see.*|You don't have access.*|Something went wrong.*)(\n|$)/

async function crawl(who, email, starts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  await ctx.addCookies([{ name: "next-auth.session-token", value: cookie.split("=")[1], domain: new URL(BASE).hostname, path: "/" }])
  const page = await ctx.newPage()
  const queue = starts.map((s) => ({ path: s, from: "(start)" }))
  const seen = new Set()
  const broken = []
  let visited = 0
  while (queue.length && visited < LIMIT) {
    const { path, from } = queue.shift()
    const key = shape(path)
    if (seen.has(key)) continue
    seen.add(key)
    if (path.startsWith("/api/")) {
      const res = await fetch(BASE + path, { headers: { cookie } })
      if (res.status !== 200) broken.push(`${path} (${res.status}) <- ${from}`)
      continue
    }
    visited++
    let status = 0
    try {
      const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30000 })
      status = res?.status() ?? 0
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
    } catch (e) {
      broken.push(`${path} (did not load: ${String(e).slice(0, 80)}) <- ${from}`)
      continue
    }
    const landed = new URL(page.url()).pathname
    const main = await page.locator("main, [data-slot=sidebar-inset]").first().innerText().catch(() => "")
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => [])
    const bad =
      status >= 400 ||
      landed.startsWith("/sign-in") ||
      BROKEN.test(main.split("\n").slice(0, 6).join("\n")) ||
      alerts.some((a) => BROKEN.test(a))
    if (bad) {
      broken.push(`${path} (${status}${landed !== path.split("?")[0] ? ` → ${landed}` : ""}: ${(alerts[0] ?? main.split("\n")[0] ?? "").slice(0, 80)}) <- ${from}`)
      continue
    }
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))
    for (const href of hrefs) {
      if (!href || !href.startsWith("/") || href.startsWith("//")) continue
      const clean = href.split("#")[0]
      const p = clean.startsWith("/api/") ? clean : clean.split("?")[0]
      if (skip(p) || seen.has(shape(p))) continue
      queue.push({ path: clean.startsWith("/api/") ? clean : p, from: path })
    }
  }
  await ctx.close()
  if (process.env.LINKS_DUMP) for (const k of seen) reached.add(k)
  check(`as ${who}, every link works (${visited} pages)`, broken.length === 0, "\n    " + broken.join("\n    "))
}

await crawl("the platform admin", "admin@example.com", ["/admin", "/home"])
await crawl("the school's owner", "lk-o@example.com", ["/orgs/lk-school", "/home"])
await crawl("a teacher", "lk-t@example.com", ["/orgs/lk-school", "/home"])
await crawl("office staff", "lk-off@example.com", ["/orgs/lk-school", "/home"])
await crawl("a student", "lk-s@example.com", ["/orgs/lk-school", "/home"])
await crawl("a parent", "lk-p@example.com", ["/orgs/lk-school", "/home"])
await browser.close()
if (process.env.LINKS_DUMP) (await import("node:fs")).writeFileSync(process.env.LINKS_DUMP, [...reached].sort().join("\n"))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
