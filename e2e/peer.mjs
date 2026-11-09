/**
 * Peer review: settings, handing out reviews after the due time, anonymity, writing and
 * handing in reviews (rubric scores, line comments, summary), authors reading them,
 * teachers' overview and hiding, closing, and the pages.
 *   node e2e/peer.mjs [base-url] [screenshot-dir]
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
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()

const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'peer-%')`)
  psql(`delete from assignments where title like 'peer %'`)
  psql(`delete from organizations where slug = 'peertest'`)
  psql(`delete from users where email like 'peer-%'`)
}
cleanup()
const PEOPLE = ["peer-t", "peer-s1", "peer-s2", "peer-s3", "peer-s4"]
for (const h of PEOPLE) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Peer College", slug: "peertest", type: "college", ownerEmail: "peer-t@example.com" } })
const O = "/orgs/peertest"
const orgId = psql(`select id from organizations where slug='peertest'`)
const [t, s1, s2, s3, s4] = await Promise.all(PEOPLE.map((h) => client(`${h}@example.com`)))
const lab = (await t(`${O}/groups`, { body: { name: "peer Lab" } })).json
const students = ["peer-s1", "peer-s2", "peer-s3", "peer-s4"]
for (const h of students) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: students.map(uid) } })
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing = 'everyone' order by slug limit 1`)
const base = (extra) => ({ description: "", allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [{ problemId: problem, points: 100, rubric: [{ id: "r1", label: "Readable", points: 5 }], outcomes: [] }], questions: [], ...extra })
const peer = { reviews: 2, anonymous: true, dueAt: days(3) }

// ---------- settings
check("exams don't have peer review", (await t(`${O}/assignments`, { body: base({ title: "peer Exam", slug: "peer-exam", opensAt: days(-5), dueAt: days(-1), exam: { minutes: 30, fullscreen: true, networks: [], startWithin: null }, peerReview: peer }) })).status === 400)
check("reviews are due after the assignment", (await t(`${O}/assignments`, { body: base({ title: "peer Bad", slug: "peer-bad", opensAt: days(-5), dueAt: days(-1), peerReview: { ...peer, dueAt: days(-2) } }) })).status === 400)
const later = (await t(`${O}/assignments`, { body: base({ title: "peer Later", slug: "peer-later", opensAt: days(-1), dueAt: days(2), peerReview: peer }) })).json
check("not before the due time", (await t(`${O}/assignments/${later.id}/peer`, { body: {} })).json?.error?.code === "not_due")
const a = (await t(`${O}/assignments`, { body: base({ title: "peer Week 1", slug: "peer-week-1", opensAt: days(-5), dueAt: days(-1), peerReview: peer }) })).json
check("an assignment with peer review", !!a?.id && a.peerReview?.reviews === 2, JSON.stringify(a).slice(0, 150))
const code = (n) => JSON.stringify([{ path: "main.py", content: `# by student ${n}\nprint(input())\nprint('done')\n` }]).replace(/'/g, "''")
for (const [i, h] of ["peer-s1", "peer-s2", "peer-s3"].entries()) {
  psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${problem}','submit','python','main.py','${code(i + 1)}',1000,256,'done','AC',100,100,'${days(-2)}','${days(-2)}')`)
}

// ---------- handing out
check("students can't start it", [403, 404].includes((await s1(`${O}/assignments/${a.id}/peer`, { body: {} })).status))
const started = await t(`${O}/assignments/${a.id}/peer`, { body: {} })
check("each who submitted reviews two classmates", started.json?.reviews === 6 && started.json.reviewers === 3, JSON.stringify(started.json))
check("only once", (await t(`${O}/assignments/${a.id}/peer`, { body: {} })).json?.error?.code === "already_started")
const mine = (await s1(`/assignments/peer-week-1/peer`)).json
check("a reviewer's list, without names", mine.toDo.length === 2 && mine.toDo[0].label === "Classmate 1" && !JSON.stringify(mine).includes("peer-s"), JSON.stringify(mine).slice(0, 200))
check("nobody reviews themselves, and someone who didn't submit gets none", psql(`select count(*) from peer_reviews where reviewer_id = author_id`) === "0" && (await s4(`/assignments/peer-week-1/peer`)).json.toDo.length === 0)
check("reviewers hear about it", (await s2("/me/notifications")).json.notifications.some((n) => n.kind === "peer_review"))
const R = mine.toDo[0].id
const task = (await s1(`/assignments/peer-week-1/peer/${R}`)).json
check("the task: their code and the rubric, anonymously", task.files[0].content.startsWith("# by student") && task.criteria[0].label === "Readable" && task.author === "A classmate")
check("only the reviewer opens it", (await s4(`/assignments/peer-week-1/peer/${R}`)).status === 404)

// ---------- writing a review
const put = (api, id, body) => api(`/assignments/peer-week-1/peer/${id}`, { method: "PUT", body })
check("a draft can be partial", (await put(s1, R, { scores: {}, comment: "", lineComments: [], submit: false })).status === 200)
check("handing in needs every score and a summary", (await put(s1, R, { scores: {}, comment: "", lineComments: [], submit: true })).json?.error?.code === "incomplete_review")
check("scores stay in range", (await put(s1, R, { scores: { r1: 9 }, comment: "x", lineComments: [], submit: true })).json?.error?.code === "incomplete_review")
check("line comments only on real lines", (await put(s1, R, { scores: { r1: 4 }, comment: "x", lineComments: [{ path: "main.py", line: 40, body: "?" }], submit: true })).json?.error?.code === "no_such_line")
const handed = await put(s1, R, { scores: { r1: 4 }, comment: "Clear and short. Name the variable.", lineComments: [{ path: "main.py", line: 2, body: "Store this in a variable first." }], submit: true })
check("handing in a review", handed.json?.submitted === true)
const author = psql(`select u.email from peer_reviews r join users u on u.id = r.author_id where r.id='${R}'`).split("@")[0]
const authorApi = { "peer-s2": s2, "peer-s3": s3 }[author]
const received = (await authorApi(`/assignments/peer-week-1/peer`)).json.received
check("the author reads it, anonymously", received.length === 1 && received[0].scores.r1 === 4 && received[0].lineComments[0].line === 2 && received[0].reviewer === "Reviewer 1", JSON.stringify(received).slice(0, 200))
check("and was told", (await authorApi("/me/notifications")).json.notifications.some((n) => n.kind === "peer_review_received"))

// ---------- the teacher
const overview = (await t(`${O}/assignments/${a.id}/peer`)).json
const row = overview.reviews.find((r) => r.id === R)
check("teachers see every review, with names", overview.reviews.length === 6 && row.reviewer === "peer-s1 Name" && row.score === 4 && row.outOf === 5)
check("students can't", [403, 404].includes((await s1(`${O}/assignments/${a.id}/peer`)).status))
await t(`${O}/assignments/${a.id}/peer/${R}`, { method: "PATCH", body: { hidden: true } })
check("a hidden review disappears for its author", (await authorApi(`/assignments/peer-week-1/peer`)).json.received.length === 0)
await t(`${O}/assignments/${a.id}/peer/${R}`, { method: "PATCH", body: { hidden: false } })
check("marks don't change", psql(`select count(*) from rubric_marks where assignment_id='${a.id}'`) === "0")

// ---------- the pages
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const page = await open("peer-s1@example.com")
await page.goto(`${BASE}/assignments/peer-week-1`)
await page.getByTestId("review-task").nth(1).getByRole("button", { name: "Review" }).click({ timeout: 30000 })
const dialog = page.getByTestId("review-dialog")
await dialog.getByTestId("commented-code").waitFor({ timeout: 15000 })
await dialog.getByRole("button", { name: "Comment on line 3" }).click()
await dialog.getByRole("textbox", { name: "Comment on line 3" }).fill("Nice touch.")
await dialog.getByRole("button", { name: "Comment", exact: true }).click()
await dialog.getByTestId("line-comment").waitFor({ timeout: 15000 })
await dialog.getByLabel("Readable").selectOption("5")
await dialog.getByLabel("Summary").fill("Works and reads well.")
await page.screenshot({ path: SHOTS + "peer-review.png", fullPage: true })
await dialog.getByRole("button", { name: "Hand in review" }).click()
await dialog.waitFor({ state: "hidden", timeout: 15000 })
const second = mine.toDo[1].id
check("writing a review on the page, with a line comment", psql(`select (submitted_at is not null) || ' ' || jsonb_array_length(line_comments) from peer_reviews where id='${second}'`) === "true 1")
const teacher = await open("peer-t@example.com")
await teacher.goto(`${BASE}${O}/manage/assignments/${a.id}/grades`)
await teacher.getByTestId("peer-row").first().waitFor({ timeout: 30000 })
check("the gradebook's peer review panel", (await teacher.getByTestId("peer-panel").innerText()).includes("2 of 6 reviews written"))
await teacher.screenshot({ path: SHOTS + "peer-panel.png", fullPage: true })

// ---------- closing
psql(`update assignments set peer_review = jsonb_set(peer_review, '{dueAt}', to_jsonb('${days(-0.01)}'::text)) where id='${a.id}'`)
check("after the review due time, reviews are closed", (await put(s1, R, { scores: { r1: 1 }, comment: "late change", lineComments: [], submit: true })).json?.error?.code === "reviews_closed")
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
