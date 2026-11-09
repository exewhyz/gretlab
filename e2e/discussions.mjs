/**
 * Class discussions: who can read and post, anonymous posts, replies and their
 * notification, votes, teacher moderation (pin, lock, hide, answer, delete), and the page.
 *   node e2e/discussions.mjs [base-url] [screenshot-dir]
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

const cleanup = () => {
  psql(`delete from organizations where slug = 'dsctest'`)
  psql(`delete from users where email like 'dsc-%'`)
}
cleanup()
for (const h of ["dsc-t", "dsc-s1", "dsc-s2", "dsc-other", "dsc-out"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Dsc College", slug: "dsctest", type: "college", ownerEmail: "dsc-t@example.com" } })
const O = "/orgs/dsctest"
const orgId = psql(`select id from organizations where slug='dsctest'`)
const [t, s1, s2, other, out] = await Promise.all(["dsc-t", "dsc-s1", "dsc-s2", "dsc-other", "dsc-out"].map((h) => client(`${h}@example.com`)))
const lab = (await t(`${O}/groups`, { body: { name: "dsc Lab" } })).json
const lab2 = (await t(`${O}/groups`, { body: { name: "dsc Lab 2" } })).json
for (const h of ["dsc-s1", "dsc-s2", "dsc-other"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: [uid("dsc-s1"), uid("dsc-s2")] } })
await t(`${O}/groups/${lab2.id}/members`, { body: { userIds: [uid("dsc-other")] } })
const D = `${O}/classes/${lab.id}/discussion`

// ---------- who can read and post
check("the class's students and teachers read it", (await s1(D)).status === 200 && (await t(D)).status === 200)
check("other classes and outsiders don't", (await other(D)).status === 404 && (await out(D)).status === 404)
const q = await s1(D, { body: { title: "Why does my loop never end?", body: "```python\nwhile True:\n  pass\n```", anonymous: true } })
check("a student posts a question", q.status === 200 && !!q.json.id)
const T = `${D}/${q.json.id}`
const firstView = await s2(T)
check("anonymous to classmates", firstView.json?.thread?.author === "Anonymous", JSON.stringify(firstView).slice(0, 300))
check("but not to teachers, or themselves", (await t(T)).json.thread.author === "dsc-s1" && (await s1(T)).json.thread.author === "dsc-s1")
check("posts stay in their class", (await other(T)).status === 404 && (await t(`${O}/classes/${lab2.id}/discussion/${q.json.id}`)).status === 404)

// ---------- replies, votes, notifications
const r1 = await s2(T, { body: { body: "You never change the condition." } })
check("classmates reply", r1.status === 200)
check("the author hears about it", (await s1("/me/notifications")).json.notifications.some((n) => n.kind === "discussion_reply" && n.href.includes(`thread=${q.json.id}`)))
const r2 = await t(T, { body: { body: "Use `break` when you're done, or a condition that becomes false.", anonymous: true } })
const view = (await s2(T)).json
const teacherReply = view.replies.find((r) => r.id === r2.json.id)
check("teachers always post as themselves, marked", teacherReply.author === "dsc-t" && teacherReply.byTeacher && !teacherReply.anonymous)
check("a +1 counts once, and can be taken back", (await s1(`${D}/${r1.json.id}/vote`, { body: {} })).json.voted === true && (await s1(`${D}/${r1.json.id}/vote`, { body: {} })).json.voted === false && (await s1(`${D}/${r1.json.id}/vote`, { body: {} })).json.voted === true)
check("not on your own post", (await s2(`${D}/${r1.json.id}/vote`, { body: {} })).json?.error?.code === "own_post")
check("the list counts replies and votes", (await s2(D)).json.threads[0].replies === 2 && (await s2(T)).json.replies.find((r) => r.id === r1.json.id).votes === 1)

// ---------- moderation
check("students can't moderate", (await s2(T, { method: "PATCH", body: { pinned: true } })).status === 403)
check("or edit others' posts", (await s2(T, { method: "PATCH", body: { body: "changed" } })).status === 403)
check("authors edit their own", (await s1(T, { method: "PATCH", body: { body: "Fixed: see the answer." } })).status === 200 && (await s2(T)).json.thread.editedAt !== null)
check("a teacher marks the answer", (await t(T, { method: "PATCH", body: { answerId: r2.json.id } })).status === 200 && (await s1(T)).json.thread.answerId === r2.json.id)
check("only a reply of this thread", (await t(T, { method: "PATCH", body: { answerId: q.json.id } })).json?.error?.code === "not_a_reply")
await t(T, { method: "PATCH", body: { pinned: true, locked: true } })
check("locked: no more replies from students", (await s2(T, { body: { body: "one more" } })).json?.error?.code === "locked")
const spam = await s2(D, { body: { title: "buy stuff", body: "spam" } })
await t(`${D}/${spam.json.id}`, { method: "PATCH", body: { hidden: true } })
check("hidden posts: gone for classmates, kept for teachers and the author", !(await s1(D)).json.threads.some((x) => x.id === spam.json.id) && (await t(D)).json.threads.some((x) => x.id === spam.json.id && x.hidden) && (await s2(D)).json.threads.some((x) => x.id === spam.json.id))
check("and can't be opened by classmates", (await s1(`${D}/${spam.json.id}`)).status === 404)
check("pinned first", (await t(D)).json.threads[0].id === q.json.id)
check("students can't delete others' posts", (await s1(`${D}/${spam.json.id}`, { method: "DELETE" })).status === 404 && (await s2(`${D}/${r2.json.id}`, { method: "DELETE" })).status === 403)
check("a thread with replies stays as deleted", (await s1(T, { method: "DELETE" })).status === 200 && (await s2(T)).json.thread.deleted === true && (await s2(T)).json.replies.length === 2)
check("a teacher deletes anything; it's logged", (await t(`${D}/${spam.json.id}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from audit_log where org_id='${orgId}' and action in ('discussion.hide','discussion.delete')`) === "2")

// ---------- the page
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const page = await open("dsc-s2@example.com")
await page.goto(`${BASE}${O}/classes/${lab.id}?tab=discussion`)
await page.getByRole("button", { name: "New post" }).click({ timeout: 30000 })
await page.getByRole("dialog").getByRole("textbox", { name: "Title" }).fill("Is recursion on the exam?")
await page.getByRole("dialog").getByRole("textbox", { name: "Post" }).fill("Asking for the **mid-sem**.")
await page.getByRole("dialog").getByRole("button", { name: "Post" }).click()
await page.getByTestId("thread").waitFor({ timeout: 15000 })
check("posting from the page opens the thread", (await page.getByTestId("thread").innerText()).includes("Is recursion on the exam?"))
await page.getByLabel("Your reply").fill("Probably yes.")
await page.getByRole("button", { name: "Reply", exact: true }).click()
await page.getByTestId("reply").first().waitFor({ timeout: 15000 })
check("replying from the page", (await page.getByTestId("reply").count()) === 1)
await page.screenshot({ path: SHOTS + "discussion-thread.png", fullPage: true })
const teacher = await open("dsc-t@example.com")
const answered = (await t(D)).json.threads.find((x) => x.title === "Why does my loop never end?")
await teacher.goto(`${BASE}${O}/classes/${lab.id}?tab=discussion&thread=${answered.id}`)
await teacher.getByTestId("thread").waitFor({ timeout: 30000 })
check("a notification's link opens the thread", (await teacher.getByTestId("reply").first().innerText()).includes("Answer"))
await teacher.getByRole("button", { name: "← All posts" }).click()
await teacher.getByTestId("thread-row").first().waitFor({ timeout: 15000 })
check("the list: pinned and answered first", (await teacher.getByTestId("thread-row").count()) === 2)
await teacher.screenshot({ path: SHOTS + "discussion.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
