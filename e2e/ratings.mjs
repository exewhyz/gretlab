/**
 * Contest ratings: once a rated contest ends, its final standings change the rating of everyone
 * who tried something in it, exactly once and oldest contest first. Organizations' contests only
 * when ticked; virtual attempts never.
 *   node e2e/ratings.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"
mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'rt-%')`)
  psql(`delete from contests where slug like 'rt-%'`)
  psql(`delete from organizations where slug = 'rt-school'`)
  psql(`delete from problems where slug like 'rt-%'`)
  psql(`delete from users where email like 'rt-%'`)
}
cleanup()
const people = ["rt-a", "rt-b", "rt-c", "rt-d", "rt-v", "rt-o", "rt-admin"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.slice(3).toUpperCase()} Person','${h === "rt-admin" ? "admin" : "student"}','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (h) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email: `${h}@example.com` }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [admin, a, owner] = await Promise.all(["rt-admin", "rt-a", "rt-o"].map(client))
const cron = () => fetch(`${BASE}/api/cron/outbox`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json()).catch(() => null)

const problem = (await admin("/admin/problems", { body: { slug: "rt-one", title: "Rt One", unitId: null, level: "easy", description: "Print 1.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "", expected: "1", isSample: true, points: 1 }] } })).json
const at = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const contestBody = (over) => ({ title: "Rt Cup", slug: "rt-cup-1", description: "", startsAt: at(-10), endsAt: at(-8), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [problem.id], questions: [], ...over })
const made1 = await admin("/admin/contests", { body: contestBody({}) })
check("a platform contest is rated when the form doesn't say", made1.status === 200 && psql(`select rated from contests where slug='rt-cup-1'`) === "t", JSON.stringify(made1.json).slice(0, 200))
await admin("/admin/contests", { body: contestBody({ slug: "rt-cup-2", title: "Rt Cup 2", startsAt: at(-6), endsAt: at(-4) }) })
await admin("/admin/contests", { body: contestBody({ slug: "rt-unrated", title: "Rt Practice", startsAt: at(-6), endsAt: at(-4), rated: false }) })
const cid = (slug) => psql(`select id from contests where slug='${slug}'`)
const play = (slug, h, verdict, minute) => {
  psql(`insert into contest_participants(contest_id,user_id) values ('${cid(slug)}','${uid(h)}') on conflict do nothing`)
  if (verdict) psql(`insert into submissions(user_id,problem_id,contest_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) select '${uid(h)}','${problem.id}',id,'submit','python','main.py','[]',1000,256,'done','${verdict}',1,1,starts_at + interval '${minute} minutes',now() from contests where slug='${slug}'`)
}
// Contest 1: A first, B second, C tried and failed, D only registered.
play("rt-cup-1", "rt-a", "AC", 5)
play("rt-cup-1", "rt-b", "AC", 30)
play("rt-cup-1", "rt-c", "WA", 10)
play("rt-cup-1", "rt-d", null)
// Contest 2: B wins this time, A second.
play("rt-cup-2", "rt-b", "AC", 5)
play("rt-cup-2", "rt-a", "AC", 50)
play("rt-unrated", "rt-a", "AC", 5)
play("rt-unrated", "rt-b", "AC", 6)
// V takes contest 1 virtually (its work carries no contest), before ratings are worked out.
psql(`insert into contest_virtuals(contest_id,user_id,started_at) values ('${cid("rt-cup-1")}','${uid("rt-v")}',now() - interval '3 hours')`)
psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid("rt-v")}','${problem.id}','submit','python','main.py','[]',1000,256,'done','AC',1,1,now() - interval '170 minutes',now())`)

// ---------- applied once, oldest first
const before = (await a("/contests/rt-cup-2/leaderboard")).json
check("before ratings are applied, the board says it's waiting", before?.awaitingRatings === true)
for (let i = 0; i < 50 && psql(`select count(*) from contests where slug in ('rt-cup-1','rt-cup-2') and rated_at is not null`) !== "2"; i++) await new Promise((r) => setTimeout(r, 200))
const changes = (slug) => Object.fromEntries(psql(`select u.email || '=' || r.before || ':' || r.after || ':' || r.rank from rating_changes r join users u on u.id = r.user_id where r.contest_id='${cid(slug)}'`).split("\n").filter(Boolean).map((l) => { const [email, rest] = l.split("="); const [b, af, rank] = rest.split(":").map(Number); return [email.split("@")[0], { before: b, after: af, rank }] }))
const c1 = changes("rt-cup-1")
const c2 = changes("rt-cup-2")
check("reading a finished board rates it, and the one before it first", Object.keys(c1).length === 3 && Object.keys(c2).length === 2, JSON.stringify({ c1, c2 }))
check("contest 1: everyone starts at 1500; first up, last down", c1["rt-a"]?.before === 1500 && c1["rt-a"].after > 1500 && c1["rt-c"]?.after < 1500 && c1["rt-a"].rank === 1, JSON.stringify(c1))
check("only registering isn't taking part: D isn't rated", !("rt-d" in c1))
check("a virtual attempt is never rated", !("rt-v" in c1) && !("rt-v" in c2))
check("contest 2 starts from where contest 1 left them", c2["rt-a"]?.before === c1["rt-a"]?.after && c2["rt-b"]?.before === c1["rt-b"]?.after, JSON.stringify({ c1, c2 }))
check("an unrated contest changes nothing", Object.keys(changes("rt-unrated")).length === 0 && psql(`select coalesce(rated_at::text,'none') from contests where slug='rt-unrated'`) === "none")
const cronRun = await cron()
check("the cron finds nothing left to rate: applied once", cronRun?.ratings?.rated === 0 && psql(`select count(*) from rating_changes where contest_id in ('${cid("rt-cup-1")}','${cid("rt-cup-2")}')`) === "5", JSON.stringify(cronRun?.ratings))

// ---------- shown
const board = (await a("/contests/rt-cup-1/leaderboard")).json
check("the finished board shows each contestant's change", board?.rows?.find((r) => r.user.name === "A Person")?.rating?.after === c1["rt-a"].after && board.awaitingRatings === false, JSON.stringify(board?.rows?.map((r) => r.rating)))
const profile = (await a("/users/rt-a")).json
check("a profile has the rating and each rated contest, newest first", profile?.rating?.rating === c2["rt-a"].after && profile.rating.contests.length === 2 && profile.rating.contests[0].slug === "rt-cup-2", JSON.stringify(profile?.rating))
check("someone never rated has none", (await a("/users/rt-d")).json?.rating?.rating === null)

// ---------- an organization's contest: rated only when ticked
await admin("/admin/organizations", { body: { name: "Rt School", slug: "rt-school", type: "school", ownerEmail: "rt-o@example.com" } })
const orgBody = (over) => ({ ...contestBody(over), audience: [] })
const classTest = await owner("/orgs/rt-school/contests", { body: orgBody({ slug: "rt-class", title: "Rt Class Test", startsAt: at(-3), endsAt: at(-2) }) })
const openOne = await owner("/orgs/rt-school/contests", { body: orgBody({ slug: "rt-org-rated", title: "Rt Open", startsAt: at(-3), endsAt: at(-2), rated: true }) })
check("an organization's contest isn't rated unless ticked", psql(`select string_agg(slug || '=' || rated, ',' order by slug) from contests where slug in ('rt-class','rt-org-rated')`) === "rt-class=false,rt-org-rated=true", JSON.stringify([classTest, openOne]).slice(0, 400))

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
  const p = await as("rt-b")
  await p.goto(`${BASE}/u/rt-a`)
  await p.getByTestId("contest-rating").waitFor({ timeout: 30000 })
  check("the profile shows the rating and its chart", (await p.getByTestId("rating-chart").count()) === 1 && (await p.getByTestId("contest-rating").textContent()).includes(String(c2["rt-a"].after)))
  await p.getByTestId("contest-rating").screenshot({ path: `${SHOTS}rt-profile.png` })
  const phone = await as("rt-b", { width: 390, height: 844 })
  await phone.goto(p.url())
  await phone.getByTestId("contest-rating").waitFor({ timeout: 30000 })
  check("on a phone, without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.getByTestId("contest-rating").screenshot({ path: `${SHOTS}rt-profile-phone.png` })
  await p.goto(`${BASE}/contests/rt-cup-1`)
  await p.getByRole("tab", { name: "Leaderboard" }).click()
  await p.getByRole("columnheader", { name: "Rating" }).waitFor({ timeout: 15000 })
  check("the contest board has a Rating column", true)
  await p.screenshot({ path: `${SHOTS}rt-board.png` })
  const f = await as("rt-admin")
  await f.goto(`${BASE}/admin/contests/new`)
  await f.getByRole("checkbox", { name: /Rated/ }).waitFor({ timeout: 30000 })
  check("a new platform contest's form starts rated", (await f.getByRole("checkbox", { name: /Rated/ }).getAttribute("aria-checked")) === "true")
  const o = await as("rt-o")
  await o.goto(`${BASE}/orgs/rt-school/manage/contests/new`)
  await o.getByRole("checkbox", { name: /Rated/ }).waitFor({ timeout: 30000 })
  check("an organization's starts unrated", (await o.getByRole("checkbox", { name: /Rated/ }).getAttribute("aria-checked")) === "false")
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll rating checks passed")
process.exit(failures ? 1 : 0)
