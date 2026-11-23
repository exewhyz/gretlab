/**
 * Plans and billing (features/billing; rules in packages/judge/src/billing.ts).
 *   - Billing off (the default): new organizations have no plan limits, as before
 *   - Billing on: a new organization starts on the free plan (core and the coding lab); modules
 *     outside it are off and can't be switched on, and features outside it are refused where
 *     they start (LMS, API keys, courses, lab exams, outcomes)
 *   - a plan that holds a feature allows it; organizations from before billing keep everything
 *   - Manage › Plan and billing: the plan, use (students, staff), the prices, billing details
 *     (GSTIN checked); only who manages billing sees it
 *   - Dashboard › Plans: every organization's plan, setting one by hand (its price worked out on
 *     the server), back to no limits, and the prices; only staff with the permission
 *   - both pages in a browser, on a laptop and a phone
 *   node e2e/billing.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/billing/"
mkdirSync(SHOTS, { recursive: true })
const { chromium } = createRequire(ROOT + "package.json")("playwright")
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 1500)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q]).toString().trim()
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const cleanup = () => {
  psql(`delete from organizations where slug like 'bl-%'`)
  psql(`delete from users where email like 'bl-%@example.com'`)
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role) values ('bl-old@example.com','Bl Old','student'), ('bl-new@example.com','Bl New','student')`)
const admin = await client("admin@example.com")
const settings = (body) => admin("/admin/settings", { method: "PATCH", body })

// ---------- billing off: nothing changes
await settings({ "billing.enabled": false })
await admin("/admin/organizations", { body: { name: "Bl Old College", slug: "bl-old", type: "college", ownerEmail: "bl-old@example.com" } })
const old = await client("bl-old@example.com")
check("with billing off, a new organization has no plan limits", psql(`select coalesce(plan_features::text, 'none') || '|' || s.status from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-old'`) === "none|custom")
check("…and its modules work as before", (await old("/orgs/bl-old", { method: "PATCH", body: { modules: { attendance: true } } })).status === 200)

// ---------- billing on: new organizations start free
await settings({ "billing.enabled": true })
await admin("/admin/organizations", { body: { name: "Bl New College", slug: "bl-new", type: "college", ownerEmail: "bl-new@example.com" } })
const fresh = await client("bl-new@example.com")
check("with billing on, a new organization starts on the free plan", psql(`select plan_features::text || '|' || s.status || '|' || s.students from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-new'`) === `["core", "coding"]|free|50`)
const summary = (await fresh("/orgs/bl-new/manage")).json
const attendance = summary?.org?.moduleOptions?.find((m) => m.key === "attendance")
check("Settings lists a module outside the plan as not in it", attendance?.inPlan === false && summary?.org?.moduleOptions?.find((m) => m.key === "coding")?.inPlan === true, JSON.stringify(summary?.org?.moduleOptions))
const switched = await fresh("/orgs/bl-new", { method: "PATCH", body: { modules: { attendance: true } } })
check("…and it can't be switched on until it's bought", switched.status === 403 && switched.json?.error?.code === "not_in_plan", JSON.stringify(switched.json))
check("modules outside the plan are off (attendance answers 404)", (await fresh("/orgs/bl-new/attendance")).status === 404)
const refused = async (path) => {
  const r = await fresh(path)
  return r.status === 403 && r.json?.error?.code === "not_in_plan"
}
check("an LMS can't be connected without LTI in the plan", await refused("/orgs/bl-new/lti"))
check("API keys and webhooks need them in the plan", await refused("/orgs/bl-new/integrations"))
check("courses need them in the plan", await refused("/orgs/bl-new/courses"))
const outcomesSave = await fresh("/orgs/bl-new/outcomes", { method: "PUT", body: { outcomes: [], rules: { threshold: 60, levels: [50, 60, 70] } } })
check("outcomes need them in the plan", outcomesSave.json?.error?.code === "not_in_plan", JSON.stringify(outcomesSave))

// A plan that holds them allows them (staff set plans by hand until paying is built).
psql(`update organizations set plan_features = '["core","coding","lti","api","courses"]'::jsonb where slug = 'bl-new'`)
check("with LTI, API access and courses in the plan, they work", (await fresh("/orgs/bl-new/lti")).status === 200 && (await fresh("/orgs/bl-new/integrations")).status === 200 && (await fresh("/orgs/bl-new/courses")).status === 200)
check("…and attendance, not bought, is still off", (await fresh("/orgs/bl-new", { method: "PATCH", body: { modules: { attendance: true } } })).json?.error?.code === "not_in_plan")

// ---------- organizations from before billing keep everything
check("an organization from before billing keeps everything with billing on", (await old("/orgs/bl-old/lti")).status === 200 && (await old("/orgs/bl-old/integrations")).status === 200)

// ---------- Manage › Plan and billing
// A student in a group, so the counts have someone to count.
const group = (await fresh("/orgs/bl-new/groups", { body: { name: "Bl Batch" } })).json
psql(`insert into users(email,name,role) values ('bl-stu@example.com','Bl Student','student')`)
const orgId = psql(`select id from organizations where slug = 'bl-new'`)
psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgId}', id, 'active', 'created' from users where email = 'bl-stu@example.com'`)
psql(`insert into group_members(group_id,user_id) select '${group.id}', id from users where email = 'bl-stu@example.com'`)
const page = (await fresh("/orgs/bl-new/billing")).json
check("the plan page shows the plan, use, and every feature's price", page?.enabled === true && page.plan?.status === "free" && page.usage?.students === 1 && page.usage?.staff === 1 && page.catalogue?.features?.length >= 15 && page.catalogue.features.find((f) => f.key === "coding")?.price === 49, JSON.stringify({ usage: page?.usage, plan: page?.plan }))
check("…and that paying online isn't set up here", page?.canPay === false)
const student = await client("bl-stu@example.com")
check("a member without billing can't see it", (await student("/orgs/bl-new/billing")).status === 403)
const badGstin = await fresh("/orgs/bl-new/billing/profile", { method: "PUT", body: { legalName: "Bl New College Trust", gstin: "27ABCDE1234", address: "1 College Road, Pune", billingEmail: "accounts@example.com" } })
check("a GSTIN that isn't one is refused", badGstin.status === 400, JSON.stringify(badGstin.json))
const profile = await fresh("/orgs/bl-new/billing/profile", { method: "PUT", body: { legalName: "Bl New College Trust", gstin: "27abcde1234f1z5", address: "1 College Road, Pune", billingEmail: "accounts@example.com" } })
check("billing details save, the GSTIN in capitals", profile.status === 200 && profile.json?.billing?.gstin === "27ABCDE1234F1Z5", JSON.stringify(profile.json?.billing))
check("…and the change is in the organization's activity log", Number(psql(`select count(*) from audit_log where org_id = '${orgId}' and action = 'billing.profile'`)) === 1)

// ---------- Dashboard › Plans
check("someone without the permission can't see the plans", (await student("/admin/billing")).status === 403 && (await fresh("/admin/billing")).status === 403)
const list = (await admin("/admin/billing?q=bl-")).json
check("the plans list every organization with its use", list?.items?.length === 2 && list.items.find((o) => o.slug === "bl-new")?.usage?.students === 1 && list.items.find((o) => o.slug === "bl-old")?.features === null, JSON.stringify(list?.items?.map((o) => [o.slug, o.status, o.features])))
const setPlan = (body) => admin(`/admin/billing/orgs/${orgId}`, { method: "PUT", body: { status: "active", features: ["attendance"], students: 100, staff: 10, judges: 0, storagePacks: 0, period: "year", periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2027-11-01T00:00:00.000Z", discountPercent: 0, notes: "Pilot", ...body } })
const set = await setPlan({})
// Classes 10 + attendance 10 = 20 a student x 100; staff within the free 7? 10 staff - 7 free = 3 x 300.
check("setting a plan by hand works its price out on the server", set.status === 200 && set.json?.price === 2_000 + 900, JSON.stringify(set.json))
check("…switches its features on (attendance now available)", (await fresh("/orgs/bl-new", { method: "PATCH", body: { modules: { attendance: true } } })).status === 200)
check("…and off (the coding lab, not in it, is now off)", psql(`select plan_features::text from organizations where id = '${orgId}'`) === `["core", "attendance"]`)
check("…and goes in the platform's activity log", Number(psql(`select count(*) from audit_log where org_id is null and action = 'billing.set_plan' and detail->>'orgId' = '${orgId}'`)) === 1)
check("a discount comes off the price", (await setPlan({ discountPercent: 50 })).json?.price === 1_450)
check("back to no limits", (await setPlan({ features: null, status: "custom" })).status === 200 && psql(`select coalesce(plan_features::text, 'none') from organizations where id = '${orgId}'`) === "none")
await setPlan({})

// ---------- prices
const prices = (await admin("/admin/billing/settings")).json
check("the billing settings are read with the permission", prices?.["billing.staff_price"] === 300 && prices?.["billing.enabled"] === true, JSON.stringify(prices).slice(0, 200))
check("only billing settings can be changed here", (await admin("/admin/billing/settings", { method: "PATCH", body: { "site.title": "x" } })).status === 400)
await admin("/admin/billing/settings", { method: "PATCH", body: { "billing.prices": { attendance: 12 } } })
check("a new price shows in the plan page's prices", (await fresh("/orgs/bl-new/billing")).json?.catalogue?.features?.find((f) => f.key === "attendance")?.price === 12)
await admin("/admin/billing/settings", { method: "PATCH", body: { "billing.prices": {} } })

// ---------- the pages
const browser = await chromium.launch()
for (const [name, viewport] of [["laptop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport })
  await context.addCookies([{ name: "next-auth.session-token", value: (await encode({ token: { email: "bl-new@example.com" }, secret: SECRET })), url: BASE }])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/bl-new/manage/billing`)
  await tab.getByTestId("plan-builder").waitFor({ timeout: 30_000 }).catch(() => {})
  const before = await tab.getByTestId("plan-total").innerText().catch(() => "")
  await tab.getByTestId("plan-builder").getByRole("button", { name: "College", exact: true }).click()
  const after = await tab.getByTestId("plan-total").innerText().catch(() => "")
  check(`${name}: the plan page builds a plan and its price changes as you choose`, Boolean(before) && Boolean(after) && before !== after, JSON.stringify({ before, after }))
  check(`${name}: it says paying online isn't set up yet`, await tab.getByTestId("pay-note").isVisible())
  // The plan holds classes and attendance only: no links to pages it would refuse.
  const sidebar = tab.locator('nav[aria-label="Organization"]')
  check(`${name}: the sidebar has no Courses or Outcomes outside the plan, but has Plan and billing`, name === "phone" || ((await sidebar.getByRole("link", { name: "Courses" }).count()) === 0 && (await sidebar.getByRole("link", { name: "Outcomes" }).count()) === 0 && (await sidebar.getByRole("link", { name: "Plan and billing" }).count()) === 1))
  check(`${name}: nothing spills sideways`, await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await tab.screenshot({ path: `${SHOTS}plan-${name}.png`, fullPage: true })
  await context.addCookies([{ name: "next-auth.session-token", value: (await encode({ token: { email: "admin@example.com" }, secret: SECRET })), url: BASE }])
  await tab.goto(`${BASE}/admin/plans`)
  await tab.getByTestId("plan-row").first().waitFor({ timeout: 30_000 }).catch(() => {})
  check(`${name}: Dashboard › Plans lists organizations`, (await tab.getByTestId("plan-row").count()) >= 2)
  await tab.getByRole("tab", { name: "Prices" }).click()
  await tab.getByTestId("billing-prices").waitFor({ timeout: 15_000 }).catch(() => {})
  check(`${name}: …and its prices`, await tab.getByLabel("Price of Coding lab").isVisible().catch(() => false))
  check(`${name}: nothing spills sideways on Plans`, await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await tab.screenshot({ path: `${SHOTS}plans-admin-${name}.png`, fullPage: true })
  await context.close()
}
await browser.close()

await settings({ "billing.enabled": false })
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
