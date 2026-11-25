/**
 * Solution posts on library problems: shared from an accepted submission by someone who solved
 * it, read by people who have, voted, commented and reported; hidden by moderators.
 *   node e2e/solution-posts.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from submissions where user_id in (select id from users where email like 'sp-%')`)
  psql(`delete from contests where slug like 'sp-%'`)
  psql(`delete from problems where slug like 'sp-%'`)
  psql(`delete from platform_staff where user_id in (select id from users where email like 'sp-%')`)
  psql(`delete from users where email like 'sp-%'`)
}
cleanup()
for (const h of ["sp-a", "sp-b", "sp-c", "sp-mod", "sp-admin"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.slice(3).toUpperCase()} Person','${h === "sp-admin" ? "admin" : "student"}','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (h) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email: `${h}@example.com` }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [a, b, c, mod, admin] = await Promise.all(["sp-a", "sp-b", "sp-c", "sp-mod", "sp-admin"].map(client))
await admin("/admin/settings", { method: "PATCH", body: { "solutions.posts": true, "practice.show_solutions": true, "practice.solutions_after_solve": true } })
// A moderator: a custom platform role with only "Moderate solution posts".
const role = await admin("/admin/roles", { body: { name: "Sp Moderator", description: "Moderates solution posts.", permissions: ["platform.solutions.moderate"] } })
const given = await admin("/admin/staff", { method: "PUT", body: { email: "sp-mod@example.com", role: role.json?.id } })
check("setup: a moderator role is given", role.status === 200 && given.status === 200, JSON.stringify([role.json, given.json]).slice(0, 300))

const problemBody = (slug, extra = {}) => ({ slug, title: slug, unitId: null, level: "easy", description: "Print 1.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "", expected: "1", isSample: true, points: 1 }], ...extra })
const lib = (await admin("/admin/problems", { body: problemBody("sp-lib") })).json
const hiddenOne = (await admin("/admin/problems", { body: problemBody("sp-assess", { listed: false }) })).json
const accepted = (h, problemId, code, verdict = "AC") => psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${problemId}','submit','python','main.py','${JSON.stringify([{ path: "main.py", content: code }]).replaceAll("'", "''")}',1000,256,'done','${verdict}',1,1,now(),now()) returning id`)
const subA = accepted("sp-a", lib.id, "print(1)  # A's way")
const subB = accepted("sp-b", lib.id, "print(2 - 1)")
const wrongC = accepted("sp-c", lib.id, "print(0)", "WA")
accepted("sp-a", hiddenOne.id, "print(1)")

// ---------- writing
const write = (who, body) => who("/problems/sp-lib/solutions", { body })
const good = { title: "Just print it", body: "The answer is always one, so print it directly.", submissionId: subA }
check("someone who hasn't solved it can't share", (await write(c, { ...good, submissionId: wrongC })).json?.error?.code === "solve_first")
check("code must come from your own accepted submission", (await write(a, { ...good, submissionId: subB })).json?.error?.code === "not_accepted")
const posted = await write(a, good)
check("sharing an accepted solution", posted.status === 200 && psql(`select code from solution_posts where id='${posted.json?.id}'`).includes("A's way"), JSON.stringify(posted.json))
check("writing again edits the one post", (await write(a, { ...good, title: "Print one" })).json?.id === posted.json.id && psql(`select count(*) from solution_posts where author_id='${uid("sp-a")}'`) === "1")
check("not on an assessment-only problem", (await a("/problems/sp-assess/solutions")).status === 404)
const postB = (await write(b, { title: "Arithmetic", body: "Two minus one is one, which is the answer.", submissionId: subB })).json

// ---------- reading
const locked = (await c("/problems/sp-lib/solutions")).json
check("before solving: only how many", locked?.canRead === false && locked.count === 2 && locked.posts.length === 0, JSON.stringify(locked))
check("a post can't be opened by id before solving", (await c(`/solutions/${posted.json.id}`)).status === 404)
const listB = (await b("/problems/sp-lib/solutions")).json
check("after solving: the posts", listB?.canRead === true && listB.posts.length === 2 && listB.mine === postB.id)

// ---------- votes, comments, reports
check("no voting on your own post", (await a(`/solutions/${posted.json.id}/vote`, { method: "PUT", body: { on: true } })).json?.error?.code === "own_post")
check("a vote counts once", (await b(`/solutions/${posted.json.id}/vote`, { method: "PUT", body: { on: true } })).json?.votes === 1 && (await b(`/solutions/${posted.json.id}/vote`, { method: "PUT", body: { on: true } })).json?.votes === 1)
check("most votes first", (await b("/problems/sp-lib/solutions")).json?.posts?.[0]?.id === posted.json.id)
check("taking a vote back", (await b(`/solutions/${posted.json.id}/vote`, { method: "PUT", body: { on: false } })).json?.votes === 0)
await b(`/solutions/${posted.json.id}/vote`, { method: "PUT", body: { on: true } })
const commented = await b(`/solutions/${posted.json.id}/comments`, { body: { body: "Neat, but why not compute it?" } })
check("commenting", commented.status === 200)
check("the author hears of the comment", psql(`select count(*) from notifications where user_id='${uid("sp-a")}' and kind='solution_comment'`) === "1")
const read = (await b(`/solutions/${posted.json.id}`)).json
check("a post with its code and comments", read?.code?.includes("A's way") && read.comments.length === 1 && read.voted === true && read.reports === undefined, JSON.stringify(read).slice(0, 300))
check("reporting, once each", (await b(`/solutions/${posted.json.id}/report`, { method: "POST" })).status === 200 && (await b(`/solutions/${posted.json.id}/report`, { method: "POST" })).status === 200 && psql(`select reports from solution_posts where id='${posted.json.id}'`) === "1")

// ---------- moderation
check("students can't moderate", (await b("/admin/solutions")).status === 403)
const queue = (await mod("/admin/solutions?filter=reported")).json
check("the moderator sees the reported post first", queue?.[0]?.id === posted.json.id && queue[0].reports === 1, JSON.stringify(queue).slice(0, 200))
check("hiding it", (await mod("/admin/solutions", { body: { kind: "post", id: posted.json.id, hidden: true } })).status === 200)
check("hidden from readers, still there for its author", !(await b("/problems/sp-lib/solutions")).json.posts.some((p) => p.id === posted.json.id) && (await a("/problems/sp-lib/solutions")).json.posts.some((p) => p.id === posted.json.id && p.hidden))
check("hiding is logged", psql(`select count(*) from audit_log where action='solution.hide' and org_id is null`) === "1")
await mod("/admin/solutions", { body: { kind: "post", id: posted.json.id, hidden: false } })

// ---------- closed while a contest uses the problem, and switched off
await admin("/admin/contests", { body: { title: "Sp Cup", slug: "sp-cup", description: "", startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [lib.id], questions: [], rated: false } })
check("hidden while a contest uses the problem", (await b("/problems/sp-lib/solutions")).json?.error?.code === "contest_running")
psql(`delete from contests where slug='sp-cup'`)
await admin("/admin/settings", { method: "PATCH", body: { "solutions.posts": false } })
await new Promise((r) => setTimeout(r, 5500))
check("the platform can switch them off", (await b("/problems/sp-lib/solutions")).status === 403)
await admin("/admin/settings", { method: "PATCH", body: { "solutions.posts": true } })
await new Promise((r) => setTimeout(r, 5500))

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
  for (const [name, viewport] of [["laptop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await as("sp-b", viewport)
    await p.goto(`${BASE}/problems/sp-lib?tab=solutions`)
    await p.getByTestId("solutions").waitFor({ timeout: 60000 })
    await p.getByRole("button", { name: /Print one/ }).click()
    await p.getByTestId("solution-post").getByText("A's way").waitFor({ timeout: 15000 })
    check(`${name}: a post opens with its code and comments`, (await p.getByText("Neat, but why not compute it?").count()) === 1)
    await p.screenshot({ path: `${SHOTS}sp-post-${name}.png` })
  }
  const c2 = await as("sp-c")
  await c2.goto(`${BASE}/problems/sp-lib`)
  await c2.getByRole("tab", { name: "Solutions" }).click()
  await c2.getByTestId("solutions-locked").waitFor({ timeout: 30000 })
  check("before solving the tab says how many and asks to solve first", (await c2.getByTestId("solutions-locked").textContent()).includes("2 solutions"))
  const m = await as("sp-mod")
  await m.goto(`${BASE}/admin/solutions`)
  await m.getByRole("cell", { name: /Print one/ }).waitFor({ timeout: 30000 })
  check("the moderation page lists reported posts", (await m.getByRole("cell", { name: /Print one/ }).count()) === 1)
  await m.screenshot({ path: `${SHOTS}sp-moderation.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
  psql(`delete from platform_roles where name = 'Sp Moderator'`)
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll solution post checks passed")
process.exit(failures ? 1 : 0)
