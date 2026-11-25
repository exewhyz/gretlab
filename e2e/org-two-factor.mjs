/**
 * An organization requiring two-factor sign-in of its staff or of everyone: only adding to the
 * platform's, never set by someone without it, and enforced like the platform's (everything but
 * the security page refused until it's on).
 *   node e2e/org-two-factor.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from organizations where slug like 'o2f-%'`)
  psql(`delete from users where email like 'o2f-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["o2f-o", "o2f-t", "o2f-s", "o2f-x"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
// Someone with two-factor on, who passed the second step just now.
const withTwoFactor = (h) => psql(`insert into two_factor(user_id, enabled_at, email_on) values ('${uid(h)}', now() - interval '1 hour', true) on conflict (user_id) do update set enabled_at = excluded.enabled_at, email_on = true`)
const client = async (email, extra = {}) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email, ...extra }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/settings", { method: "PATCH", body: { "security.require_2fa": "off" } })
await admin("/admin/organizations", { body: { name: "O2f School", slug: "o2f-school", type: "school", ownerEmail: "o2f-o@example.com" } })
const O = "/orgs/o2f-school"
const orgId = psql(`select id from organizations where slug='o2f-school'`)
for (const h of ["o2f-t", "o2f-s"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const ownerNo2fa = await client("o2f-o@example.com")
const teacherRole = (await ownerNo2fa(`${O}/roles`)).json.find((r) => r.systemKey === "teacher")
await ownerNo2fa(`${O}/members/${uid("o2f-t")}/roles`, { body: { roleId: teacherRole.id } })
const [teacher, student, outsider] = await Promise.all(["o2f-t", "o2f-s", "o2f-x"].map((h) => client(`${h}@example.com`)))

// ---------- who may require it
check("the owner can't require it without using it", (await ownerNo2fa(O, { method: "PATCH", body: { requireTwoFactor: "staff" } })).json?.error?.code === "two_factor_first")
withTwoFactor("o2f-o")
const owner = await client("o2f-o@example.com", { mfaAt: Date.now(), signedInAt: Date.now() })
check("with it on, the owner requires it of staff", (await owner(O, { method: "PATCH", body: { requireTwoFactor: "staff" } })).status === 200)
check("the setting shows, with the platform's beside it", (await owner(`${O}/manage`)).json?.org?.twoFactor?.required === "staff")

// ---------- enforced
const blocked = (r) => r.status === 403 && r.json?.error?.code === "two_factor_required"
check("staff without it are refused everything but their security page", blocked(await teacher("/me/notifications")) && (await teacher("/me/security")).status === 200)
check("a student isn't asked when only staff are", !blocked(await student("/me/notifications")))
check("someone outside the organization isn't affected", !blocked(await outsider("/me/notifications")))
await owner(O, { method: "PATCH", body: { requireTwoFactor: "everyone" } })
check("everyone: the student is asked too", blocked(await student("/me/notifications")))
withTwoFactor("o2f-s")
const studentDone = await client("o2f-s@example.com", { mfaAt: Date.now(), signedInAt: Date.now() })
check("once they've turned it on, they're through", !blocked(await studentDone("/me/notifications")))
check("the change is logged", psql(`select count(*) from audit_log where org_id='${orgId}' and action='org.settings' and detail::text like '%Two-factor%'`) >= "2")
await owner(O, { method: "PATCH", body: { requireTwoFactor: "off" } })
check("turned off, nobody is held back", !blocked(await teacher("/me/notifications")))

// ---------- the page
const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "o2f-o@example.com", mfaAt: Date.now(), signedInAt: Date.now() }, secret: SECRET }), url: BASE }])
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await p.goto(`${BASE}/orgs/o2f-school/manage/settings`)
  await p.getByTestId("two-factor-card").waitFor({ timeout: 30000 })
  await p.getByRole("radio", { name: "Staff: anyone with a role here" }).click()
  await p.getByTestId("two-factor-card").getByRole("button", { name: "Save" }).click()
  await p.getByText("Two-factor sign-in saved.").waitFor({ timeout: 15000 })
  check("saving from the page", psql(`select require_2fa from organizations where id='${orgId}'`) === "staff")
  await p.getByTestId("two-factor-card").screenshot({ path: `${SHOTS}o2f-card.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll organization two-factor checks passed")
process.exit(failures ? 1 : 0)
