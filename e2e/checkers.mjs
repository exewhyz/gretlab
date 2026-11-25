/**
 * How a problem's output is checked: built-in comparers (numbers within a tolerance, lines in
 * any order, spacing, case), judged in the real sandbox (needs a runner up, as in e2e/run.sh),
 * in the browser, written in the editor and the import format, and told to students.
 *   node e2e/checkers.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from submissions where user_id in (select id from users where email like 'ck-%')`)
  psql(`delete from problems where slug like 'ck-%'`)
  psql(`delete from users where email like 'ck-%'`)
}
cleanup()
for (const [h, role] of [["ck-s", "student"], ["ck-admin", "admin"]]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','${role}','${h}')`)
const client = async (h) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email: `${h}@example.com` }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [s, admin] = await Promise.all([client("ck-s"), client("ck-admin")])
const setting = (changes) => admin("/admin/settings", { method: "PATCH", body: changes })
await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 60 })

// Print each number's third and its name, one per line: any order, within 1e-6, any case.
const tests = [
  { input: "1 one\n2 two", expected: "0.333333333 ONE\n0.666666667 TWO", isSample: true, points: 1 },
  { input: "3 three\n9 nine", expected: "1 THREE\n3 NINE", isSample: false, points: 1 },
]
const body = (slug, checker) => ({ slug, title: slug, unitId: null, level: "easy", description: "Divide by three.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests, checker })
const CHECKER = { numbers: { absolute: 1e-6 }, unordered: true, ignoreCase: true }

// ---------- writing a checker
check("a tolerance is required with numbers", (await admin("/admin/problems", { body: body("ck-bad", { numbers: {} }) })).status === 400)
check("an unknown comparer is refused", (await admin("/admin/problems", { body: body("ck-bad", { regex: ".*" }) })).status === 400)
const made = await admin("/admin/problems", { body: body("ck-third", CHECKER) })
check("a problem with a checker saves", made.status === 200, JSON.stringify(made.json).slice(0, 200))
await admin("/admin/problems", { body: body("ck-exact", null) })
check("the editor gets the checker back", JSON.stringify((await admin(`/admin/problems/${made.json?.id}`)).json?.checker) === JSON.stringify(CHECKER))
const page = (await s("/problems/ck-third")).json
check("students are told how output is checked", page?.checkerNote === "Numbers within 1e-6 are accepted. Lines may be in any order. Upper and lower case count as the same.", page?.checkerNote)
check("an exact problem says nothing", (await s("/problems/ck-exact")).json?.checkerNote === null)

// ---------- judged in the sandbox
const settle = async (id) => {
  for (let i = 0; i < 900; i++) {
    const r = await s(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (slug, code, extra = {}) => {
  const res = await s("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: slug, ...extra } })
  if (!res.json?.id) throw new Error(JSON.stringify(res.json))
  return settle(res.json.id)
}
// Lower case, reversed lines, more digits, and 1.0E+0 spelt as a float.
const LOOSE = "import sys\nrows = [l.split() for l in sys.stdin.read().splitlines()]\nfor n, w in reversed(rows):\n    print(f'{int(n)/3:.10E} {w}')\n"
const WRONG = "import sys\nrows = [l.split() for l in sys.stdin.read().splitlines()]\nfor n, w in rows:\n    print(f'{int(n)/3 + 0.001:.6f} {w}')\n"
const loose = await submit("ck-third", LOOSE)
check("numbers spelt differently, lines reversed, other case: Accepted", loose.verdict === "AC", JSON.stringify(loose.results?.map((r) => r.verdict)))
check("the submission keeps the checker it was judged by", JSON.stringify(psql(`select checker from submissions where id='${loose.id}'`) && JSON.parse(psql(`select checker::text from submissions where id='${loose.id}'`))) === JSON.stringify(CHECKER))
check("past the tolerance: Wrong answer", (await submit("ck-third", WRONG)).verdict === "WA")
check("without a checker the same program is wrong", (await submit("ck-exact", LOOSE)).verdict === "WA")

// ---------- graded in the browser, the same way
await setting({ "server_execution.enabled": false, "browser_execution.enabled": true, "browser_execution.grading": true })
const given = (await s("/submissions/tests?problem=ck-third")).json?.tests ?? []
const third = (input) => input.split("\n").reverse().map((l) => { const [n, w] = l.split(" "); return `${(Number(n) / 3).toExponential(9)} ${w}` }).join("\n") + "\n"
const browser = await s("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: LOOSE }], problemSlug: "ck-third", browser: { outputs: given.map((c) => ({ testCaseId: c.id, stdout: third(c.input), stderr: "", wallMs: 1 })) } } })
check("browser grading uses the checker too", browser.json?.id && (await s(`/submissions/${browser.json.id}`)).json?.verdict === "AC", JSON.stringify(browser.json))
await setting({ "server_execution.enabled": true, "browser_execution.grading": false })

// ---------- importing a checker
const imported = await admin("/admin/problems/import", { body: { file: { problems: [{ title: "Ck Imported", slug: "ck-imported", statement: "Half.", samples: [{ input: "1", output: "0.5" }], checker: { numbers: { relative: 1e-9 } } }] }, listed: false, published: true } })
const importedChecker = JSON.parse(psql(`select coalesce(checker::text, 'null') from problems where slug='ck-imported'`) || "null")
check("importing keeps the checker", imported.status === 200 && importedChecker?.numbers?.relative === 1e-9 && Object.keys(importedChecker).length === 1, JSON.stringify(importedChecker))
check("an import with a bad checker is refused, naming it", (await admin("/admin/problems/import", { body: { file: { problems: [{ title: "Ck Bad", statement: "x", samples: [{ input: "1", output: "1" }], checker: { numbers: { absolute: -1 } } }] }, listed: false, published: true } })).status === 400)

// ---------- the pages
const pw = await chromium.launch()
const errors = []
const as = async (h, viewport = { width: 1440, height: 900 }) => {
  const ctx = await pw.newContext({ viewport })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE }])
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  return p
}
try {
  const e = await as("ck-admin")
  await e.goto(`${BASE}/admin/problems/${made.json.id}`)
  await e.getByTestId("checker-settings").waitFor({ timeout: 30000 })
  check("the editor shows the checker and what students will read", (await e.getByTestId("checker-note").textContent()).includes("Numbers within 1e-6 are accepted"))
  await e.getByLabel("Absolute tolerance").fill("0.001")
  await e.getByTestId("checker-note").getByText(/Numbers within 0\.001/).waitFor({ timeout: 5000 })
  check("changing the tolerance updates the line", true)
  await e.getByTestId("checker-settings").scrollIntoViewIfNeeded()
  await e.evaluate(() => window.scrollBy(0, -150))
  await e.screenshot({ path: `${SHOTS}ck-editor.png` })

  const p = await as("ck-s", { width: 390, height: 844 })
  await p.goto(`${BASE}/problems/ck-third`)
  await p.getByTestId("checker-note").waitFor({ timeout: 60000 })
  check("the problem page tells students, on a phone", (await p.getByTestId("checker-note").textContent()).includes("Lines may be in any order"))
  await p.getByTestId("checker-note").scrollIntoViewIfNeeded()
  await p.screenshot({ path: `${SHOTS}ck-problem-phone.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await pw.close()
  await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 12 })
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checker checks passed")
process.exit(failures ? 1 : 0)
