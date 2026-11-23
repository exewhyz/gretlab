/**
 * Judge machines from the dashboard (Dashboard › Judges), against the fake AWS the test server
 * runs with (JUDGES_PROVIDER=fake): no real machine is ever started here.
 *   - who may see, start, stop and change settings ("Manage judges" and its four actions)
 *   - starting for everyone or one organization; an unknown organization; the limit
 *   - AWS refusing a start shows as failed, with its reason
 *   - Stop: a machine still setting up ends at once; a ready one drains, then ends
 *   - a machine that vanished without being asked is marked failed
 *   - judge settings only here, not on the general Settings route; the activity log
 *   - versions: each judge's code against the site's; Update (Start and Stop both needed)
 *     replaces a machine, one at a time; a failed replacement leaves the old one working;
 *     a machine stuck setting up fails; the setup check
 *   - automatic scaling: off by default; on, waiting work starts one machine (one at a time),
 *     and an idle machine it started is ended, never one a person started
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
  psql(`delete from runners where host like 'jd-%'`)
  psql(`delete from submissions where user_id in (select id from users where email like 'jd-%@example.com')`)
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
// The regression's judge logs in as the judges' own limited role (e2e/run.sh), and says so.
const ownLogin = page.json?.online?.filter((r) => r.login === "own") ?? []
check("a judge on the judges' own login shows it", ownLogin.length >= 1 && !page.json?.online?.some((r) => r.login === "main"), JSON.stringify(page.json?.online))
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

// ---------- versions and updates (the site's code is e2e-latest in the test server)
await admin("/admin/judges/settings", { method: "PUT", body: { maxRunning: 10, size: "c7i-flex.large" } })
const judgeOn = (host, machine, version, pool = null) => psql(`insert into runners (id, host, slots, busy, last_seen_at, version, machine_id, pool_org_id) values ('${host}', '${host}', 2, 0, now(), '${version}', ${machine ? `'${machine}'` : "null"}, ${pool ? `'${pool}'` : "null"}) on conflict (id) do update set last_seen_at = now(), version = excluded.version, machine_id = excluded.machine_id`)
const readyMachine = async () => {
  const made = (await admin("/admin/judges", { body: {} })).json
  psql(`update judge_machines set stage = 'ready' where id = '${made.id}'`)
  return made
}
const x = await readyMachine()
judgeOn("jd-x", x.instanceId, "e2e-old")
judgeOn("jd-hand", null, "e2e-old")
let list = (await admin("/admin/judges")).json
const xRow = list.machines.find((m) => m.id === x.id)
check("a machine's judge shows its code, out of date against the site's", xRow?.judge?.version === "e2e-old" && xRow?.outOfDate === true && list.latest === "e2e-latest", JSON.stringify({ judge: xRow?.judge, outOfDate: xRow?.outOfDate, latest: list.latest }))
check("a judge set up by hand shows too, marked as such", list.online.some((r) => r.host === "jd-hand" && r.fromDashboard === false && r.outOfDate === true))
check("\"Start judges\" alone can't update (it also stops)", (await starter(`/admin/judges/${x.id}/update`, { body: {} })).status === 403)
check("\"See judges\" can't either", (await viewer(`/admin/judges/${x.id}/update`, { body: {} })).status === 403)
const asked = await admin(`/admin/judges/${x.id}/update`, { body: {} })
const replacements = () => psql(`select count(*) from judge_machines where replaces_id = '${x.id}'`)
check("Update starts one replacement for the same pool, and the old one keeps working", asked.status === 200 && asked.json?.updateWanted === true && asked.json?.stage === "ready" && replacements() === "1", JSON.stringify(asked.json))
await admin(`/admin/judges/${x.id}/update`, { body: {} })
await admin("/admin/judges")
check("…asking again starts no second one", replacements() === "1")
const fresh = psql(`select id from judge_machines where replaces_id = '${x.id}'`)
psql(`update judge_machines set stage = 'ready' where id = '${fresh}'`)
list = (await admin("/admin/judges")).json
const xNow = list.machines.find((m) => m.id === x.id)
check("once the replacement is ready, the old one drains", xNow?.stage === "draining" && xNow?.updateWanted === false && xNow?.note.includes("Replaced"), JSON.stringify(xNow))
// Update all: two more machines on old code; one replacement at a time.
const y = await readyMachine()
const z = await readyMachine()
judgeOn("jd-y", y.instanceId, "e2e-old")
judgeOn("jd-z", z.instanceId, "e2e-old")
judgeOn("jd-fresh", psql(`select instance_id from judge_machines where id = '${fresh}'`), "e2e-latest")
const all = await admin("/admin/judges/update-all", { body: {} })
const coming = () => psql(`select count(*) from judge_machines where replaces_id is not null and stage in ('requested','launching','installing')`)
// The page refreshing (a tidy-up) while the first replacement is still starting.
await admin("/admin/judges")
await admin("/admin/judges")
check("Update all takes only the out-of-date machines, and replaces one at a time", all.status === 200 && all.json?.updating === 2 && coming() === "1", JSON.stringify({ all: all.json, coming: coming() }))
const first = psql(`select id from judge_machines where replaces_id in ('${y.id}', '${z.id}') and stage = 'launching'`)
psql(`update judge_machines set stage = 'ready' where id = '${first}'`)
await admin("/admin/judges")
check("…the next one starts once the first is ready", coming() === "1" && psql(`select count(*) from judge_machines where stage = 'draining' and id in ('${y.id}', '${z.id}')`) === "1")
const second = psql(`select id from judge_machines where replaces_id in ('${y.id}', '${z.id}') and stage = 'launching'`)
psql(`update judge_machines set stage = 'failed', note = 'Setting up stopped at line 40.' where id = '${second}'`)
list = (await admin("/admin/judges")).json
const kept = list.machines.find((m) => m.id === psql(`select replaces_id from judge_machines where id = '${second}'`))
check("a replacement that fails leaves the old machine working, and says so", kept?.stage === "ready" && kept?.updateWanted === false && kept?.note.includes("didn't work"), JSON.stringify(kept))
// A machine that never finishes setting up.
const slow = (await admin("/admin/judges", { body: {} })).json
psql(`update judge_machines set stage = 'installing', stage_at = now() - interval '31 minutes' where id = '${slow.id}'`)
check("a machine still setting up after 30 minutes has failed", (await admin("/admin/judges")).json?.machines?.find((m) => m.id === slow.id)?.stage === "failed")
psql(`update judge_machines set note = E'Setting up stopped at line 52.\n==> Building the runner\nfailed to fetch' where id = '${slow.id}'`)
// The setup check, for anyone who may see judges.
const checked = await viewer("/admin/judges/check")
check("the setup check runs for anyone who may see judges", checked.status === 200 && checked.json?.results?.length >= 2 && checked.json.results.every((r) => r.ok), JSON.stringify(checked.json))
check("…and not for anyone else", (await outsider("/admin/judges/check")).status === 403)

// ---------- automatic scaling (run by the cron here: the page's runs are a few seconds apart)
const cronNow = async () => (await (await fetch(`${BASE}/api/cron/outbox`, { method: "POST", headers: { authorization: "Bearer e2e-cron-secret-0123456789" } })).json().catch(() => null))?.judges
const autos = () => psql(`select count(*) from judge_machines where auto`)
const waiter = psql(`select id from users where email = 'jd-viewer@example.com'`)
// Shared work that has waited a minute.
psql(`insert into submissions (user_id, kind, language, entry, files, time_limit_ms, memory_limit_mb, status, created_at, queue_at) values ('${waiter}', 'run', 'python', 'main.py', '[]', 1000, 256, 'queued', now() - interval '60 seconds', now() + interval '1 day')`)
await cronNow()
check("automatic scaling is off unless switched on: waiting work starts nothing", autos() === "0")
const on = await admin("/admin/judges/settings", { method: "PUT", body: { autoscale: true } })
check("…switched on by itself (a save may change one setting)", on.status === 200 && on.json?.autoscale === true && on.json?.maxRunning === 10, JSON.stringify(on.json))
const scaled = await cronNow()
const auto = psql(`select id || '|' || stage || '|' || coalesce(requested_by::text, 'nobody') from judge_machines where auto`).split("|")
check("work waiting past the limit starts one machine, started by nobody", scaled?.scaling === "start" && autos() === "1" && auto[1] === "launching" && auto[2] === "nobody", JSON.stringify({ scaled, auto }))
await cronNow()
check("…and no second one while it's still coming up", autos() === "1")
check("…in the activity log as GretLab's own action, with the reason", psql(`select actor_label || '|' || summary from audit_log where action = 'judges.autoscale' order by created_at limit 1`).startsWith("GretLab (automatic scaling)|Started a judge: Work has waited"))
// The work is done; the machine is ready and then sits idle for half an hour.
psql(`delete from submissions where user_id = '${waiter}' and status = 'queued'`)
psql(`update judge_machines set stage = 'ready' where id = '${auto[0]}'`)
const autoInstance = psql(`select instance_id from judge_machines where id = '${auto[0]}'`)
psql(`insert into runners (id, host, slots, busy, last_seen_at, last_busy_at, version, machine_id) values ('jd-auto', 'jd-auto', 2, 0, now(), now() - interval '30 minutes', 'e2e-latest', '${autoInstance}')`)
// A machine a person started, just as idle.
const personal = (await admin("/admin/judges", { body: {} })).json
psql(`update judge_machines set stage = 'ready' where id = '${personal.id}'`)
psql(`insert into runners (id, host, slots, busy, last_seen_at, last_busy_at, version, machine_id) values ('jd-person', 'jd-person', 2, 0, now(), now() - interval '90 minutes', 'e2e-latest', '${personal.instanceId}')`)
await cronNow()
check("an idle machine it started is ended once idle past the limit", psql(`select stage from judge_machines where id = '${auto[0]}'`) === "draining", psql(`select stage || ' ' || note from judge_machines where id = '${auto[0]}'`))
await cronNow()
check("…but never one a person started, however idle", psql(`select stage from judge_machines where id = '${personal.id}'`) === "ready")
await admin("/admin/judges/settings", { method: "PUT", body: { autoscale: false } })

// ---------- the activity log
const log = psql(`select string_agg(distinct action, ',' order by action) from audit_log where org_id is null and action like 'judges.%'`)
check("starts, stops, updates, scaling and settings are in the activity log", log === "judges.autoscale,judges.settings,judges.start,judges.stop,judges.update", log)

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
check("an out-of-date judge shows as such, with Update", (await tab.getByText("Out of date").count()) >= 1 && (await tab.getByRole("button", { name: "Update" }).count()) >= 1)
await tab.getByRole("button", { name: "Show the setup log" }).first().click()
check("a failure's setup log opens from its note", await tab.getByText("==> Building the runner").first().isVisible())
await tab.getByRole("button", { name: "Run the setup check" }).click()
await tab.getByTestId("judge-check").waitFor({ timeout: 15_000 }).catch(() => {})
check("the setup check runs from the page", (await tab.getByTestId("judge-check").getByText("Signing in to AWS").count()) === 1)
await tab.getByRole("switch", { name: "Automatic scaling" }).click()
check("switching automatic scaling on shows its numbers", await tab.getByTestId("autoscale-settings").isVisible())
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
