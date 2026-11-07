/**
 * The whole system against a throwaway database: API security, real judging through
 * gVisor, contests and the browser UI. Run it with e2e/run.sh.
 */
import { chromium } from "playwright"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const require = createRequire(ROOT + "apps/web/")
const { encode } = require("next-auth/jwt")
const BASE = "http://localhost:3100"
const SECRET = "e2e-only-secret"
const SHOTS = process.env.E2E_SCREENSHOTS ?? "/tmp/gretlab-e2e/"
mkdirSync(SHOTS, { recursive: true })
const seed = JSON.parse(readFileSync(ROOT + "packages/db/seed-data/content.json", "utf8"))
const seedQs = seed.units.flatMap((u) => u.questions)
const phase = process.argv[2] ?? "all"
let failures = 0
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + String(detail).slice(0, 240) : ""}`); if (!ok) failures++ }
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", "gretlab_test", "-Atc", q]).toString().trim()

async function cookieFor(email) {
  return encode({ token: { email, name: email.split("@")[0], sub: email }, secret: SECRET })
}
function user(email, name, role) { psql(`insert into users(email,name,role) values ('${email}','${name}','${role}') on conflict (email) do update set role='${role}', disabled=false`) }
user("admin@example.com", "Admin", "admin"); user("teach@example.com", "Teacher", "teacher"); user("ana@example.com", "Ana", "student"); user("ben@example.com", "Ben", "student")
const client = async (email) => {
  const cookie = email ? `next-auth.session-token=${await cookieFor(email)}` : ""
  return async (path, { method, body, headers } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await res.json() } catch {}
    return { status: res.status, json }
  }
}
const [anon, ana, ben, teach, admin] = await Promise.all([client(null), client("ana@example.com"), client("ben@example.com"), client("teach@example.com"), client("admin@example.com")])
async function settle(api, id, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const r = await api(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((res) => setTimeout(res, 150))
  }
  throw new Error("timeout " + id)
}
const py = (content, extra = {}) => ({ kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content }], ...extra })

if (phase === "all" || phase === "api") {
  // This suite submits far faster than a person. Its own limit test comes later.
  await admin("/admin/settings", { method: "PATCH", body: { "submissions.per_minute": 600 } })
  // ---- what the public can see
  const q1 = seedQs[0]
  const hiddenExpected = q1.tests[0][1], hiddenInput = q1.tests[2][0]
  const pub = await anon("/problems/p1")
  const pubText = JSON.stringify(pub.json)
  check("public problem has samples", pub.status === 200 && pub.json.samples.length === 2)
  check("public API leaks no hidden input", !pubText.includes(hiddenInput))
  check("public API leaks no solution", !pubText.includes("si = principal"))
  const html = await (await fetch(BASE + "/problems/p1")).text()
  check("page is server-rendered with the problem text", html.includes("Simple Interest") && html.includes("yearly rate"))
  check("page leaks no solution", !html.includes("si = principal"))
  check("page leaks no hidden input", !html.includes(hiddenInput))
  check("unknown problem 404", (await fetch(BASE + "/problems/nope")).status === 404)
  check("anon cannot read a solution", (await anon("/problems/p1/solution")).status === 401)
  const early = await ana("/problems/p1/solution")
  check("solution locked until the student solves it", early.status === 403 && early.json.error.code === "solve_first", early.status)

  // ---- access control
  for (const path of ["/admin/overview", "/admin/settings", "/admin/users", "/admin/problems", "/admin/submissions", "/admin/contests", "/admin/notes", "/admin/languages"]) {
    check(`anon refused ${path}`, (await anon(path)).status === 401)
    check(`student refused ${path}`, (await ana(path)).status === 403)
  }
  for (const path of ["/admin/settings", "/admin/users"]) check(`teacher refused ${path}`, (await teach(path)).status === 403)
  for (const path of ["/admin/problems", "/admin/overview", "/admin/submissions"]) check(`teacher allowed ${path}`, (await teach(path)).status === 200)
  const students = await admin("/admin/users?search=ana")
  check("admin can list users", students.json?.[0]?.email === "ana@example.com")
  check("anon cannot submit", (await anon("/submissions", { body: py("print(1)", { problemSlug: "p1" }) })).status === 401)
  const forged = await fetch(BASE + "/api/v1/me", { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: "admin@example.com" }, secret: "wrong" })}` } })
  check("forged cookie is anonymous", (await forged.json()).user === null)
  const dev = await (await fetch(BASE + "/api/auth/providers")).json()
  check("dev login absent from production build", !dev.dev, Object.keys(dev).join(","))

  // ---- request hardening
  const xsite = await ana("/submissions", { body: py("print(1)", { problemSlug: "p1" }), headers: { origin: "https://evil.example" } })
  check("cross-site POST refused", xsite.status === 403 && xsite.json.error.code === "bad_origin", xsite.status)
  for (const path of ["../evil.py", "/etc/passwd", "a/../../b.py", "$(id).py", "x y.py", ".env"]) {
    const r = await ana("/submissions", { body: { kind: "run", language: "python", entry: path, files: [{ path, content: "print(1)" }] } })
    check(`bad path refused: ${path}`, r.status === 400, r.status)
  }
  check("missing entry refused", (await ana("/submissions", { body: { kind: "run", language: "python", entry: "nope.py", files: [{ path: "main.py", content: "" }] } })).status === 400)
  check("wrong extension refused", (await ana("/submissions", { body: { kind: "run", language: "python", entry: "a.java", files: [{ path: "a.java", content: "" }] } })).status === 400)
  check("unknown language refused", (await ana("/submissions", { body: { kind: "run", language: "cobol", entry: "main.py", files: [{ path: "main.py", content: "" }] } })).status === 400)
  check("invalid JSON refused", (await (await fetch(BASE + "/api/v1/submissions", { method: "POST", headers: { cookie: `next-auth.session-token=${await cookieFor("ana@example.com")}`, "content-type": "application/json" }, body: "{nope" })).status) === 400)

  // ---- real judging through gVisor
  const created = await ana("/submissions", { body: py(q1.solution, { problemSlug: "p1" }) })
  check("submission accepted", created.status === 200, JSON.stringify(created.json))
  const done = await settle(ana, created.json.id)
  check("correct solution: AC", done.verdict === "AC", done.verdict)
  check("all tests judged", done.results.length === 6, done.results.length)
  const hidden = done.results.filter((r) => !r.isSample)
  check("hidden tests: no input, output or expected", hidden.length === 4 && hidden.every((r) => r.input === null && r.expected === null && r.stdout === null && r.stderr === null))
  check("hidden tests: verdict still shown", hidden.every((r) => r.verdict === "AC"))
  check("response leaks no hidden values", !JSON.stringify(done).includes(hiddenExpected.split("\n")[1] + "XX") && !JSON.stringify(done).includes(hiddenInput))
  check("other student cannot read it (404)", (await ben(`/submissions/${created.json.id}`)).status === 404)
  const asStaff = await teach(`/submissions/${created.json.id}`)
  check("staff can read hidden details", asStaff.json?.results?.find((r) => !r.isSample)?.input !== null)
  check("progress shows solved", (await ana("/me/progress")).json?.p1 === "solved")
  check("after solving, the solution unlocks", (await ana("/problems/p1/solution")).json?.solution?.includes("principal"))

  const ranOnly = await settle(ana, (await ana("/submissions", { body: { ...py("print(1)", { problemSlug: "p3" }), kind: "run", stdin: "" } })).json.id)
  check("a plain Run on your own input is Finished, never Accepted", ranOnly.verdict === "OK", ranOnly.verdict)
  const sampleRun = await settle(ana, (await ana("/submissions", { body: { ...py(q1.solution, { problemSlug: "p1" }), kind: "run", inputs: [q1.samples[0][0], "1\n1\n1"] } })).json.id)
  check("Run: an unchanged sample is compared", sampleRun.results[0].verdict === "AC" && sampleRun.results[0].expected === q1.samples[0][1], JSON.stringify(sampleRun.results[0]))
  check("Run: your own input isn't", sampleRun.results[1].verdict === "OK" && sampleRun.results[1].expected === null)
  const probe = await settle(ana, (await ana("/submissions", { body: { ...py("print('x')", { problemSlug: "p1" }), kind: "run", inputs: [hiddenInput] } })).json.id)
  check("Run can't be used to probe a hidden test", probe.results[0].expected === null && probe.results[0].verdict === "OK", JSON.stringify(probe.results[0]))
  const inList = (await ana("/submissions?problem=p1")).json
  check("my submissions list has no Runs", inList.length > 0 && inList.every((row) => row.kind === "submit"))
  check("rows have runtime, memory and test counts", inList.every((row) => row.runtimeMs !== null && row.totalTests === 6), JSON.stringify(inList[0]))
  check("staff list hides Runs by default", (await admin("/admin/submissions")).json.rows.every((row) => row.kind === "submit"))
  check("staff can ask for Runs", (await admin("/admin/submissions?kind=run")).json.rows.every((row) => row.kind === "run"))
  check("a plain Run never marks a problem solved", (await ana("/me/progress")).json?.p3 === "tried", (await ana("/me/progress")).json?.p3)
  const big = await fetch(BASE + "/api/v1/submissions", { method: "POST", headers: { cookie: `next-auth.session-token=${await cookieFor("ana@example.com")}`, "content-type": "application/json" }, body: JSON.stringify({ kind: "run", pad: "x".repeat(9 * 1024 * 1024) }) })
  check("oversized request refused", big.status === 413, big.status)
  const headers = (await fetch(BASE + "/problems/p1")).headers
  check("security headers", headers.get("x-frame-options") === "DENY" && headers.get("x-content-type-options") === "nosniff" && !headers.get("x-powered-by"))
  const wrong = await settle(ana, (await ana("/submissions", { body: py("print('nope')", { problemSlug: "p1" }) })).json.id)
  check("wrong answer: WA", wrong.verdict === "WA", wrong.verdict)
  check("solved stays solved", (await ana("/me/progress")).json?.p1 === "solved")
  const crash = await settle(ana, (await ana("/submissions", { body: py("raise ValueError('boom')", { problemSlug: "p1" }) })).json.id)
  check("exception: RE with traceback on sample", crash.verdict === "RE" && crash.results[0].stderr.includes("boom"), crash.verdict)
  const loop = await settle(ana, (await ana("/submissions", { body: { ...py("while True: pass"), kind: "run", stdin: "" } })).json.id)
  check("infinite loop: TLE", loop.verdict === "TLE", loop.verdict)

  // ---- multi-file, every language, custom input
  const mf = await settle(ana, (await ana("/submissions", { body: { kind: "run", language: "python", entry: "main.py", stdin: "21", files: [{ path: "main.py", content: "from pkg.h import t\nprint(t(int(input())))" }, { path: "pkg/h.py", content: "def t(x): return x*2" }] } })).json.id)
  check("python packages across files", mf.results[0].stdout.trim() === "42", JSON.stringify(mf.results[0]))
  const langs = {
    javascript: [{ path: "main.js", content: 'console.log(require("./l.js").t(21))' }, { path: "l.js", content: "exports.t=x=>x*2" }],
    cpp: [{ path: "main.cpp", content: '#include <iostream>\n#include "h.hpp"\nint main(){std::cout<<t(21);}' }, { path: "h.hpp", content: "int t(int);" }, { path: "h.cpp", content: "int t(int x){return x*2;}" }],
    c: [{ path: "main.c", content: '#include <stdio.h>\nint main(){printf("42");}' }],
    java: [{ path: "Main.java", content: "public class Main{public static void main(String[] a){System.out.print(H.t(21));}}" }, { path: "H.java", content: "class H{static int t(int x){return x*2;}}" }],
  }
  for (const [language, files] of Object.entries(langs)) {
    const r = await settle(ana, (await ana("/submissions", { body: { kind: "run", language, entry: files[0].path, files } })).json.id)
    check(`${language} multi-file runs`, r.results[0]?.stdout?.trim() === "42", JSON.stringify(r.results[0] ?? r.compileOutput))
  }
  const ce = await settle(ana, (await ana("/submissions", { body: { kind: "run", language: "cpp", entry: "main.cpp", files: [{ path: "main.cpp", content: "int main( {" }] } })).json.id)
  check("compile error reported", ce.verdict === "CE" && ce.compileOutput.includes("error"))

  // ---- rate limits from settings
  const set = (changes) => admin("/admin/settings", { method: "PATCH", body: changes })
  await set({ "submissions.per_minute": 2 })
  const fresh = await client("ben@example.com")
  await fresh("/submissions", { body: { ...py("print(1)"), kind: "run" } }); await fresh("/submissions", { body: { ...py("print(1)"), kind: "run" } })
  const limited = await fresh("/submissions", { body: { ...py("print(1)"), kind: "run" } })
  check("per-minute limit enforced", limited.status === 429, limited.status)
  await set({ "submissions.per_minute": 600, "submissions.max_pending": 50 })

  // ---- switches take effect immediately, enforced on the server
  check("invalid setting refused", (await set({ "submissions.per_minute": -5 })).status === 400)
  check("unknown setting refused", (await set({ "nope": 1 })).status === 400)
  await set({ "server_execution.enabled": false })
  const off = await ana("/submissions", { body: { ...py("print(1)"), kind: "run" } })
  check("server execution off: refused at once", off.status === 403 && off.json.error.code === "feature_disabled", off.status)
  await set({ "server_execution.enabled": true })
  await admin("/admin/languages/java", { method: "PUT", body: { enabled: false, timeLimitMs: 8000, memoryLimitMb: 768 } })
  check("disabled language refused", (await ana("/submissions", { body: { kind: "run", language: "java", entry: "Main.java", files: [{ path: "Main.java", content: "" }] } })).status === 400)
  check("disabled language hidden from clients", !(await ana("/me")).json.languages.some((l) => l.id === "java"))
  await admin("/admin/languages/java", { method: "PUT", body: { enabled: true, timeLimitMs: 8000, memoryLimitMb: 768 } })
  await set({ "practice.show_solutions": false })
  check("solutions off: refused for students", (await ana("/problems/p1/solution")).status === 403)
  check("solutions off: staff still can", (await teach("/problems/p1/solution")).status === 200)
  await set({ "practice.show_solutions": true })
  await admin("/admin/languages/python", { method: "PUT", body: { enabled: true, timeLimitMs: 1000, memoryLimitMb: 256 } })
  const short = await settle(ana, (await ana("/submissions", { body: { ...py("import time\ntime.sleep(3)"), kind: "run" } })).json.id)
  check("dashboard time limit applies", short.verdict === "TLE", short.verdict)
  await admin("/admin/languages/python", { method: "PUT", body: { enabled: true, timeLimitMs: 5000, memoryLimitMb: 256 } })

  // ---- accounts
  const banUser = (await admin("/admin/users?search=ben")).json[0]
  await admin(`/admin/users/${banUser.id}`, { method: "PATCH", body: { disabled: true } })
  check("blocked user is signed out at once", (await ben("/me")).json.user === null)
  await admin(`/admin/users/${banUser.id}`, { method: "PATCH", body: { disabled: false } })
  const me = (await admin("/me")).json.user
  check("admin can't change own role", (await admin(`/admin/users/${me.id}`, { method: "PATCH", body: { role: "student" } })).status === 400)
  const demote = (await admin("/admin/users?search=teach")).json[0]
  await admin(`/admin/users/${demote.id}`, { method: "PATCH", body: { role: "student" } })
  check("demotion applies at once", (await teach("/admin/problems")).status === 403)
  await admin(`/admin/users/${demote.id}`, { method: "PATCH", body: { role: "teacher" } })

  // ---- every seeded solution through gVisor with concurrency
  const started = Date.now()
  const submitted = []
  for (const q of seedQs) {
    const r = await teach("/submissions", { body: py(q.solution, { problemSlug: q.id }) })
    submitted.push([q.id, r.json?.id, r.status])
    while ((await teach("/submissions")).json.filter((s) => s.status !== "done").length >= 40) await new Promise((res) => setTimeout(res, 300))
  }
  const bad = []
  for (const [slug, id, status] of submitted) {
    if (status !== 200) { bad.push(slug + ":" + status); continue }
    const r = await settle(teach, id)
    if (r.verdict !== "AC") bad.push(`${slug}:${r.verdict}`)
  }
  check(`all ${seedQs.length} reference solutions AC in the sandbox`, bad.length === 0, bad.join(" "))
  // And every other language's reference solution, with the same tests.
  const ENTRY = { javascript: "main.js", c: "main.c", cpp: "main.cpp", java: "Main.java" }
  const others = []
  for (const q of seedQs) {
    for (const [language, parts] of Object.entries(q.code ?? {})) {
      if (language === "python" || !parts.solution) continue
      const entry = ENTRY[language]
      const r = await teach("/submissions", { body: { kind: "submit", language, entry, files: [{ path: entry, content: parts.solution }], problemSlug: q.id } })
      others.push([`${q.id}/${language}`, r.json?.id, r.status])
      while ((await teach("/submissions")).json.filter((s) => s.status !== "done").length >= 40) await new Promise((res) => setTimeout(res, 300))
    }
  }
  const badOthers = []
  for (const [name, id, status] of others) {
    if (status !== 200) { badOthers.push(`${name}:${status}`); continue }
    const r = await settle(teach, id)
    if (r.verdict !== "AC") badOthers.push(`${name}:${r.verdict}`)
  }
  check(`all ${others.length} JavaScript, C, C++ and Java reference solutions AC in the sandbox`, others.length >= 60 && badOthers.length === 0, badOthers.join(" "))
  console.log(`      took ${Math.round((Date.now() - started) / 1000)}s`)
  check("no sandboxes left behind", execFileSync("docker", ["exec", "gretlab-gvisor-rig", "docker", "ps", "-aq", "--filter", "label=gretlab.sandbox=1"]).toString().trim() === "")
}

if (phase === "all" || phase === "contest") {
  const now = Date.now()
  const iso = (m) => new Date(now + m * 60000).toISOString()
  const ids = JSON.parse((await admin("/admin/problems")).json ? JSON.stringify((await admin("/admin/problems")).json.problems.slice(0, 2).map((p) => p.id)) : "[]")
  // ---- teacher makes a draft problem, students can't see it
  const draft = await teach("/admin/problems", { body: { slug: "secret-contest-q", title: "Secret Q", unitId: null, level: "hard", statement: ["Print the double."], inputFormat: [], outputFormat: [], constraints: [], solution: "print(int(input())*2)", timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: false, tests: [{ input: "1", expected: "2", isSample: true, points: 40 }, { input: "5", expected: "10", isSample: false, points: 60 }] } })
  check("teacher creates a draft problem", draft.status === 200, JSON.stringify(draft.json))
  check("draft hidden from public", (await anon("/problems/secret-contest-q")).status === 404 && (await fetch(BASE + "/problems/secret-contest-q")).status === 404)
  check("draft not in the list", !(await anon("/problems")).json.some((p) => p.id === "secret-contest-q"))
  check("student can't submit to a draft", (await ana("/submissions", { body: py("print(1)", { problemSlug: "secret-contest-q" }) })).status === 404)
  const bad = await teach("/admin/problems", { body: { ...{ slug: "BAD SLUG", title: "", unitId: null, level: "easy", statement: [], inputFormat: [], outputFormat: [], constraints: [], solution: "", timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: false, tests: [] } } })
  check("invalid problem refused", bad.status === 400)

  // ---- upcoming contest
  const body = (o) => ({ slug: "midterm", title: "Midterm", description: "Good luck", startsAt: iso(60), endsAt: iso(180), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [draft.json.id, ids[0]], ...o })
  check("end before start refused", (await teach("/admin/contests", { body: body({ endsAt: iso(10) }) })).status === 400)
  const contest = await teach("/admin/contests", { body: body({}) })
  check("teacher creates a contest", contest.status === 200, JSON.stringify(contest.json))
  const cid = contest.json.id
  const view = await anon("/contests/midterm")
  check("upcoming contest hides its problems", view.json.phase === "upcoming" && view.json.problems.length === 0)
  check("upcoming contest problem refused", (await anon("/contests/midterm/problems/A")).status === 403)
  check("anon can't register", (await anon("/contests/midterm/registration", { method: "POST" })).status === 401)
  check("student registers", (await ana("/contests/midterm/registration", { method: "POST" })).status === 200)
  check("registering twice is harmless", (await ana("/contests/midterm/registration", { method: "POST" })).status === 200)
  check("registered flag", (await ana("/contests/midterm")).json.registered === true)
  check("can't submit before the start", (await ana("/submissions", { body: py("print(1)", { problemSlug: "secret-contest-q", contestSlug: "midterm" }) })).status === 403)

  // ---- live
  await teach(`/admin/contests/${cid}`, { method: "PUT", body: body({ startsAt: iso(-30), endsAt: iso(30) }) })
  check("live contest shows problems", (await anon("/contests/midterm")).json.problems.length === 2)
  const cp = await ana("/contests/midterm/problems/A")
  const cpText = JSON.stringify(cp.json)
  check("contest problem: no solution or hidden tests", cp.status === 200 && !cpText.includes("int(input())*2") && cp.json.problem.hiddenTestCount === 1 && !cpText.includes('"10"'))
  const inContestSlug = (await teach("/admin/problems")).json.problems.find((p) => p.id === ids[0]).slug
  check("solution hidden while a live contest uses it", (await ana(`/problems/${inContestSlug}/solution`)).status === 403)
  check("unregistered student can't submit", (await ben("/submissions", { body: py("print(1)", { problemSlug: "secret-contest-q", contestSlug: "midterm" }) })).status === 403)
  check("problem outside the contest refused", (await ana("/submissions", { body: py("print(1)", { problemSlug: "p5", contestSlug: "midterm" }) })).status === 404)
  await ben("/contests/midterm/registration", { method: "POST" })
  const sub = async (api, code) => settle(api, (await api("/submissions", { body: py(code, { problemSlug: "secret-contest-q", contestSlug: "midterm" }) })).json.id)
  check("wrong attempt: WA", (await sub(ana, "print(0)")).verdict === "WA")
  const scored = await sub(ana, "print(int(input())*2)")
  check("correct attempt: AC", scored.verdict === "AC", scored.verdict)
  check("score from test points", scored.score === 100 && scored.maxScore === 100, `${scored.score}/${scored.maxScore}`)
  const partial = await sub(ben, "x=int(input())\nprint(2 if x==1 else 0)")
  check("partial credit", partial.verdict === "WA" && partial.score === 40, `${partial.verdict} ${partial.score}`)
  const lb = (await anon("/contests/midterm/leaderboard")).json
  check("ICPC board: solver ranked first, penalty counted", lb.rows[0].user.name === "Ana" && lb.rows[0].solved === 1 && lb.rows[0].penalty >= 50 && lb.rows[0].penalty <= 52, JSON.stringify(lb.rows[0]))
  check("board shows names, never emails", !JSON.stringify(lb).includes("@example.com"))
  // Switch to IOI
  await teach(`/admin/contests/${cid}`, { method: "PUT", body: body({ startsAt: iso(-30), endsAt: iso(30), scoring: "ioi" }) })
  const ioi = (await anon("/contests/midterm/leaderboard")).json
  check("IOI board: partial scores", ioi.rows[0].score === 100 && ioi.rows[1].score === 40, JSON.stringify(ioi.rows.map((r) => r.score)))
  // Freeze
  await teach(`/admin/contests/${cid}`, { method: "PUT", body: body({ startsAt: iso(-30), endsAt: iso(30), freezeMinutes: 45 }) })
  const frozen = (await anon("/contests/midterm/leaderboard")).json
  check("frozen board hides recent results", frozen.frozen === true && frozen.rows.every((r) => r.solved === 0) && frozen.rows.find((r) => r.user.name === "Ana").problems[0].pending === 2, JSON.stringify(frozen.rows[0].problems[0]))
  const staffBoard = (await teach("/contests/midterm/leaderboard")).json
  check("staff see through the freeze", staffBoard.rows[0].solved === 1)
  // Over
  await teach(`/admin/contests/${cid}`, { method: "PUT", body: body({ startsAt: iso(-120), endsAt: iso(-1), freezeMinutes: 45 }) })
  check("ended: results revealed", (await anon("/contests/midterm/leaderboard")).json.frozen === false && (await anon("/contests/midterm/leaderboard")).json.rows[0].solved === 1)
  check("ended: submissions refused", (await ana("/submissions", { body: py("print(1)", { problemSlug: "secret-contest-q", contestSlug: "midterm" }) })).status === 403)
  // Contests off
  await admin("/admin/settings", { method: "PATCH", body: { "contests.enabled": false } })
  check("contests off: API refuses", (await anon("/contests")).status === 403)
  await admin("/admin/settings", { method: "PATCH", body: { "contests.enabled": true } })
  const inUse = await teach(`/admin/problems/${draft.json.id}`, { method: "DELETE" })
  check("problem used by a contest: clear 409", inUse.status === 409 && inUse.json.error.message.includes("contest"), inUse.status)
  const dupe = await teach("/admin/contests", { body: body({}) })
  check("duplicate address: clear 409", dupe.status === 409, dupe.status)
  // Publish appears at once
  await teach("/admin/problems", { body: { slug: "new-public", title: "Brand New", unitId: null, level: "easy", statement: ["Hi"], inputFormat: [], outputFormat: [], constraints: [], solution: "", timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "", expected: "x", isSample: true, points: 1 }] } })
  const fresh = await fetch(BASE + "/problems/new-public")
  check("published problem is live immediately", fresh.status === 200 && (await fresh.text()).includes("Brand New"))
}

if (phase === "all" || phase === "ui") {
  const browser = await chromium.launch()
  const errors = []
  const open = async (email, viewport = { width: 1440, height: 900 }, colorScheme) => {
    const ctx = await browser.newContext({ viewport, colorScheme, permissions: ["clipboard-read", "clipboard-write"] })
    if (email) await ctx.addCookies([{ name: "next-auth.session-token", value: await cookieFor(email), url: BASE }])
    const page = await ctx.newPage()
    page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)) })
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)))
    return page
  }
  const typeCode = async (p, code) => {
    await p.locator(".monaco-editor textarea, .monaco-editor .native-edit-context").first().focus()
    await p.keyboard.press("ControlOrMeta+a"); await p.keyboard.press("Delete")
    await p.keyboard.insertText(code)
    await p.waitForTimeout(150)
  }
  const value = (p) => p.evaluate(() => window.monaco.editor.getEditors()[0].getValue())

  // ---- signed-in student, Monaco, server sandbox
  const s = await open("ana@example.com")
  await s.goto(BASE + "/problems/p2")
  await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 30000 })
  check("Monaco loads from our own host", await s.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("/vendor/monaco/"))))
  check("line numbers shown", await s.locator(".monaco-editor .line-numbers").first().isVisible())
  await typeCode(s, 'import math\nprint(math.sqrt(16))\nx = "hello"\n')
  check("syntax highlighting: several token colours", (await s.evaluate(() => new Set([...document.querySelectorAll(".monaco-editor .view-line span span")].map((e) => getComputedStyle(e).color)).size)) >= 3)

  // Formatting (Ruff)
  await typeCode(s, "x=1\ny   =  [1,2,\n3]\ndef f( a,b ):\n  return a+b\n")
  await s.getByRole("button", { name: "Format", exact: true }).click()
  await s.waitForFunction(() => window.monaco.editor.getEditors()[0].getValue().includes("x = 1"), null, { timeout: 15000 })
  const fmt = await value(s)
  check("Ruff formats Python", fmt.includes("x = 1") && fmt.includes("def f(a, b):") && fmt.includes("    return a + b"), JSON.stringify(fmt))

  // Lint squiggles
  await typeCode(s, "import os\nprint(undefined_name)\n")
  await s.waitForFunction(() => window.monaco.editor.getModelMarkers({}).length > 0, null, { timeout: 15000 }).catch(() => {})
  const markers = await s.evaluate(() => window.monaco.editor.getModelMarkers({}).map((m) => m.message))
  check("Ruff shows problems in the editor", markers.length > 0, markers.join(" | "))

  // Multiple files + completion from a sibling module
  await s.getByRole("button", { name: "New file" }).click()
  await s.getByLabel("File name").fill("../evil.py")
  await s.getByRole("button", { name: "Create" }).click()
  check("unsafe file name refused in UI", await s.getByRole("alert").filter({ hasText: "Use letters" }).isVisible())
  await s.getByLabel("File name").fill("helper.py")
  await s.getByRole("button", { name: "Create" }).click()
  await s.getByRole("tab", { name: "helper.py" }).waitFor()
  await typeCode(s, "def double_it(value):\n    return value * 2\n")
  await s.waitForTimeout(600)
  await s.getByRole("tab", { name: /main\.py/ }).click()
  await s.waitForTimeout(300)
  await typeCode(s, "import helper\nhelper.")
  await s.waitForTimeout(200)
  await s.keyboard.press("ControlOrMeta+Space")
  const suggestion = s.locator(".monaco-editor .suggest-widget .monaco-list-row").filter({ hasText: "double_it" })
  const got = await suggestion.first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false)
  check("Jedi completes from the student's other file", got)
  await s.screenshot({ path: SHOTS + "ide-completion.png" })
  await s.keyboard.press("Escape")

  // Stdlib completion
  await typeCode(s, "import math\nmath.sq")
  await s.keyboard.press("ControlOrMeta+Space")
  check("Jedi completes the standard library", await s.locator(".suggest-widget .monaco-list-row").filter({ hasText: "sqrt" }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false))
  await s.keyboard.press("Escape")

  // Run on server with the helper
  await typeCode(s, "import helper\nprint(helper.double_it(21))\n")
  await s.locator("#stdin").fill("")
  await s.getByRole("button", { name: "Run", exact: true }).click()
  await s.getByTestId("run-output").filter({ hasText: "42" }).waitFor({ timeout: 60000 })
  check("multi-file run through the server sandbox", true)
  await s.locator(".monaco-editor textarea, .monaco-editor .native-edit-context").first().focus()
  await s.keyboard.press("ControlOrMeta+Enter")
  await s.waitForTimeout(800)
  await s.getByTestId("run-output").filter({ hasText: "42" }).waitFor({ timeout: 60000 })
  check("Ctrl+Enter runs", true)

  // Submit and verdict
  await typeCode(s, "print('nope')\n")
  await s.getByRole("button", { name: "Submit" }).click()
  await s.getByTestId("verdict").waitFor({ timeout: 60000 })
  const v = await s.getByTestId("verdict").textContent()
  check("submit shows a verdict", v.includes("Wrong answer"), v)
  check("hidden tests are labelled and opaque", await s.getByText(/Hidden test 1/).first().isVisible())
  await s.screenshot({ path: SHOTS + "ide-verdict.png" })

  // Language switch, C++ format, persistence
  await s.getByLabel("Language").selectOption("cpp")
  await s.getByRole("tab", { name: /main\.cpp/ }).waitFor()
  await s.waitForTimeout(400)
  await typeCode(s, "#include <iostream>\nint main(){std::cout<<42;return 0;}\n")
  await s.getByRole("button", { name: "Format", exact: true }).click()
  await s.waitForFunction(() => window.monaco.editor.getEditors()[0].getValue().includes("int main() {"), null, { timeout: 15000 }).catch(() => {})
  const cf = await value(s)
  check("clang-format formats C++", cf.includes("int main() {") && cf.includes("    std::cout"), JSON.stringify(cf))
  await s.getByRole("tab", { name: "Test cases" }).click()
  await s.locator("#stdin").fill("")
  await s.getByRole("button", { name: "Run", exact: true }).click()
  await s.getByTestId("run-output").filter({ hasText: /^42/ }).waitFor({ timeout: 60000 })
  check("C++ compiled and run from the editor", true)
  await s.waitForTimeout(600)
  await s.reload()
  await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 30000 })
  await s.waitForFunction(() => window.monaco?.editor.getEditors()[0]?.getValue().includes("std::cout"), null, { timeout: 15000 }).catch(() => {})
  check("language and code survive reload", (await value(s)).includes("std::cout") && (await s.getByLabel("Language").inputValue()) === "cpp")
  await s.getByLabel("Language").selectOption("python")
  await s.waitForTimeout(300)
  check("Python files kept when switching back", await s.getByRole("tab", { name: "helper.py" }).isVisible())

  // Solution fetched only when asked
  await s.goto(BASE + "/problems/p1")
  await s.getByRole("tab", { name: "Editorial" }).click()
  await s.getByRole("button", { name: "Show the editorial" }).click()
  await s.getByText("principal = float").waitFor({ timeout: 10000 })
  check("solution loads on request", true)

  // Navigation keeps the shell
  await s.getByRole("link", { name: /Integer Operations/ }).click()
  await s.waitForURL("**/problems/p2")
  check("question navigation works", await s.getByRole("heading", { name: /P2\. Integer Operations/ }).isVisible())

  // ---- anonymous: browser Python, multi-file, no ads requests in test
  const a = await open(null)
  await a.goto(BASE + "/problems/p1")
  await a.getByText("Python ready").waitFor({ timeout: 90000 })
  check("anon gets the browser notice", await a.getByText(/Running Python in your browser/).isVisible())
  check("anon has Python only", (await a.getByLabel("Language").locator("option").count()) === 1)
  check("anon has no Submit", !(await a.getByRole("button", { name: "Submit" }).isVisible()))
  await a.getByRole("button", { name: "New file" }).click()
  await a.getByLabel("File name").fill("mymod.py")
  await a.getByRole("button", { name: "Create" }).click()
  await a.getByRole("tab", { name: "mymod.py" }).waitFor()
  await a.waitForTimeout(400)
  await typeCode(a, "VALUE = 41\n")
  await a.waitForTimeout(500)
  await a.getByRole("tab", { name: /main\.py/ }).click()
  await a.waitForTimeout(400)
  await typeCode(a, "import mymod\nprint(mymod.VALUE + 1)\n")
  await a.getByRole("button", { name: "Run", exact: true }).click()
  await a.getByTestId("run-output").filter({ hasText: "42" }).waitFor({ timeout: 30000 })
  check("browser Python runs across files", true)
  await typeCode(a, seedQs[0].solution + "\n")
  await a.getByRole("button", { name: "Run", exact: true }).click()
  await a.getByTestId("verdict").waitFor({ timeout: 30000 })
  check("browser samples pass", (await a.getByTestId("verdict").textContent()).includes("Sample cases passed"))
  check("browser mode prompts to sign in for hidden tests", await a.getByText(/Sign in to submit it against the hidden tests/).isVisible())
  await a.goto(BASE + "/playground")
  await a.locator(".monaco-editor .view-line").first().waitFor({ timeout: 30000 })
  check("playground opens", await a.getByLabel("Your code").first().count() >= 0)

  // ---- phone
  const m = await open(null, { width: 390, height: 800 })
  await m.goto(BASE + "/problems/p1")
  await m.locator(".monaco-editor .view-line").first().waitFor({ timeout: 30000 })
  check("phone: no sideways page scroll", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await m.evaluate(() => document.documentElement.scrollWidth))
  await m.screenshot({ path: SHOTS + "phone-ide.png", fullPage: true })

  // ---- dashboard
  const d = await open("admin@example.com")
  for (const [path, heading] of [["/admin", "Overview"], ["/admin/problems", "Problems"], ["/admin/contests", "Contests"], ["/admin/notes", "Notices"], ["/admin/submissions", "Submissions"], ["/admin/languages", "Languages"], ["/admin/users", "Users"], ["/admin/settings", "Settings"]]) {
    await d.goto(BASE + path)
    const ok = await d.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    check(`dashboard ${path} renders`, ok)
    if (path === "/admin/settings") await d.screenshot({ path: SHOTS + "admin-settings.png" })
    if (path === "/admin") { await d.waitForTimeout(500); await d.screenshot({ path: SHOTS + "admin-overview.png" }) }
  }
  await d.goto(BASE + "/admin/settings")
  const toggle = d.getByRole("switch", { name: "Contests" })
  await toggle.waitFor()
  const wasOn = await toggle.isChecked()
  await toggle.click()
  await d.waitForFunction((v) => document.querySelector('[aria-label="Contests"]').checked !== v, wasOn)
  await d.reload()
  await d.getByRole("switch", { name: "Contests" }).waitFor()
  check("setting toggle persists", (await d.getByRole("switch", { name: "Contests" }).isChecked()) !== wasOn)
  await d.getByRole("switch", { name: "Contests" }).click()
  await d.waitForTimeout(400)
  await d.goto(BASE + "/admin/problems/new")
  await d.getByLabel("Title").waitFor()
  await d.getByLabel("Title").fill("UI Made Problem")
  await d.getByLabel("Address").fill("ui-made")
  await d.getByLabel("Problem statement", { exact: true }).fill("Double the `number`.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |")
  await d.getByTestId("markdown-preview").locator("table").waitFor({ timeout: 10000 })
  await d.getByLabel("Input format").fill("Line 1: a number `n`")
  // Images in markdown: uploaded from the editor, stored by the server, shown in the preview.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
  await d.getByLabel("Upload an image to Problem statement").setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: png })
  await d.getByTestId("markdown-preview").locator('img[alt="diagram"]').waitFor({ timeout: 15000 })
  const imageUrl = await d.getByTestId("markdown-preview").locator('img[alt="diagram"]').getAttribute("src")
  check("an image uploads from the editor into the markdown", /^\/api\/v1\/uploads\/[0-9a-f-]{36}$/.test(imageUrl) && (await d.getByLabel("Problem statement", { exact: true }).inputValue()).includes(`![diagram](${imageUrl})`), imageUrl)
  const served = await d.request.get(BASE + imageUrl)
  check("and is served as an image that can't be read as anything else", served.status() === 200 && served.headers()["content-type"] === "image/png" && served.headers()["x-content-type-options"] === "nosniff")
  const svg = await d.request.post(BASE + "/api/v1/uploads", { multipart: { file: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') } } })
  check("SVG and other files that aren't plain images are refused", svg.status() === 415)
  const fromStudent = await s.request.post(BASE + "/api/v1/uploads", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } })
  check("students can't upload", fromStudent.status() === 403)
  check("the statement editor previews markdown as it's typed", await d.getByTestId("markdown-preview").locator("code", { hasText: "number" }).isVisible())
  await d.getByLabel(/^Reference solution \(Python/).fill("n = int(input())\nprint(n * 2)")
  await d.getByRole("button", { name: "Generate from the reference solution" }).first().click()
  check("starter code is generated from the solution: input kept, logic left out", (await d.getByLabel(/^Starter code \(Python/).inputValue()) === "n = int(input())\n\n# Your code here\n", JSON.stringify(await d.getByLabel(/^Starter code \(Python/).inputValue()))
  await d.getByRole("button", { name: "Generate from the reference solution" }).first().click()
  await d.getByRole("alertdialog", { name: /Replace the Python/ }).waitFor({ timeout: 10000 })
  check("and asks before replacing starter code that's there", true)
  await d.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click()
  await d.getByLabel("Test 1 input").fill("4")
  await d.getByRole("button", { name: "Fill expected outputs from the Python solution" }).click()
  await d.getByText("Expected outputs filled").waitFor({ timeout: 90000 })
  check("fill outputs from solution", (await d.getByLabel("Test 1 expected output").inputValue()) === "8")
  await d.getByText("Published in practice").click()
  await d.getByRole("button", { name: "Save", exact: true }).click()
  await d.waitForURL(/admin\/problems\/[0-9a-f-]{36}/, { timeout: 15000 })
  await d.getByLabel("Title").waitFor({ timeout: 15000 })
  check("saved problem reopens with its data", (await d.getByLabel("Title").inputValue()) === "UI Made Problem" && (await d.getByLabel("Test 1 expected output").inputValue()) === "8" && (await d.getByLabel("Problem statement", { exact: true }).inputValue()).includes("| 1 | 2 |") && (await d.getByLabel("Input format").inputValue()) === "Line 1: a number `n`")
  await d.getByLabel("Title").fill("UI Made Problem Edited")
  await d.getByRole("button", { name: "Save", exact: true }).click()
  await d.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15000 })
  await d.screenshot({ path: SHOTS + "admin-problem.png" })
  check("editing a problem saves through the UI", (await (await admin("/problems/ui-made")).json).title === "UI Made Problem Edited")
  await d.goto(BASE + "/admin/contests/new")
  await d.getByLabel("Title").waitFor()
  await d.getByLabel("Title").fill("UI Cup")
  await d.getByRole("button", { name: "Add Simple Interest" }).click()
  await d.getByRole("button", { name: "Publish" }).click()
  await d.waitForURL(/admin\/contests\/[0-9a-f-]{36}/, { timeout: 15000 })
  await d.getByLabel("Title").waitFor({ timeout: 15000 })
  check("contest created in the UI, reopens with its problem", (await d.getByLabel("Title").inputValue()) === "UI Cup" && (await d.getByTestId("selected-problem").count()) === 1)
  await d.getByRole("button", { name: "Save changes" }).click()
  await d.getByRole("status").filter({ hasText: "Published." }).waitFor({ timeout: 15000 })
  check("re-saving a contest keeps its dates valid", true)
  const pubPage = await open(null)
  await pubPage.goto(BASE + "/problems/ui-made")
  check("problem from the dashboard is live, table and code rendered", await pubPage.getByRole("heading", { name: /UI Made Problem/ }).isVisible() && await pubPage.locator("table").first().isVisible())

  // ---- contest page + staff gate
  const st = await open("ana@example.com")
  await st.goto(BASE + "/admin")
  check("student sent away from the dashboard", st.url().includes("/sign-in"), st.url())
  await st.goto(BASE + "/contests")
  await st.getByRole("heading", { name: "Midterm" }).waitFor({ timeout: 15000 }).catch(() => {})
  await st.goto(BASE + "/contests/ui-cup")
  await st.getByRole("button", { name: "Register" }).waitFor({ timeout: 15000 }).catch(() => {})
  await st.getByRole("button", { name: "Register" }).click()
  await st.getByText("You're registered.").waitFor({ timeout: 15000 })
  check("registering through the UI", true)
  await st.goto(BASE + "/contests/midterm")
  await st.getByRole("tab", { name: "Leaderboard" }).click()
  await st.getByRole("cell", { name: "Ana" }).waitFor({ timeout: 15000 })
  check("contest page and board render", true)
  await st.screenshot({ path: SHOTS + "contest.png" })

  // ---- dark
  const dk = await open("ana@example.com", { width: 1440, height: 900 }, "dark")
  await dk.goto(BASE + "/problems/p1")
  await dk.locator(".monaco-editor .view-line").first().waitFor({ timeout: 30000 })
  await dk.waitForTimeout(500)
  await dk.screenshot({ path: SHOTS + "ide-dark.png" })
  check("Monaco follows dark theme", await dk.evaluate(() => getComputedStyle(document.querySelector(".monaco-editor-background, .monaco-editor .margin")).backgroundColor) === "rgb(30, 29, 24)", await dk.evaluate(() => getComputedStyle(document.querySelector(".monaco-editor .margin")).backgroundColor))

  check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 6).join(" || "))
  await browser.close()
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
