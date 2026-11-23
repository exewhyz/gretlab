/**
 * Plans and billing (features/billing; rules in packages/judge/src/billing.ts).
 *   - Billing off (the default): new organizations have no plan limits, as before
 *   - Billing on: a new organization starts on the free plan (core and the coding lab); modules
 *     outside it are off and can't be switched on, and features outside it are refused where
 *     they start (LMS, API keys, courses, lab exams, outcomes)
 *   - a plan that holds a feature allows it; organizations from before billing keep everything
 *   node e2e/billing.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 1500)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q]).toString().trim()
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const cleanup = () => {
  psql(`delete from organizations where slug like 'bl-%'`)
  psql(`delete from users where email like 'bl-%@example.com'`)
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role) values ('bl-old@example.com','Bl Old','student'), ('bl-new@example.com','Bl New','student')`)
const admin = await client("admin@example.com")
const settings = (body) => admin("/admin/settings", { method: "PATCH", body })

// ---------- billing off: nothing changes
await settings({ "billing.enabled": false })
await admin("/admin/organizations", { body: { name: "Bl Old College", slug: "bl-old", type: "college", ownerEmail: "bl-old@example.com" } })
const old = await client("bl-old@example.com")
check("with billing off, a new organization has no plan limits", psql(`select coalesce(plan_features::text, 'none') || '|' || s.status from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-old'`) === "none|custom")
check("…and its modules work as before", (await old("/orgs/bl-old", { method: "PATCH", body: { modules: { attendance: true } } })).status === 200)

// ---------- billing on: new organizations start free
await settings({ "billing.enabled": true })
await admin("/admin/organizations", { body: { name: "Bl New College", slug: "bl-new", type: "college", ownerEmail: "bl-new@example.com" } })
const fresh = await client("bl-new@example.com")
check("with billing on, a new organization starts on the free plan", psql(`select plan_features::text || '|' || s.status || '|' || s.students from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-new'`) === `["core", "coding"]|free|50`)
const summary = (await fresh("/orgs/bl-new/manage")).json
const attendance = summary?.org?.moduleOptions?.find((m) => m.key === "attendance")
check("Settings lists a module outside the plan as not in it", attendance?.inPlan === false && summary?.org?.moduleOptions?.find((m) => m.key === "coding")?.inPlan === true, JSON.stringify(summary?.org?.moduleOptions))
const switched = await fresh("/orgs/bl-new", { method: "PATCH", body: { modules: { attendance: true } } })
check("…and it can't be switched on until it's bought", switched.status === 403 && switched.json?.error?.code === "not_in_plan", JSON.stringify(switched.json))
check("modules outside the plan are off (attendance answers 404)", (await fresh("/orgs/bl-new/attendance")).status === 404)
const refused = async (path) => {
  const r = await fresh(path)
  return r.status === 403 && r.json?.error?.code === "not_in_plan"
}
check("an LMS can't be connected without LTI in the plan", await refused("/orgs/bl-new/lti"))
check("API keys and webhooks need them in the plan", await refused("/orgs/bl-new/integrations"))
check("courses need them in the plan", await refused("/orgs/bl-new/courses"))
const outcomesSave = await fresh("/orgs/bl-new/outcomes", { method: "PUT", body: { outcomes: [], rules: { threshold: 60, levels: [50, 60, 70] } } })
check("outcomes need them in the plan", outcomesSave.json?.error?.code === "not_in_plan", JSON.stringify(outcomesSave))

// A plan that holds them allows them (staff set plans by hand until paying is built).
psql(`update organizations set plan_features = '["core","coding","lti","api","courses"]'::jsonb where slug = 'bl-new'`)
check("with LTI, API access and courses in the plan, they work", (await fresh("/orgs/bl-new/lti")).status === 200 && (await fresh("/orgs/bl-new/integrations")).status === 200 && (await fresh("/orgs/bl-new/courses")).status === 200)
check("…and attendance, not bought, is still off", (await fresh("/orgs/bl-new", { method: "PATCH", body: { modules: { attendance: true } } })).json?.error?.code === "not_in_plan")

// ---------- organizations from before billing keep everything
check("an organization from before billing keeps everything with billing on", (await old("/orgs/bl-old/lti")).status === 200 && (await old("/orgs/bl-old/integrations")).status === 200)

await settings({ "billing.enabled": false })
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
