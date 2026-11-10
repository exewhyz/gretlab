/**
 * Calendar: a person's dated work (due times with their extension, exams, contests,
 * peer reviews) and the private iCal feed (secret address, new link, off, blocked).
 *   node e2e/calendar.mjs [base-url] [screenshot-dir]
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
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()

const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'cal-%')`)
  psql(`delete from assignments where title like 'cal %'`)
  psql(`delete from contests where title like 'cal %'`)
  psql(`delete from organizations where slug = 'caltest'`)
  psql(`delete from users where email like 'cal-%'`)
}
cleanup()
const PEOPLE = ["cal-t", "cal-s1", "cal-s2", "cal-s3"]
for (const h of PEOPLE) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = email ? `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}` : ""
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, type: res.headers.get("content-type") }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Cal College", slug: "caltest", type: "college", ownerEmail: "cal-t@example.com" } })
const O = "/orgs/caltest"
const orgId = psql(`select id from organizations where slug='caltest'`)
const [t, s1, s2, anon] = await Promise.all(["cal-t@example.com", "cal-s1@example.com", "cal-s2@example.com", null].map(client))
const lab = (await t(`${O}/groups`, { body: { name: "cal Lab" } })).json
const other = (await t(`${O}/groups`, { body: { name: "cal Other" } })).json
for (const h of ["cal-s1", "cal-s2", "cal-s3"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: [uid("cal-s1"), uid("cal-s2"), uid("cal-s3")] } })
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing = 'everyone' order by slug limit 1`)
const make = (title, extra) => t(`${O}/assignments`, { body: { title, slug: title.replace(/ /g, "-").toLowerCase(), description: "", opensAt: days(-1), dueAt: days(2), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [{ problemId: problem, points: 100, rubric: [], outcomes: [] }], questions: [], ...extra } })
const due = (await make("cal Week 1", {})).json
await make("cal Exam", { opensAt: days(3), dueAt: days(3.1), exam: { minutes: 60, fullscreen: true, networks: [], startWithin: null } })
await make("cal Draft", { published: false })
await make("cal Elsewhere", { audience: [[other.id]] })
await t(`${O}/assignments/${due.id}/extensions`, { method: "PUT", body: { student: "cal-s1@example.com", dueAt: days(4) } })
await t(`${O}/contests`, { body: { title: "cal Contest", slug: "cal-contest", description: "", startsAt: days(5), endsAt: days(5.1), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [problem], audience: [[lab.id]] } })
// Peer reviews to write: a past assignment with reviews due tomorrow.
const peer = (await make("cal Reviewed", { opensAt: days(-5), dueAt: days(-1), peerReview: { reviews: 1, anonymous: true, dueAt: days(1) } })).json
for (const h of ["cal-s1", "cal-s2"]) {
  psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${problem}','submit','python','main.py','[]',1000,256,'done','AC',100,100,'${days(-2)}','${days(-2)}')`)
}
await t(`${O}/assignments/${peer.id}/peer`, { body: {} })

// ---------- the calendar
const cal = (await s1("/me/calendar")).json
const titles = cal.events.map((e) => e.title)
check("due times, exams, contests and reviews to write", ["Due: cal Week 1", "Exam: cal Exam", "Contest: cal Contest", "Peer reviews due: cal Reviewed"].every((x) => titles.includes(x)), titles.join(" | "))
check("not drafts or other classes' work", !titles.some((x) => x.includes("cal Draft") || x.includes("cal Elsewhere")))
const mineDue = cal.events.find((e) => e.title === "Due: cal Week 1")
check("with their own extension", Math.abs(new Date(mineDue.start) - new Date(days(4))) < 120_000 && mineDue.detail.includes("your extension"))
check("a classmate sees the class's due time", Math.abs(new Date((await s2("/me/calendar")).json.events.find((e) => e.title === "Due: cal Week 1").start) - new Date(days(2))) < 120_000)
const exam = cal.events.find((e) => e.kind === "exam")
check("an exam is a window", exam.end && new Date(exam.end) > new Date(exam.start))
check("in date order", cal.events.every((e, i, all) => i === 0 || all[i - 1].start <= e.start))
check("needs sign-in", (await anon("/me/calendar")).status === 401)

// ---------- the feed
check("no feed until turned on", cal.feed === null)
const on = (await s1("/me/calendar/feed", { body: {} })).json.feed
const ics = await anon(`/calendar/${on}.ics`)
check("the feed works without signing in, as iCal", ics.status === 200 && ics.type.startsWith("text/calendar") && ics.text.startsWith("BEGIN:VCALENDAR\r\n"), ics.text.slice(0, 80))
check("with the same events", ics.text.includes("SUMMARY:Due: cal Week 1") && ics.text.includes("SUMMARY:Exam: cal Exam") && !ics.text.includes("cal Draft") && ics.text.includes("URL:") && /UID:due-cal-week-1@/.test(ics.text))
check("never marks", !/earned|score|grade/i.test(ics.text))
check("a wrong secret finds nothing", (await anon(`/calendar/${"x".repeat(32)}.ics`)).status === 404 && (await anon("/calendar/short")).status === 404)
const newer = (await s1("/me/calendar/feed", { body: {} })).json.feed
check("a new link retires the old one", newer !== on && (await anon(`/calendar/${on}.ics`)).status === 404 && (await anon(`/calendar/${newer}.ics`)).status === 200)
psql(`update users set disabled = true where email='cal-s1@example.com'`)
check("a blocked account's feed stops", (await anon(`/calendar/${newer}.ics`)).status === 404)
psql(`update users set disabled = false where email='cal-s1@example.com'`)
await s1("/me/calendar/feed", { method: "DELETE" })
check("turning it off", (await anon(`/calendar/${newer}.ics`)).status === 404 && (await s1("/me/calendar")).json.feed === null)

// ---------- the page
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "cal-s1@example.com" }, secret: SECRET }), url: BASE }])
const page = await ctx.newPage()
await page.goto(`${BASE}/calendar`)
await page.getByTestId("calendar-event").first().waitFor({ timeout: 30000 })
check("the page lists them by day", (await page.getByTestId("calendar-event").count()) >= 4)
await page.getByRole("button", { name: "Get calendar link" }).click()
await page.getByLabel("Calendar link").waitFor({ timeout: 15000 })
const link = await page.getByLabel("Calendar link").inputValue()
check("getting the link from the page", /\/api\/v1\/calendar\/[A-Za-z0-9_-]+\.ics$/.test(link) && (await anon(link.replace(/^.*\/api\/v1/, ""))).status === 200, link)
await page.screenshot({ path: SHOTS + "calendar.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
