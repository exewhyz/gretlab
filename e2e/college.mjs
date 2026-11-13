/**
 * A college: courses with credits, semesters in the academic year, mid- and end-semester
 * assessments weighted into each course's grade on the UGC ten-point scale, the SGPA per
 * semester (a failed course is a backlog, its credits not earned) and the CGPA across
 * them, on the report card page and in its PDF; schools keep percentages; the kind's words.
 *   node e2e/college.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const { PDFDocument } = createRequire(ROOT + "apps/web/")("pdf-lib")
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
  psql(`delete from organizations where slug in ('cl-college','cl-school')`)
  psql(`delete from users where email like 'cl-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  call.pdf = async (path) => {
    const res = await fetch(BASE + "/api/v1" + path, { headers: { cookie } })
    return { status: res.status, doc: res.ok ? await PDFDocument.load(new Uint8Array(await res.arrayBuffer())).catch(() => null) : null }
  }
  return call
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Cl College", slug: "cl-college", type: "college", ownerEmail: "cl-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Cl School", slug: "cl-school", type: "school", ownerEmail: "cl-o@example.com" } })
const O = "/orgs/cl-college"
const owner = await client("cl-o@example.com")
const dept = (await owner(`${O}/groups`, { body: { name: "CSE" } })).json
const batch = (await owner(`${O}/groups`, { body: { name: "B.Tech 2026", parentId: dept.id } })).json
const year = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })).json
const s1 = (await owner(`${O}/students`, { body: { name: "Cl Asha", email: "cl-s1@example.com", groupId: batch.id, rollNo: 1 } })).json
const s2 = (await owner(`${O}/students`, { body: { name: "Cl Ravi", email: "cl-s2@example.com", groupId: batch.id, rollNo: 2 } })).json
const [k1] = await Promise.all(["cl-s1"].map((h) => client(`${h}@example.com`)))

// ---------- courses with credits
const course = async (name, code, credits) => {
  const c = (await owner(`${O}/subjects`, { body: { name, code, credits } })).json
  await owner(`${O}/subjects/${c.id}/classes`, { body: { groupId: batch.id } })
  return c
}
check("a course's credits must be whole or halves", (await owner(`${O}/subjects`, { body: { name: "Odd", code: "OD1", credits: 1.25 } })).status === 400)
const ds = await course("Data Structures", "CS201", 4)
const ma = await course("Mathematics III", "MA201", 3)
const lab = await course("Data Structures Lab", "CS291", 1.5)
const subjects = (await owner(`${O}/subjects`)).json
check("a college's courses carry credits", subjects?.usesCredits === true && subjects.subjects.find((s) => s.code === "CS291")?.credits === 1.5, JSON.stringify(subjects?.subjects?.map((s) => s.credits)))
check("a school's don't ask for them", (await owner("/orgs/cl-school/subjects")).json?.usesCredits === false)

// ---------- semesters
const term = async (name) => (await owner(`${O}/exams/terms`, { body: { yearId: year.id, name } })).json
const sem1 = await term("Semester 1")
const sem2 = await term("Semester 2")
check("semesters are added to the year", !!(sem1?.id && sem2?.id))
check("a semester's name is once per year", (await owner(`${O}/exams/terms`, { body: { yearId: year.id, name: "semester 1" } })).status === 409)
const list = (await owner(`${O}/exams`)).json
check("a college grades by credits, in its own words", list?.grading === "credits" && list.words.parts === "Semesters" && list.words.assessments === "Assessments" && list.terms.map((t) => t.name).join() === "Semester 1,Semester 2", JSON.stringify({ g: list?.grading, w: list?.words?.parts }))
check("its default scale is the UGC's ten points", list?.scale[0].grade === "O" && list.scale.at(-1).grade === "F")
const exam = async (name, termId, weight) => (await owner(`${O}/exams`, { body: { yearId: year.id, name, termId, weight } })).json
check("an assessment's semester must be the year's", (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Stray", termId: "00000000-0000-0000-0000-000000000000" } })).status === 400)
const mid = await exam("Mid-semester", sem1.id, 30)
const end = await exam("End semester", sem1.id, 70)
const end2 = await exam("Semester 2 exam", sem2.id, 100)
for (const e of [mid, end, end2]) await owner(`${O}/exams/${e.id}/papers`, { body: { groupIds: [batch.id], maxMarks: 100, passMarks: 40 } })
const paper = (e, c) => psql(`select id from exam_papers where exam_id='${e.id}' and subject_id='${c.id}'`)
const marks = async (e, c, a, r) => owner(`/orgs/cl-college/exam-papers/${paper(e, c)}/marks`, { method: "PUT", body: { marks: [{ userId: s1.id, marks: a }, { userId: s2.id, marks: r }] } })
// Semester 1: Asha DS 90/92 (91.4 → O), MA 70/85 (80.5 → A+), Lab 80/80 (A+); Ravi DS 30/35 (33.5 → F), MA 60/60 (B+), Lab 50/50 (C).
await marks(mid, ds, 90, 30); await marks(end, ds, 92, 35)
await marks(mid, ma, 70, 60); await marks(end, ma, 85, 60)
await marks(mid, lab, 80, 50); await marks(end, lab, 80, 50)
// Semester 2: Asha DS 85 (A+), MA 75 (A), Lab 95 (O).
await marks(end2, ds, 85, 45); await marks(end2, ma, 75, 45); await marks(end2, lab, 95, 45)
for (const e of [mid, end, end2]) await owner(`${O}/exams/${e.id}/publish`, { body: { published: true, force: true } })

// ---------- the grade card
const card = (await k1(`${O}/report-cards/me`)).json?.credits
const t1 = card?.terms.find((t) => t.name === "Semester 1")
const t2 = card?.terms.find((t) => t.name === "Semester 2")
check("each semester has a grade card", card?.terms.length === 2, JSON.stringify(card?.terms?.map((t) => t.name)))
check("a course's grade weighs its assessments in the semester", t1?.courses.find((c) => c.code === "CS201")?.grade === "O" && t1.courses.find((c) => c.code === "MA201")?.percent === 80.5 && t1.courses.find((c) => c.code === "MA201")?.grade === "A+", JSON.stringify(t1?.courses))
check("SGPA weighs grade points by credits", t1?.sgpa === 9.47 && t1.credits === 8.5 && t1.earned === 8.5, JSON.stringify({ sgpa: t1?.sgpa, credits: t1?.credits }))
check("the next semester has its own SGPA", t2?.sgpa === 8.82, String(t2?.sgpa))
const expected = Math.round(((t1?.sgpa * 8.5 + t2?.sgpa * 8.5) / 17) * 100) / 100
check("the CGPA weighs the semesters by credits", card?.cgpa === expected && card.earned === 17, JSON.stringify({ cgpa: card?.cgpa, expected, earned: card?.earned }))
const ravi = (await owner(`${O}/report-cards/${s2.id}`)).json?.credits?.terms.find((t) => t.name === "Semester 1")
check("a failed course is a backlog, its credits not earned", ravi?.courses.find((c) => c.code === "CS201")?.grade === "F" && ravi.backlogs === 1 && ravi.earned === 4.5 && ravi.sgpa === 3.35, JSON.stringify({ sgpa: ravi?.sgpa, earned: ravi?.earned, backlogs: ravi?.backlogs }))
const pdf = await k1.pdf(`${O}/report-cards/me/pdf`)
check("the grade card prints as a PDF", pdf.status === 200 && pdf.doc?.getPageCount() >= 1)
check("a school's report card has no grade card", (await owner("/orgs/cl-school/exams")).json?.grading === "marks")

// ---------- removing a semester keeps its assessments
const sem3 = await term("Summer term")
const extra = await exam("Summer test", sem3.id, 0)
check("removing a semester keeps its assessments, without one", (await owner(`${O}/exams/terms/${sem3.id}`, { method: "DELETE" })).status === 200 && psql(`select coalesce(term_id::text,'none') from term_exams where id='${extra.id}'`) === "none")

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const o = await view("cl-o@example.com", 1440)
await o.goto(`${BASE}${O}/manage/exams`)
await o.getByRole("heading", { name: "Assessments" }).waitFor({ timeout: 30000 })
await o.getByRole("button", { name: /Semesters/ }).click()
await o.getByTestId("terms").waitFor({ timeout: 15000 })
check("the exams page manages semesters, in the college's words", (await o.getByTestId("terms").innerText()).includes("Semester 2"))
await o.keyboard.press("Escape")
const kp = await view("cl-s1@example.com", 1440)
await kp.goto(`${BASE}${O}/results/me`)
await kp.getByTestId("grade-card").waitFor({ timeout: 30000 })
check("the student's report card shows the grade card and CGPA", (await kp.getByTestId("cgpa").innerText()) === expected.toFixed(2) && (await kp.getByTestId("grade-term").count()) === 2)
await kp.screenshot({ path: SHOTS + "grade-card.png", fullPage: true })
const phone = await view("cl-s1@example.com", 390)
await phone.goto(`${BASE}${O}/results/me`)
await phone.getByTestId("grade-card").waitFor({ timeout: 30000 })
check("...and fits a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
