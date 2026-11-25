/**
 * Where code runs, profiles, and one organization's modules.
 * - Execution in three levels: the platform's switches, an organization's (it can only
 *   narrow them), an assignment's or contest's choice. Browser grading: every test's input
 *   reaches the browser, never an expected output; the server checks the outputs; verdicts
 *   are provisional and judged again by the sandbox once it can (checked when a runner is up).
 *   A work's submission limit, never above the platform's.
 * - The platform setting one organization's modules over its kind's.
 * - Account › Profile and an organization member's profile: who sees what, who edits what.
 * - The pages: Account's tabs, the sidebar footer and logo, a profile, the form's execution
 *   section, and a JavaScript Submit graded in the browser.
 *   node e2e/execution-profiles.mjs [base-url] [screenshot-dir]
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
const SLUGS = ["xp-add", "xp-cup"]
const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'xp-%')`)
  psql(`delete from contests where slug in ('xp-cup')`)
  psql(`delete from assignments where slug like 'xp-%'`)
  psql(`delete from organizations where slug = 'xp-school'`)
  psql(`delete from test_cases where problem_id in (select id from problems where slug in (${SLUGS.map((s) => `'${s}'`).join(",")}) or slug like 'xp-%')`)
  psql(`delete from problems where slug like 'xp-%'`)
  psql(`delete from users where email like 'xp-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["xp-o", "xp-t", "xp-s1", "xp-s2", "xp-x"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Xp ${h.slice(3)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const setting = (changes) => admin("/admin/settings", { method: "PATCH", body: changes })
// Known starting point: everything on, browser grading off (its default).
await setting({ "server_execution.enabled": true, "browser_execution.enabled": true, "browser_execution.grading": false, "submissions.per_minute": 12 })

await admin("/admin/organizations", { body: { name: "Xp School", slug: "xp-school", type: "school", ownerEmail: "xp-o@example.com" } })
const O = "/orgs/xp-school", orgId = psql(`select id from organizations where slug='xp-school'`)
const [owner, t, s1, s2, x] = await Promise.all(["xp-o", "xp-t", "xp-s1", "xp-s2", "xp-x"].map((h) => client(`${h}@example.com`)))
const g = (await owner(`${O}/groups`, { body: { name: "Grade 7" } })).json
const a7 = (await owner(`${O}/groups`, { body: { name: "A", parentId: g.id } })).json
const b7 = (await owner(`${O}/groups`, { body: { name: "B", parentId: g.id } })).json
psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid("xp-t")}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("xp-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: a7.id } })
await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })
for (const [h, grp] of [["xp-s1", a7], ["xp-s2", b7]]) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
  psql(`insert into group_members(group_id,user_id) values ('${grp.id}','${uid(h)}')`)
}
const rec = (await owner(`${O}/students`, { body: { name: "Xp Kid", email: "xp-k@example.com", groupId: a7.id, rollNo: 4, gender: "female", birthDate: "2014-05-09", phone: "+91 90000 11111" } })).json
await owner(`${O}/parents`, { body: { studentId: rec?.id, email: "xp-p@example.com", name: "Xp Parent", relation: "Mother" } })
const [kid, parent] = await Promise.all(["xp-k", "xp-p"].map((h) => client(`${h}@example.com`)))
check("the set-up worked", Boolean(g?.id && a7?.id && rec?.id), JSON.stringify(rec))

// A practice problem of the platform's and one of the school's, each with a hidden test.
const problemBody = (slug, title) => ({ slug, title, unitId: null, level: "easy", statement: ["Print the sum of two numbers."], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "2 3", expected: "5", isSample: true, points: 1 }, { input: "40 2", expected: "42", isSample: false, points: 3 }] })
const made = await admin("/admin/problems", { body: problemBody("xp-add", "Xp Add") })
check("a practice problem", made.status === 200, JSON.stringify(made.json).slice(0, 200))
const orgProblem = await owner(`${O}/problems`, { body: { ...problemBody("xp-org-add", "Xp Org Add"), listed: true } })
check("the school's own problem", orgProblem.status === 200, JSON.stringify(orgProblem.json).slice(0, 200))
const JS = 'const [a, b] = require("fs").readFileSync(0, "utf8").trim().split(" ").map(Number)\nconsole.log(a + b)\n'
const files = [{ path: "main.js", content: JS }]
const plan = (who, q) => who(`/execution?${new URLSearchParams(q)}`)
const tests = (who, q) => who(`/submissions/tests?${new URLSearchParams(q)}`)
const browserSubmit = (who, problemSlug, outputs, extra = {}) => who("/submissions", { body: { kind: "submit", language: "javascript", entry: "main.js", files, problemSlug, browser: { outputs }, ...extra } })
const outputsFor = (list, fn) => list.map((c) => ({ testCaseId: c.id, stdout: fn(c.input), stderr: "", wallMs: 3 }))
const sum = (input) => `${input.split(" ").map(Number).reduce((a, b) => a + b, 0)}\n`

// ---------- the platform's level
check("server on: practice runs and submits on the server", JSON.stringify((await plan(s1, { problem: "xp-add" })).json) === JSON.stringify({ run: "server", submit: "server", browserOnly: false }))
check("visitors run in the browser and can't submit", JSON.stringify((await (await fetch(`${BASE}/api/v1/execution?problem=xp-add`)).json())) === JSON.stringify({ run: "browser", submit: "none", browserOnly: true }))
check("the test inputs aren't handed out while the server grades", (await tests(s1, { problem: "xp-add" })).json?.error?.code === "browser_grading_off")
await setting({ "server_execution.enabled": false })
check("server off, grading off: runs in the browser, Submit paused", JSON.stringify((await plan(s1, { problem: "xp-add" })).json) === JSON.stringify({ run: "browser", submit: "none", browserOnly: true }))
const refusedSubmit = await s1("/submissions", { body: { kind: "submit", language: "javascript", entry: "main.js", files, problemSlug: "xp-add" } })
check("...and a server Submit is refused", refusedSubmit.status === 403 && refusedSubmit.json?.error?.code === "feature_disabled", JSON.stringify(refusedSubmit.json))
await setting({ "browser_execution.grading": true })
check("with browser grading on, practice submits in the browser", (await plan(s1, { problem: "xp-add" })).json?.submit === "browser")
const given = await tests(s1, { problem: "xp-add" })
check("every test's input is given, never an expected output", given.json?.tests?.length === 2 && given.json.tests.every((c) => c.id && typeof c.input === "string" && !("expected" in c)), JSON.stringify(given.json))
check("a plain server Submit says to submit from the browser", (await s1("/submissions", { body: { kind: "submit", language: "javascript", entry: "main.js", files, problemSlug: "xp-add" } })).json?.error?.code === "grade_in_browser")
const good = await browserSubmit(s1, "xp-add", outputsFor(given.json.tests, sum))
const goodRow = good.json?.id ? (await s1(`/submissions/${good.json.id}`)).json : null
check("right outputs: Accepted, provisional, with full points", goodRow?.verdict === "AC" && goodRow.provisional === true && goodRow.score === 4 && goodRow.maxScore === 4 && goodRow.status === "done", JSON.stringify(goodRow).slice(0, 300))
check("the hidden test's input and output stay hidden from the student", goodRow?.results?.find((r) => r.hidden)?.input === null && goodRow.results.find((r) => r.hidden).expected === null)
const wrong = await browserSubmit(s1, "xp-add", outputsFor(given.json.tests, () => "0\n"))
check("wrong outputs: Wrong answer", (await s1(`/submissions/${wrong.json?.id}`)).json?.verdict === "WA")
const crashed = await browserSubmit(s1, "xp-add", given.json.tests.map((c) => ({ testCaseId: c.id, stdout: "", stderr: "TypeError: boom", wallMs: 1 })))
check("a program that failed: Runtime error", (await s1(`/submissions/${crashed.json?.id}`)).json?.verdict === "RE")
check("missing a test's output is refused", (await browserSubmit(s1, "xp-add", outputsFor(given.json.tests.slice(0, 1), sum))).json?.error?.code === "missing_outputs")
check("a language that can't run in a browser is refused", (await s1("/submissions", { body: { kind: "submit", language: "cpp", entry: "main.cpp", files: [{ path: "main.cpp", content: "int main(){}" }], problemSlug: "xp-add", browser: { outputs: outputsFor(given.json.tests, sum) } } })).json?.error?.code === "language_unavailable")
check("a Run can't carry browser outputs", (await s1("/submissions", { body: { kind: "run", language: "javascript", entry: "main.js", files, problemSlug: "xp-add", browser: { outputs: [] } } })).status === 400)
check("provisional rows are kept as such", psql(`select count(*) from submissions where user_id='${uid("xp-s1")}' and provisional`) === "3")

// ---------- an organization narrows the platform
check("the school's practice needs the school to allow browser grading", (await plan(s1, { problem: "xp-org-add" })).json?.submit === "none")
const settingsOf = async () => (await owner(`${O}/manage`)).json?.org?.execution
check("Settings shows the school's execution and the platform's", JSON.stringify(await settingsOf()) === JSON.stringify({ server: true, browserGrading: false, platform: { server: false, browser: true, browserGrading: true } }), JSON.stringify(await settingsOf()))
check("a teacher can't change it", (await t(O, { method: "PATCH", body: { execution: { server: true, browserGrading: true } } })).status === 403)
check("the owner allows browser grading", (await owner(O, { method: "PATCH", body: { execution: { server: true, browserGrading: true } } })).status === 200)
check("...so its practice submits in the browser", (await plan(s1, { problem: "xp-org-add" })).json?.submit === "browser")
check("the change is in the school's log, in words", psql(`select detail::text from audit_log where org_id='${orgId}' and action='org.settings' order by created_at desc limit 1`).includes("Grading in the browser"))
await setting({ "server_execution.enabled": true })
check("the platform's server back on: the school's practice is on the server", (await plan(s1, { problem: "xp-org-add" })).json?.submit === "server")
await owner(O, { method: "PATCH", body: { execution: { server: false, browserGrading: true } } })
check("the school turns its own server off: browser, provisional", JSON.stringify((await plan(s1, { problem: "xp-org-add" })).json) === JSON.stringify({ run: "browser", submit: "browser", browserOnly: true }))
check("the platform's own practice stays on the server", (await plan(s1, { problem: "xp-add" })).json?.submit === "server")
await setting({ "browser_execution.grading": false })
check("with the platform's grading off, the school can't turn it on", (await owner(O, { method: "PATCH", body: { execution: { server: true, browserGrading: true } } })).json?.error?.code === "browser_grading_off")
await setting({ "browser_execution.grading": true })
await owner(O, { method: "PATCH", body: { execution: { server: true, browserGrading: false } } })

// ---------- an assignment's choice and limit
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const orgProblemId = psql(`select id from problems where slug='xp-org-add'`)
const asg = (over) => ({ title: "Xp Week", slug: "xp-week", description: "", opensAt: hours(-1), dueAt: hours(24), allowLate: false, latePenaltyPercent: 0, published: true, audience: [[a7.id]], problems: [{ problemId: orgProblemId, points: 10 }], questions: [], ...over })
check("the form knows the platform's limit and what may be chosen", (await client("xp-o@example.com").then((c) => c(`/execution/options?org=xp-school`))).json?.platformPerMinute === 12)
const tooMany = await owner(`${O}/assignments`, { body: asg({ submissionsPerMinute: 50 }) })
check("a limit above the platform's is refused", tooMany.status === 400 && tooMany.json?.error?.code === "limit_too_high", JSON.stringify(tooMany.json))
const notAllowed = await owner(`${O}/assignments`, { body: asg({ execution: "browser" }) })
check("browser mode needs the school to allow browser grading", notAllowed.json?.error?.code === "browser_not_allowed", JSON.stringify(notAllowed.json))
await owner(O, { method: "PATCH", body: { execution: { server: true, browserGrading: true } } })
const week = await owner(`${O}/assignments`, { body: asg({ execution: "browser", submissionsPerMinute: 2 }) })
check("an assignment set to the browser with a lower limit", week.status === 200 && week.json?.execution === "browser" && week.json.submissionsPerMinute === 2, JSON.stringify(week.json).slice(0, 300))
check("its plan: the browser, though the server is on", JSON.stringify((await plan(s1, { problem: "xp-org-add", assignment: "xp-week" })).json) === JSON.stringify({ run: "browser", submit: "browser", browserOnly: true }))
check("the same problem as practice stays on the server", (await plan(s1, { problem: "xp-org-add" })).json?.submit === "server")
const asgTests = (await tests(s1, { problem: "xp-org-add", assignment: "xp-week" })).json?.tests ?? []
const tries = []
// A student who hasn't submitted anything this minute.
for (let i = 0; i < 3; i++) tries.push(await browserSubmit(kid, "xp-org-add", outputsFor(asgTests, sum), { assignmentSlug: "xp-week" }))
check("its limit holds: two a minute, the third refused", tries[0].status === 200 && tries[1].status === 200 && tries[2].status === 429, tries.map((r) => r.status).join())
const graded = (await kid("/assignments/xp-week")).json
check("a provisional Accepted counts in the assignment", graded?.earned === 10, JSON.stringify(graded?.problems?.[0]))
check("a student of another class can't use its rules", (await tests(s2, { problem: "xp-org-add", assignment: "xp-week" })).status === 404)
await owner(O, { method: "PATCH", body: { execution: { server: false, browserGrading: true } } })
const serverWork = await owner(`${O}/assignments`, { body: asg({ slug: "xp-server-week", title: "Xp Server" }) })
check("a server assignment with the school's server off: browser runs, no Submit", JSON.stringify((await plan(s1, { problem: "xp-org-add", assignment: "xp-server-week" })).json) === JSON.stringify({ run: "browser", submit: "none", browserOnly: true }), JSON.stringify(serverWork.json).slice(0, 200))
await owner(O, { method: "PATCH", body: { execution: { server: true, browserGrading: true } } })

// ---------- a contest's choice
const cup = await owner(`${O}/contests`, { body: { title: "Xp Cup", slug: "xp-cup", description: "", startsAt: hours(-1), endsAt: hours(3), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [orgProblemId], questions: [], audience: [], execution: "browser" } })
check("a contest set to the browser", cup.status === 200 && cup.json?.execution === "browser", JSON.stringify(cup.json).slice(0, 200))
await s1("/contests/xp-cup/registration", { method: "POST" })
check("its plan is the browser", (await plan(s1, { problem: "xp-org-add", contest: "xp-cup" })).json?.submit === "browser")
const cupTests = (await tests(s1, { problem: "xp-org-add", contest: "xp-cup" })).json?.tests ?? []
const cupSubmit = await browserSubmit(s1, "xp-org-add", outputsFor(cupTests, sum), { contestSlug: "xp-cup" })
check("a contest Submit graded in the browser counts on the board", cupSubmit.status === 200 && (await s1("/contests/xp-cup/leaderboard")).json?.rows?.[0]?.solved === 1, JSON.stringify((await s1("/contests/xp-cup/leaderboard")).json?.rows?.[0]))

// ---------- time and memory limits for an organization's own work
const limitsOf = async () => (await owner(`${O}/manage`)).json?.org?.limits
const startLimits = await limitsOf()
const jsDefault = startLimits?.languages.find((l) => l.id === "javascript")
check("the settings show each language's defaults and the platform's ceiling", startLimits?.ceiling.timeMs === 10000 && startLimits?.ceiling.memoryMb === 1024 && jsDefault?.timeLimitMs > 0 && Object.keys(startLimits.values).length === 0, JSON.stringify(startLimits?.ceiling))
check("a teacher can't change the limits", (await t(O, { method: "PATCH", body: { limits: { javascript: { timeLimitMs: 3000 } } } })).status === 403)
const overTime = await owner(O, { method: "PATCH", body: { limits: { javascript: { timeLimitMs: 10_001 } } } })
check("a time limit past the ceiling is refused", overTime.json?.error?.code === "bad_limit" && /10 s/.test(overTime.json.error.message), JSON.stringify(overTime.json))
check("a memory limit past the ceiling is refused", (await owner(O, { method: "PATCH", body: { limits: { javascript: { memoryLimitMb: 2048 } } } })).json?.error?.code === "bad_limit")
check("an unknown language is refused", (await owner(O, { method: "PATCH", body: { limits: { cobol: { timeLimitMs: 1000 } } } })).json?.error?.code === "bad_limit")
check("the owner sets JavaScript's limits", (await owner(O, { method: "PATCH", body: { limits: { javascript: { timeLimitMs: 3000, memoryLimitMb: 128 } } } })).status === 200 && (await limitsOf())?.values.javascript?.timeLimitMs === 3000)
const limitLog = psql(`select detail::text from audit_log where org_id='${orgId}' and action='org.settings' order by created_at desc limit 1`)
check("the activity log says what changed, in words", /JavaScript[^"]* time limit/.test(limitLog) && limitLog.includes("3 s") && limitLog.includes("128 MB"), limitLog.slice(0, 300))
// A Run's stored limits (no runner needed: the row is what the judge reads), then cleared.
const runLimits = async (who, problemSlug) => {
  const res = await who("/submissions", { body: { kind: "run", language: "javascript", entry: "main.js", files, problemSlug, inputs: ["2 3"] } })
  if (!res.json?.id) return JSON.stringify(res.json)
  const row = psql(`select time_limit_ms || '/' || memory_limit_mb from submissions where id='${res.json.id}'`)
  psql(`delete from submissions where id='${res.json.id}'`)
  return row
}
check("the school's problem runs under the school's limits", (await runLimits(s2, "xp-org-add")) === "3000/128", await runLimits(s2, "xp-org-add"))
check("personal practice on a library problem keeps the platform's", (await runLimits(s2, "xp-add")) === `${jsDefault?.timeLimitMs}/${jsDefault?.memoryLimitMb}`)
await owner(`${O}/problems`, { body: { ...problemBody("xp-org-own", "Xp Org Own"), timeLimitMs: 1500, listed: true } })
check("a problem's own limit wins; the school's memory still applies", (await runLimits(s2, "xp-org-own")) === "1500/128", await runLimits(s2, "xp-org-own"))
await owner(O, { method: "PATCH", body: { limits: { javascript: { timeLimitMs: 9000 } } } })
await setting({ "limits.max_time_ms": 4000 })
check("a ceiling lowered later holds a limit saved before it", (await runLimits(s2, "xp-org-add")) === `4000/${jsDefault?.memoryLimitMb}`, await runLimits(s2, "xp-org-add"))
await setting({ "limits.max_time_ms": 10000 })
check("clearing a language goes back to the platform's", (await owner(O, { method: "PATCH", body: { limits: {} } })).status === 200 && (await runLimits(s2, "xp-org-add")) === `${jsDefault?.timeLimitMs}/${jsDefault?.memoryLimitMb}`)

// ---------- the sandbox judges provisional verdicts again (only with a runner up)
const runnerUp = psql(`select count(*) from runners where last_seen_at > now() - interval '1 minute'`) !== "0"
if (runnerUp) {
  const deadline = Date.now() + 150_000
  let left = "1"
  while (Date.now() < deadline) {
    left = psql(`select count(*) from submissions where id='${good.json.id}' and (provisional or status <> 'done')`)
    if (left === "0") break
    await new Promise((r) => setTimeout(r, 3000))
  }
  check("the runner judges a provisional verdict again on the server", left === "0" && psql(`select verdict from submissions where id='${good.json.id}'`) === "AC", psql(`select status, provisional, verdict from submissions where id='${good.json.id}'`))
} else console.log("SKIP  re-judging provisional verdicts: no runner is up")

// ---------- one organization's modules, set by the platform
const features = await admin(`/admin/organizations/${orgId}/modules`)
check("the platform reads a school's modules", features.json?.modules?.find((m) => m.key === "library")?.kindLevel === "optional" && features.json.modules.find((m) => m.key === "library").on === false, JSON.stringify(features.json?.modules?.find((m) => m.key === "library")))
check("a school's owner can't", (await owner(`/admin/organizations/${orgId}/modules`)).status === 403)
check("a module its kind can't run is refused", (await admin(`/admin/organizations/${orgId}/modules`, { method: "PUT", body: { modules: { training: "default" } } })).json?.error?.code === "not_capable")
await admin(`/admin/organizations/${orgId}/modules`, { method: "PUT", body: { modules: { library: "default", hostel: "off" } } })
const shell = (await owner(`${O}/shell`)).json
check("on from the start for this school: the library is on at once", shell?.modules.includes("library"))
check("off for this school: it can't choose the hostel", !(await owner(`${O}/manage`)).json?.org?.moduleOptions.some((m) => m.key === "hostel") && (await owner(O, { method: "PATCH", body: { modules: { hostel: true } } })).json?.error?.code === "module_unavailable")
await admin(`/admin/organizations/${orgId}/modules`, { method: "PUT", body: { modules: { attendance: "off" } } })
check("switched off for this school: attendance goes, and its API refuses", !(await owner(`${O}/shell`)).json?.modules.includes("attendance") && (await t(`${O}/attendance/register?groupId=${a7.id}&day=2026-11-02&period=`)).status === 404)
check("the change is in the platform's log", psql(`select count(*) from audit_log where org_id is null and action='platform.org_modules'`) !== "0")
await admin(`/admin/organizations/${orgId}/modules`, { method: "PUT", body: { modules: { attendance: null, library: null, hostel: null } } })
check("back to its kind", (await owner(`${O}/shell`)).json?.modules.includes("attendance") && !(await owner(`${O}/shell`)).json?.modules.includes("library"))

// ---------- Account › Profile
const p0 = (await s1("/me/profile")).json
check("the profile starts mostly empty, with what's missing", p0?.handle === "xp-s1" && p0.completeness.done === 1 && p0.organizations.some((o) => o.slug === "xp-school" && o.profile === "/orgs/xp-school/profile/me"), JSON.stringify(p0?.completeness))
const saved = await s1("/me/profile", { method: "PATCH", body: { name: "Xp Asha", handle: "xp-asha", headline: "Grade 7 student", bio: "I like puzzles.", city: "Pune", github: "asha-dev", phone: "+91 98765 43210", website: "https://asha.example.com" } })
check("saving the profile", saved.status === 200 && saved.json?.name === "Xp Asha" && saved.json.handle === "xp-asha" && saved.json.completeness.missing.length === 0, JSON.stringify(saved.json).slice(0, 300))
check("the phone is sealed at rest", !psql(`select profile->>'phone' from users where id='${uid("xp-s1")}'`).includes("98765"))
check("a handle someone has is refused", (await s2("/me/profile", { method: "PATCH", body: { handle: "xp-asha" } })).json?.error?.code === "handle_taken")
check("a bad link and a bad phone are refused", (await s2("/me/profile", { method: "PATCH", body: { website: "asha" } })).status === 400 && (await s2("/me/profile", { method: "PATCH", body: { phone: "call me" } })).status === 400)
check("a profile needs sign-in", (await fetch(`${BASE}/api/v1/me/profile`)).status === 401)

// ---------- a member's profile in the school
const own = (await kid(`${O}/profile/me`)).json
check("a student's own profile: record, class and parents", own?.me && own.record?.admissionNo && own.record.current?.rollNo === 4 && own.record.phone === "+91 90000 11111" && own.parents.map((p) => `${p.name}:${p.relation}`).join() === "Xp Parent:Mother", JSON.stringify(own).slice(0, 400))
check("...and their groups", own?.groups.some((x) => x.path.includes("A")))
const seenByParent = (await parent(`${O}/profile/${rec.id}`)).json
check("their parent sees it", seenByParent?.record?.admissionNo === own?.record?.admissionNo && seenByParent.me === false)
check("a parent's own profile lists their children", (await parent(`${O}/profile/me`)).json?.children.map((c) => c.name).join() === "Xp Kid")
check("their class's teacher sees it", (await t(`${O}/profile/${rec.id}`)).status === 200)
check("a classmate in another section doesn't", (await s2(`${O}/profile/${rec.id}`)).status === 404)
check("an outsider doesn't", (await x(`${O}/profile/${rec.id}`)).status === 404)
check("a student of another section's details are closed to that teacher", (await t(`${O}/profile/${uid("xp-s2")}`)).status === 404)
const teacherSeen = (await owner(`${O}/profile/${uid("xp-t")}`)).json
check("staff show as staff, with what they teach", teacherSeen?.kinds.staff === true && teacherSeen.roles.some((r) => r.where.includes("A")), JSON.stringify(teacherSeen?.roles))
const edited = await owner(`${O}/profile/${uid("xp-t")}`, { method: "PATCH", body: { designation: "Maths teacher", department: "Science", employeeId: "EMP-77", joinedOn: "2024-06-01" } })
check("the owner sets a teacher's details", edited.json?.details.designation === "Maths teacher" && edited.json.details.employeeId === "EMP-77", JSON.stringify(edited.json?.details))
check("...in the school's log", psql(`select count(*) from audit_log where org_id='${orgId}' and action='member.profile'`) === "1")
check("the teacher fills in their own phone", (await t(`${O}/profile/me`, { method: "PATCH", body: { phone: "+91 91111 22222", designation: "Maths teacher" } })).json?.details.phone === "+91 91111 22222")
check("...but can't change their staff number", (await t(`${O}/profile/me`, { method: "PATCH", body: { employeeId: "EMP-1" } })).json?.error?.code === "staff_number")
check("a student can't change a teacher's details", (await s1(`${O}/profile/${uid("xp-t")}`, { method: "PATCH", body: { designation: "x" } })).status === 404)
check("the teacher's own completeness asks for nothing more of the school's", (await t(`${O}/profile/me`)).json?.completeness.missing.every((m) => !["designation", "department", "phone"].includes(m.key)))

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
  const a = await as("xp-s1@example.com")
  await a.goto(`${BASE}/account`)
  await a.getByRole("heading", { name: "Account" }).waitFor({ timeout: 30000 })
  check("Account opens on the profile", (await a.getByLabel("Headline").inputValue()) === "Grade 7 student")
  await a.getByLabel("City").fill("Mumbai")
  await a.getByRole("button", { name: "Save profile" }).click()
  await a.getByText("Profile saved").waitFor({ timeout: 15000 })
  check("saving shows a toast", true)
  await a.screenshot({ path: `${SHOTS}xp-account-profile.png`, fullPage: true })
  await a.getByRole("tab", { name: "Security" }).click()
  await a.waitForURL(/\/account\/security$/, { timeout: 15000 })
  await a.getByRole("heading", { name: "Security" }).waitFor({ timeout: 15000 })
  check("the Security tab has its own address", true)

  const o = await as("xp-o@example.com")
  await o.goto(`${BASE}/orgs/xp-school/profile/${uid("xp-t")}`)
  await o.getByTestId("staff-details").waitFor({ timeout: 30000 })
  check("a teacher's profile page shows their details", (await o.getByTestId("staff-details").textContent()).includes("EMP-77"))
  check("the sidebar footer leads to my profile here", (await o.getByTestId("sidebar-profile").getAttribute("href")) === "/orgs/xp-school/profile/me")
  check("the header shows the logo", (await o.locator("header svg rect").count()) > 0)
  await o.screenshot({ path: `${SHOTS}xp-profile-teacher.png`, fullPage: true })
  await o.goto(`${BASE}/orgs/xp-school/manage/assignments/new`)
  await o.getByTestId("execution-settings").waitFor({ timeout: 30000 })
  await o.getByLabel("In the browser").click()
  check("choosing the browser warns about the languages", (await o.getByRole("note").textContent()).includes("Only Python and JavaScript"))
  await o.getByTestId("execution-settings").screenshot({ path: `${SHOTS}xp-execution-settings.png` })

  // Time and memory on the school's settings, as an owner sets them.
  await o.goto(`${BASE}/orgs/xp-school/manage/settings`)
  await o.getByTestId("limits-card").waitFor({ timeout: 30000 })
  check("the time limit box shows the default as a hint", (await o.getByLabel(/^JavaScript.* time limit in seconds$/).getAttribute("placeholder")).includes("default"))
  await o.getByLabel(/^JavaScript.* time limit in seconds$/).fill("2.5")
  await o.getByLabel(/^JavaScript.* memory limit in MB$/).fill("200")
  await o.getByRole("button", { name: "Save limits" }).click()
  await o.getByText("Time and memory limits saved.").waitFor({ timeout: 15000 })
  check("saving limits from the page stores them", JSON.stringify((await limitsOf())?.values.javascript) === JSON.stringify({ timeLimitMs: 2500, memoryLimitMb: 200 }), JSON.stringify((await limitsOf())?.values))
  await o.getByLabel(/^JavaScript.* time limit in seconds$/).fill("60")
  await o.getByRole("button", { name: "Save limits" }).click()
  await o.getByTestId("limits-card").getByText(/at most 10 s/).waitFor({ timeout: 15000 })
  check("past the ceiling, the page says why", true)
  await o.getByTestId("limits-card").screenshot({ path: `${SHOTS}xp-limits.png` })
  const op = await as("xp-o@example.com", { width: 390, height: 844 })
  await op.goto(`${BASE}/orgs/xp-school/manage/settings`)
  await op.getByTestId("limits-card").waitFor({ timeout: 30000 })
  check("the limits on a phone, without sideways scrolling", await op.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await op.getByTestId("limits-card").screenshot({ path: `${SHOTS}xp-limits-phone.png` })

  const k = await as("xp-k@example.com", { width: 390, height: 844 })
  await k.goto(`${BASE}/orgs/xp-school/profile/me`)
  await k.getByTestId("student-record").waitFor({ timeout: 30000 })
  check("a student's profile on a phone, without sideways scrolling", await k.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await k.screenshot({ path: `${SHOTS}xp-profile-student-phone.png`, fullPage: true })

  // A JavaScript Submit graded in the browser, with the server off.
  await setting({ "server_execution.enabled": false })
  const e = await as("xp-s2@example.com")
  await e.goto(`${BASE}/problems/xp-add`)
  await e.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
  await e.getByLabel("Language").selectOption("javascript")
  await e.getByText(/graded in your browser/i).waitFor({ timeout: 30000 })
  await e.locator(".monaco-editor textarea, .monaco-editor .native-edit-context").first().focus()
  await e.keyboard.press("ControlOrMeta+a"); await e.keyboard.press("Delete")
  await e.keyboard.insertText(JS); await e.waitForTimeout(300)
  check("only Python and JavaScript are offered", (await e.getByLabel("Language").locator("option").allTextContents()).every((l) => /Python|JavaScript/.test(l)))
  await e.getByRole("button", { name: "Submit", exact: true }).click()
  await e.getByText(/Saved in the Submissions tab/).waitFor({ timeout: 45000 })
  check("Submit graded in the browser: Accepted, provisional", (await e.getByTestId("verdict").textContent()).includes("Accepted") && (await e.getByText("Provisional", { exact: true }).count()) > 0)
  await e.screenshot({ path: `${SHOTS}xp-browser-submit.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await setting({ "server_execution.enabled": true, "browser_execution.grading": false, "limits.max_time_ms": 10000 })
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll execution and profile checks passed")
process.exit(failures ? 1 : 0)
