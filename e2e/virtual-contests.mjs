/**
 * Virtual contests: after a contest ends, someone who didn't take part live takes it once on
 * their own clock, ranked against the real contestants as they stood at the same minute. Their
 * work never reaches the official board. Needs a runner up (as in e2e/run.sh) for the submit.
 *   node e2e/virtual-contests.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
const PEOPLE = ["vc-s", "vc-p", "vc-ana", "vc-ben", "vc-dana", "vc-eve", "vc-admin"]
const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'vc-%')`)
  psql(`delete from contests where slug like 'vc-%'`)
  psql(`delete from questions where title like 'vc %'`)
  psql(`delete from problems where slug like 'vc-%'`)
  psql(`delete from users where email like 'vc-%'`)
}
cleanup()
for (const h of PEOPLE) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.slice(3)}','${h === "vc-admin" ? "admin" : "student"}','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (h) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email: `${h}@example.com` }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [s, dana, eve, admin] = await Promise.all(["vc-s", "vc-dana", "vc-eve", "vc-admin"].map(client))
await admin("/admin/settings", { method: "PATCH", body: { "server_execution.enabled": true, "submissions.per_minute": 60 } })

// Two problems (double and triple a number) and a question.
const problem = (slug, title, k) => ({ slug, title, unitId: null, level: "easy", description: `Print ${k} times the number.`, statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "2", expected: String(2 * k), isSample: true, points: 1 }, { input: "5", expected: String(5 * k), isSample: false, points: 1 }] })
const A = (await admin("/admin/problems", { body: problem("vc-double", "Vc Double", 2) })).json.id
const B = (await admin("/admin/problems", { body: problem("vc-triple", "Vc Triple", 3) })).json.id
const Q = (await admin("/admin/questions", { body: { title: "vc One", kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1 } })).json?.id
const at = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const contestBody = (over) => ({ title: "Vc Cup", slug: "vc-cup", description: "", startsAt: at(-5), endsAt: at(-3), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [A, B], questions: Q ? [{ questionId: Q, points: 1 }] : [], ...over })
const made = await admin("/admin/contests", { body: contestBody({}) })
check("a contest in the past is made", made.status === 200, JSON.stringify(made.json).slice(0, 200))
const contestId = psql(`select id from contests where slug='vc-cup'`)
const startsAt = psql(`select starts_at from contests where id='${contestId}'`)
// The live contest: Ana solves A at 10 min; Ben fails A at 20, solves it at 25 and B at 90; Dana
// registered and did nothing; Eve submitted once (so she took part).
for (const h of ["vc-ana", "vc-ben", "vc-dana", "vc-eve"]) psql(`insert into contest_participants(contest_id,user_id) values ('${contestId}','${uid(h)}')`)
const live = (h, p, verdict, minute) => psql(`insert into submissions(user_id,problem_id,contest_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${p}','${contestId}','submit','python','main.py','[]',1000,256,'done','${verdict}',${verdict === "AC" ? 2 : 0},2,'${startsAt}'::timestamptz + interval '${minute} minutes','${startsAt}'::timestamptz + interval '${minute} minutes')`)
live("vc-ana", A, "AC", 10)
live("vc-ben", A, "WA", 20)
live("vc-ben", A, "AC", 25)
live("vc-ben", B, "AC", 90)
live("vc-eve", A, "WA", 5)
const official = async () => (await s("/contests/vc-cup/leaderboard")).json
const before = await official()

// ---------- who may take it
await admin("/admin/contests", { body: contestBody({ slug: "vc-live", title: "Vc Live", startsAt: at(-1), endsAt: at(1) }) })
check("not before the contest has ended", (await s("/contests/vc-live/virtual", { method: "POST" })).json?.error?.code === "contest_not_over")
check("not by someone who took part live", (await eve("/contests/vc-cup/virtual", { method: "POST" })).json?.error?.code === "took_part_live" && (await eve("/contests/vc-cup/virtual")).json?.reason === "took_part_live")
check("someone who only registered may", (await dana("/contests/vc-cup/virtual")).json?.state === "available")
const offer = (await s("/contests/vc-cup/virtual")).json
check("offered, with the contest's length", offer?.state === "available" && offer.lengthMinutes === 120, JSON.stringify(offer))
const RIGHT2 = "print(int(input()) * 2)\n"
const submit = (code, problemSlug) => s("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug, contestSlug: "vc-cup" } })
check("submitting to it before starting is refused", (await submit(RIGHT2, "vc-double")).json?.error?.code === "contest_over")
check("starting it", (await s("/contests/vc-cup/virtual", { method: "POST" })).status === 200)
check("only once", (await s("/contests/vc-cup/virtual", { method: "POST" })).json?.error?.code === "already_taken")

// ---------- during the attempt (moved 30 minutes in, so the board stands at minute 30)
psql(`update contest_virtuals set started_at = now() - interval '30 minutes' where contest_id='${contestId}' and user_id='${uid("vc-s")}'`)
const sent = await submit(RIGHT2, "vc-double")
check("a submit during the attempt is taken", sent.status === 200 && Boolean(sent.json?.id), JSON.stringify(sent.json))
check("...and stored without the contest", psql(`select coalesce(contest_id::text, 'none') from submissions where id='${sent.json?.id}'`) === "none")
for (let i = 0; i < 600 && psql(`select status from submissions where id='${sent.json?.id}'`) !== "done"; i++) await new Promise((r) => setTimeout(r, 200))
check("judged Accepted", psql(`select verdict from submissions where id='${sent.json?.id}'`) === "AC")
if (Q) {
  check("answering a question during the attempt", (await s(`/contests/vc-cup/questions/${Q}`, { body: { answer: ["a"] } })).json?.correct === true)
  check("once each", (await s(`/contests/vc-cup/questions/${Q}`, { body: { answer: ["b"] } })).json?.error?.code === "already_answered")
}
const view = (await s("/contests/vc-cup")).json
check("the contest page shows the attempt running and my results", view?.virtual?.state === "running" && view.problems.find((p) => p.label === "A")?.status === "solved", JSON.stringify(view?.virtual))
check("right answers stay hidden while it runs", !Q || view.questions.every((q) => q.solution === null && q.answer?.correct === true))
const vb = (await s("/contests/vc-cup/virtual/leaderboard")).json
const row = (name) => vb?.rows?.find((r) => r.user.name === name)
check("the board stands at minute 30", vb?.running === true && vb.minute === 30, JSON.stringify({ running: vb?.running, minute: vb?.minute }))
check("real work up to that minute is there, later work isn't", row("ana")?.solved === 1 && row("ben")?.solved === 1 && row("ben")?.problems[0].attempts === 1 && row("ben")?.problems[1].solved === false, JSON.stringify(vb?.rows?.map((r) => [r.user.name, r.solved, r.penalty])))
check("I'm on it, my work at its minute, marked as me", row("s")?.user.id === vb?.you && row("s")?.problems[0].solved && row("s")?.problems[0].solvedAtMinutes === 30, JSON.stringify(row("s")))
const after = await official()
check("the official board is unchanged: I'm not on it", after?.rows?.length === before?.rows?.length && !after.rows.some((r) => r.user.name === "s"), JSON.stringify(after?.rows?.map((r) => r.user.name)))

// ---------- after the attempt
// Moved to 130 minutes in (over), with my work moved back with it so it stays at minute 30.
psql(`update contest_virtuals set started_at = now() - interval '130 minutes', answers = (select jsonb_object_agg(k, jsonb_set(v, '{answeredAt}', to_jsonb((now() - interval '100 minutes')::text))) from jsonb_each(answers) as e(k, v)) where contest_id='${contestId}' and user_id='${uid("vc-s")}'`)
psql(`update submissions set created_at = created_at - interval '100 minutes' where id='${sent.json?.id}'`)
check("submitting after the attempt is over is refused", (await submit(RIGHT2, "vc-triple")).json?.error?.code === "contest_over")
const done = (await s("/contests/vc-cup/virtual")).json
check("afterwards: where I'd have finished (A and the question at 30 minutes: first)", done?.state === "done" && done.result?.of === 5 && done.result.rank === 1 && done.result.solved === 2 && done.result.penalty >= 58 && done.result.penalty <= 60, JSON.stringify(done?.result))
const final = (await s("/contests/vc-cup/virtual/leaderboard")).json
check("the final virtual board has the real final standings", final?.running === false && final.rows.find((r) => r.user.name === "ben")?.solved === 2)
check("right answers show once it's over", !Q || (await s("/contests/vc-cup")).json?.questions?.[0]?.solution !== null)

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const as = async (h, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  return page
}
try {
  const p = await as("vc-p")
  await p.goto(`${BASE}/contests/vc-cup`)
  await p.getByTestId("virtual-offer").waitFor({ timeout: 30000 })
  await p.getByTestId("virtual-offer").screenshot({ path: `${SHOTS}vc-offer.png` })
  await p.getByRole("button", { name: "Take it virtually" }).click()
  await p.getByRole("alertdialog").getByRole("button", { name: "Start" }).click()
  await p.getByTestId("virtual-running").waitFor({ timeout: 15000 })
  check("starting from the page shows the attempt's clock", true)
  await p.getByRole("tab", { name: "Leaderboard" }).click()
  await p.getByTestId("virtual-board-note").waitFor({ timeout: 15000 })
  check("the leaderboard tab shows my virtual board, with me marked", (await p.locator("tr[data-you]").count()) === 1)
  await p.screenshot({ path: `${SHOTS}vc-running.png`, fullPage: true })
  await p.goto(`${BASE}/contests/vc-cup/problems/A`)
  await p.getByTestId("virtual-clock").waitFor({ timeout: 30000 })
  check("a problem page counts toward the attempt and shows its clock", (await p.getByText("Virtual contest: your submissions here count toward your attempt.").count()) === 1)
  await p.screenshot({ path: `${SHOTS}vc-problem.png` })

  const done = await as("vc-s", { width: 390, height: 844 })
  await done.goto(`${BASE}/contests/vc-cup`)
  await done.getByTestId("virtual-result").waitFor({ timeout: 30000 })
  check("afterwards the page shows my result, on a phone without sideways scrolling", /1st of 5 · 2 solved · penalty (58|59|60)/.test(await done.getByTestId("virtual-result").textContent()) && (await done.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)))
  await done.screenshot({ path: `${SHOTS}vc-result-phone.png`, fullPage: true })
  const e = await as("vc-eve")
  await e.goto(`${BASE}/contests/vc-cup`)
  await e.getByText("You took part in this contest").waitFor({ timeout: 30000 })
  check("someone who took part live is told why there's no virtual", (await e.getByRole("button", { name: "Take it virtually" }).count()) === 0)
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  await admin("/admin/settings", { method: "PATCH", body: { "submissions.per_minute": 12 } })
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll virtual contest checks passed")
process.exit(failures ? 1 : 0)
