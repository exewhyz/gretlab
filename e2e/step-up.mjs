/**
 * Step-up two-factor (packages/judge/src/step-up.ts, route({ stepUp: true })): a protected
 * action needs a second-factor code from the last 10 minutes from someone with two-factor on.
 * An older code (or only a trusted browser) is refused with step_up_required; a code given
 * through the session update passes, is logged, and the same action then goes through; reads
 * never ask; people without two-factor are let through; and in a browser the dialog asks for a
 * code and the action carries on by itself.
 *   node e2e/step-up.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/step-up/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) =>
  execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q])
    .toString()
    .trim()

// The authenticator app: RFC 6238 from the base32 secret.
const b32 = (s) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0
  const out = []
  for (const c of s.replace(/\s/g, "")) {
    value = (value << 5) | A.indexOf(c)
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
const totp = (secret, offsetSteps = 0) => {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offsetSteps))
  const h = createHmac("sha1", b32(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0")
}

const cleanup = () => {
  psql(`delete from organizations where slug like 'stp-%'`)
  psql(`delete from audit_log where actor_label like '%stp-%'`)
  psql(`delete from email_outbox where to_address like 'stp-%'`)
  psql(`delete from users where email like 'stp-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["stp-owner", "stp-plain"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)

/** A browser-like client keeping its cookies; `claims` go into its signed session. */
const session = async (email, claims = {}) => {
  const jar = new Map([["next-auth.session-token", await encode({ token: { email, signedInAt: Date.now(), ...claims }, secret: SECRET })]])
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  const keep = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }
  const api = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie: cookie(), "content-type": "application/json", origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    keep(res)
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const step = async (data) => {
    const csrf = await fetch(BASE + "/api/auth/csrf", { headers: { cookie: cookie() } })
    keep(csrf)
    const { csrfToken } = await csrf.json()
    const res = await fetch(BASE + "/api/auth/session", { method: "POST", headers: { cookie: cookie(), "content-type": "application/json" }, body: JSON.stringify({ csrfToken, data }) })
    keep(res)
    return (await res.json().catch(() => null))?.mfaError ?? null
  }
  return { api, step, token: () => jar.get("next-auth.session-token") }
}

const admin = await session("admin@example.com")
await admin.api("/admin/organizations", { body: { name: "Stp School", slug: "stp-school", type: "school", ownerEmail: "stp-owner@example.com" } })
await admin.api("/admin/organizations", { body: { name: "Stp Plain", slug: "stp-plain", type: "school", ownerEmail: "stp-plain@example.com" } })

// The owner turns two-factor on (an authenticator app).
const owner = await session("stp-owner@example.com")
const setup = (await owner.api("/me/security/app", { method: "POST" })).json
check("the owner turns two-factor on", (await owner.step({ confirmApp: totp(setup.secret) })) === null && (await owner.api("/me/security")).json?.enabled === true)
// In life two-factor has been on for days: an 11-minute-old code is then a real, aged one.
psql(`update two_factor set enabled_at = enabled_at - interval '1 hour' where user_id = (select id from users where email = 'stp-owner@example.com')`)
const enabledAt = Date.parse(psql(`select to_char(enabled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from two_factor where user_id = (select id from users where email = 'stp-owner@example.com')`))
const newRole = (name) => ({ name, description: "", permissions: ["org.members.view"] })
const roles = () => psql(`select count(*) from org_roles where org_id = (select id from organizations where slug = 'stp-school') and name like 'Stp %'`)

// ---------- with a fresh code (just given), a protected action goes through
check("with a code from the last 10 minutes, a protected action goes through", (await owner.api("/orgs/stp-school/roles", { body: newRole("Stp fresh") })).status === 200)

// ---------- an old code: refused until a fresh one is given
const old = await session("stp-owner@example.com", { mfaAt: Date.now() - 11 * 60_000 })
check("…an 11-minute-old code still signs them in (reads work)", (await old.api("/orgs/stp-school/roles")).status === 200)
const refused = await old.api("/orgs/stp-school/roles", { body: newRole("Stp stale") })
check("…but a protected action is refused with step_up_required", refused.status === 403 && refused.json?.error?.code === "step_up_required", JSON.stringify(refused.json))
check("…and nothing was done", roles() === "1")
check("a wrong code doesn't count", (await old.step({ stepUp: "000000" })) === "wrong_code" && (await old.api("/orgs/stp-school/roles", { body: newRole("Stp stale") })).status === 403)
check("emailed codes aren't on for them: asking says so", (await old.api("/me/security/step-up-code", { method: "POST" })).json?.error?.code === "not_on")
check("a fresh code passes the step-up", (await old.step({ stepUp: totp(setup.secret, 1) })) === null)
check("…and the same action now goes through", (await old.api("/orgs/stp-school/roles", { body: newRole("Stp stale") })).status === 200 && roles() === "2")
check("…and it's in the activity log", Number(psql(`select count(*) from audit_log where action = 'security.step_up' and actor_label like '%stp-owner@example.com%'`)) >= 1)

// A backup code works too.
const old2 = await session("stp-owner@example.com", { mfaAt: Date.now() - 30 * 60_000 })
check("a backup code works as the fresh code", (await old2.step({ stepUp: setup.backupCodes[0] })) === null && (await old2.api("/orgs/stp-school/roles", { body: newRole("Stp backup") })).status === 200)

// A code from before two-factor was last turned on doesn't count.
const before = await session("stp-owner@example.com", { mfaAt: enabledAt - 1000 })
check("a code from before two-factor was turned on doesn't count", (await before.api("/orgs/stp-school/roles", { body: newRole("Stp before") })).status !== 200)

// ---------- people without two-factor are let through (the owner's decision)
const plain = await session("stp-plain@example.com")
check("someone without two-factor isn't asked", (await plain.api("/orgs/stp-plain/roles", { body: newRole("Stp plain") })).status === 200)

// ---------- in a browser: the dialog asks, then the action carries on
const browser = await chromium.launch()
for (const [name, viewport] of [
  ["laptop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({ token: { email: "stp-owner@example.com", signedInAt: Date.now(), mfaAt: Date.now() - 11 * 60_000 }, secret: SECRET }),
      url: BASE,
    },
  ])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/stp-school/manage/roles`)
  await tab.getByRole("button", { name: "New role" }).click()
  const roleName = `Stp ui ${name}`
  await tab.getByLabel("Role name").fill(roleName)
  await tab.getByRole("button", { name: "Create role" }).click()
  const dialog = tab.getByTestId("step-up")
  await dialog.waitFor({ timeout: 20_000 }).catch(() => {})
  check(`${name}: the dialog asks for a code`, await dialog.isVisible())
  // On top, not just present: what's under the middle of Confirm is Confirm (an open sheet hid it once).
  const confirm = dialog.getByRole("button", { name: "Confirm" })
  const box = await confirm.boundingBox()
  const onTop = box
    ? await tab.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid='step-up']") !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    : false
  check(`${name}: …above the editor it interrupted`, onTop)
  await tab.waitForTimeout(400) // past its fade-in, so the picture shows it as people see it
  await tab.screenshot({ path: `${SHOTS}step-up-${name}.png` })
  // App codes work once each (the ones from now are used above): a backup code, as the dialog offers.
  await dialog.getByLabel("Code").fill(setup.backupCodes[name === "laptop" ? 1 : 2])
  await dialog.getByRole("button", { name: "Confirm" }).click()
  await dialog.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {})
  await tab.waitForTimeout(1500)
  check(`${name}: …and the role is made without pressing Create again`, psql(`select count(*) from org_roles where name = '${roleName}'`) === "1")
  await context.close()
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
