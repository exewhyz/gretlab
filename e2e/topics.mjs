/**
 * Readable problem addresses and topic pages: numbered addresses (p2) redirect for good to
 * readable ones, the API and saved browser progress follow, a renamed problem keeps its old
 * address, nobody can take another problem's old address, and every tag has a public page
 * that search engines are told about.
 *   node e2e/topics.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

import { READABLE } from "./readable-slugs.mjs"

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

const cleanup = () => psql(`delete from problems where slug like 'slg-%' or id in (select problem_id from problem_slug_history where slug like 'slg-%')`)
cleanup()
psql(`insert into users(email,name,role,handle) values ('admin@example.com','admin','admin','admin') on conflict (email) do update set role='admin', disabled=false`)

const cookie = `next-auth.session-token=${await encode({ token: { email: "admin@example.com" }, secret: SECRET })}`
const admin = async (path, { method, body } = {}) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const page = (path) => fetch(BASE + path, { redirect: "manual" })

// ---------- numbered addresses became readable ones
check("the migration and seed gave the library readable slugs", psql(`select count(*) from problems where org_id is null and slug ~ '^p[0-9]+$'`) === "0")
check("each old number is kept", psql(`select count(*) from problem_slug_history where slug ~ '^p[0-9]+$'`) === "30")
check("p2 is integer-operations", READABLE.p2 === "integer-operations" && psql(`select p.slug from problem_slug_history h join problems p on p.id = h.problem_id where h.slug = 'p2'`) === "integer-operations")

const old = await page("/problems/p2")
check("an old address redirects permanently", old.status === 308 && new URL(old.headers.get("location"), BASE).pathname === "/problems/integer-operations", `${old.status} ${old.headers.get("location")}`)
const now = await page("/problems/integer-operations")
const html = await now.text()
check("the new address is the page", now.status === 200 && html.includes('rel="canonical" href="') && /rel="canonical" href="[^"]*\/problems\/integer-operations"/.test(html))
check("an unknown address is still not found", (await page("/problems/p999")).status === 404)
check("old /questions links end at the readable address", (await fetch(BASE + "/questions/p2")).url.endsWith("/problems/integer-operations"))
const api = await fetch(BASE + "/api/v1/problems/p2").then((r) => r.json())
check("the API answers an old slug with the problem as it is now", api.id === "integer-operations" && api.title === "Integer Operations")
const catalog = (await admin("/catalog")).json
check("the library lists readable slugs only", catalog.problems.length >= 30 && catalog.problems.every((p) => !/^p\d+$/.test(p.id)))

// ---------- renaming keeps the old address; nobody else may take it
const source = (await admin("/admin/problems")).json.problems.find((p) => p.slug === READABLE.p1)
const full = (await admin(`/admin/problems/${source.id}`)).json
const body = (over) => ({ ...full, unitId: null, tests: full.tests.map(({ input, expected, isSample, points }) => ({ input, expected, isSample, points })), tags: [], published: true, listed: true, ...over })
delete full.id
const made = await admin("/admin/problems", { body: body({ slug: "slg-first", title: "Slug test" }) })
check("a problem is made", made.status === 200 || made.status === 201, JSON.stringify(made.json).slice(0, 150))
const pid = made.json?.id
const renamed = await admin(`/admin/problems/${pid}`, { method: "PUT", body: body({ slug: "slg-second", title: "Slug test", expectedUpdatedAt: made.json.updatedAt }) })
check("its slug can change", renamed.status === 200 && renamed.json.slug === "slg-second", renamed.status)
check("the old one is kept for it", psql(`select problem_id from problem_slug_history where slug = 'slg-first'`) === pid)
const moved = await page("/problems/slg-first")
check("and its old page redirects to the new one", moved.status === 308 && new URL(moved.headers.get("location"), BASE).pathname === "/problems/slg-second", moved.status)
const taken = await admin("/admin/problems", { body: body({ slug: "slg-first", title: "Another" }) })
check("another problem can't take that old address", taken.status === 409 && taken.json?.error?.code === "slug_taken", taken.status)
check("nor a problem's current one", (await admin("/admin/problems", { body: body({ slug: "slg-second", title: "Another" }) })).status === 409)
check("the topic pages' address is reserved", (await admin("/admin/problems", { body: body({ slug: "topics", title: "Topics" }) })).status === 400)
const back = await admin(`/admin/problems/${pid}`, { method: "PUT", body: body({ slug: "slg-first", title: "Slug test", expectedUpdatedAt: renamed.json.updatedAt }) })
check("a problem can take back its own old address", back.status === 200 && back.json.slug === "slg-first")
check("which then isn't listed as former, and the other is", psql(`select string_agg(slug, ',' order by slug) from problem_slug_history where problem_id = '${pid}'`) === "slg-second")
await admin(`/admin/problems/${pid}`, { method: "DELETE" })
check("deleting a problem frees its old addresses", psql(`select count(*) from problem_slug_history where slug like 'slg-%'`) === "0")

// ---------- topic pages
const topics = await page("/problems/topics")
const topicsHtml = await topics.text()
check("the topics page lists every topic", topics.status === 200 && topicsHtml.includes("Coding problems by topic") && topicsHtml.includes('href="/problems/topics/strings"'))
const strings = await page("/problems/topics/strings")
const stringsHtml = await strings.text()
check("a topic page lists its problems with readable links", strings.status === 200 && stringsHtml.includes('href="/problems/palindrome-checker"') && stringsHtml.includes("practice problems"))
check("it's titled and described for search", /<title>Strings: 3 practice problems · GretLab<\/title>/.test(stringsHtml) && /<meta name="description" content="Free strings coding problems/.test(stringsHtml))
check("it says what it holds in structured data", stringsHtml.includes('"@type":"CollectionPage"') && stringsHtml.includes('"@type":"ItemList"') && stringsHtml.includes('"@type":"BreadcrumbList"'))
check("an unknown topic is not found", (await page("/problems/topics/no-such-topic")).status === 404)
const sitemap = await (await page("/sitemap.xml")).text()
check("the sitemap lists readable addresses and topics, not numbers", sitemap.includes("/problems/integer-operations</loc>") && sitemap.includes("/problems/topics/strings</loc>") && sitemap.includes("/problems/topics</loc>") && !/\/problems\/p\d+<\/loc>/.test(sitemap))

// ---------- pages: saved browser progress follows, tags link to topics
const browser = await chromium.launch()
const tab = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await tab.goto(BASE + "/privacy")
await tab.evaluate(() => {
  localStorage.setItem("python-practice-lab:v1", JSON.stringify({ code: { p2: "print(1)" }, status: { p2: "solved", p3: "attempted" } }))
  localStorage.setItem("gretlab:workspace:v1", JSON.stringify({ p2: { language: "python", byLanguage: {} } }))
})
await tab.goto(BASE + "/problems")
await tab.waitForFunction(() => !JSON.parse(localStorage.getItem("python-practice-lab:v1")).status.p2, null, { timeout: 15000 }).catch(() => {})
const saved = await tab.evaluate(() => ({ progress: JSON.parse(localStorage.getItem("python-practice-lab:v1")), work: JSON.parse(localStorage.getItem("gretlab:workspace:v1")) }))
check("saved progress moves to the readable slugs", saved.progress.status["integer-operations"] === "solved" && saved.progress.status["duration-formatter"] === "attempted" && !("p2" in saved.progress.status), JSON.stringify(saved.progress.status))
check("so does saved code and the editor's workspace", saved.progress.code["integer-operations"] === "print(1)" && "integer-operations" in saved.work && !("p2" in saved.work))
await tab.getByRole("link", { name: "Browse by topic" }).click()
await tab.waitForURL("**/problems/topics")
await tab.getByRole("link", { name: "Strings" }).click()
await tab.waitForURL("**/problems/topics/strings")
await tab.screenshot({ path: SHOTS + "topic.png", fullPage: true })
await tab.getByRole("link", { name: "Palindrome Checker" }).first().click()
await tab.waitForURL("**/problems/palindrome-checker")
await tab.getByRole("link", { name: "Strings" }).first().waitFor({ timeout: 15000 })
check("a problem's topic links back to its page", (await tab.getByRole("link", { name: "Strings", exact: true }).first().getAttribute("href")) === "/problems/topics/strings")
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await phone.goto(BASE + "/problems/topics/strings")
check("a topic page fits a phone", (await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0)
await phone.screenshot({ path: SHOTS + "topic-phone.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
