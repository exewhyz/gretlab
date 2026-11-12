/**
 * The richer audit log: who (kept after the account goes), what changed (settings fields
 * from/to, modules and permissions added/removed), where from (address only through the
 * trusted proxy, device from the browser), platform support marked; filters (area, person,
 * search, dates), pages, bad filters; CSV (filters, formula-safe, itself logged); who may
 * read it; the platform's log; the page, its filters and details, on a phone too.
 *   node e2e/audit.mjs [base-url] [screenshot-dir]
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
const PROXY = process.env.PROXY_SECRET ?? "e2e-proxy-secret-0123456789"
const DB = process.env.E2E_DB ?? "gretlab_test"
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug = 'aud-school'`)
  psql(`delete from users where email like 'aud-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["aud-o", "aud-auditor", "aud-m", "aud-gone"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
psql(`update users set name = '=SUM(1,2)' where email = 'aud-auditor@example.com'`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email, headers = {}) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body, raw } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (raw) return res
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Aud School", slug: "aud-school", type: "school", ownerEmail: "aud-o@example.com" } })
const O = "/orgs/aud-school"
const orgId = psql(`select id from organizations where slug='aud-school'`)
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
// The owner works from a Mac through the trusted proxy, which passes their address on.
const owner = await client("aud-o@example.com", { "user-agent": CHROME_MAC, "x-proxy-secret": PROXY, "x-client-ip": "203.0.113.7" })
// Someone claiming an address without the proxy's secret isn't believed.
const auditor = await client("aud-auditor@example.com", { "x-client-ip": "198.51.100.9" })
const m = await client("aud-m@example.com")
const gone = await client("aud-gone@example.com")
const page = (who, q = "") => who(`${O}/audit${q ? `?${q}` : ""}`)

// ---------- making changes worth reading
await owner(O, { method: "PATCH", body: { name: "Aud Academy", listed: false, modules: { library: true } } })
const role = (await owner(`${O}/roles`, { body: { name: "Auditor", permissions: ["org.audit.view"] } })).json
await owner(`${O}/roles/${role.id}`, { method: "PUT", body: { name: "Auditor", description: "Reads the log", permissions: ["org.audit.view", "org.members.view"] } })
await owner(`${O}/members/${uid("aud-auditor")}/roles`, { body: { roleId: role.id } })
const groups = (await owner(`${O}/roles`, { body: { name: "Group keeper", permissions: ["org.groups.manage"] } })).json
await owner(`${O}/members/${uid("aud-gone")}/roles`, { body: { roleId: groups.id } })
await gone(`${O}/groups`, { body: { name: "Made by someone who left" } })
await admin(`${O}/groups`, { body: { name: "Made by support" } })
await auditor(`${O}/groups`, { body: { name: "Nope" } })

// ---------- what an entry holds
const all = (await page(owner, "limit=200")).json
const entries = all?.entries ?? []
const settings = entries.find((e) => e.action === "org.settings")
check("a settings change lists each field, from and to", settings?.detail.changes.some((c) => c.field === "Name" && c.from === "Aud School" && c.to === "Aud Academy") && settings.detail.changes.some((c) => c.field === "Listed in the directory" && c.from === "Yes" && c.to === "No"), JSON.stringify(settings?.detail))
check("...and the modules switched on", settings?.detail.lists.some((l) => l.label === "Modules" && l.added.includes("Library")))
check("...and says what in its sentence", settings?.summary.startsWith("Changed name, listed in the directory"), settings?.summary)
const roleEdit = entries.find((e) => e.action === "role.update")
check("a role change lists permissions by name, and the description", roleEdit?.detail.lists[0]?.added.join() === "See members" && roleEdit.detail.changes.some((c) => c.field === "Description" && c.to === "Reads the log"), JSON.stringify(roleEdit?.detail))
check("the area is named", settings?.categoryLabel === "Organization" && roleEdit?.categoryLabel === "Roles")
check("where from: the address the trusted proxy passed on, and the browser", settings?.ip === "203.0.113.7" && settings.device === "Chrome on macOS", JSON.stringify([settings?.ip, settings?.device]))
check("an address claimed without the proxy is ignored", psql(`select count(*) from audit_log where ip = '198.51.100.9'`) === "0")
const supportEntry = entries.find((e) => e.summary.includes("Made by support"))
check("platform support stepping in is marked", supportEntry?.support === true && !settings.support, JSON.stringify(supportEntry))
psql(`delete from users where email = 'aud-gone@example.com'`)
const left = (await page(owner, "q=someone%20who%20left")).json.entries[0]
check("who did it is kept after their account goes", left?.actor.name === "aud-gone Name" && left.actor.email === "aud-gone@example.com" && left.actor.removed === true, JSON.stringify(left?.actor))

// ---------- filters and pages
const roles = (await page(owner, "category=role&limit=200")).json
check("by area", roles.entries.length >= 4 && roles.entries.every((e) => e.category === "role"), roles.entries.map((e) => e.action).join())
check("the areas and people to filter by are offered", roles.filters.categories.some((c) => c.key === "org" && c.label === "Organization") && roles.filters.people.some((p) => p.id === uid("aud-o")))
check("by person", (await page(owner, `actor=${uid("aud-o")}&limit=200`)).json.entries.every((e) => e.actor.email === "aud-o@example.com"))
check("by words", (await page(owner, "q=Group%20keeper")).json.entries.every((e) => e.summary.includes("Group keeper")))
const today = new Date().toISOString().slice(0, 10)
check("by dates", (await page(owner, `to=2000-01-01`)).json.entries.length === 0 && (await page(owner, `from=${today}&limit=200`)).json.entries.length === entries.length)
const p1 = (await page(owner, "limit=3")).json
const p2 = (await page(owner, `limit=3&before=${encodeURIComponent(p1.next)}`)).json
check("a page at a time, newest first, without repeats", p1.entries.length === 3 && p2.entries.length === 3 && !p2.entries.some((e) => p1.entries.some((x) => x.id === e.id)) && new Date(p1.entries[2].createdAt) >= new Date(p2.entries[0].createdAt))
check("nonsense filters are a 400", (await page(owner, "actor=nope")).status === 400 && (await page(owner, "before=garbage")).status === 400 && (await page(owner, "from=yesterday")).status === 400)

// ---------- CSV, and who may read
const csv = await owner(`${O}/audit/export?category=role`, { raw: true })
const text = await csv.text()
check("the CSV downloads with the filters", csv.headers.get("content-type")?.startsWith("text/csv") && text.startsWith("When (UTC),Who,Email,Area") && text.includes("Auditor") && !text.includes("org.settings"))
check("...with changes in words", text.includes("Permissions added: See members"))
await auditor(`${O}/audit/export`, { raw: true })
const fullCsv = await (await owner(`${O}/audit/export`, { raw: true })).text()
check("...and a name that looks like a formula made safe", fullCsv.includes("'=SUM(1,2)") && !fullCsv.includes(",=SUM"))
check("downloading it is logged", (await page(owner, "q=Downloaded")).json.entries.some((e) => e.action === "org.audit_export"))
check("a role with See the activity log reads it", (await page(auditor)).status === 200)
check("a member without it can't", (await page(m)).status === 403 && (await m(`${O}/audit/export`, { raw: true })).status === 403)
const plat = (await admin("/admin/activity?limit=5")).json
check("the platform's log reads the same way", Array.isArray(plat?.entries) && "filters" in plat && plat.entries.every((e) => e.categoryLabel))

// ---------- the page
const browser = await chromium.launch()
const view = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await view("aud-o@example.com")
await op.goto(`${BASE}${O}/manage/activity`)
await op.getByTestId("audit-log").waitFor({ timeout: 30000 })
check("the page lists entries by day", (await op.getByTestId("audit-entry").count()) >= 8)
await op.getByLabel("Area").selectOption({ label: "Roles" })
await op.waitForFunction(() => [...document.querySelectorAll('[data-testid="audit-entry"]')].every((e) => e.textContent.includes("Roles")), null, { timeout: 15000 }).catch(() => {})
check("choosing an area narrows it", (await op.getByTestId("audit-entry").allInnerTexts()).every((t) => t.includes("Roles")))
check("the CSV link carries the filters", (await op.getByRole("link", { name: "Download CSV" }).getAttribute("href")).includes("category=role"))
await op.getByRole("button", { name: "Clear" }).click()
await op.getByLabel("Search the activity log").fill("Changed name")
await op.getByTestId("audit-entry").filter({ hasText: "Changed name" }).first().waitFor({ timeout: 15000 })
await op.getByTestId("audit-entry").filter({ hasText: "Changed name" }).first().click()
const detail = op.getByTestId("audit-detail")
await detail.waitFor({ timeout: 15000 })
const dt = await detail.innerText()
check("an entry's details show who, from where, and what changed", dt.includes("Aud Academy") && dt.includes("Chrome on macOS · 203.0.113.7") && dt.includes("Library") && (await op.getByTestId("audit-changes").count()) === 1, dt.slice(0, 300))
await op.screenshot({ path: SHOTS + "audit.png", fullPage: true })
const phone = await view("aud-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/activity`)
await phone.getByTestId("audit-log").waitFor({ timeout: 30000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
