/**
 * Integrations: an API key works on its own organization's API only, with the permissions
 * chosen for it, is named in the activity log, and stops when revoked; a webhook receives
 * the changes it asked for, signed, and not the others. Needs WEBHOOKS_ALLOW_LOCAL=true on
 * the server (run.sh sets it) for the local receiver.
 *   node e2e/integrations.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { createRequire } from "node:module"

import { verifyWebhook } from "../packages/judge/src/integrations.ts"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug in ('in-school','in-other')`)
  psql(`delete from users where email like 'in-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('in-t@example.com','in-t Name','student','in-t')`)
const token = (email) => encode({ token: { email }, secret: SECRET })
const client = async (email) => {
  const cookie = `next-auth.session-token=${await token(email)}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const withKey = (key) => async (path, { method, body } = {}) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "In School", slug: "in-school", type: "school", ownerEmail: "in-o@example.com" } })
await admin("/admin/organizations", { body: { name: "In Other", slug: "in-other", type: "school", ownerEmail: "in-o2@example.com" } })
const O = "/orgs/in-school"
const orgId = psql(`select id from organizations where slug='in-school'`)
const owner = await client("in-o@example.com")
psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgId}', id, 'active', 'created' from users where email='in-t@example.com'`)

// ---------- API keys
check("a key needs what it may do", (await owner(`${O}/integrations/keys`, { body: { name: "Empty", permissions: [] } })).status === 400)
check("...from real permissions", (await owner(`${O}/integrations/keys`, { body: { name: "Bogus", permissions: ["nothing.at.all"] } })).status === 400)
const made = await owner(`${O}/integrations/keys`, { body: { name: "In SIS", permissions: ["org.members.view"] } })
check("the owner makes a key, shown once", made.status === 200 && /^glk_[a-z0-9]{10}_/.test(made.json?.token ?? ""), JSON.stringify(made.json))
const key = withKey(made.json.token)
check("only a fingerprint of it is kept", psql(`select count(*) from org_api_keys where hash = '${made.json.token}'`) === "0")
check("it reads what it may", (await key(`${O}/members`)).status === 200)
check("...but changes nothing it may not", (await key(`${O}/groups`, { body: { name: "In 6-A" } })).status === 403)
check("it doesn't reach another organization", [403, 404].includes((await key(`/orgs/in-other/members`)).status))
check("...or anyone's own account", (await key(`/me`)).status === 403)
check("...or make keys and webhooks", (await key(`${O}/integrations`)).status === 403)
check("a made-up key is refused", (await withKey("glk_abcdefghij_" + "x".repeat(40))(`${O}/members`)).status === 401)

const writer = (await owner(`${O}/integrations/keys`, { body: { name: "In Writer", permissions: ["org.members.view", "org.groups.manage"] } })).json.token
const group = await withKey(writer)(`${O}/groups`, { body: { name: "In 6-A" } })
check("a key with the right permission changes things", group.status === 200, JSON.stringify(group.json))
check("...and the activity log names the key", Number(psql(`select count(*) from audit_log where org_id='${orgId}' and actor_label like '%API key "In Writer"%'`)) >= 1)
check("someone without the settings can't see integrations", [403, 404].includes((await (await client("in-t@example.com"))(`${O}/integrations`)).status))
const list = (await owner(`${O}/integrations`)).json
check("the list shows keys by prefix, never whole", list?.keys.length === 2 && list.keys.every((k) => k.prefix.endsWith("_…")) && !JSON.stringify(list).includes(made.json.token))
await owner(`${O}/integrations/keys/${made.json.id}`, { method: "DELETE" })
check("a revoked key stops at once", (await key(`${O}/members`)).status === 401)

// ---------- webhooks
const got = []
const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    got.push({ headers: req.headers, body })
    res.writeHead(204).end()
  })
}).listen(3197, "127.0.0.1")
const waitFor = async (pred, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (got.some(pred)) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}
check("a webhook must be https (local addresses only for tests)", (await owner(`${O}/integrations/webhooks`, { body: { url: "http://hooks.example.com/x", events: ["*"] } })).status === 400)
const hook = await owner(`${O}/integrations/webhooks`, { body: { url: "http://127.0.0.1:3197/hook", events: ["group.*"] } })
check("the owner adds a webhook for groups, with its secret shown once", hook.status === 200 && hook.json?.secret?.startsWith("whsec_"), JSON.stringify(hook.json))
await owner(`${O}/groups`, { body: { name: "In 6-B" } })
check("a change it asked for arrives", await waitFor((r) => r.headers["gretlab-event"]?.startsWith("group.")))
const delivery = got.find((r) => r.headers["gretlab-event"]?.startsWith("group."))
const payload = delivery ? JSON.parse(delivery.body) : null
check("...signed with its secret", delivery && verifyWebhook(hook.json.secret, delivery.body, delivery.headers["gretlab-signature"], new Date()))
check("...saying what happened and who did it", payload?.summary?.includes("In 6-B") && payload.actor?.label?.includes("in-o@example.com") && payload.id === delivery.headers["gretlab-delivery"], delivery?.body)
await owner(`${O}/holidays`, { body: { name: "In Day", startsOn: "2027-01-02", endsOn: "2027-01-02" } })
await new Promise((r) => setTimeout(r, 1500))
check("a change it didn't ask for doesn't", !got.some((r) => r.headers["gretlab-event"]?.startsWith("holiday.")))
await owner(`${O}/integrations/webhooks/${hook.json.id}/ping`, { body: {} })
check("Send a test delivers a ping", await waitFor((r) => r.headers["gretlab-event"] === "ping"))
const shown = (await owner(`${O}/integrations`)).json?.webhooks[0]
check("its deliveries are listed as delivered", shown?.deliveries.some((d) => d.status === "sent" && d.responseStatus === 204))
await owner(`${O}/integrations/webhooks/${hook.json.id}`, { method: "PATCH", body: { active: false } })
const before = got.length
await owner(`${O}/groups`, { body: { name: "In 6-C" } })
await new Promise((r) => setTimeout(r, 1500))
check("a paused webhook gets nothing", got.length === before)
server.close()

// ---------- the page
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await token("in-o@example.com"), domain: new URL(BASE).hostname, path: "/" }])
const p = await ctx.newPage()
await p.goto(`${BASE}${O}/manage/integrations`)
await p.getByTestId("api-key-row").first().waitFor({ timeout: 30000 })
check("the page lists keys and webhooks", (await p.getByTestId("api-key-row").count()) === 2 && (await p.getByTestId("webhook").count()) === 1)
await p.getByRole("button", { name: "New key" }).click()
await p.getByPlaceholder("e.g. Student information system").fill("In Page Key")
await p.getByRole("dialog").getByText("See members", { exact: true }).first().click()
await p.getByRole("button", { name: "Make key" }).click()
await p.getByTestId("shown-secret").waitFor({ timeout: 15000 })
check("making a key there shows it once", (await p.getByTestId("shown-secret").innerText()).startsWith("glk_"))
await p.screenshot({ path: SHOTS + "integrations.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
