/**
 * Dashboard › Monitoring and Dashboard › Costs.
 *   - who sees them: the Owner both; Support and Auditor monitoring, not costs; nobody else
 *   - monitoring: failed email with its reasons, and system errors, as problems
 *   - costs: a stopped and a running machine at Sydney prices, by pool, and the forecast
 *   - both pages in a browser, and on a phone
 *   node e2e/monitoring.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/monitoring/"
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
  psql(`delete from judge_machines where instance_id like 'i-mon%'`)
  psql(`delete from email_outbox where to_address like 'mon-%@example.com'`)
  psql(`delete from submissions where user_id in (select id from users where email like 'mon-%@example.com')`)
  psql(`delete from organizations where slug = 'mon-org'`)
  psql(`delete from users where email like 'mon-%@example.com'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path) => {
    const res = await fetch(BASE + "/api/v1" + path, { headers: { cookie } })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const who of ["mon-support", "mon-auditor", "mon-student", "mon-owner"]) psql(`insert into users(email,name,role) values ('${who}@example.com','${who}','student')`)
const ownerCookie = `next-auth.session-token=${await encode({ token: { email: "admin@example.com" }, secret: SECRET })}`
const give = (email, role) => fetch(`${BASE}/api/v1/admin/staff`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, role }) })
await give("mon-support@example.com", "support")
await give("mon-auditor@example.com", "auditor")
await fetch(`${BASE}/api/v1/admin/organizations`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ name: "Mon College", slug: "mon-org", type: "college", ownerEmail: "mon-owner@example.com" }) })
const orgId = psql(`select id from organizations where slug = 'mon-org'`)
const admin = await client("admin@example.com")
const support = await client("mon-support@example.com")
const auditor = await client("mon-auditor@example.com")
const student = await client("mon-student@example.com")

// ---------- who sees what
check("the Owner sees monitoring and costs", (await admin("/admin/monitoring")).status === 200 && (await admin("/admin/costs")).status === 200)
check("Support and the Auditor see monitoring…", (await support("/admin/monitoring")).status === 200 && (await auditor("/admin/monitoring")).status === 200)
check("…but not costs", (await support("/admin/costs")).status === 403 && (await auditor("/admin/costs")).status === 403)
check("anyone else sees neither", (await student("/admin/monitoring")).status === 403 && (await student("/admin/costs")).status === 403)

// ---------- monitoring: what's wrong
const who = psql(`select id from users where email = 'mon-student@example.com'`)
psql(`insert into email_outbox (to_address, subject, body, status, last_error, created_at) select 'mon-' || g || '@example.com', 'Hi', 'Hi', 'failed', '550 5.1.1 mailbox unavailable', now() - interval '1 hour' from generate_series(1, 3) g`)
psql(`insert into email_outbox (to_address, subject, body, status, last_error) values ('mon-x@example.com', 'Hi', 'Hi', 'failed', '401 the API key is wrong')`)
psql(`insert into submissions (user_id, kind, language, entry, files, time_limit_ms, memory_limit_mb, status, verdict, finished_at) values ('${who}', 'submit', 'python', 'main.py', '[]', 1000, 256, 'done', 'SE', now())`)
const health = (await admin("/admin/monitoring")).json
const texts = (health?.problems ?? []).map((p) => `${p.level}: ${p.text}`)
check("failed email shows as a problem", texts.some((t) => /^warning: \d+ emails? failed in the last day/.test(t)), texts.join(" | "))
check("…with its reasons, commonest first, and never an address", health?.email?.reasons?.[0]?.reason === "550 5.1.1 mailbox unavailable" && health.email.reasons[0].count >= 3 && !JSON.stringify(health.email.reasons).includes("@"), JSON.stringify(health?.email?.reasons))
check("a system error in the last hour shows as a problem", texts.some((t) => /^warning: \d+ submissions? ended in a system error/.test(t)) && health?.queue?.systemErrorsLastHour >= 1, texts.join(" | "))
check("the numbers are there: queue, judges, email, webhooks", typeof health?.queue?.queued === "number" && typeof health?.judges?.online === "number" && typeof health?.email?.sentLastDay === "number" && typeof health?.webhooks?.waiting === "number")

// ---------- the charts: six hours of activity, with a slow spell and a few system errors
psql(`insert into submissions (user_id, kind, language, entry, files, time_limit_ms, memory_limit_mb, status, verdict, created_at, started_at, finished_at)
  select '${who}', 'submit', 'python', 'main.py', '[]', 1000, 256, 'done',
    case when g % 97 = 0 then 'SE' else 'AC' end,
    now() - make_interval(mins => g * 360 / 600),
    now() - make_interval(mins => g * 360 / 600) + make_interval(secs => case when g between 200 and 230 then 90 + (g % 7) * 10 else 1 + (g % 5) end),
    now() - make_interval(mins => g * 360 / 600) + make_interval(secs => case when g between 200 and 230 then 92 + (g % 7) * 10 else 3 + (g % 5) end)
  from generate_series(1, 600) g`)
psql(`insert into email_outbox (to_address, subject, body, status, sent_at, created_at) select 'mon-s' || g || '@example.com', 'Hi', 'Hi', 'sent', now() - make_interval(mins => g), now() - make_interval(mins => g) from generate_series(1, 300) g`)
const series = await admin("/admin/monitoring/series?range=6h")
const busyPoints = (series.json?.points ?? []).filter((p) => p.judged > 0)
check("the charts get six hours in 5-minute steps, with the activity in them", series.status === 200 && series.json?.points?.length >= 72 && busyPoints.length >= 60, JSON.stringify({ status: series.status, points: series.json?.points?.length, busy: busyPoints.length }))
const slow = Math.max(...busyPoints.map((p) => p.waitP95 ?? 0))
check("…the slow spell shows in the waiting times", slow >= 90, slow)
check("…system errors land in their buckets", busyPoints.reduce((n, p) => n + p.systemErrors, 0) >= 6)
// The current step isn't drawn (it isn't over), so the last few minutes' emails aren't counted yet.
check("…and email sent per bucket, the unfinished step left out", (series.json?.points ?? []).reduce((n, p) => n + p.emailSent, 0) >= 290)
check("a range that isn't offered is refused", (await admin("/admin/monitoring/series?range=99y")).status === 400)
check("the charts need the same permission as the page", (await student("/admin/monitoring/series?range=6h")).status === 403)

// ---------- costs
const before = (await admin("/admin/costs")).json
// An organization's machine that ran 10 hours today and stopped; a shared one running for 2 hours.
psql(`insert into judge_machines (instance_id, pool_org_id, size, stage, created_at, stage_at) values ('i-mon-stopped', '${orgId}', 'c7i-flex.large', 'stopped', now() - interval '12 hours', now() - interval '2 hours')`)
psql(`insert into judge_machines (instance_id, size, stage, created_at, stage_at) values ('i-mon-running', 'c7i.large', 'ready', now() - interval '2 hours', now() - interval '2 hours')`)
const report = (await admin("/admin/costs")).json
const hourly = report?.prices ?? {}
const expected = 10 * hourly["c7i-flex.large"] + 2 * hourly["c7i.large"]
check("costs add up: 10 hours stopped and 2 hours running, at Sydney prices", Math.abs(report.soFar - before.soFar - expected) < 0.01, JSON.stringify({ soFar: report?.soFar, before: before?.soFar, expected }))
const org = report?.byPool?.find((p) => p.pool === "mon-org")
check("…by pool, with the organization's name", org?.name === "Mon College" && Math.abs(org.hours - 10) < 0.05, JSON.stringify(org))
check("the forecast keeps the running machine going to the month's end", report.forecast > report.soFar && Math.abs(report.runningHourly - before.runningHourly - hourly["c7i.large"]) < 1e-6, JSON.stringify({ forecast: report?.forecast, runningHourly: report?.runningHourly }))
check("each machine hour includes its address and disk (about 0.9 cents)", Math.abs(hourly["c7i-flex.large"] - 0.11072 - 0.008945) < 0.0001, hourly["c7i-flex.large"])

// ---------- the pages
const browser = await chromium.launch()
for (const [width, name] of [[1440, "laptop"], [390, "phone"]]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.addCookies([{ name: "next-auth.session-token", value: ownerCookie.split("=").slice(1).join("="), url: BASE }])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/admin/monitoring`)
  await tab.getByTestId("health-problems").waitFor({ timeout: 30_000 }).catch(() => {})
  check(`${name}: monitoring lists the problems and email's reasons`, (await tab.getByTestId("health-problems").getByText(/emails failed/).count()) === 1 && (await tab.getByTestId("email-reasons").getByText(/mailbox unavailable/).count()) === 1)
  check(`${name}: the state, the golden signals and the charts are there`, await tab.getByTestId("health-state").isVisible() && (await tab.getByTestId("chart-wait").locator("svg .recharts-line-curve").count()) >= 1 && (await tab.getByTestId("chart-throughput").locator("svg .recharts-area-area").count()) >= 1)
  await tab.getByRole("tab", { name: "6 hours" }).click()
  await tab.waitForTimeout(800)
  // Bars are actually drawn (each a path with a size), not just the axes.
  const bars = await tab.getByTestId("chart-email-sent").locator(".recharts-bar-rectangle path").evaluateAll((paths) =>
    paths.map((p) => { const b = p.getBBox(); return [Math.round(b.width * 10) / 10, Math.round(b.height)] })
  )
  check(`${name}: the bar charts draw their bars`, bars.filter(([w, h]) => w > 0 && h > 0).length >= 50, JSON.stringify({ drawn: bars.length, sample: bars.slice(0, 4) }))
  // "View as table" opens the chart's numbers in a side sheet: the peak and average, then every time.
  await tab.getByTestId("chart-wait").getByRole("button", { name: "View as table" }).click()
  const sheet = tab.getByTestId("chart-table")
  await sheet.waitFor({ timeout: 10_000 }).catch(() => {})
  check(`${name}: a chart's numbers open as a table in a sheet`, (await sheet.locator("table tbody tr").count()) >= 10 && (await sheet.getByText(/highest/).count()) >= 1 && (await sheet.getByRole("columnheader", { name: "Slowest (95%)" }).count()) === 1)
  await tab.screenshot({ path: `${SHOTS}monitoring-table-${name}.png` })
  await tab.keyboard.press("Escape")
  await sheet.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {})
  check(`${name}: the table sheet closes`, (await sheet.count()) === 0)
  check(`${name}: nothing spills sideways on monitoring`, await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  if (width >= 1024) {
    // The charts mustn't squeeze the menu: it keeps its full 16rem.
    const menu = await tab.locator('[data-slot="sidebar-container"]').first().boundingBox()
    check(`${name}: the sidebar keeps its full width beside the charts`, (menu?.width ?? 0) >= 250, menu?.width)
  }
  await tab.screenshot({ path: `${SHOTS}monitoring-${name}.png`, fullPage: true })
  await tab.goto(`${BASE}/admin/costs`)
  await tab.getByTestId("cost-pool").first().waitFor({ timeout: 30_000 }).catch(() => {})
  check(`${name}: costs show each pool`, (await tab.getByTestId("cost-pool").filter({ hasText: "Mon College" }).count()) === 1)
  check(`${name}: nothing spills sideways on costs`, await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await tab.screenshot({ path: `${SHOTS}costs-${name}.png`, fullPage: true })
  await context.close()
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
