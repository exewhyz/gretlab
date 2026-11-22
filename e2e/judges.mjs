/**
 * Judge machines from the dashboard (Dashboard › Judges), against the fake AWS the test server
 * runs with (JUDGES_PROVIDER=fake): no real machine is ever started here.
 *   - who may see, start, stop and change settings ("Manage judges" and its four actions)
 *   - starting for everyone or one organization; an unknown organization; the limit
 *   - AWS refusing a start shows as failed, with its reason
 *   - Stop: a machine still setting up ends at once; a ready one drains, then ends
 *   - a machine that vanished without being asked is marked failed
 *   - judge settings only here, not on the general Settings route; the activity log
 *   - the page, its Start dialog and Stop confirmation
 *   node e2e/judges.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/judges/"
mkdirSync(SHOTS, { recursive: true })
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 2000)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from judge_machines`)
  psql(`delete from settings where key like 'judges.%'`)
  psql(`delete from organizations where slug in ('jd-org', 'fake-aws-refuses')`)
  psql(`delete from users where email like 'jd-%@example.com'`)
  psql(`delete from platform_roles where name like 'jd %'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const who of ["jd-viewer", "jd-starter", "jd-owner"]) psql(`insert into users(email,name,role) values ('${who}@example.com','${who}','student')`)
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Jd College", slug: "jd-org", type: "college", ownerEmail: "jd-owner@example.com" } })
await admin("/admin/organizations", { body: { name: "Refused", slug: "fake-aws-refuses", type: "college", ownerEmail: "jd-owner@example.com" } })
const viewRole = await admin("/admin/roles", { body: { name: "jd Watcher", permissions: ["platform.judges.view"] } })
const startRole = await admin("/admin/roles", { body: { name: "jd Starter", permissions: ["platform.judges.view", "platform.judges.start"] } })
await admin("/admin/staff", { method: "PUT", body: { email: "jd-viewer@example.com", role: viewRole.json?.id } })
await admin("/admin/staff", { method: "PUT", body: { email: "jd-starter@example.com", role: startRole.json?.id } })
const viewer = await client("jd-viewer@example.com")
const starter = await client("jd-starter@example.com")
const outsider = await client("jd-owner@example.com")
check("the set-up worked", viewRole.status === 200 && startRole.status === 200, JSON.stringify([viewRole.json, startRole.json]).slice(0, 200))

// ---------- who may do what
const page = await admin("/admin/judges")
check("an owner sees the judges, with the settings and that machines can be started", page.status === 200 && page.json?.available === true && page.json?.settings?.maxRunning === 3 && page.json?.settings?.size === "c7i-flex.large", JSON.stringify(page.json).slice(0, 300))
check("someone with no platform role can't even see them", (await outsider("/admin/judges")).status === 403)
check("\"See judges\" sees them…", (await viewer("/admin/judges")).status === 200)
check("…but can't start one", (await viewer("/admin/judges", { body: {} })).status === 403)
check("…or change the settings", (await viewer("/admin/judges/settings", { method: "PUT", body: { maxRunning: 9, size: "c7i.xlarge" } })).status === 403)

// ---------- starting
const shared = await starter("/admin/judges", { body: {} })
check("\"Start judges\" starts one for everyone: it's launching on AWS", shared.status === 200 && shared.json?.stage === "launching" && /^i-fake/.test(shared.json?.instanceId ?? "") && shared.json?.poolOrgId === null, JSON.stringify(shared.json))
check("…but can't stop it", (await starter(`/admin/judges/${shared.json?.id}/stop`, { body: {} })).status === 403)
const own = await admin("/admin/judges", { body: { pool: "jd-org" } })
const orgId = psql(`select id from organizations where slug = 'jd-org'`)
check("one for an organization, by its address", own.status === 200 && own.json?.poolOrgId === orgId, JSON.stringify(own.json))
check("an address that isn't an organization is refused", (await admin("/admin/judges", { body: { pool: "no-such-org" } })).status === 404)
const refused = await admin("/admin/judges", { body: { pool: "fake-aws-refuses" } })
check("AWS refusing to start one shows as failed, with its reason", refused.status === 200 && refused.json?.stage === "failed" && refused.json?.note.includes("InsufficientInstanceCapacity"), JSON.stringify(refused.json))
check("a failed start doesn't count toward the limit", (await admin("/admin/judges")).json?.machines?.filter((m) => !["failed", "stopped"].includes(m.stage)).length === 2)
check("settings: the general Settings route can't change judge settings", (await admin("/admin/settings", { method: "PATCH", body: { "judges.max_running": 40 } })).status === 403)
const saved = await admin("/admin/judges/settings", { method: "PUT", body: { maxRunning: 2, size: "c7i.large" } })
check("\"Judge settings\" changes the limit and the size", saved.status === 200 && (await admin("/admin/judges")).json?.settings?.maxRunning === 2)
check("bad settings are refused", (await admin("/admin/judges/settings", { method: "PUT", body: { maxRunning: 2, size: "m5.24xlarge" } })).status === 400)
const over = await admin("/admin/judges", { body: {} })
check("past the limit, starting is refused", over.status === 409 && over.json?.error?.code === "judge_limit", JSON.stringify(over.json))

// ---------- stopping
const stopped = await admin(`/admin/judges/${shared.json?.id}/stop`, { body: {} })
check("Stop on a machine still setting up ends it at once", stopped.json?.stage === "stopping", JSON.stringify(stopped.json))
const after = (await admin("/admin/judges")).json?.machines?.find((m) => m.id === shared.json?.id)
check("…and once AWS has ended it, it shows as stopped", after?.stage === "stopped", after?.stage)
check("stopping it again is refused", (await admin(`/admin/judges/${shared.json?.id}/stop`, { body: {} })).status === 409)
check("an id that isn't one is not found", (await admin(`/admin/judges/not-an-id/stop`, { body: {} })).status === 404)
// The organization's machine sets itself up (the boot script says so), then is stopped.
psql(`update judge_machines set stage = 'ready' where id = '${own.json?.id}'`)
const draining = await admin(`/admin/judges/${own.json?.id}/stop`, { body: {} })
check("Stop on a ready machine drains it first: it finishes its work", draining.json?.stage === "draining", JSON.stringify(draining.json))
check("…and it isn't ended while it still has work", (await admin("/admin/judges")).json?.machines?.find((m) => m.id === own.json?.id)?.stage === "draining")
// The judge says it's done (apps/runner does this once its jobs finish).
psql(`update judge_machines set stage = 'drained' where id = '${own.json?.id}'`)
const cron = await fetch(`${BASE}/api/cron/outbox`, { method: "POST", headers: { authorization: "Bearer e2e-cron-secret-0123456789" } })
const cronJson = await cron.json().catch(() => null)
check("the cron ends a drained machine, with nobody on the page", cron.status === 200 && cronJson?.judges?.ended === 1, JSON.stringify(cronJson?.judges))
check("…and it then shows as stopped", (await admin("/admin/judges")).json?.machines?.find((m) => m.id === own.json?.id)?.stage === "stopped")
// A machine AWS no longer knows, though nobody asked it to stop.
const lost = await admin("/admin/judges", { body: {} })
psql(`update judge_machines set instance_id = 'i-vanished000000' where id = '${lost.json?.id}'`)
check("a machine that vanished without being asked is marked failed", (await admin("/admin/judges")).json?.machines?.find((m) => m.id === lost.json?.id)?.stage === "failed")
const cleared = await admin(`/admin/judges/${lost.json?.id}/stop`, { body: {} })
check("Stop on a failed machine clears it, even when AWS no longer has it", cleared.status === 200 && cleared.json?.stage === "stopped", JSON.stringify(cleared.json))

// ---------- the activity log
const log = psql(`select string_agg(distinct action, ',' order by action) from audit_log where org_id is null and action like 'judges.%'`)
check("starts, stops and settings are in the activity log", log === "judges.settings,judges.start,judges.stop", log)

// ---------- the page
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "admin@example.com" }, secret: SECRET }), url: BASE }])
const tab = await context.newPage()
await tab.goto(`${BASE}/admin/judges`)
await tab.getByTestId("judge-machine").first().waitFor({ timeout: 30_000 })
check("the page lists the machines with their stages", (await tab.getByTestId("judge-machine").count()) >= 4 && (await tab.getByText("Stopped").count()) >= 2 && (await tab.getByText("Failed").count()) >= 1)
check("the menu has Judges under Setup", (await tab.locator('a[href="/admin/judges"]:visible').count()) >= 1)
await tab.getByRole("button", { name: "Start a judge" }).click()
await tab.getByRole("dialog").getByRole("textbox").fill("jd-org")
await tab.getByRole("dialog").getByRole("button", { name: "Start judge" }).click()
await tab.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
await tab.getByText("Starting the machine").first().waitFor({ timeout: 15_000 }).catch(() => {})
check("Start from the page: a machine for the organization appears, starting", (await tab.getByTestId("judge-machine").filter({ hasText: "Jd College" }).filter({ hasText: "Starting the machine" }).count()) === 1)
await tab.getByTestId("judge-machine").filter({ hasText: "Starting the machine" }).getByRole("button", { name: "Stop" }).click()
await tab.getByRole("alertdialog").getByRole("button", { name: "Stop judge" }).click()
await tab.waitForFunction(() => !document.body.innerText.includes("Starting the machine"), null, { timeout: 15_000 }).catch(() => {})
check("Stop from the page asks first, then ends it", !(await tab.getByText("Starting the machine").count()))
await tab.screenshot({ path: SHOTS + "judges.png", fullPage: true })
const watcher = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await watcher.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "jd-viewer@example.com" }, secret: SECRET }), url: BASE }])
const seen = await watcher.newPage()
await seen.goto(`${BASE}/admin/judges`)
await seen.getByTestId("judge-machine").first().waitFor({ timeout: 30_000 })
check("someone who may only look sees no Start, Stop or settings", !(await seen.getByRole("button", { name: "Start a judge" }).count()) && !(await seen.getByRole("button", { name: "Stop" }).count()) && !(await seen.getByText("Judge settings").count()))
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
await phone.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "admin@example.com" }, secret: SECRET }), url: BASE }])
const small = await phone.newPage()
await small.goto(`${BASE}/admin/judges`)
await small.getByTestId("judge-machine").first().waitFor({ timeout: 30_000 })
check("on a phone, nothing spills sideways", await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
await small.screenshot({ path: SHOTS + "judges-phone.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
