/**
 * Certificates: for finishing a class's course (once each) or written by a teacher for
 * chosen students; the public verification page; revoking; My certificates; the pages.
 *   node e2e/certificates.mjs [base-url] [screenshot-dir]
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
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const cleanup = () => {
  psql(`delete from courses where title like 'crt %'`)
  psql(`delete from practice_answers where question_id in (select id from questions where title like 'crt %')`)
  psql(`delete from questions where title like 'crt %'`)
  psql(`delete from organizations where slug = 'crttest'`)
  psql(`delete from users where email like 'crt-%'`)
}
cleanup()
for (const h of ["crt-t", "crt-s1", "crt-s2", "crt-out"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = email ? `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}` : ""
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Crt College", slug: "crttest", type: "college", ownerEmail: "crt-t@example.com" } })
const O = "/orgs/crttest"
const orgId = psql(`select id from organizations where slug='crttest'`)
const [t, s1, s2] = await Promise.all(["crt-t", "crt-s1", "crt-s2"].map((h) => client(`${h}@example.com`)))
const lab = (await t(`${O}/groups`, { body: { name: "crt Lab" } })).json
for (const h of ["crt-s1", "crt-s2", "crt-out"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: [uid("crt-s1"), uid("crt-s2")] } })
// A one-question course, given to the class; s1 finishes it.
const q = (await t(`${O}/questions`, { body: { title: "crt Q", kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1 } })).json.id
const course = (await t(`${O}/courses`, { body: { title: "crt Python basics", published: true } })).json
await t(`${O}/courses/${course.id}/outline`, { method: "PUT", body: { modules: [{ title: "Start", items: [{ kind: "question", id: q }] }] } })
await t(`${O}/classes/${lab.id}/courses`, { body: { courseId: course.id, startsOn: day(-1) } })
await s1(`${O}/classes/${lab.id}/practice`, { body: { questionId: q, answer: ["a"] } })
const C = `${O}/classes/${lab.id}/certificates`

// ---------- giving
check("students can't give them", [403, 404].includes((await s1(C, { body: { kind: "course", courseId: course.id } })).status))
const first = await t(C, { body: { kind: "course", courseId: course.id } })
check("for finishing the course: only who finished", first.json?.issued === 1, JSON.stringify(first.json))
check("once each", (await t(C, { body: { kind: "course", courseId: course.id } })).json?.issued === 0)
check("a written one goes only to the class's students", (await t(C, { body: { kind: "custom", title: "Best project", userIds: [uid("crt-out")] } })).json?.error?.code === "not_in_class")
check("a written one", (await t(C, { body: { kind: "custom", title: "Best project", detail: "Library manager", userIds: [uid("crt-s2")] } })).json?.issued === 1)
check("students are told", (await s1("/me/notifications")).json.notifications.some((n) => n.kind === "certificate"))
const mine = (await s1("/me/certificates")).json
check("My certificates", mine.length === 1 && mine[0].title === "crt Python basics" && /^[2-9A-Z]{5}-[2-9A-Z]{5}$/.test(mine[0].code), JSON.stringify(mine))
const code = mine[0].code

// ---------- verifying, for anyone
const page = async (c) => {
  const res = await fetch(`${BASE}/certificates/${c}`)
  return { status: res.status, html: await res.text() }
}
const pub = await page(code)
check("its public page, without signing in", pub.status === 200 && pub.html.includes("crt-s1 Name") && pub.html.includes("crt Python basics") && pub.html.includes("Valid"))
check("no email on it", !pub.html.includes("crt-s1@example.com"))
check("codes aren't case-sensitive", (await page(code.toLowerCase())).html.includes("crt Python basics"))
check("an unknown code says so", (await page("AAAAA-BBBBB")).html.includes("No certificate with that code"))

// ---------- revoking
const list = (await t(C)).json
check("the class's list for teachers", list.issued.length === 2 && list.students.length === 2)
check("students can't revoke", [403, 404].includes((await s2(`${C}/${list.issued[0].id}`, { method: "DELETE" })).status))
const cert = list.issued.find((c) => c.code === code)
check("revoking", (await t(`${C}/${cert.id}`, { method: "DELETE" })).status === 200 && (await page(code)).html.includes("Revoked on") && (await t(C)).json.issued.find((c) => c.code === code).revoked)
check("a revoked one can't be given again by finishing", (await t(C, { body: { kind: "course", courseId: course.id } })).json?.issued === 0)

// ---------- the pages
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "crt-t@example.com" }, secret: SECRET }), url: BASE }])
const tp = await ctx.newPage()
await tp.goto(`${BASE}${O}/classes/${lab.id}?tab=course`)
await tp.getByTestId("class-certificates").getByRole("button", { name: "Give certificates" }).click({ timeout: 30000 })
const dialog = tp.getByRole("dialog")
await dialog.getByRole("radio", { name: "One I write" }).click()
await dialog.getByLabel("Certificate title").fill("Helpful classmate")
await dialog.getByRole("checkbox", { name: "Give to crt-s1 Name" }).click()
await dialog.getByRole("button", { name: "Give", exact: true }).click()
await tp.getByText("Gave 1 certificate.").waitFor({ timeout: 15000 })
await tp.getByTestId("issued-certificate").nth(2).waitFor({ timeout: 15000 }).catch(() => {})
check("giving one from the class page", (await tp.getByTestId("issued-certificate").count()) === 3)
await tp.screenshot({ path: SHOTS + "class-certificates.png", fullPage: true })
const anon = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage()
const fresh = (await s1("/me/certificates")).json.find((c) => c.title === "Helpful classmate")
await anon.goto(`${BASE}/certificates/${fresh.code}`)
await anon.getByTestId("certificate").waitFor({ timeout: 30000 })
check("the certificate page", (await anon.getByTestId("certificate-status").innerText()).startsWith("Valid"))
await anon.screenshot({ path: SHOTS + "certificate.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
