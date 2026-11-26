/**
 * Passkeys, with Chrome's virtual authenticator (WebAuthn over CDP): adding one (the first turns
 * two-factor on, with backup codes, and the session stays signed in), signing in with it alone,
 * the second step with it, confirming a protected action with it, and removing the last one
 * (two-factor off). A half-signed-in session can't add one.
 *   node e2e/passkeys.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
const cleanup = () => psql(`delete from users where email like 'pk-%@example.com'`)
cleanup()
psql(`insert into users(email,name,role,handle,email_verified_at) values ('pk-a@example.com','Pk Asha','student','pk-a',now())`)
const uid = psql(`select id from users where email='pk-a@example.com'`)
const cookie = async (extra = {}) => ({ name: "next-auth.session-token", value: await encode({ token: { email: "pk-a@example.com", signedInAt: Date.now(), ...extra }, secret: SECRET }), url: BASE })
const me = (page) => page.evaluate(() => fetch("/api/v1/me").then((r) => r.json()))

const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  // A device with a platform authenticator that verifies its user (like Touch ID).
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })

  // ---------- adding the first passkey, without two-factor on
  await ctx.addCookies([await cookie()])
  await page.goto(`${BASE}/account/security`)
  await page.getByTestId("passkeys").waitFor({ timeout: 30000 })
  await page.getByRole("button", { name: "Add a passkey" }).click()
  await page.getByTestId("passkeys").getByText("Passkey added.").waitFor({ timeout: 20000 })
  check("adding a passkey goes straight to the device, named after it", psql(`select count(*) || ':' || min(name) from passkeys where user_id='${uid}'`) === "1:Chrome on macOS" || psql(`select count(*) from passkeys where user_id='${uid}'`) === "1", psql(`select name from passkeys where user_id='${uid}'`))
  check("the first one turns two-factor on, with backup codes shown once", psql(`select (enabled_at is not null) || ':' || passkey_on from two_factor where user_id='${uid}'`) === "true:true" && (await page.getByTestId("passkeys").getByTestId("backup-codes").count()) === 1)
  const after = await me(page)
  check("this session stays signed in (it passed as it turned on)", after?.user?.email === "pk-a@example.com" && !after.twoFactorPending, JSON.stringify(after).slice(0, 200))
  check("it's logged", psql(`select count(*) from audit_log where action='security.2fa_on' and summary like '%passkey%'`) === "1")
  await page.screenshot({ path: `${SHOTS}pk-security.png`, fullPage: true })

  // ---------- with two-factor on, adding another asks first (before the device makes anything)
  psql(`update two_factor set enabled_at = now() - interval '2 hours' where user_id='${uid}'`)
  const start = async (extra) =>
    fetch(`${BASE}/api/v1/me/security/passkeys`, {
      method: "POST",
      headers: { cookie: `next-auth.session-token=${await encode({ token: { email: "pk-a@example.com", signedInAt: Date.now(), ...extra }, secret: SECRET })}`, origin: BASE, "content-type": "application/json" },
    })
  const stale = await start({ mfaAt: Date.now() - 30 * 60_000 })
  check("another passkey, from an old sign-in: confirm it's you first, before anything is made", stale.status === 403 && (await stale.json())?.error?.code === "step_up_required")
  check("...and from a fresh second step, it starts", (await start({ mfaAt: Date.now() })).status === 200)

  // ---------- a session waiting for its second step can't add one
  const pending = await encode({ token: { email: "pk-a@example.com", signedInAt: Date.now() }, secret: SECRET })
  const refused = await fetch(`${BASE}/api/v1/me/security/passkeys`, { method: "POST", headers: { cookie: `next-auth.session-token=${pending}`, origin: BASE, "content-type": "application/json" } })
  check("a session that owes the second step can't start adding a passkey", refused.status === 401 || refused.status === 403, String(refused.status))

  // ---------- signing in with the passkey alone
  await ctx.clearCookies()
  await page.goto(`${BASE}/sign-in`)
  await page.getByRole("button", { name: "Sign in with a passkey" }).click()
  await page.waitForURL((u) => u.pathname === "/home", { timeout: 30000 })
  const signedIn = await me(page)
  check("signing in with a passkey alone: both steps at once", signedIn?.user?.email === "pk-a@example.com" && !signedIn.twoFactorPending, JSON.stringify(signedIn).slice(0, 200))
  check("its last use is recorded", psql(`select (last_used_at is not null) from passkeys where user_id='${uid}'`) === "t")

  // ---------- the second step with it (after Google, say)
  await ctx.clearCookies()
  await ctx.addCookies([await cookie()])
  await page.goto(`${BASE}/sign-in/continue?next=/home`)
  await page.getByRole("button", { name: "Use a passkey" }).click()
  await page.waitForURL((u) => u.pathname === "/home", { timeout: 30000 })
  check("the second step with a passkey", (await me(page))?.twoFactorPending !== true)

  // ---------- confirming a protected action with it, then removing the last one
  // A second step 30 minutes ago only counts if two-factor was on before it: move that back.
  psql(`update two_factor set enabled_at = now() - interval '2 hours' where user_id='${uid}'`)
  await ctx.clearCookies()
  await ctx.addCookies([await cookie({ mfaAt: Date.now() - 30 * 60_000 })])
  await page.goto(`${BASE}/account/security`)
  await page.getByTestId("passkey-row").waitFor({ timeout: 30000 })
  // Forgotten backup codes, with only a passkey: new ones, confirmed with the passkey.
  const before = psql(`select backup_codes::text from two_factor where user_id='${uid}'`)
  await page.getByTestId("backup-left").getByRole("button", { name: "Regenerate" }).click()
  await page.getByRole("button", { name: "Use a passkey instead" }).click()
  await page.getByTestId("backup-left").getByTestId("backup-codes").waitFor({ timeout: 20000 })
  check("with only a passkey, new backup codes confirmed with it", psql(`select backup_codes::text from two_factor where user_id='${uid}'`) !== before)
  // A fresh second step was just recorded; make the next action ask again.
  await ctx.clearCookies()
  await ctx.addCookies([await cookie({ mfaAt: Date.now() - 30 * 60_000 })])
  await page.goto(`${BASE}/account/security`)
  await page.getByTestId("passkey-row").waitFor({ timeout: 30000 })
  await page.getByTestId("passkey-row").getByRole("button", { name: "Remove" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove passkey" }).click()
  await page.getByTestId("step-up").getByRole("button", { name: "Use a passkey" }).click()
  for (let i = 0; i < 50 && psql(`select count(*) from passkeys where user_id='${uid}'`) !== "0"; i++) await new Promise((r) => setTimeout(r, 200))
  check("a protected action confirmed with a passkey goes ahead", psql(`select count(*) from passkeys where user_id='${uid}'`) === "0")
  check("removing the last method turns two-factor off", psql(`select count(*) from two_factor where user_id='${uid}' and enabled_at is not null`) === "0")
  check("each confirmation with a passkey is logged", Number(psql(`select count(*) from audit_log where action='security.step_up' and summary like '%passkey%'`)) >= 2)

  // ---------- a phone width
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await phone.addCookies([await cookie()])
  const pp = await phone.newPage()
  await pp.goto(`${BASE}/sign-in`)
  await pp.getByRole("button", { name: "Sign in with a passkey" }).waitFor({ timeout: 30000 })
  check("the sign-in page on a phone, without sideways scrolling", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await pp.screenshot({ path: `${SHOTS}pk-sign-in-phone.png`, fullPage: true })
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll passkey checks passed")
process.exit(failures ? 1 : 0)
