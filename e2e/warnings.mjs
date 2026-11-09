/**
 * Early warnings: who in a class needs attention and why (missed work, low marks, gone
 * quiet, attendance), who may see it, and a teacher's note to chosen students.
 *   node e2e/warnings.mjs [base-url] [screenshot-dir]
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
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

const PEOPLE = ["wrn-t", "wrn-s1", "wrn-s2", "wrn-s3", "wrn-s4", "wrn-out"]
const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'wrn-%')`)
  psql(`delete from assignments where title like 'wrn %'`)
  psql(`delete from organizations where slug = 'wrntest'`)
  psql(`delete from users where email like 'wrn-%'`)
}
cleanup()
for (const h of PEOPLE) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Wrn College", slug: "wrntest", type: "college", ownerEmail: "wrn-t@example.com" } })
const O = "/orgs/wrntest"
const orgId = psql(`select id from organizations where slug='wrntest'`)
const [t, s1, s3, out] = await Promise.all(["wrn-t", "wrn-s1", "wrn-s3", "wrn-out"].map((h) => client(`${h}@example.com`)))
const lab = (await t(`${O}/groups`, { body: { name: "wrn Lab" } })).json
const students = ["wrn-s1", "wrn-s2", "wrn-s3", "wrn-s4"]
for (const h of students) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: students.map(uid) } })

// Two finished assignments and one open, each with one problem.
const [p1, p2] = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing = 'everyone' order by slug limit 2`).split("\n")
const assignment = async (title, problemId, opensAt, dueAt) =>
  (await t(`${O}/assignments`, { body: { title, slug: title.replace(/ /g, "-").toLowerCase(), description: "", opensAt, dueAt, allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [{ problemId, points: 100, rubric: [], outcomes: [] }], questions: [] } })).json
const a1 = await assignment("wrn Week 1", p1, daysAgo(10), daysAgo(5))
const a2 = await assignment("wrn Week 2", p2, daysAgo(10), daysAgo(2))
const a3 = await assignment("wrn Week 3", p1, daysAgo(1), daysAgo(-5))
check("a class with finished and open work", !!a1?.id && !!a2?.id && !!a3?.id, JSON.stringify(a1).slice(0, 150))
const submit = (h, problemId, verdict, at) =>
  psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${problemId}','submit','python','main.py','[]',1000,256,'done','${verdict}',${verdict === "AC" ? 100 : 0},100,'${at}','${at}')`)
// s1: nothing at all. s2: everything, recently. s3: tried, all wrong. s4: everything, but rarely in class.
submit("wrn-s2", p1, "AC", daysAgo(6)); submit("wrn-s2", p2, "AC", daysAgo(3))
submit("wrn-s3", p1, "WA", daysAgo(6)); submit("wrn-s3", p2, "WA", daysAgo(3))
submit("wrn-s4", p1, "AC", daysAgo(6)); submit("wrn-s4", p2, "AC", daysAgo(4))
for (let i = 0; i < 4; i++) {
  const session = psql(`insert into teaching_sessions(org_id,group_id,day,minutes) values ('${orgId}','${lab.id}','2026-11-0${i + 1}',60) returning id`).split("\n")[0]
  for (const h of students) psql(`insert into attendance(session_id,user_id,present) values ('${session}','${uid(h)}',${h !== "wrn-s4" || i === 0})`)
}

// ---------- who needs attention
const w = await t(`${O}/classes/${lab.id}/warnings`)
const of = (h) => w.json?.students?.find((s) => s.email === `${h}@example.com`)
check("teachers see who needs attention", w.status === 200 && w.json.total === 4, JSON.stringify(w.json).slice(0, 300))
check("nothing in at all: at risk, with why", of("wrn-s1")?.level === "risk" && of("wrn-s1").reasons.includes("Missed 2 assignments") && of("wrn-s1").reasons.includes("Hasn't submitted anything yet"), JSON.stringify(of("wrn-s1")))
check("tried but scoring nothing: watch, low marks (not missed)", of("wrn-s3")?.level === "watch" && JSON.stringify(of("wrn-s3").reasons) === JSON.stringify(["0% on finished work"]), JSON.stringify(of("wrn-s3")))
check("doing the work but absent: attendance", of("wrn-s4")?.level === "watch" && of("wrn-s4").reasons[0] === "Attendance 25%", JSON.stringify(of("wrn-s4")))
check("on track: not listed", !of("wrn-s2"))
check("at risk first", w.json.students[0].email === "wrn-s1@example.com")
check("students can't see it", [403, 404].includes((await s1(`${O}/classes/${lab.id}/warnings`)).status))
check("outsiders can't either", (await out(`${O}/classes/${lab.id}/warnings`)).status === 404)

// ---------- a note to them
check("notes go only to the class's students", (await t(`${O}/classes/${lab.id}/notes`, { body: { userIds: [uid("wrn-out")], message: "Hi" } })).json?.error?.code === "not_in_class")
check("students can't send them", [403, 404].includes((await s1(`${O}/classes/${lab.id}/notes`, { body: { userIds: [uid("wrn-s3")], message: "Hi" } })).status))
const sent = await t(`${O}/classes/${lab.id}/notes`, { body: { userIds: [uid("wrn-s3")], message: "Come and see me about the labs." } })
const bell = (await s3("/me/notifications")).json
check("a note reaches the student's bell", sent.json?.sent === 1 && bell.notifications.some((n) => n.kind === "teacher_note" && n.body === "Come and see me about the labs."), JSON.stringify(bell).slice(0, 200))
check("and only them", !(await s1("/me/notifications")).json.notifications.some((n) => n.kind === "teacher_note"))
check("the log records a note, not its words", psql(`select summary from audit_log where org_id='${orgId}' and action='class.note'`) === "Sent a note to 1 students in wrn Lab")

// ---------- the page
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "wrn-t@example.com" }, secret: SECRET }), url: BASE }])
const page = await ctx.newPage()
await page.goto(`${BASE}${O}/classes/${lab.id}?tab=grades`)
await page.getByTestId("attention-row").first().waitFor({ timeout: 30000 })
check("the Grades tab lists them first", (await page.getByTestId("attention-row").count()) === 3 && (await page.getByTestId("attention-row").first().innerText()).includes("At risk"))
await page.getByRole("checkbox", { name: "Choose wrn-s1" }).click()
await page.getByRole("button", { name: /Send a note/ }).click()
await page.getByRole("dialog").getByLabel("Note").fill("You've missed two labs. Let's talk on Thursday.")
await page.screenshot({ path: SHOTS + "attention-note.png", fullPage: true })
await page.getByRole("button", { name: "Send note" }).click()
await page.getByText("Note sent to 1 student.").waitFor({ timeout: 15000 })
check("sending a note from the page", psql(`select count(*) from notifications where user_id='${uid("wrn-s1")}' and kind='teacher_note'`) === "1")
await page.screenshot({ path: SHOTS + "needs-attention.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
