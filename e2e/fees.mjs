/**
 * Fees students pay their institution (the finance module). This part: the module (off until a
 * college switches it on, never for a company), fee heads (duplicates, removing one a plan uses),
 * plans (checks, another organization's classes, stale saves, deleting), the settings (prefix,
 * GSTIN, the institution's own Razorpay keys: sealed, never sent back, kept when left empty),
 * who may set up (an accountant who only collects may not), the activity log, and the Setup
 * screen on a laptop and a phone.
 *   node e2e/fees.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from organizations where slug in ('fee-college','fee-co','fee-other')`)
  psql(`delete from users where email like 'fee-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["fee-o", "fee-acct", "fee-t", "fee-s1", "fee-s2", "fee-out", "fee-o2"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const session = (email) => encode({ token: { email }, secret: SECRET })
const client = async (email) => {
  const cookie = `next-auth.session-token=${await session(email)}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Fee College", slug: "fee-college", type: "college", ownerEmail: "fee-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Fee Co", slug: "fee-co", type: "company", ownerEmail: "fee-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Fee Other", slug: "fee-other", type: "college", ownerEmail: "fee-o2@example.com" } })
const O = "/orgs/fee-college"
const orgId = psql(`select id from organizations where slug='fee-college'`)
const [owner, acct, teacher, , , outsider, otherOwner] = await Promise.all(people.map((h) => client(`${h}@example.com`)))
const dept = (await owner(`${O}/groups`, { body: { name: "CSE" } })).json
const batch = (await owner(`${O}/groups`, { body: { name: "2026-A", parentId: dept.id } })).json
const otherGroup = (await otherOwner(`/orgs/fee-other/groups`, { body: { name: "Elsewhere" } })).json
for (const h of ["fee-acct", "fee-t", "fee-s1", "fee-s2"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const year = psql(`insert into academic_years(org_id,name,starts_on,ends_on,is_current) values ('${orgId}','2026-27','2026-06-01','2027-05-31',true) returning id`).split("\n")[0]
const acctRole = (await owner(`${O}/roles`, { body: { name: "Fee counter", permissions: ["fees.collect"] } })).json
await owner(`${O}/members/${uid("fee-acct")}/roles`, { body: { roleId: acctRole.id } })

// ---------- the module
check("fees are off until switched on", (await owner(`${O}/fees/setup`)).status === 404)
check("a company can't switch them on", (await owner("/orgs/fee-co", { method: "PATCH", body: { modules: { finance: true } } })).json?.error?.code === "module_unavailable")
check("a college can", (await owner(O, { method: "PATCH", body: { modules: { finance: true } } })).status === 200)
const setup = async (who = owner) => (await who(`${O}/fees/setup`)).json

// ---------- fee heads
const tuition = (await owner(`${O}/fees/heads`, { body: { name: "Tuition", gstRate: 0, appliesTo: "everyone" } })).json
const hostel = (await owner(`${O}/fees/heads`, { body: { name: "Hostel", gstRate: 0, appliesTo: "hostel" } })).json
check("fee heads are added", Boolean(tuition?.id && hostel?.id) && (await setup()).heads.length === 2, JSON.stringify(tuition))
check("…each name once, in any case", (await owner(`${O}/fees/heads`, { body: { name: "TUITION", gstRate: 0, appliesTo: "everyone" } })).json?.error?.code === "head_taken")
check("a GST rate above 28% is refused", (await owner(`${O}/fees/heads`, { body: { name: "Lab", gstRate: 40, appliesTo: "everyone" } })).status === 400)
check("an accountant who only collects can't set up", (await acct(`${O}/fees/heads`, { body: { name: "Exam", gstRate: 0, appliesTo: "everyone" } })).status === 403)
check("…but can open the Fees area", (await acct(`${O}/fees/setup`)).status === 200)
check("a teacher can't open it", (await teacher(`${O}/fees/setup`)).status === 403)
check("an outsider can't either", [403, 404].includes((await outsider(`${O}/fees/setup`)).status))

// ---------- plans
const instalment = (over = {}) => ({ id: "t1", label: "Term 1", dueOn: "2026-07-10", lines: [{ headId: tuition.id, amount: 30000 }, { headId: hostel.id, amount: 20000 }], fine: { amount: 500, graceDays: 5 }, ...over })
const planBody = (over = {}) => ({ yearId: year, name: "B.Tech 1st year", audience: [dept.id], instalments: [instalment(), instalment({ id: "t2", label: "Term 2", dueOn: "2026-12-10", fine: null })], ...over })
const bad = await owner(`${O}/fees/plans`, { body: planBody({ instalments: [instalment({ dueOn: "2026-02-30" })] }) })
check("a plan with a day that doesn't exist is refused, saying which", bad.status === 400 && bad.json?.error?.message === "Term 1: the due day isn't a real date.", JSON.stringify(bad.json))
check("…and one for another organization's classes", (await owner(`${O}/fees/plans`, { body: planBody({ audience: [otherGroup.id] }) })).json?.error?.code === "bad_audience")
const plan = (await owner(`${O}/fees/plans`, { body: planBody() })).json
check("a plan is made for chosen classes, in instalments", Boolean(plan?.id) && plan.instalments.length === 2 && plan.audience[0] === dept.id, JSON.stringify(plan).slice(0, 200))
const edited = await owner(`${O}/fees/plans/${plan.id}`, { method: "PUT", body: { ...planBody({ name: "B.Tech first year" }), expectedUpdatedAt: plan.updatedAt } })
check("…changed with the version it opened at", edited.status === 200 && edited.json?.name === "B.Tech first year")
const stale = await owner(`${O}/fees/plans/${plan.id}`, { method: "PUT", body: { ...planBody(), expectedUpdatedAt: plan.updatedAt } })
check("…and an older version is refused", stale.json?.error?.code === "edited_elsewhere", JSON.stringify(stale.json))
check("a head a plan uses can't be removed", (await owner(`${O}/fees/heads/${hostel.id}`, { method: "DELETE" })).json?.error?.code === "head_in_use")
const spare = (await owner(`${O}/fees/plans`, { body: planBody({ name: "Spare" }) })).json
check("a plan nobody has paid on can be deleted", (await owner(`${O}/fees/plans/${spare.id}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from fee_plans where id='${spare.id}'`) === "0")

// ---------- settings
check("a key ID that isn't Razorpay's is refused", (await owner(`${O}/fees/settings`, { method: "PUT", body: { prefix: "FC", gstin: "", razorpay: { keyId: "nope", keySecret: "x", webhookSecret: "y" } } })).json?.error?.code === "bad_key")
const saved = await owner(`${O}/fees/settings`, { method: "PUT", body: { prefix: "fc", gstin: "", razorpay: { keyId: "rzp_test_feecollege", keySecret: "fee-secret-123", webhookSecret: "fee-hook-456" } } })
check("the settings are saved, the secrets never sent back", saved.status === 200 && saved.json?.prefix === "FC" && saved.json?.razorpay?.keyId === "rzp_test_feecollege" && !JSON.stringify(saved.json).includes("fee-secret-123"), JSON.stringify(saved.json))
const stored = psql(`select fee_settings::text from organizations where id='${orgId}'`)
check("…and sealed at rest", !stored.includes("fee-secret-123") && !stored.includes("fee-hook-456"), stored.slice(0, 200))
await owner(`${O}/fees/settings`, { method: "PUT", body: { prefix: "FC", gstin: "29ABCDE1234F1Z5", razorpay: { keyId: "rzp_test_feecollege", keySecret: "", webhookSecret: "" } } })
check("left empty, the saved secrets are kept", psql(`select fee_settings->'razorpay'->>'keySecret' from organizations where id='${orgId}'`) === JSON.parse(stored).razorpay.keySecret)
check("…and the setup screen never sees them", !JSON.stringify(await setup()).includes(JSON.parse(stored).razorpay.keySecret))
check("an accountant can't change the settings", (await acct(`${O}/fees/settings`, { method: "PUT", body: { prefix: "X", gstin: "", razorpay: null } })).status === 403)
check("changes are in the activity log", Number(psql(`select count(*) from audit_log where org_id='${orgId}' and action like 'fees.%'`)) >= 6)

// ---------- the Setup screen
const browser = await chromium.launch()
const errors = []
try {
  const open = async (email, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addCookies([{ name: "next-auth.session-token", value: await session(email), url: BASE }])
    const p = await ctx.newPage()
    p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
    return p
  }
  const p = await open("fee-o@example.com", 1440)
  await p.goto(`${BASE}${O}/manage/fees`)
  await p.getByTestId("fee-head").first().waitFor({ timeout: 30000 })
  check("the Setup screen lists the heads and plans", (await p.getByTestId("fee-head").count()) === 2 && (await p.getByTestId("fee-plan").count()) === 1)
  check("…and Fees is in the sidebar", (await p.getByRole("navigation", { name: "Organization" }).innerText()).includes("Fees"))
  await p.getByRole("button", { name: "Add a fee head" }).click()
  await p.getByLabel("Name").fill("Exam")
  await p.getByRole("button", { name: "Add", exact: true }).click()
  await p.getByTestId("fee-head").nth(2).waitFor({ timeout: 15000 })
  check("a head is added from the page", psql(`select count(*) from fee_heads where org_id='${orgId}'`) === "3")
  await p.getByRole("button", { name: "Edit B.Tech first year" }).click()
  await p.getByTestId("fee-plan-sheet").waitFor({ timeout: 15000 })
  check("a plan opens in a sheet with its instalments", (await p.getByTestId("fee-instalment").count()) === 2)
  await p.screenshot({ path: SHOTS + "fees-plan-sheet.png" })
  await p.getByRole("button", { name: "Add an instalment" }).click()
  check("…and can take another", (await p.getByTestId("fee-instalment").count()) === 3)
  await p.keyboard.press("Escape")
  await p.screenshot({ path: SHOTS + "fees-setup.png", fullPage: true })
  const phone = await open("fee-o@example.com", 390)
  await phone.goto(`${BASE}${O}/manage/fees`)
  await phone.getByTestId("fee-head").first().waitFor({ timeout: 30000 })
  check("the Setup screen on a phone, without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.screenshot({ path: SHOTS + "fees-setup-phone.png", fullPage: true })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll fee checks passed")
process.exit(failures ? 1 : 0)
