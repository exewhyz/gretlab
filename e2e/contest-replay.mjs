/**
 * Contest code replay: whoever runs a contest opens a contestant's cell on the board and sees
 * how that code was written while the contest ran (draft snapshots), with their submissions on
 * the timeline and the steps where a lot of new code appeared at once. Contestants and others
 * see nothing; code written before or after the contest isn't shown; each replay is logged.
 *   node e2e/contest-replay.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from audit_log where action='contest.replay' and summary like '%Rp Cup%'`)
  psql(`delete from submissions where user_id in (select id from users where email like 'rp-%')`)
  psql(`delete from contests where slug like 'rp-%'`)
  psql(`delete from problems where slug like 'rp-%'`)
  psql(`delete from users where email like 'rp-%'`)
}
cleanup()
for (const [h, role] of [["rp-ana", "student"], ["rp-ben", "student"], ["rp-out", "student"], ["rp-admin", "admin"]])
  psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h[3].toUpperCase()}${h.slice(4)}','${role}','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const cookieFor = async (h) => ({ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE })
const client = async (h) => {
  const cookie = `next-auth.session-token=${(await cookieFor(h)).value}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [ana, out, admin] = await Promise.all(["rp-ana", "rp-out", "rp-admin"].map(client))

const STARTER = "n = int(input())"
const problem = { slug: "rp-sum", title: "Rp Sum", unitId: null, level: "easy", description: "Add them up.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, code: { python: { starter: STARTER } }, tests: [{ input: "2", expected: "2", isSample: true, points: 1 }] }
const madeProblem = await admin("/admin/problems", { body: problem })
const P = madeProblem.json?.id
check("a problem with starter code", Boolean(P), JSON.stringify(madeProblem.json).slice(0, 200))
const at = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const made = await admin("/admin/contests", { body: { title: "Rp Cup", slug: "rp-cup", description: "", startsAt: at(-3), endsAt: at(-1), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [P], questions: [] } })
check("a contest that has ended", made.status === 200, JSON.stringify(made.json).slice(0, 200))
const contestId = psql(`select id from contests where slug='rp-cup'`)
for (const h of ["rp-ana", "rp-ben"]) psql(`insert into contest_participants(contest_id,user_id) values ('${contestId}','${uid(h)}')`)
const start = `(select starts_at from contests where id='${contestId}')`
const file = (content) => JSON.stringify([{ path: "main.py", content }]).replaceAll("'", "''")
const snapshot = (when, content) => psql(`insert into draft_snapshots(user_id,problem_id,language,files,at) values ('${uid("rp-ana")}','${P}','python','${file(content)}',${when})`)
const pasted = Array.from({ length: 12 }, (_, i) => `total_${i} = sum(map(int, input().split())) + ${i}`).join("\n")
// Practice before the contest and after it: not the contest's to see.
snapshot(`${start} - interval '1 hour'`, `${STARTER}\nprint("practice before")`)
snapshot(`${start} + interval '5 minutes'`, `${STARTER}\nprint(n)`)
snapshot(`${start} + interval '6 minutes'`, `${STARTER}\nprint(n + 1)`)
snapshot(`${start} + interval '20 minutes'`, `${STARTER}\n${pasted}`)
snapshot(`${start} + interval '21 minutes'`, `${STARTER}\n${pasted}\nprint(total_0)`)
snapshot(`now()`, `${STARTER}\nprint("practice after")`)
const sub = (minute, verdict) => psql(`insert into submissions(user_id,problem_id,contest_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,passed_tests,total_tests,created_at,queue_at) values ('${uid("rp-ana")}','${P}','${contestId}','submit','python','main.py','[]',1000,256,'done','${verdict}',${verdict === "AC" ? 1 : 0},1,${verdict === "AC" ? 1 : 0},1,${start} + interval '${minute} minutes',${start} + interval '${minute} minutes')`)
sub(15, "WA")
sub(22, "AC")

// ---------- who sees it
const path = (user, label = "A") => `/contests/rp-cup/replay?user=${user}&problem=${label}`
const board = (await admin("/contests/rp-cup/leaderboard")).json
check("whoever runs it is told which cells open a replay", JSON.stringify(board?.replay) === '["A"]', JSON.stringify(board?.replay))
const studentBoard = (await ana("/contests/rp-cup/leaderboard")).json
check("a contestant's board offers none", Array.isArray(studentBoard?.replay) && studentBoard.replay.length === 0)
check("a contestant can't replay anyone, even themselves", (await ana(path(uid("rp-ana")))).status === 404)
check("nor can someone outside it", (await out(path(uid("rp-ana")))).status === 404)
const r = await admin(path(uid("rp-ana")))
check("the organizer gets the replay", r.status === 200, JSON.stringify(r.json).slice(0, 200))
const code = (r.json?.history ?? []).map((h) => h.files[0].content)
check("only what was written while the contest ran", code.length === 4 && !code.some((c) => c.includes("practice")), JSON.stringify(code.map((c) => c.slice(-20))))
check("the submissions, in order", JSON.stringify(r.json?.attempts?.map((a) => a.verdict)) === '["WA","AC"]')
check("the paste is pointed out, measured from the starter (one jump, at minute 20)", r.json?.jumps?.length === 1 && r.json.jumps[0].step === 2 && r.json.jumps[0].seconds === 840, JSON.stringify(r.json?.jumps))
check("the person is named, by name and email", r.json?.student?.email === "rp-ana@example.com")
check("someone who didn't take part isn't found", (await admin(path(uid("rp-out")))).status === 404)
check("registered but wrote nothing: an empty replay", (await admin(path(uid("rp-ben")))).json?.history?.length === 0)
check("a label that isn't a problem isn't found", (await admin(path(uid("rp-ana"), "Z"))).status === 404)
check("a malformed request is refused", (await admin(`/contests/rp-cup/replay?user=nope&problem=A`)).status === 400)
check("each replay is in the activity log", Number(psql(`select count(*) from audit_log where action='contest.replay' and summary like '%Rp Cup%'`)) >= 1)

// ---------- in a browser
const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([await cookieFor("rp-admin")])
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await p.goto(`${BASE}/contests/rp-cup`)
  await p.getByRole("tab", { name: "Leaderboard" }).click()
  await p.getByRole("button", { name: "How Ana wrote A" }).click()
  const sheet = p.getByTestId("contest-replay")
  await sheet.getByTestId("playback").waitFor({ timeout: 30000 })
  check("the replay opens beside the board, with both submissions", (await sheet.getByTestId("replay-attempts").locator("li").count()) === 2)
  check("the paste is pointed out", (await sheet.getByTestId("playback-jumps").count()) === 1)
  await sheet.getByTestId("playback-jumps").getByRole("button").first().click()
  check("pressing it shows that step", (await sheet.getByTestId("playback-jump-here").count()) === 1 && (await sheet.getByText("total_11").count()) > 0)
  await sheet.getByRole("button", { name: "Minute 15: Wrong answer" }).click()
  check("a submission shows the code as it was then", (await sheet.getByText("print(n + 1)").count()) === 1 && (await sheet.getByText("Minute 6", { exact: true }).count()) === 1)
  await p.screenshot({ path: `${SHOTS}replay-sheet.png` })

  const student = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await student.addCookies([await cookieFor("rp-ana")])
  const sp = await student.newPage()
  await sp.goto(`${BASE}/contests/rp-cup`)
  await sp.getByRole("tab", { name: "Leaderboard" }).click()
  await sp.getByRole("table").waitFor({ timeout: 30000 })
  check("a contestant's board has nothing to open", (await sp.getByRole("button", { name: /^How / }).count()) === 0)

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await phone.addCookies([await cookieFor("rp-admin")])
  const pp = await phone.newPage()
  await pp.goto(`${BASE}/contests/rp-cup`)
  await pp.getByRole("tab", { name: "Leaderboard" }).click()
  await pp.getByRole("button", { name: "How Ana wrote A" }).click()
  await pp.getByTestId("contest-replay").getByTestId("playback").waitFor({ timeout: 30000 })
  check("the replay on a phone, without sideways scrolling", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await pp.screenshot({ path: `${SHOTS}replay-phone.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll contest replay checks passed")
process.exit(failures ? 1 : 0)
