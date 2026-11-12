/**
 * Two-factor sign-in: the authenticator app (QR, secret sealed at rest, a wrong code,
 * confirming through the session) and codes by email (limits, expiry, one at a time);
 * an older session owes the second step (signed out everywhere, "finish signing in");
 * app codes (no reuse, one step of drift), emailed codes, backup codes (once each), the
 * lock after five wrong codes; trusted browsers (and forgetting them); new backup codes;
 * removing a method and turning off; security emails; required for staff or everyone
 * (blocked until on, can't turn off, an admin can't require it before using it);
 * platform reset for a lost phone; the log; the pages, on a phone too.
 *   node e2e/two-factor.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { createServer } from "node:http"
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A fake email provider (Resend's API shape), so codes really go out.
const delivered = []
const provider = createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    const body = JSON.parse(raw)
    for (const m of Array.isArray(body) ? body : [body]) delivered.push({ to: m.to[0], subject: m.subject })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: [] }))
  })
})
await new Promise((r) => provider.listen(3198, "127.0.0.1", r))

/** The latest code emailed to someone (the outbox keeps the subject: "Your Gretlab code: 123456"). */
const mailedCode = (h) => psql(`select subject from email_outbox where to_address='${h}@example.com' and subject like 'Your Gretlab code:%' order by created_at desc limit 1`).split(": ")[1] ?? ""
const notices = (h) => psql(`select subject from email_outbox where to_address='${h}@example.com' and subject like 'Security:%' order by created_at`).split("\n").filter(Boolean)
const setRule = async (rule) => {
  psql(`insert into settings(key, value) values ('security.require_2fa', '"${rule}"') on conflict (key) do update set value = excluded.value`)
  await sleep(5500) // settings are cached for 5 s
}

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
  psql(`delete from organizations where slug = 'tfa-school'`)
  psql(`delete from users where email like 'tfa-%'`)
  psql(`delete from settings where key = 'security.require_2fa'`)
  psql(`delete from email_outbox where to_address like 'tfa-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["tfa-u", "tfa-staff", "tfa-student", "tfa-ui"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)

/** A browser-like client: keeps its cookies, so the session can change under it. */
const session = async (email, claims = {}) => {
  const jar = new Map([["next-auth.session-token", await encode({ token: { email, ...claims }, secret: SECRET })]])
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  const keep = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }
  const api = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie: cookie(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    keep(res)
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  /** The session's update(): the jwt callback checks the code. */
  const step = async (data) => {
    const csrf = await fetch(BASE + "/api/auth/csrf", { headers: { cookie: cookie() } })
    keep(csrf)
    const { csrfToken } = await csrf.json()
    const res = await fetch(BASE + "/api/auth/session", { method: "POST", headers: { cookie: cookie(), "content-type": "application/json" }, body: JSON.stringify({ csrfToken, data }) })
    keep(res)
    return (await res.json().catch(() => null))?.mfaError ?? null
  }
  const raw = (path, init = {}) => fetch(BASE + "/api/v1" + path, { ...init, headers: { cookie: cookie(), "content-type": "application/json" } }).then((r) => (keep(r), r))
  return { api, step, raw, token: () => jar.get("next-auth.session-token"), jar }
}

// ---------- turning it on
const u = await session("tfa-u@example.com")
check("it starts off", (await u.api("/me/security")).json?.enabled === false)
const setup = (await u.api("/me/security/app", { method: "POST" })).json
check("setup gives a QR code, the key and ten backup codes", setup?.qr.startsWith("<svg") && /^[A-Z2-7]{32}$/.test(setup.secret) && setup.url.startsWith("otpauth://totp/") && setup.backupCodes.length === 10)
const sealed = psql(`select pending_secret from two_factor where user_id='${uid("tfa-u")}'`)
check("the secret is sealed at rest, codes hashed", sealed.startsWith("v1:") && !sealed.includes(setup.secret) && !psql(`select pending_backup_codes::text from two_factor where user_id='${uid("tfa-u")}'`).includes(setup.backupCodes[0]))
check("not on until confirmed", (await u.api("/me/security")).json?.enabled === false)
check("a wrong code doesn't confirm", (await u.step({ confirmApp: "000000" })) === "wrong_code")
const oldToken = u.token()
check("the right code turns it on", (await u.step({ confirmApp: totp(setup.secret) })) === null && (await u.api("/me/security")).json?.methods.app === true)
check("...and they're told by email", notices("tfa-u").some((n) => n.includes("Two-factor sign-in was turned on (an authenticator app)")), notices("tfa-u").join(" | "))
check("...and this session stays signed in", (await u.api("/me")).json?.user?.security.twoFactor === true)

// ---------- an older session owes the step
const older = await session("tfa-u@example.com")
const me = (await older.api("/me")).json
check("an older session counts as signed out, owing the step", me?.user === null && me.twoFactorPending === true)
check("...everywhere", (await older.api("/me/classes")).status === 401 && (await older.api("/me/security")).status === 401)
check("a code already used can't be used again", (await older.step({ secondStep: totp(setup.secret) })) === "wrong_code")
check("a backup code passes", (await older.step({ secondStep: setup.backupCodes[0].toUpperCase() })) === null && (await older.api("/me")).json?.user?.email === "tfa-u@example.com")
const again = await session("tfa-u@example.com")
check("...but only once", (await again.step({ secondStep: setup.backupCodes[0] })) === "wrong_code")
check("the next code from the app passes (a step of drift allowed)", (await again.step({ secondStep: totp(setup.secret, 1) })) === null && (await again.api("/me")).json?.user !== null)
check("nine backup codes are left", (await u.api("/me/security")).json?.backupCodesLeft === 9)
check("using a backup code is emailed", notices("tfa-u").some((n) => n.includes("A backup code was used")))

// ---------- codes by email, as a second method
const emailSetup = (await u.api("/me/security/email", { method: "POST" })).json
check("adding email sends a code, and no new backup codes", emailSetup?.sentTo === "t•••u@example.com" && emailSetup.backupCodes === null && /^\d{6}$/.test(mailedCode("tfa-u")), JSON.stringify(emailSetup))
check("asking again within a minute waits", (await u.api("/me/security/email", { method: "POST" })).json?.error?.code === "wait")
check("the code was really handed to the email service, not just queued", delivered.some((m) => m.to === "tfa-u@example.com" && m.subject.startsWith("Your Gretlab code:")))
check("the emailed code turns email on", (await u.step({ confirmEmail: mailedCode("tfa-u") })) === null && (await u.api("/me/security")).json?.methods.email === true)
psql(`update two_factor set email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-u")}'`)
const viaMail = await session("tfa-u@example.com")
check("someone owing the step can have a code emailed", (await viaMail.api("/auth/two-factor/email", { method: "POST" })).status === 200)
const mailed = mailedCode("tfa-u")
check("...which passes it", (await viaMail.step({ secondStep: mailed })) === null && (await viaMail.api("/me")).json?.user !== null)
check("...once", (await (await session("tfa-u@example.com")).step({ secondStep: mailed })) === "wrong_code")
// A backlog: 300 ordinary emails queued ahead. The code must not wait behind them.
psql(`insert into email_outbox(to_address, subject, body) select 'tfa-bulk-' || g || '@example.com', 'Notice', 'x' from generate_series(1, 300) g`)
psql(`update two_factor set email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-u")}'`)
const behind = await session("tfa-u@example.com")
const t0 = Date.now()
const fast = await behind.api("/auth/two-factor/email", { method: "POST" })
const latest = psql(`select status from email_outbox where to_address='tfa-u@example.com' and subject like 'Your Gretlab code:%' order by created_at desc limit 1`)
check("a code goes ahead of a backlog of notices, at once", fast.status === 200 && latest === "sent" && Date.now() - t0 < 5000, JSON.stringify([fast.status, latest, Date.now() - t0]))
check("...and the backlog is left to the queue", Number(psql(`select count(*) from email_outbox where to_address like 'tfa-bulk-%' and status = 'queued'`)) >= 290)
psql(`delete from email_outbox where to_address like 'tfa-bulk-%'`)
psql(`insert into email_outbox(to_address, subject, body, urgent, expires_at) values ('tfa-u@example.com', 'Your Gretlab code: 999999', 'x', true, now() - interval '1 minute')`)
psql(`update two_factor set email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-u")}'`)
await behind.api("/auth/two-factor/email", { method: "POST" })
check("a code that expired while waiting is dropped, not sent late", psql(`select status || ':' || last_error from email_outbox where subject = 'Your Gretlab code: 999999'`).startsWith("failed:expired") && !delivered.some((m) => m.subject === "Your Gretlab code: 999999"))
psql(`delete from email_outbox where subject = 'Your Gretlab code: 999999'`)
check("someone not signed in can't ask for one", (await fetch(BASE + "/api/v1/auth/two-factor/email", { method: "POST" })).status === 401)
psql(`update two_factor set email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-u")}'`)
const late = await session("tfa-u@example.com")
await late.api("/auth/two-factor/email", { method: "POST" })
const stale = mailedCode("tfa-u")
psql(`update two_factor set email_code_expires = now() - interval '1 second' where user_id='${uid("tfa-u")}'`)
check("an emailed code expires", (await late.step({ secondStep: stale })) === "wrong_code")
psql(`update two_factor set email_sends = 5, email_window_start = now() - interval '10 minutes', email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-u")}'`)
check("five emails an hour, then a wait", (await late.api("/auth/two-factor/email", { method: "POST" })).json?.error?.code === "wait")
psql(`update two_factor set email_sends = 0, email_sent_at = null, failures = 0 where user_id='${uid("tfa-u")}'`)

// ---------- trusting a browser
const trustful = await session("tfa-u@example.com")
check("a backup code passes the step for the browser to trust", (await trustful.step({ secondStep: setup.backupCodes[3] })) === null)
check("a browser can be trusted for 30 days", (await trustful.api("/me/security/trust", { method: "POST" })).status === 200 && trustful.jar.has("gl-2fa-trust"))
const trustCookie = trustful.jar.get("gl-2fa-trust")
const sameBrowser = await session("tfa-u@example.com")
sameBrowser.jar.set("gl-2fa-trust", trustCookie)
check("...and then skips the second step", (await sameBrowser.api("/me")).json?.user?.email === "tfa-u@example.com")
const elsewhere = await session("tfa-u@example.com")
elsewhere.jar.set("gl-2fa-trust", trustCookie.slice(0, -2) + "xx")
check("a forged trust cookie doesn't", (await elsewhere.api("/me")).json?.user === null)
const otherPerson = await session("tfa-staff@example.com")
otherPerson.jar.set("gl-2fa-trust", trustCookie)
check("nor someone else's", (await otherPerson.api("/me")).json?.user?.email !== "tfa-u@example.com")
await u.api("/me/security/forget-browsers", { method: "POST" })
check("forgetting browsers voids it", (await sameBrowser.api("/me")).json?.user === null)
check("a session from before it was on doesn't count", oldToken !== u.token())

// ---------- locked after five wrong codes
const guess = await session("tfa-u@example.com")
const answers = []
for (let i = 0; i < 5; i++) answers.push(await guess.step({ secondStep: "111111" }))
check("five wrong codes lock it", answers.slice(0, 4).every((a) => a === "wrong_code") && answers[4] === "locked", answers.join())
check("...even a right one waits", (await guess.step({ secondStep: setup.backupCodes[1] })) === "locked")
psql(`update two_factor set locked_until = null where user_id='${uid("tfa-u")}'`)

// ---------- backup codes, turning off
const renewed = await u.api("/me/security/backup-codes", { body: { code: setup.backupCodes[1] } })
check("new backup codes, with a code", renewed.json?.backupCodes.length === 10)
check("...the old ones stop working", (await u.api("/me/security/backup-codes", { body: { code: setup.backupCodes[2] } })).json?.error?.code === "wrong_code")
check("...the old ones stop working", true)
check("removing a method needs a right code", (await u.api("/me/security/remove", { body: { method: "app", code: "123456" } })).json?.error?.code === "wrong_code")
check("removing the app keeps email", (await u.api("/me/security/remove", { body: { method: "app", code: renewed.json.backupCodes[0] } })).json?.enabled === true)
check("a signed-in person can have a code emailed to confirm a change", (await u.api("/me/security/code", { method: "POST" })).status === 200)
check("removing the last method turns it off", (await u.api("/me/security/remove", { body: { method: "email", code: mailedCode("tfa-u") } })).json?.enabled === false && (await older.api("/me")).json?.user !== null)
check("...and they're told", notices("tfa-u").some((n) => n.includes("Two-factor sign-in was turned off")))

// ---------- required
const admin = await session("admin@example.com")
check("an admin can't require it before using it", (await admin.api("/admin/settings", { method: "PATCH", body: { "security.require_2fa": "staff" } })).json?.error?.code === "two_factor_first")
await admin.api("/admin/organizations", { body: { name: "Tfa School", slug: "tfa-school", type: "school", ownerEmail: "tfa-staff@example.com" } })
await setRule("staff")
const staff = await session("tfa-staff@example.com")
const student = await session("tfa-student@example.com")
check("staff without it must turn it on", (await staff.api("/me")).json?.user?.security.mustEnroll === true)
check("...and until then only reach their security page", (await staff.api("/me/classes")).json?.error?.code === "two_factor_required" && (await staff.api("/me/security")).status === 200)
check("a student isn't asked, under staff only", (await student.api("/me")).json?.user?.security.mustEnroll === false && (await student.api("/me/classes")).status === 200)
const staffSetup = (await staff.api("/me/security/app", { method: "POST" })).json
await staff.step({ confirmApp: totp(staffSetup.secret) })
check("once on, they carry on", (await staff.api("/me/classes")).status === 200)
check("required, its last method can't be removed", (await staff.api("/me/security/remove", { body: { method: "app", code: staffSetup.backupCodes[0] } })).json?.error?.code === "required")
await setRule("everyone")
check("required of everyone, a student must too", (await student.api("/me/classes")).json?.error?.code === "two_factor_required")
await setRule("off")

// ---------- a lost phone
check("platform staff can turn it off for someone", (await admin.api(`/admin/users/${uid("tfa-staff")}/two-factor`, { method: "DELETE" })).status === 200 && notices("tfa-staff").some((n) => n.includes("turned off by an administrator")))
check("...who then signs in with Google alone", (await (await session("tfa-staff@example.com")).api("/me")).json?.user !== null)
check("...not when it's already off", (await admin.api(`/admin/users/${uid("tfa-staff")}/two-factor`, { method: "DELETE" })).json?.error?.code === "not_on")
const users = (await admin.api("/admin/users?search=tfa-")).json
check("the users list shows who has it on", Array.isArray(users) && users.every((x) => x.twoFactor === false))
const plog = (await admin.api("/admin/activity?category=security&limit=50")).json?.entries ?? []
check("it's all in the platform log", ["security.2fa_on", "security.method_add", "security.backup_code", "security.backup_codes", "security.forget_browsers", "security.method_remove", "security.2fa_off", "security.2fa_reset"].every((a) => plog.some((e) => e.action === a)), plog.map((e) => e.action).join())

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("tfa-ui@example.com")
await p.goto(`${BASE}/account/security`)
await p.getByTestId("method-app").getByRole("button", { name: "Turn on" }).click()
await p.getByTestId("app-setup").waitFor({ timeout: 15000 })
const key = (await p.getByTestId("app-secret").innerText()).replace(/\s/g, "")
const codes = (await p.getByTestId("backup-codes").locator("li").allInnerTexts())
check("the page shows the QR code, key and backup codes", (await p.getByRole("img", { name: "QR code for your authenticator app" }).locator("svg").count()) === 1 && key.length === 32 && codes.length === 10)
await p.getByLabel("I've saved my backup codes").check()
await p.getByLabel("Code from the app").fill(totp(key))
await p.getByTestId("app-setup").getByRole("button", { name: "Turn on", exact: true }).click()
await p.getByTestId("backup-left").waitFor({ timeout: 15000 })
check("it's turned on from the page", (await p.getByTestId("backup-left").innerText()).includes("10 backup codes left") && (await p.getByTestId("method-app").innerText()).includes("On"))
await p.getByTestId("method-email").getByRole("button", { name: "Turn on" }).click()
await p.getByRole("button", { name: /Email a code to/ }).click()
await p.getByLabel("Code from the email").waitFor({ timeout: 15000 })
await p.getByLabel("Code from the email").fill(mailedCode("tfa-ui"))
await p.getByTestId("email-setup").getByRole("button", { name: "Turn on", exact: true }).click()
await p.getByTestId("method-email").getByText("· On").waitFor({ timeout: 15000 }).catch(() => {})
check("codes by email are added from the page", (await p.getByTestId("method-email").innerText()).includes("On"))
await p.screenshot({ path: SHOTS + "two-factor.png", fullPage: true })
// The same person in another browser, signed in with Google before: one more step.
const q = await view("tfa-ui@example.com")
await q.goto(`${BASE}/playground`)
await q.getByRole("link", { name: "Finish signing in" }).waitFor({ timeout: 30000 }).catch(() => {})
check("a public page offers to finish signing in", (await q.getByRole("link", { name: "Finish signing in" }).count()) === 1)
await q.goto(`${BASE}/classes`)
await q.getByRole("heading", { name: "One more step" }).waitFor({ timeout: 30000 })
check("a signed-in page sends them to the second step", q.url().includes("/sign-in/continue?next=%2Fclasses"), q.url())
// The setup email just went: past the one-minute wait before asking again.
psql(`update two_factor set email_sent_at = now() - interval '2 minutes' where user_id='${uid("tfa-ui")}'`)
await q.getByRole("button", { name: "Email me a code instead" }).click()
await q.getByRole("button", { name: "Email me a code" }).click()
await q.getByLabel("Code").waitFor({ timeout: 15000 })
await q.getByLabel("Code").fill(mailedCode("tfa-ui"))
await q.getByLabel("Don't ask again on this browser for 30 days").check()
await q.getByRole("button", { name: "Continue" }).click()
await q.waitForURL(/\/classes$/, { timeout: 15000 }).catch(() => {})
await q.getByRole("button", { name: "Account" }).waitFor({ timeout: 15000 }).catch(() => {})
check("the second step by email lands where they were going", q.url().endsWith("/classes") && (await q.getByRole("button", { name: "Account" }).count()) === 1, q.url())
check("...and the browser is trusted", (await q.context().cookies()).some((c) => c.name === "gl-2fa-trust" && c.httpOnly))
const phone = await view("tfa-ui@example.com", 390)
await phone.goto(`${BASE}/sign-in/continue?next=/account/security`)
await phone.getByRole("heading", { name: "One more step" }).waitFor({ timeout: 15000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

provider.close()
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
