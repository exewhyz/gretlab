/**
 * Checker programs written by teachers, judged in the real sandbox (needs a runner up, as in
 * e2e/run.sh): any correct answer accepted, partly right earning a share, wrong with the
 * checker's message (staff always, students only on samples), a checker that fails or doesn't
 * compile as a system error, the code never sent to students, never graded in the browser, and
 * the editor.
 *   node e2e/checker-programs.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from submissions where user_id in (select id from users where email like 'cp-%')`)
  psql(`delete from problems where slug like 'cp-%'`)
  psql(`delete from users where email like 'cp-%'`)
}
cleanup()
for (const [h, role] of [["cp-s", "student"], ["cp-admin", "admin"]]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','${role}','${h}')`)
const cookieFor = async (h) => ({ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE })
const client = async (h) => {
  const cookie = `next-auth.session-token=${(await cookieFor(h)).value}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [s, admin] = await Promise.all([client("cp-s"), client("cp-admin")])
const setting = (changes) => admin("/admin/settings", { method: "PATCH", body: changes })
await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 60 })

// "Print two non-negative numbers adding up to n": many right answers. The expected outputs
// are one of them ("n 0"), which a plain comparison would hold the student to.
const tests = [
  { input: "5", expected: "5 0", isSample: true, points: 1 },
  { input: "12", expected: "12 0", isSample: false, points: 10 },
  { input: "40", expected: "40 0", isSample: false, points: 10 },
]
const PY_CHECKER = `import sys
n = int(open("input.txt").read())
assert open("answer.txt").read().split()[0] == str(n)  # the answer is there too
try:
    a, b = map(int, open("output.txt").read().split())
except ValueError:
    print("Print two whole numbers.")
    sys.exit(1)
if a < 0 or b < 0:
    print("Both must be non-negative.")
    sys.exit(1)
if a + b == n:
    sys.exit(0)
if abs(a + b - n) == 1:
    print("0.5")
    print(f"{a} + {b} is off by one.")
    sys.exit(3)
print(f"{a} + {b} = {a + b}, not {n}.")
sys.exit(1)
`
const body = (slug, checker) => ({ slug, title: slug, unitId: null, level: "easy", description: "Two numbers adding up to n.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests, checker })

// ---------- writing one
check("a checker program needs code", (await admin("/admin/problems", { body: body("cp-bad", { program: { language: "python", code: " " } }) })).status === 400)
check("and isn't combined with the built-in comparers", (await admin("/admin/problems", { body: body("cp-bad", { program: { language: "python", code: PY_CHECKER }, spacing: true }) })).status === 400)
const made = await admin("/admin/problems", { body: body("cp-sum", { program: { language: "python", code: PY_CHECKER } }) })
check("a problem with a checker program saves", made.status === 200, JSON.stringify(made.json).slice(0, 200))
check("the editor gets its code back", (await admin(`/admin/problems/${made.json?.id}`)).json?.checker?.program?.code === PY_CHECKER)
const page = (await s("/problems/cp-sum")).json
check("students are told any correct answer counts", /any correct answer/.test(page?.checkerNote ?? ""), page?.checkerNote)
check("...and never get the checker's code", page?.checker?.program?.code === "" && page.checker.program.language === "python", JSON.stringify(page?.checker))

// ---------- judged in the sandbox
const settle = async (who, id) => {
  for (let i = 0; i < 900; i++) {
    const r = await who(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (slug, code, kind = "submit") => {
  // A Run tries the sample's input, which the server matches to its expected output.
  const res = await s("/submissions", { body: { kind, language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: slug, ...(kind === "run" ? { inputs: ["5"] } : {}) } })
  if (!res.json?.id) throw new Error(JSON.stringify(res.json))
  return settle(s, res.json.id)
}
const other = await submit("cp-sum", "n = int(input())\nprint(0, n)\n")
check("another correct answer than the expected one is Accepted", other.verdict === "AC" && other.score === 21, JSON.stringify({ v: other.verdict, s: other.score, r: other.results?.map((r) => r.verdict) }))
const near = await submit("cp-sum", "n = int(input())\nprint(0, n - 1)\n")
check("partly right: Partially correct, half of each test's points (rounded down)", near.verdict === "PC" && JSON.stringify(near.results?.map((r) => r.points)) === "[0,5,5]" && near.score === 10, JSON.stringify(near.results?.map((r) => [r.verdict, r.points])))
const wrong = await submit("cp-sum", "print(1, 1)\n")
check("wrong: Wrong answer", wrong.verdict === "WA" && wrong.score === 0)
check("the checker's message on a sample is shown to the student", wrong.results?.[0]?.checkerMessage === "1 + 1 = 2, not 5.", JSON.stringify(wrong.results?.[0]))
check("...but never on a hidden test", wrong.results?.[1]?.checkerMessage === null)
const staffView = (await admin(`/submissions/${wrong.id}`)).json
check("staff read it on every test", staffView?.results?.[1]?.checkerMessage === "1 + 1 = 2, not 12.", JSON.stringify(staffView?.results?.[1]))
const ran = await submit("cp-sum", "n = int(input())\nprint(n, 0)\n", "run")
check("a Run on the server is checked by it too (sample cases passed)", ran.verdict === "AC", ran.verdict)

// A checker that fails, and one that doesn't compile: the problem's fault, never the student's.
await admin("/admin/problems", { body: body("cp-broken", { program: { language: "python", code: "import sys\nsys.exit(7)\n" } }) })
const broken = await submit("cp-broken", "n = int(input())\nprint(0, n)\n")
check("a checker that fails is a System error, not Wrong", broken.verdict === "SE", broken.verdict)
await admin("/admin/problems", { body: body("cp-nocompile", { program: { language: "cpp", code: "int main( {" } }) })
const nocompile = await submit("cp-nocompile", "n = int(input())\nprint(0, n)\n")
check("a checker that doesn't compile: System error, saying so to staff", nocompile.verdict === "SE" && /doesn't compile/.test((await admin(`/submissions/${nocompile.id}`)).json?.results?.[1]?.checkerMessage ?? ""), JSON.stringify((await admin(`/submissions/${nocompile.id}`)).json?.results?.[1]))
await admin("/admin/problems", { body: body("cp-cpp", { program: { language: "cpp", code: "#include <fstream>\nint main(){std::ifstream i(\"input.txt\"),o(\"output.txt\");long n,a,b;i>>n;o>>a>>b;return a>=0&&b>=0&&a+b==n?0:1;}\n" } }) })
check("a checker in C++ works the same", (await submit("cp-cpp", "n = int(input())\nprint(1, n - 1)\n")).verdict === "AC")

// ---------- never in the browser
await setting({ "server_execution.enabled": false, "browser_execution.enabled": true, "browser_execution.grading": true })
await admin("/admin/problems", { body: body("cp-plain", null) })
check("with grading in the browser, a plain problem is graded there", (await s("/execution?problem=cp-plain")).json?.submit === "browser")
const plan = (await s("/execution?problem=cp-sum")).json
check("a problem with a checker program is never graded in the browser", plan?.submit === "none" && plan.run === "browser", JSON.stringify(plan))
check("...and its tests aren't handed to the browser", (await s("/submissions/tests?problem=cp-sum")).status >= 400)
await setting({ "server_execution.enabled": true, "browser_execution.grading": false })

// ---------- the editor
const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addCookies([await cookieFor("cp-admin")])
  const e = await ctx.newPage()
  e.on("pageerror", (err) => errors.push(err.message.slice(0, 200)))
  await e.goto(`${BASE}/admin/problems/${made.json.id}`)
  const box = e.getByTestId("checker-settings")
  await box.waitFor({ timeout: 30000 })
  check("the editor shows the checker program", (await box.getByLabel("Checker code").inputValue()) === PY_CHECKER)
  await box.getByLabel("Checker language").selectOption("cpp")
  await box.getByRole("button", { name: "Start from an example" }).click()
  check("an example to start from, in the chosen language", (await box.getByLabel("Checker code").inputValue()).includes("#include"))
  await box.scrollIntoViewIfNeeded()
  await e.screenshot({ path: `${SHOTS}checker-program-editor.png` })
  await box.getByRole("radio", { name: "Compare with the expected output" }).click()
  check("switching back to comparing drops the program", (await box.getByLabel("Checker code").count()) === 0 && (await box.getByTestId("checker-note").textContent()).includes("Exact"))
  await box.getByRole("radio", { name: "A checker program decides" }).click()
  check("and choosing a program starts from the Python example", (await box.getByLabel("Checker code").inputValue()).includes("answer.txt"))
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checker program checks passed")
process.exit(failures ? 1 : 0)
