/**
 * Limits by network address (packages/judge/src/rate-limits.ts, lib/api/rate-limit.ts):
 * password sign-in across accounts, sign-up, emailed links, LMS launches, and payments an
 * organization starts. Only an address the server can trust counts (here: Caddy's header with
 * the proxy secret); a header anyone could send is ignored. Past the limit: 429 with
 * Retry-After, or the sign-in page's message. Old windows are tidied by the cron.
 *   node e2e/rate-limits.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/rate-limits/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const PROXY_SECRET = "e2e-proxy-secret-0123456789"
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`
  )
  if (!ok) failures++
}
const psql = (q) =>
  execFileSync("docker", [
    "compose",
    "-f",
    ROOT + "docker-compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "gretlab",
    "-d",
    DB,
    "-Atqc",
    q,
  ])
    .toString()
    .trim()

// Addresses from a documentation range, one per check, so checks never share a count.
const from = (ip) => ({ "x-proxy-secret": PROXY_SECRET, "x-client-ip": ip })

/** Fills an action's count for a subject to `n`, in this window and the next (a check never straddles one). */
const fill = (action, subject, seconds, n) => {
  const ms = seconds * 1000
  const now = Math.floor(Date.now() / ms) * ms
  for (const start of [now, now + ms])
    psql(
      `insert into rate_limits (key, window_start, n) values ('${action}:${subject}', '${new Date(start).toISOString()}', ${n})
       on conflict (key, window_start) do update set n = ${n}`
    )
}

const cleanup = () => {
  psql(
    `delete from rate_limits where key like '%:192.0.2.%' or key like '%:198.51.100.%'`
  )
  psql(
    `delete from rate_limits where key like 'checkout:%' and key in (select 'checkout:' || id from organizations where slug like 'rl-%')`
  )
  psql(`delete from rate_limits where key = 'rl:old'`)
  psql(`delete from email_outbox where to_address like 'rl-%@example.com'`)
  psql(
    `delete from auth_tokens where user_id in (select id from users where email like 'rl-%@example.com')`
  )
  psql(`delete from organizations where slug like 'rl-%'`)
  psql(`delete from users where email like 'rl-%@example.com'`)
}
cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
psql(
  `insert into users(email,name,role) values ('rl-owner@example.com','Rl Owner','student')`
)

const as = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const anon = async (path, body, headers = {}) => {
  const res = await fetch(BASE + "/api/v1" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, ...headers },
    body: JSON.stringify(body),
  })
  return {
    status: res.status,
    json: await res.json().catch(() => null),
    retryAfter: res.headers.get("retry-after"),
  }
}
const admin = await as("admin@example.com")
const registration = psql(
  `select value from settings where key = 'registration.enabled'`
)
await admin("/admin/settings", {
  method: "PATCH",
  body: { "registration.enabled": true },
})

// ---------- emailed links: fifty an hour from one address, the last few counted for real
const A = from("192.0.2.10")
fill("email_link", "192.0.2.10", 3600, 47)
let last
for (let i = 0; i < 3; i++)
  last = await anon("/auth/forgot", { email: `rl-nobody${i}@example.com` }, A)
check(
  "up to fifty links asked for from one address are answered",
  last.status === 200 && last.json?.sent === true,
  JSON.stringify(last)
)
const eleventh = await anon(
  "/auth/resend",
  { email: "rl-nobody@example.com" },
  A
)
check(
  "the eleventh (forgot and resend count together) is refused, saying when to try again",
  eleventh.status === 429 &&
    eleventh.json?.error?.code === "too_many_requests" &&
    Number(eleventh.retryAfter) > 0 &&
    Number(eleventh.retryAfter) <= 3600,
  JSON.stringify(eleventh)
)
check(
  "another address isn't affected",
  (
    await anon(
      "/auth/forgot",
      { email: "rl-nobody@example.com" },
      from("192.0.2.11")
    )
  ).status === 200
)
check(
  "the same address claimed without the proxy's secret isn't believed, so isn't counted",
  (
    await anon(
      "/auth/forgot",
      { email: "rl-nobody@example.com" },
      { "x-client-ip": "192.0.2.10" }
    )
  ).status === 200
)

// ---------- sign-up: 200 new accounts an hour from one address (a cohort signing up together)
const B = from("192.0.2.20")
fill("sign_up", "192.0.2.20", 3600, 200)
const sixth = await anon(
  "/auth/sign-up",
  {
    name: "Rl Six",
    email: "rl-six@example.com",
    password: "a quiet harbour at dusk",
  },
  B
)
check(
  "past 200 accounts from one address in an hour, sign-up is refused",
  sixth.status === 429 && sixth.json?.error?.code === "too_many_requests",
  JSON.stringify(sixth)
)
check(
  "…and nothing is made",
  psql(`select count(*) from users where email = 'rl-six@example.com'`) === "0"
)
const fine = await anon(
  "/auth/sign-up",
  {
    name: "Rl Fine",
    email: "rl-fine@example.com",
    password: "a quiet harbour at dusk",
  },
  from("192.0.2.21")
)
check(
  "from another address it works",
  fine.status === 200 &&
    psql(`select count(*) from users where email = 'rl-fine@example.com'`) ===
      "1",
  JSON.stringify(fine)
)

// ---------- password sign-in: twenty tries an address in 15 minutes, whichever accounts
const signIn = async (email, password, headers) => {
  const csrf = await fetch(BASE + "/api/auth/csrf", { headers })
  const cookie = (csrf.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ")
  const { csrfToken } = await csrf.json()
  const res = await fetch(BASE + "/api/auth/callback/password", {
    method: "POST",
    redirect: "manual",
    headers: {
      ...headers,
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ email, password, csrfToken, json: "true" }),
  })
  const where =
    res.headers.get("location") ??
    (await res.json().catch(() => ({}))).url ??
    ""
  return new URL(where, BASE).searchParams.get("error")
}
// Only failures count: a right password from the same address leaves the count alone.
psql(
  `update users set email_verified_at = now() where email = 'rl-fine@example.com'`
)
fill("sign_in", "192.0.2.32", 900, 99)
check(
  "a right password signs in",
  (await signIn(
    "rl-fine@example.com",
    "a quiet harbour at dusk",
    from("192.0.2.32")
  )) === null
)
const counted = () =>
  psql(`select max(n) from rate_limits where key = 'sign_in:192.0.2.32'`)
check(
  "…and isn't counted, however many come from one lab",
  counted() === "99",
  counted()
)
check(
  "a wrong one is counted",
  (await signIn(
    "rl-fine@example.com",
    "wrong password here",
    from("192.0.2.32")
  )) === "wrong" && counted() === "100"
)
check(
  "past 100 failures, the next attempt is refused",
  (await signIn(
    "rl-fine@example.com",
    "a quiet harbour at dusk",
    from("192.0.2.32")
  )) === "busy"
)
psql(
  `update users set password_failures = 0 where email = 'rl-fine@example.com'`
)
fill("sign_in", "192.0.2.30", 900, 100)
check(
  "past 100 failed tries from one address, sign-in is refused before any password is checked",
  (await signIn(
    "rl-fine@example.com",
    "wrong password here",
    from("192.0.2.30")
  )) === "busy"
)
check(
  "…and the account's own count of wrong passwords didn't move",
  psql(
    `select password_failures from users where email = 'rl-fine@example.com'`
  ) === "0"
)
check(
  "from another address the usual answer comes back",
  (await signIn(
    "rl-fine@example.com",
    "wrong password here",
    from("192.0.2.31")
  )) === "wrong"
)

// ---------- LMS launches: 120 a minute from one address
fill("lti_login", "192.0.2.40", 60, 600)
const launch = await fetch(
  `${BASE}/api/v1/lti/login?iss=https://lms.example.com&login_hint=x&target_link_uri=${encodeURIComponent(BASE)}`,
  { headers: from("192.0.2.40"), redirect: "manual" }
)
check(
  "LMS launches past the limit get the error page, 429",
  launch.status === 429 && (await launch.text()).includes("Too many launches")
)

// ---------- payments: twenty orders an hour per organization
await admin("/admin/organizations", {
  body: {
    name: "Rl College",
    slug: "rl-college",
    type: "college",
    ownerEmail: "rl-owner@example.com",
  },
})
const orgId = psql(`select id from organizations where slug = 'rl-college'`)
const owner = await as("rl-owner@example.com")
const before = await owner("/orgs/rl-college/billing/checkout", {
  body: {
    features: ["coding"],
    students: 60,
    staff: 5,
    judges: 0,
    storagePacks: 0,
    period: "year",
  },
})
check(
  "under the limit, checkout goes on to its own checks",
  before.status !== 429,
  JSON.stringify(before.json)
)
fill("checkout", orgId, 3600, 20)
const flood = await owner("/orgs/rl-college/billing/checkout", {
  body: {
    features: ["coding"],
    students: 60,
    staff: 5,
    judges: 0,
    storagePacks: 0,
    period: "year",
  },
})
check(
  "past twenty orders an hour, an organization's checkout is refused",
  flood.status === 429 && flood.json?.error?.code === "too_many_requests",
  JSON.stringify(flood.json)
)

// ---------- tidying
psql(
  `insert into rate_limits (key, window_start, n) values ('rl:old', now() - interval '2 days', 3)`
)
await fetch(`${BASE}/api/cron/outbox`, {
  method: "POST",
  headers: { authorization: `Bearer ${CRON}` },
})
check(
  "windows over a day old are deleted by the cron",
  psql(`select count(*) from rate_limits where key = 'rl:old'`) === "0"
)

// ---------- the sign-in page says why
const browser = await chromium.launch()
for (const [name, viewport] of [
  ["laptop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  const ip = name === "laptop" ? "192.0.2.50" : "192.0.2.51"
  fill("sign_in", ip, 900, 100)
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: from(ip),
  })
  const tab = await context.newPage()
  await tab.goto(`${BASE}/sign-in`)
  await tab.getByLabel("Email", { exact: true }).fill("rl-fine@example.com")
  await tab.getByLabel("Password", { exact: true }).fill("wrong password here")
  await tab.getByRole("button", { name: "Sign in", exact: true }).click()
  const note = tab.getByText("Too many sign-in attempts from your network")
  await note.waitFor({ timeout: 20_000 }).catch(() => {})
  check(
    `${name}: the sign-in page says to wait, not that the password is wrong`,
    await note.isVisible()
  )
  await tab.screenshot({ path: `${SHOTS}sign-in-busy-${name}.png` })
  await context.close()
}
await browser.close()

await admin("/admin/settings", {
  method: "PATCH",
  body: {
    "registration.enabled":
      registration === "" ? true : JSON.parse(registration),
  },
})
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
