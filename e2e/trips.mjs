/**
 * Trips per page: a page's requests go out together, not one after another. Each wave of
 * requests that waits for an earlier one costs a round trip to the server, which is what made
 * pages slow from India (docs/scaling.md). Fails if a page slips back into waiting.
 *   - a first load sends /me with the frame's data (organizations, exam, bell) in one answer,
 *     and asks for none of them separately, then or on the next page;
 *   - the first management page asks for the summary beside its own data;
 *   - a class page asks for its stream beside the class;
 *   - a problem page asks for the saved code beside the problem;
 *   - the frame is never sent to visitors or to someone who must turn two-factor on first.
 *   node e2e/trips.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const PROBLEM = "integer-operations"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 2000)}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from settings where key = 'security.require_2fa'`)
  psql(`delete from organizations where slug = 'tr-school'`)
  psql(`delete from users where email like 'tr-%'`)
}
const cookieFor = async (email) => `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
const client = async (email) => {
  const cookie = email ? await cookieFor(email) : ""
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('tr-o@example.com','Tr Owner','student','tr-o')`)

// ---------- a school with one section and one student in it
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Tr School", slug: "tr-school", type: "school", ownerEmail: "tr-o@example.com" } })
const O = "/orgs/tr-school"
const owner = await client("tr-o@example.com")
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 4" } })).json
const sec = (await owner(`${O}/groups`, { body: { name: "A", parentId: grade.id } })).json
await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })
const kid = (await owner(`${O}/students`, { body: { name: "Tr Kid", email: "tr-s@example.com", groupId: sec.id, rollNo: 1 } })).json
check("the set-up worked", !!(grade?.id && sec?.id && kid?.id), JSON.stringify({ grade, sec, kid }))

// ---------- the API: who gets the frame
const student = await client("tr-s@example.com")
const framed = (await student("/me?frame=1")).json
check("a signed-in person's /me?frame=1 carries the frame", Array.isArray(framed?.frame?.orgs) && framed.frame.orgs.some((o) => o.slug === "tr-school") && "exam" in framed.frame && framed.frame.notifications !== undefined, JSON.stringify(framed?.frame))
const same = { orgs: (await student("/me/orgs")).json, exam: (await student("/me/exam")).json?.exam }
check("the frame's parts match their own routes", JSON.stringify(framed?.frame?.orgs) === JSON.stringify(same.orgs) && JSON.stringify(framed?.frame?.exam) === JSON.stringify(same.exam))
check("plain /me carries no frame", (await student("/me")).json?.frame === null)
const visitor = await client(null)
const seen = (await visitor("/me?frame=1")).json
check("a visitor gets no frame", seen?.user === null && seen?.frame === null, JSON.stringify(seen))
psql(`insert into settings(key, value) values ('security.require_2fa', '"everyone"') on conflict (key) do update set value = excluded.value`)
await sleep(5500) // settings are cached for 5 s
const owing = (await student("/me?frame=1")).json
check("someone who must turn two-factor on first gets no frame", owing?.user?.security?.mustEnroll === true && owing?.frame === null, JSON.stringify({ mustEnroll: owing?.user?.security, frame: owing?.frame }))
check("…just as their own routes refuse them", (await student("/me/orgs")).status === 403)
psql(`delete from settings where key = 'security.require_2fa'`)
await sleep(5500)

// ---------- in a browser: what each page change asks for, and when
const browser = await chromium.launch()
const tracked = (path) => path.startsWith("/api/") && !path.startsWith("/api/auth/")
async function session(email) {
  const context = await browser.newContext()
  if (email) {
    const value = (await cookieFor(email)).split("=").slice(1).join("=")
    await context.addCookies([{ name: "next-auth.session-token", value, url: BASE }])
  }
  const page = await context.newPage()
  let log = []
  const open = new Map()
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (tracked(u.pathname)) open.set(r, { path: u.pathname, search: u.search, start: performance.now(), end: Infinity })
  })
  const finish = (r) => {
    const entry = open.get(r)
    if (!entry) return
    entry.end = performance.now()
    entry.status = r.failure() ? 0 : undefined
    log.push(entry)
    open.delete(r)
  }
  page.on("requestfinished", finish)
  page.on("requestfailed", finish)
  page.on("response", (res) => {
    const entry = open.get(res.request())
    if (entry) entry.code = res.status()
  })
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(400)
      const n = log.length + open.size
      if (n === last && open.size === 0) break
      last = n
    }
    await page.waitForTimeout(800)
    const taken = log
    log = []
    return taken
  }
  return {
    page,
    async load(path) {
      await page.goto(BASE + path, { waitUntil: "load" })
      return settle()
    },
    async go(path) {
      // As a click on a link does: inside the app, no full load.
      await page.evaluate((p) => window.next.router.push(p), path)
      await page.waitForURL((u) => u.pathname === path, { timeout: 30_000 })
      return settle()
    },
    close: () => context.close(),
  }
}
const find = (log, path) => log.find((r) => r.path === path)
const names = (log) => log.map((r) => r.path + r.search).join(", ")
// Two requests in the same wave: each started before the other finished.
const together = (a, b) => !!(a && b && a.start < b.end && b.start < a.end)

// A student's first load, then the next page.
const kidSession = await session("tr-s@example.com")
let log = await kidSession.load("/home")
const me = find(log, "/api/v1/me")
check("a first load asks for /me with the frame", me?.search === "?frame=1", names(log))
check("…and not for the frame's parts on their own", !log.some((r) => ["/api/v1/me/orgs", "/api/v1/me/exam", "/api/v1/me/notifications"].includes(r.path)), names(log))
check("…and the page's own data goes beside /me", together(me, find(log, "/api/v1/me/dashboard")), names(log))
check("the bell shows from the frame's data", await kidSession.page.getByRole("button", { name: /^Notifications/ }).first().isVisible().catch(() => false))
log = await kidSession.go("/classes")
check("the next page doesn't ask for the frame again", !log.some((r) => ["/api/v1/me/orgs", "/api/v1/me/notifications", "/api/v1/me/exam"].includes(r.path)) && !find(log, "/api/v1/me"), names(log))

// A problem: the saved code is asked for beside the problem, not after it.
log = await kidSession.go(`/problems/${PROBLEM}`)
const problem = find(log, `/api/v1/problems/${PROBLEM}`)
const draft = find(log, `/api/v1/problems/${PROBLEM}/draft`)
check("a problem asks for the saved code beside the problem", together(problem, draft), names(log))
check("…and the editor still opens", await kidSession.page.locator(".monaco-editor").first().waitFor({ timeout: 30_000 }).then(() => true, () => false))
await kidSession.close()

// The owner: the first management page, then a class.
const ownerSession = await session("tr-o@example.com")
await ownerSession.load(O)
log = await ownerSession.go(`${O}/manage/members`)
const summary = find(log, `/api/v1${O}/manage`)
const members = log.find((r) => r.path === `/api/v1${O}/members`)
check("the first management page asks for the summary beside its own data", together(summary, members), names(log))
check("…and shows the members", await ownerSession.page.getByText("Tr Kid").first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
log = await ownerSession.go(`${O}/classes/${sec.id}`)
check("a class page asks for its stream beside the class", together(find(log, `/api/v1${O}/classes/${sec.id}`), find(log, `/api/v1${O}/classes/${sec.id}/stream`)), names(log))
await ownerSession.close()

// A visitor: /me once, nothing that needs an account.
const guest = await session(null)
log = await guest.load("/problems")
check("a visitor's page asks for nothing that needs an account", !log.some((r) => r.path.startsWith("/api/v1/me/")) && !log.some((r) => r.code === 401 || r.code === 403), names(log) + " " + log.filter((r) => r.code >= 400).map((r) => r.path + " " + r.code).join(", "))
await guest.close()

await browser.close()
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
