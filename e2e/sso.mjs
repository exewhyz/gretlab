/**
 * College single sign-on (OpenID Connect) against a fake identity provider this suite runs on
 * :3196 (discovery, authorize, token with PKCE, keys). Platform staff give the domains; the
 * college connects its IdP; people sign in, become members, and go through the second step.
 * Every way a sign-in can be forged or replayed is refused.
 *   node e2e/sso.mjs http://localhost:3100 /tmp/gretlab-e2e/
 */
import { execFileSync } from "node:child_process"
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const IDP = "http://127.0.0.1:3196"
mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug like 'sso-%'`)
  psql(`delete from users where email like '%@sso-college.edu' or email like 'sso-%@example.com'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('sso-o@example.com','Sso Owner','student','sso-o')`)

// ---------- the fake identity provider
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 })
const KID = "idp-1"
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url")
const sign = (payload, privateKey = key.privateKey) => {
  const head = b64({ alg: "RS256", typ: "JWT", kid: KID })
  const body = b64(payload)
  return `${head}.${body}.${createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url")}`
}
const pending = new Map() // code -> { nonce, challenge, email }
let nextIdentity = { email: "asha@sso-college.edu", name: "Asha Rao", sub: "idp-asha" }
let tamper = null // (claims) => claims, for the next token only
let signWith = null
const idp = createServer(async (req, res) => {
  const url = new URL(req.url, IDP)
  if (url.pathname === "/.well-known/openid-configuration") {
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ issuer: IDP, authorization_endpoint: `${IDP}/authorize`, token_endpoint: `${IDP}/token`, jwks_uri: `${IDP}/jwks` }))
  }
  if (url.pathname === "/jwks") {
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }))
  }
  if (url.pathname === "/authorize") {
    // A real IdP would show its own sign-in; this one signs in whoever the test chose.
    const code = randomUUID()
    pending.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), client: url.searchParams.get("client_id"), identity: nextIdentity })
    const back = new URL(url.searchParams.get("redirect_uri"))
    back.searchParams.set("code", code)
    back.searchParams.set("state", url.searchParams.get("state"))
    res.statusCode = 302
    res.setHeader("location", back.toString())
    return res.end()
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let raw = ""
    for await (const chunk of req) raw += chunk
    const form = new URLSearchParams(raw)
    const got = pending.get(form.get("code"))
    pending.delete(form.get("code"))
    const verifierOk = got && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === got.challenge
    if (!got || !verifierOk || form.get("client_secret") !== "college-secret") {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: "invalid_grant" }))
    }
    const now = Math.floor(Date.now() / 1000)
    let claims = { iss: IDP, aud: got.client, sub: got.identity.sub, email: got.identity.email, name: got.identity.name, nonce: got.nonce, iat: now, exp: now + 300 }
    if (tamper) claims = tamper(claims)
    const token = sign(claims, signWith ?? key.privateKey)
    tamper = null
    signWith = null
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ id_token: token, access_token: "x", token_type: "Bearer" }))
  }
  res.statusCode = 404
  res.end()
})
await new Promise((r) => idp.listen(3196, "127.0.0.1", r))

const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [admin, owner] = await Promise.all([client("admin@example.com"), client("sso-o@example.com")])

/** One whole sign-in as a browser would do it; returns where it ended and the session cookie. */
async function signIn(email, { dropCookie = false, replay = false } = {}) {
  const start = await fetch(`${BASE}/api/v1/sso/start?email=${encodeURIComponent(email)}&next=/home`, { redirect: "manual" })
  if (start.status !== 302) return { status: start.status, text: await start.text() }
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0]
  const atIdp = await fetch(start.headers.get("location"), { redirect: "manual" })
  const back = atIdp.headers.get("location")
  const call = () => fetch(back, { redirect: "manual", headers: dropCookie ? {} : { cookie: stateCookie } })
  let done = await call()
  if (replay) done = await call()
  const session = (done.headers.get("set-cookie") ?? "").match(/next-auth\.session-token=[^;]+/)?.[0] ?? null
  return { status: done.status, location: done.headers.get("location"), session, text: done.status >= 400 ? await done.text() : "" }
}
const meWith = async (session) => (await fetch(`${BASE}/api/v1/me`, { headers: { cookie: session } })).json()

// ---------- setup: platform staff give the domains; the college connects its IdP
await admin("/admin/organizations", { body: { name: "Sso College", slug: "sso-college", type: "college", ownerEmail: "sso-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Sso Other", slug: "sso-other", type: "college", ownerEmail: "sso-o@example.com" } })
const orgId = psql(`select id from organizations where slug='sso-college'`)
const otherId = psql(`select id from organizations where slug='sso-other'`)
const connect = (over = {}) => owner("/orgs/sso-college/sso", { method: "PUT", body: { issuer: IDP, clientId: "gretlab-app", clientSecret: "college-secret", enabled: true, required: false, ...over } })
check("the college can't switch it on before GretLab confirms its domains", (await connect()).json?.error?.code === "no_domains")
check("public mail can never be a college's domain", (await admin(`/admin/organizations/${orgId}/sso-domains`, { method: "PUT", body: { domains: ["gmail.com"] } })).json?.error?.code === "bad_domain")
check("the college can't set its own domains", (await owner(`/admin/organizations/${orgId}/sso-domains`, { method: "PUT", body: { domains: ["sso-college.edu"] } })).status === 403)
check("platform staff give the domain", (await admin(`/admin/organizations/${orgId}/sso-domains`, { method: "PUT", body: { domains: ["SSO-College.edu"] } })).json?.domains?.[0] === "sso-college.edu")
check("one organization per domain", (await admin(`/admin/organizations/${otherId}/sso-domains`, { method: "PUT", body: { domains: ["sso-college.edu"] } })).json?.error?.code === "domain_taken")
check("a wrong issuer is refused when saving", (await connect({ issuer: "http://127.0.0.1:3196/elsewhere" })).status === 400)
const connected = await connect()
check("the college connects its identity provider", connected.status === 200, JSON.stringify(connected.json))
const settings = (await owner("/orgs/sso-college/sso")).json
check("the secret is never sent back, the redirect address is", settings?.hasSecret === true && !JSON.stringify(settings).includes("college-secret") && settings.redirectUri.endsWith("/api/v1/sso/callback"))
check("the secret is sealed at rest", !psql(`select client_secret from org_sso where org_id='${orgId}'`).includes("college-secret"))

// ---------- signing in
const first = await signIn("asha@sso-college.edu")
check("signing in sends them through the second step to where they were going", first.status === 303 && first.location?.includes("/sign-in/continue?next=%2Fhome") && Boolean(first.session), JSON.stringify(first).slice(0, 300))
const me = first.session ? await meWith(first.session) : null
check("a new account, signed in", me?.user?.email === "asha@sso-college.edu", JSON.stringify(me).slice(0, 200))
check("and an active member of the college", psql(`select status || ':' || joined_via from org_members where org_id='${orgId}' and user_id=(select id from users where email='asha@sso-college.edu')`) === "active:sso")
check("signing in is logged", psql(`select count(*) from audit_log where org_id='${orgId}' and action='sso.sign_in'`) === "1")
const again = await signIn("asha@sso-college.edu")
check("signing in again is the same account", again.status === 303 && psql(`select count(*) from users where email='asha@sso-college.edu'`) === "1")

// ---------- refusals
const refused = (r, code) => r.status >= 400 && r.status < 500 && r.text.includes("sso-error")
check("a sign-in finished in another browser (no state cookie) is refused", refused(await signIn("asha@sso-college.edu", { dropCookie: true })))
check("a sign-in used twice is refused", refused(await signIn("asha@sso-college.edu", { replay: true })))
signWith = rogue.privateKey
check("a token signed with another key is refused", refused(await signIn("asha@sso-college.edu")))
tamper = (c) => ({ ...c, aud: "another-app" })
check("a token for another app is refused", refused(await signIn("asha@sso-college.edu")))
tamper = (c) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 600 })
check("an expired token is refused", refused(await signIn("asha@sso-college.edu")))
tamper = (c) => ({ ...c, nonce: "someone-elses" })
check("a token for another sign-in (nonce) is refused", refused(await signIn("asha@sso-college.edu")))
nextIdentity = { email: "victim@example.com", name: "Not Theirs", sub: "idp-evil" }
tamper = (c) => ({ ...c, email: "victim@example.com" })
const takeover = await signIn("asha@sso-college.edu")
check("the IdP can't vouch for an address off the college's domains", refused(takeover) && takeover.text.includes("isn") , takeover.text.slice(0, 200))
nextIdentity = { email: "asha@sso-college.edu", name: "Asha Rao", sub: "idp-asha" }
check("an address with no college SSO is told so", (await signIn("someone@nowhere-college.edu")).status === 404)

// ---------- requiring it
await connect({ required: true, clientSecret: "" })
check("required: no password sign-up for its addresses", (await fetch(`${BASE}/api/v1/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: "ravi@sso-college.edu", name: "Ravi", password: "a-long-unusual-passphrase-42" }) }).then((r) => r.json())).error?.code === "use_sso")
check("required: no password reset for its addresses", (await fetch(`${BASE}/api/v1/auth/forgot`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: "asha@sso-college.edu" }) }).then((r) => r.json())).error?.code === "use_sso")
check("changes are logged, the secret only as changed", psql(`select count(*) from audit_log where org_id='${orgId}' and action='org.sso'`) >= "2" && !psql(`select string_agg(detail::text, ' ') from audit_log where org_id='${orgId}' and action='org.sso'`).includes("college-secret"))

// ---------- the pages
const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await page.goto(`${BASE}/sign-in`)
  await page.getByRole("button", { name: "Sign in with your college" }).click()
  await page.getByLabel("Your college email").fill("asha@sso-college.edu")
  await page.screenshot({ path: `${SHOTS}sso-sign-in.png` })
  await page.getByRole("button", { name: "Continue to your college" }).click()
  await page.waitForURL(/\/home/, { timeout: 30000 })
  check("signing in with the college from the sign-in page lands on the home", true)
  await page.goto(`${BASE}/sign-in`)
  await page.getByLabel("Email").first().fill("asha@sso-college.edu").catch(() => {})
  const p2 = await (await browser.newContext()).newPage()
  await p2.goto(`${BASE}/sign-in`)
  await p2.getByTestId("password-sign-in").getByLabel("Email", { exact: true }).fill("asha@sso-college.edu")
  await p2.getByTestId("password-sign-in").getByLabel("Password", { exact: true }).fill("whatever-password-1")
  await p2.getByTestId("password-sign-in").getByRole("button", { name: /Sign in/ }).click()
  await p2.getByText(/use Sign in with your college/).waitFor({ timeout: 15000 })
  check("required: a password sign-in is told to use the college", true)
  const o = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await o.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "sso-o@example.com" }, secret: SECRET }), url: BASE }])
  const op = await o.newPage()
  op.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await op.goto(`${BASE}/orgs/sso-college/manage/sso`)
  await op.getByTestId("sso-domains").waitFor({ timeout: 30000 })
  check("the college's page shows its confirmed domains", (await op.getByTestId("sso-domains").textContent()).includes("sso-college.edu"))
  await op.screenshot({ path: `${SHOTS}sso-settings.png`, fullPage: true })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  idp.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll single sign-on checks passed")
process.exit(failures ? 1 : 0)
