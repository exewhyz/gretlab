/**
 * Test-case groups (subtasks): a group earns its tests' points only when all of them pass, and
 * once one fails the judge skips the rest of the group. Judged in the real sandbox (needs a
 * runner up, as in e2e/run.sh), in the browser, on an IOI board and in an assignment's grade;
 * written in the editor and the import format; shown on the submission page.
 *   node e2e/test-groups.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from submissions where user_id in (select id from users where email like 'tg-%')`)
  psql(`delete from contests where slug = 'tg-cup'`)
  psql(`delete from assignments where slug = 'tg-week'`)
  psql(`delete from problems where slug like 'tg-%'`)
  psql(`delete from users where email like 'tg-%'`)
}
cleanup()
for (const [email, role] of [["tg-s@example.com", "student"], ["tg-admin@example.com", "admin"]]) {
  psql(`insert into users(email,name,role,handle) values ('${email}','${email.split("@")[0]}','${role}','${email.split("@")[0]}')`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [s, admin] = await Promise.all([client("tg-s@example.com"), client("tg-admin@example.com")])
const setting = (changes) => admin("/admin/settings", { method: "PATCH", body: changes })
await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 60 })

// The program doubles a number; the wrong one gets numbers from 1000 up wrong.
const RIGHT = "n = int(input())\nprint(n * 2)\n"
const WRONG = "n = int(input())\nprint(n * 2 if n < 1000 else 0)\n"
const test = (input, group, points, isSample = false) => ({ input, expected: String(Number(input) * 2), isSample, points, group })
const tests = [
  test("1", null, 0, true), // a sample, ungrouped
  test("3", "Small", 10),
  test("5", "Small", 10),
  test("999", "Large", 15),
  test("2000", "Large", 15), // the wrong program fails here...
  test("3000", "Large", 15), // ...so this one is skipped
  test("7", null, 5), // ungrouped
]
const problemBody = { slug: "tg-double", title: "Tg Double", unitId: null, level: "easy", description: "Print twice the number.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests }

// ---------- writing groups
check("a group name past 40 characters is refused", (await admin("/admin/problems", { body: { ...problemBody, tests: [test("1", null, 0, true), test("2", "x".repeat(41), 1)] } })).status === 400)
const made = await admin("/admin/problems", { body: problemBody })
check("a problem with groups saves", made.status === 200, JSON.stringify(made.json).slice(0, 200))
check("blank group names are stored as none, others as written", psql(`select string_agg(coalesce(group_name, '-'), ',' order by position) from test_cases where problem_id='${made.json?.id}'`) === "-,Small,Small,Large,Large,Large,-")
const staffView = (await admin(`/admin/problems/${made.json?.id}`)).json
check("the editor gets each test's group back", staffView?.tests?.[1]?.group === "Small" && staffView?.tests?.[0]?.group === null)

// ---------- judged in the sandbox
const settle = async (id) => {
  for (let i = 0; i < 900; i++) {
    const r = await s(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (code, extra = {}) => {
  const res = await s("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: "tg-double", ...extra } })
  if (!res.json?.id) throw new Error(JSON.stringify(res.json))
  return settle(res.json.id)
}
const wrong = await submit(WRONG)
check("a failed group: Wrong answer, the passing groups and tests still score", wrong.verdict === "WA" && wrong.score === 25 && wrong.maxScore === 70, JSON.stringify({ v: wrong.verdict, s: wrong.score, m: wrong.maxScore }))
check("each test's verdict: the rest of the failed group is Skipped", wrong.results.map((r) => r.verdict).join() === "AC,AC,AC,AC,WA,SK,AC", wrong.results.map((r) => r.verdict).join())
check("a skipped test wasn't run", wrong.results[5]?.wallMs === 0)
check("earned points: a passing test in a failed group earns nothing", wrong.results.map((r) => r.points).join() === "0,10,10,0,0,0,5", wrong.results.map((r) => r.points).join())
check("each group: what it earned of what it's worth", JSON.stringify(wrong.groups) === JSON.stringify([{ name: "Small", points: 20, earned: 20, passed: true, tests: 2 }, { name: "Large", points: 45, earned: 0, passed: false, tests: 3 }]), JSON.stringify(wrong.groups))
check("students still see nothing of hidden tests", wrong.results.filter((r) => r.hidden).every((r) => r.input === null && r.expected === null && r.stdout === null))
const right = await submit(RIGHT)
check("every test passing: Accepted, full score, every group passed", right.verdict === "AC" && right.score === 70 && right.groups.every((g) => g.passed), JSON.stringify({ v: right.verdict, s: right.score }))

// ---------- an IOI contest and an assignment read the score
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
await admin("/admin/contests", { body: { title: "Tg Cup", slug: "tg-cup", description: "", startsAt: hours(-1), endsAt: hours(3), scoring: "ioi", penaltyMinutes: 0, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [made.json.id], questions: [] } })
const registered = await s("/contests/tg-cup/registration", { body: {} })
check("registering for the contest", registered.status === 200, JSON.stringify(registered.json))
await submit(WRONG, { contestSlug: "tg-cup" })
const board = (await s("/contests/tg-cup/leaderboard")).json
check("the IOI board counts the groups' score", board?.rows?.[0]?.score === 25, JSON.stringify(board?.rows?.[0]))
const week = await admin("/admin/assignments", { body: { title: "Tg Week", slug: "tg-week", description: "", opensAt: hours(-1), dueAt: hours(24), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: made.json.id, points: 14 }], questions: [] } })
// Only the failed-group submission counts here: 25 of 70 of the problem's 14 points is 5.
psql(`delete from submissions where user_id=(select id from users where email='tg-s@example.com')`)
const shown = await submit(WRONG, {})
const book = (await admin(`/admin/assignments/${week.json?.id}/gradebook`)).json
const mine = book?.rows?.find((r) => r.email === "tg-s@example.com")
check("an assignment's grade is the share of points the groups earned", mine?.earned === 5, JSON.stringify(mine).slice(0, 300))

// ---------- graded in the browser, the same way
await setting({ "server_execution.enabled": false, "browser_execution.enabled": true, "browser_execution.grading": true })
const given = (await s("/submissions/tests?problem=tg-double")).json?.tests ?? []
const outputs = given.map((c) => ({ testCaseId: c.id, stdout: `${Number(c.input) < 1000 ? Number(c.input) * 2 : 0}\n`, stderr: "", wallMs: 2 }))
const browserRes = await s("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: WRONG }], problemSlug: "tg-double", browser: { outputs } } })
const browserRow = browserRes.json?.id ? (await s(`/submissions/${browserRes.json.id}`)).json : null
check("browser grading scores groups as the server does", browserRow?.score === 25 && browserRow?.maxScore === 70 && browserRow?.groups?.[1]?.earned === 0, JSON.stringify({ s: browserRow?.score, g: browserRow?.groups }))
await setting({ "server_execution.enabled": true, "browser_execution.grading": false })

// ---------- importing groups
const imported = await admin("/admin/problems/import", { body: { file: { problems: [{ title: "Tg Imported", slug: "tg-imported", statement: "Double it.", samples: [{ input: "1", output: "2" }], tests: [{ input: "4", output: "8", group: " Part A " }, { input: "6", output: "12", group: "Part A", points: 3 }] }] }, listed: false, published: true } })
check("importing keeps each test's group, trimmed", imported.status === 200 && psql(`select string_agg(coalesce(group_name, '-'), ',' order by position) from test_cases where problem_id=(select id from problems where slug='tg-imported')`) === "-,Part A,Part A", JSON.stringify(imported.json).slice(0, 200))

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const as = async (email, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  return page
}
try {
  const e = await as("tg-admin@example.com")
  await e.goto(`${BASE}/admin/problems/${made.json.id}`)
  await e.getByTestId("test-groups").waitFor({ timeout: 30000 })
  const totals = await e.getByTestId("test-groups").textContent()
  check("the editor adds up each group", totals.includes("Small: 2 tests, 20 points") && totals.includes("Large: 3 tests, 45 points"), totals)
  await e.getByLabel("Test 7 group").fill("Small")
  await e.getByTestId("test-groups").getByText("Small: 3 tests, 25 points").waitFor({ timeout: 5000 })
  check("typing a group updates the totals", true)
  await e.getByTestId("test-groups").scrollIntoViewIfNeeded()
  await e.evaluate(() => window.scrollBy(0, -200))
  await e.screenshot({ path: `${SHOTS}tg-editor-groups.png` })

  const p = await as("tg-s@example.com")
  await p.goto(`${BASE}/submissions/${shown.id}`)
  await p.getByTestId("group-scores").waitFor({ timeout: 30000 })
  const groups = await p.getByTestId("group-scores").textContent()
  check("the submission page shows each group's points and where it failed", groups.includes("Small") && groups.includes("20 / 20 points") && groups.includes("0 / 45 points") && /failed on Hidden test 4, 1 skipped/.test(groups), groups)
  await p.getByRole("tab", { name: "Hidden test 5" }).click()
  await p.getByText(/An earlier test in Large failed/).waitFor({ timeout: 5000 })
  check("a skipped test says why, and its chip is the one selected", (await p.getByRole("tab", { name: "Hidden test 5" }).getAttribute("aria-selected")) === "true" && (await p.getByRole("tab", { name: "Hidden test 4" }).getAttribute("aria-selected")) === "false")
  check("a skipped test shows no timing", (await p.getByText(/^0 ms/).count()) === 0)
  await p.mouse.move(0, 0)
  await p.screenshot({ path: `${SHOTS}tg-submission.png`, fullPage: true })
  const phone = await as("tg-s@example.com", { width: 390, height: 844 })
  await phone.goto(`${BASE}/submissions/${shown.id}`)
  await phone.getByTestId("group-scores").waitFor({ timeout: 30000 })
  check("on a phone, without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.screenshot({ path: `${SHOTS}tg-submission-phone.png`, fullPage: true })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 12 })
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll test group checks passed")
process.exit(failures ? 1 : 0)
