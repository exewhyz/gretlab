/**
 * Email and password sign-in beside Google: signing up (a link confirms the address, and
 * nothing says whether an address has an account), signing in only once confirmed, wrong
 * passwords pausing password sign-in, forgotten passwords (a one-hour single-use link that
 * signs out every older session), changing or adding a password, signing out everywhere,
 * the second step after a password like after Google, and a hash never leaving the server.
 *   node e2e/password-auth.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 400)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from email_outbox where to_address like 'pw-%'`)
  psql(`delete from users where email like 'pw-%'`)
}
cleanup()
// Settings left at their defaults: registration open to any address.
const api = async (path, { method, body, cookie = "" } = {}) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null), text: "" }
}
/** The latest email to an address, and the first link in it. */
const lastMail = (to) => {
  const row = psql(`select subject || E'\\n' || body from email_outbox where to_address='${to}' order by created_at desc limit 1`)
  return { subject: row.split("\n")[0], text: row, link: row.match(/https?:\/\/\S+token=[\w-]+/)?.[0] ?? null }
}
const mails = (to, like) => Number(psql(`select count(*) from email_outbox where to_address='${to}' and subject like '${like}'`))
/** Signs in through NextAuth's own endpoint; the session cookie, or the reason it refused. */
const signIn = async (email, password) => {
  const csrf = await fetch(BASE + "/api/auth/csrf")
  const jar = csrf.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  const { csrfToken } = await csrf.json()
  const res = await fetch(BASE + "/api/auth/callback/password", {
    method: "POST",
    redirect: "manual",
    headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE + "/", json: "true" }),
  })
  const session = res.headers.getSetCookie().find((c) => c.startsWith("next-auth.session-token="))
  const location = res.headers.get("location") ?? (await res.json().catch(() => ({})))?.url ?? ""
  return session ? { cookie: session.split(";")[0] } : { error: new URL(location, BASE).searchParams.get("error") }
}
const PW = "blue kettle sings at noon"

// ---------- signing up
check("a weak password is refused", (await api("/auth/sign-up", { body: { name: "Pw One", email: "pw-one@example.com", password: "password123" } })).status === 400)
const up = await api("/auth/sign-up", { body: { name: "Pw One", email: "PW-One@Example.com", password: PW } })
check("signing up says to check your email", up.status === 200 && up.json?.sent === true)
check("the account is made, unconfirmed, with only a hash of the password", psql(`select (password_hash like 'scrypt$%') || ':' || (email_verified_at is null) || ':' || (password_hash not like '%kettle%') from users where email='pw-one@example.com'`) === "true:true:true")
const confirm = lastMail("pw-one@example.com")
check("a link to confirm the address is emailed", confirm.subject === "Confirm your email" && !!confirm.link, confirm.text)
check("signing in waits for it", (await signIn("pw-one@example.com", PW)).error === "unverified")
const again = await api("/auth/sign-up", { body: { name: "Someone", email: "pw-one@example.com", password: "another long passphrase" } })
check("signing up with a taken address answers the same", again.status === 200 && again.json?.sent === true)
check("...and doesn't send a second link within a minute", mails("pw-one@example.com", "Confirm your email") === 1)
const token = new URL(confirm.link).searchParams.get("token")
check("a made-up link doesn't confirm", (await api("/auth/verify", { body: { token: "x".repeat(43) } })).status === 400)
check("the real one does", (await api("/auth/verify", { body: { token } })).json?.email === "pw-one@example.com")
check("...once", (await api("/auth/verify", { body: { token } })).status === 400)
// The second sign-up changed the waiting password: it was never confirmed, so the latest stands.
const s1 = await signIn("pw-one@example.com", "another long passphrase")
check("once confirmed, they sign in", !!s1.cookie, JSON.stringify(s1))
const me = await api("/me", { cookie: s1.cookie })
check("...as themselves", me.json?.user?.email === "pw-one@example.com")
check("no response carries the hash", !JSON.stringify(me.json).includes("scrypt"))

// ---------- wrong passwords
const pw = "another long passphrase"
check("a wrong password is refused, without saying which part", (await signIn("pw-one@example.com", "wrong guess here")).error === "wrong")
check("an unknown address gets the same answer", (await signIn("pw-nobody@example.com", "wrong guess here")).error === "wrong")
for (let i = 0; i < 4; i++) await signIn("pw-one@example.com", "wrong guess here")
check("five in a row pause password sign-in", (await signIn("pw-one@example.com", pw)).error === "locked")
check("...and tell the owner", mails("pw-one@example.com", "Security: Password sign-in was paused%") === 1)
psql(`update users set password_locked_until=now() - interval '1 second' where email='pw-one@example.com'`)
check("once the pause is over, the right password works", !!(await signIn("pw-one@example.com", pw)).cookie)

// ---------- forgotten passwords
const old = `next-auth.session-token=${await encode({ token: { email: "pw-one@example.com", signedInAt: Date.now() - 5000 }, secret: SECRET })}`
check("a session from before works", (await api("/me", { cookie: old })).json?.user?.email === "pw-one@example.com")
check("asking for a reset answers the same for unknown addresses", (await api("/auth/forgot", { body: { email: "pw-nobody@example.com" } })).json?.sent === true && mails("pw-nobody@example.com", "%") === 0)
await api("/auth/forgot", { body: { email: "pw-one@example.com" } })
const reset = lastMail("pw-one@example.com")
check("a reset link is emailed", reset.subject === "Reset your password" && !!reset.link)
const rt = new URL(reset.link).searchParams.get("token")
check("a weak new password is refused, and the link still works", (await api("/auth/reset", { body: { token: rt, password: "1234567890" } })).status === 400)
check("a good one is set", (await api("/auth/reset", { body: { token: rt, password: "a brand new passphrase" } })).status === 200)
check("...the link works once", (await api("/auth/reset", { body: { token: rt, password: "yet another passphrase" } })).status === 400)
check("...older sessions are signed out", (await api("/me", { cookie: old })).json?.user === null)
check("...the old password stops working and the new one works", (await signIn("pw-one@example.com", pw)).error === "wrong" && !!(await signIn("pw-one@example.com", "a brand new passphrase")).cookie)
check("...and the owner is told", mails("pw-one@example.com", "Security: Your password was reset") === 1)

// ---------- changing, adding, signing out everywhere
const s2 = await signIn("pw-one@example.com", "a brand new passphrase")
check("changing needs the current password", (await api("/me/password", { method: "PUT", cookie: s2.cookie, body: { current: "nope nope nope", password: "fourth passphrase here" } })).status === 400)
check("...with it, it changes", (await api("/me/password", { method: "PUT", cookie: s2.cookie, body: { current: "a brand new passphrase", password: "fourth passphrase here" } })).status === 200)
psql(`insert into users(email,name,role,handle,email_verified_at) values ('pw-google@example.com','Pw Google','student','pw-google',now())`)
const g = `next-auth.session-token=${await encode({ token: { email: "pw-google@example.com" }, secret: SECRET })}`
check("a Google account has no password", (await api("/me/password", { cookie: g })).json?.hasPassword === false)
check("...and adds one without a current one", (await api("/me/password", { method: "PUT", cookie: g, body: { password: "google person passphrase" } })).status === 200 && !!(await signIn("pw-google@example.com", "google person passphrase")).cookie)
const s3 = await signIn("pw-one@example.com", "fourth passphrase here")
await api("/me/sessions", { method: "DELETE", cookie: s3.cookie })
check("signing out everywhere ends that session too", (await api("/me", { cookie: s3.cookie })).json?.user === null)
check("account changes are in the log", Number(psql(`select count(*) from audit_log where action like 'account.%' and actor_label like '%pw-one@example.com%'`)) >= 5)

// ---------- the pages
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage()
await page.goto(`${BASE}/sign-up`)
await page.getByLabel("Name").fill("Pw Two")
await page.getByLabel("Email").fill("pw-two@example.com")
await page.getByLabel("Password", { exact: true }).fill("short")
check("the sign-up form says what's wrong with a password as you type", (await page.getByTestId("sign-up-form").innerText()).includes("at least 10"))
await page.getByLabel("Password", { exact: true }).fill("orange river moves slowly")
await page.getByRole("button", { name: "Create account" }).click()
await page.getByTestId("sign-up-sent").waitFor({ timeout: 15000 })
check("signing up from the page", psql(`select count(*) from users where email='pw-two@example.com'`) === "1")
check("...without scrolling sideways on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await page.screenshot({ path: SHOTS + "sign-up.png", fullPage: true })
await page.goto(lastMail("pw-two@example.com").link.replace(/^https?:\/\/[^/]+/, BASE))
await page.getByRole("button", { name: "Confirm my email" }).click()
await page.getByTestId("email-confirmed").waitFor({ timeout: 15000 })
check("confirming from the emailed link", psql(`select email_verified_at is not null from users where email='pw-two@example.com'`) === "t")
await page.goto(`${BASE}/sign-in`)
await page.getByLabel("Email").fill("pw-two@example.com")
await page.getByLabel("Password", { exact: true }).fill("orange river moves slowly")
await page.screenshot({ path: SHOTS + "sign-in.png", fullPage: true })
await page.getByRole("button", { name: "Sign in", exact: true }).click()
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 })
check("signing in from the page", (await page.evaluate(() => fetch("/api/v1/me").then((r) => r.json()))).user?.email === "pw-two@example.com")
// With two-factor on, a password sign-in asks for the second step like Google does.
psql(`insert into two_factor(user_id, enabled_at, email_on) select id, now(), true from users where email='pw-two@example.com'`)
const p2 = await (await browser.newContext()).newPage()
await p2.goto(`${BASE}/sign-in`)
await p2.getByLabel("Email").fill("pw-two@example.com")
await p2.getByLabel("Password", { exact: true }).fill("orange river moves slowly")
await p2.getByRole("button", { name: "Sign in", exact: true }).click()
await p2.waitForURL((u) => u.pathname === "/sign-in/continue", { timeout: 30000 })
check("with two-factor on, a password sign-in asks for the second step", (await p2.evaluate(() => fetch("/api/v1/me").then((r) => r.json()))).twoFactorPending === true)
const p3 = await (await browser.newContext()).newPage()
await p3.goto(`${BASE}/sign-in`)
await p3.getByLabel("Email").fill("pw-two@example.com")
await p3.getByLabel("Password", { exact: true }).fill("not the password")
await p3.getByRole("button", { name: "Sign in", exact: true }).click()
await p3.getByText("don't match").waitFor({ timeout: 15000 })
check("a wrong password shows a message on the page", true)
await p3.goto(`${BASE}/forgot-password`)
await p3.getByLabel("Email").fill("pw-two@example.com")
await p3.getByRole("button", { name: "Email me a link" }).click()
await p3.getByTestId("forgot-sent").waitFor({ timeout: 15000 })
await p3.goto(lastMail("pw-two@example.com").link.replace(/^https?:\/\/[^/]+/, BASE))
await p3.getByLabel("New password").fill("purple tiger dances well")
await p3.getByLabel("Type it again").fill("purple tiger dances well")
await p3.getByRole("button", { name: "Set new password" }).click()
await p3.getByTestId("password-reset").waitFor({ timeout: 15000 })
check("resetting from the pages", !!(await signIn("pw-two@example.com", "purple tiger dances well")).cookie)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
