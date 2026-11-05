/**
 * Assignments: due dates, late penalties, grading from submissions, the gradebook and its
 * CSV, privacy, the feature switch, and the pages students and teachers use.
 *   node e2e/assignments.mjs [base-url] [screenshot-dir]
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

const PEOPLE = [["asg-a@example.com", "student", "Asha"], ["asg-b@example.com", "student", "=HYPERLINK(\"x\")"], ["asg-t@example.com", "teacher", "Teacher"], ["asg-admin@example.com", "admin", "Admin"]]
psql(`delete from assignments where slug like 'asg-%'`)
psql(`delete from submissions where user_id in (select id from users where email like 'asg-%')`)
psql(`delete from settings where key in ('assignments.enabled','submissions.per_minute')`)
for (const [email, role, name] of PEOPLE) {
  const handle = email.split("@")[0]
  psql(`insert into users(email,name,role,handle) values ('${email}','${name.replaceAll("'", "''")}','${role}','${handle}') on conflict (email) do update set role='${role}', name=excluded.name, disabled=false`)
}
// Grading counts only students, so the gradebook lists exactly the people here.
const studentsBefore = Number(psql(`select count(*) from users where role='student' and not disabled`))

const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body, raw } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (raw) return res
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [a, b, t, admin] = await Promise.all(PEOPLE.map(([email]) => client(email)))
const settle = async (api, id) => {
  for (let i = 0; i < 600; i++) {
    const r = await api(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (api, slug, code) => settle(api, (await api("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: slug } })).json.id)
const SI = 'principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f"Simple Interest: {si:.2f}")\nprint(f"Total Amount: {principal + si:.2f}")\n'
const WRONG = 'print("no")\n'

const problems = (await t("/admin/problems")).json.problems
const id = (slug) => problems.find((p) => p.slug === slug).id
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const body = (over) => ({ title: "Week 1", slug: "asg-week-1", description: "Do both.", opensAt: hours(-1), dueAt: hours(24), allowLate: true, latePenaltyPercent: 50, published: false, problems: [{ problemId: id("p1"), points: 100 }, { problemId: id("p2"), points: 50 }], ...over })

// ---------- teachers set assignments
const draftProblem = problems.find((p) => !p.published)
if (draftProblem) {
  const refused = await t("/admin/assignments", { body: body({ slug: "asg-draft", problems: [{ problemId: draftProblem.id, points: 10 }] }) })
  check("draft problems can't be assigned", refused.status === 400 && refused.json.error.code === "draft_problem", refused.status)
}
check("due must be after opening", (await t("/admin/assignments", { body: body({ dueAt: hours(-2) }) })).status === 400)
check("a problem can't be listed twice", (await t("/admin/assignments", { body: body({ problems: [{ problemId: id("p1"), points: 1 }, { problemId: id("p1"), points: 1 }] }) })).status === 400)
check("students can't create assignments", (await a("/admin/assignments", { body: body({}) })).status === 403)
const week1 = await t("/admin/assignments", { body: body({}) })
check("teacher creates a draft assignment", week1.status === 200, JSON.stringify(week1.json).slice(0, 150))
check("a draft is hidden from students", (await a("/assignments")).json.every((x) => x.slug !== "asg-week-1") && (await a("/assignments/asg-week-1")).status === 404)
await t(`/admin/assignments/${week1.json.id}`, { method: "PUT", body: body({ published: true }) })
const listed = (await a("/assignments")).json.find((x) => x.slug === "asg-week-1")
check("published: students see it, open, nothing earned yet", listed?.phase === "open" && listed.earned === 0 && listed.total === 150 && listed.problemCount === 2, JSON.stringify(listed))
check("assignments need sign-in", (await fetch(BASE + "/api/v1/assignments")).status === 401)

// ---------- grades come from submissions
await admin("/admin/settings", { method: "PATCH", body: { "submissions.per_minute": 600 } })
check("solve p1", (await submit(a, "p1", SI)).verdict === "AC")
check("fail p2", (await submit(a, "p2", WRONG)).verdict !== "AC")
const mine = (await a("/assignments/asg-week-1")).json
const byProblem = Object.fromEntries(mine.problems.map((p) => [p.slug, p]))
check("solved on time earns full marks", byProblem.p1.status === "solved" && byProblem.p1.earned === 100)
check("a failing submission earns nothing", byProblem.p2.status === "attempted" && byProblem.p2.earned === 0)
check("totals add up", mine.earned === 100 && mine.total === 150 && mine.solved === 1, `${mine.earned}/${mine.total}`)
check("the problem page knows its assignment", (await a("/problems/p1/assignments")).json.some((x) => x.slug === "asg-week-1"))

// Past due with a 50% penalty: today's solution is late.
const late = await t("/admin/assignments", { body: body({ title: "Old", slug: "asg-old", opensAt: hours(-3), dueAt: hours(-2), published: true, problems: [{ problemId: id("p1"), points: 10 }] }) })
const old = (await a("/assignments/asg-old")).json
check("late work loses the penalty", old.phase === "late" && old.problems[0].status === "late" && old.problems[0].earned === 5, JSON.stringify(old.problems[0]))
await t(`/admin/assignments/${late.json.id}`, { method: "PUT", body: body({ title: "Old", slug: "asg-old", opensAt: hours(-3), dueAt: hours(-2), published: true, allowLate: false, problems: [{ problemId: id("p1"), points: 10 }] }) })
const closed = (await a("/assignments/asg-old")).json
check("no late work: closed and nothing counts", closed.phase === "closed" && closed.earned === 0)

// Opens tomorrow: students learn when, not what.
await t("/admin/assignments", { body: body({ title: "Later", slug: "asg-later", opensAt: hours(20), dueAt: hours(40), published: true }) })
const later = (await a("/assignments/asg-later")).json
check("an upcoming assignment hides its problems", later.phase === "upcoming" && later.problems.length === 0)
check("staff see an upcoming assignment's problems", (await t("/assignments/asg-later")).json.problems.length === 2)

// ---------- gradebook
const book = (await t(`/admin/assignments/${week1.json.id}/gradebook`)).json
const rowA = book.rows.find((r) => r.email === "asg-a@example.com")
const rowB = book.rows.find((r) => r.email === "asg-b@example.com")
check("gradebook lists every student, started or not", book.rows.length === studentsBefore && rowB?.cells.every((c) => c.status === "missing"), `${book.rows.length} vs ${studentsBefore}`)
check("gradebook has each student's marks", rowA?.earned === 100 && rowA.cells[0].earned === 100)
check("gradebook never lists staff", !book.rows.some((r) => r.email === "asg-t@example.com"))
check("gradebook summary", book.summary.started >= 1 && book.total === 150)
check("students can't read the gradebook", (await a(`/admin/assignments/${week1.json.id}/gradebook`)).status === 403)
const csv = await t(`/admin/assignments/${week1.json.id}/gradebook?format=csv`, { raw: true })
const text = await csv.text()
check("CSV downloads", csv.headers.get("content-type")?.startsWith("text/csv") && csv.headers.get("content-disposition")?.includes("asg-week-1-grades.csv"))
check("CSV header and a student's row", text.includes("Total (150)") && text.split("\r\n").some((line) => line.startsWith("Asha,asg-a@example.com,asg-a,100,0,100,0")), text.split("\r\n").slice(0, 2).join(" | "))
check("CSV can't run formulas", text.includes(`"'=HYPERLINK(""x"")"`) && !text.includes("\n=HYPERLINK"))

// ---------- the switch
await admin("/admin/settings", { method: "PATCH", body: { "assignments.enabled": false } })
await new Promise((r) => setTimeout(r, 5500))
check("assignments off: refused", (await a("/assignments")).status === 403)
check("assignments off: problem pages stop mentioning them", (await a("/problems/p1/assignments")).json.length === 0)
await admin("/admin/settings", { method: "PATCH", body: { "assignments.enabled": true } })
await new Promise((r) => setTimeout(r, 5500))

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  page.on("console", (m) => {
    if (m.type() === "error" && !/40\d|Failed to load/.test(m.text())) errors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(0, 160)}`)
  })
  return page
}

const s = await open("asg-a@example.com")
await s.goto(`${BASE}/assignments`)
await s.getByTestId("assignment-card").first().waitFor({ timeout: 30000 })
check("nav shows Assignments as the current section", (await s.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assignments" }).getAttribute("aria-current")) === "page")
check("assignments page groups by what to do", await s.getByRole("heading", { name: "To do" }).isVisible() && await s.getByRole("heading", { name: "Coming up" }).isVisible() && await s.getByRole("heading", { name: "Closed" }).isVisible())
await s.screenshot({ path: SHOTS + "assignments.png", fullPage: true })
await s.getByRole("link", { name: /Week 1/ }).click()
await s.getByTestId("assignment-problem").first().waitFor({ timeout: 15000 })
check("assignment page shows marks per problem", await s.getByText("100 / 150 points").isVisible() && await s.getByRole("cell", { name: "Solved", exact: true }).isVisible())
await s.screenshot({ path: SHOTS + "assignment.png", fullPage: true })
await s.getByRole("link", { name: "Simple Interest" }).click()
await s.getByTestId("assignment-chip").first().waitFor({ timeout: 30000 })
check("problem page links back to its assignment", (await s.getByTestId("assignment-chip").first().textContent()).includes("Week 1"))

const tp = await open("asg-t@example.com")
await tp.goto(`${BASE}/admin/assignments/new`)
await tp.getByLabel("Title").waitFor({ timeout: 30000 })
await tp.getByLabel("Title").fill("Asg UI made")
check("address follows the title", (await tp.getByLabel("Address").inputValue()) === "asg-ui-made")
await tp.getByRole("button", { name: "Add Leap Year" }).click()
await tp.getByLabel("Points").fill("40")
check("total points follow the points given", await tp.getByText("40 points in total").isVisible())
await tp.getByRole("button", { name: "Publish" }).click()
await tp.waitForURL(/\/admin\/assignments\/[0-9a-f-]{36}$/, { timeout: 15000 })
await tp.getByText("Published: students can see this assignment.").waitFor({ timeout: 15000 })
await tp.screenshot({ path: SHOTS + "assignment-editor.png", fullPage: true })
check("publishing from the form works", (await t("/assignments/asg-ui-made")).json?.problems?.[0]?.points === 40)
await tp.getByRole("link", { name: "Gradebook" }).click()
await tp.getByTestId("grade-row").first().waitFor({ timeout: 15000 })
check("gradebook page with a CSV download", await tp.getByRole("link", { name: "Download CSV" }).isVisible())
await tp.goto(`${BASE}/admin/assignments/${week1.json.id}/grades`)
await tp.getByTestId("grade-row").first().waitFor({ timeout: 15000 })
check("gradebook page shows marks", await tp.getByTestId("grade-row").filter({ hasText: "asg-a@example.com" }).getByRole("cell", { name: "100" }).first().isVisible())
await tp.screenshot({ path: SHOTS + "gradebook.png", fullPage: true })

check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" || "))
await browser.close()

psql(`delete from assignments where slug like 'asg-%'`)
psql(`delete from submissions where user_id in (select id from users where email like 'asg-%')`)
psql(`delete from users where email like 'asg-%'`)
psql(`delete from settings where key in ('assignments.enabled','submissions.per_minute')`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
