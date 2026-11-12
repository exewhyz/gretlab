/**
 * The Transport module: off until switched on, refused for a company; routes with stops
 * (order of times, duplicate names), seats; assigning riders (scoped to a section, a stop
 * of another route, a full bus, moving stops), the rider and their parent told; changing a
 * route (fewer seats than riders, removing a used stop); a list of riders with a report;
 * taking off; removing a route; what a rider and a parent see; the audit; the page and its
 * dialogs, on a phone too.
 *   node e2e/transport.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug in ('trn-school','trn-co')`)
  psql(`delete from users where email like 'trn-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["trn-o", "trn-office", "trn-duty", "trn-s1", "trn-s2", "trn-s3", "trn-s4"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Trn School", slug: "trn-school", type: "school", ownerEmail: "trn-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Trn Co", slug: "trn-co", type: "company", ownerEmail: "trn-o@example.com" } })
const O = "/orgs/trn-school"
const orgId = psql(`select id from organizations where slug='trn-school'`)
const [owner, office, duty, s1] = await Promise.all(people.slice(0, 4).map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 6" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["trn-s1", "trn-s2"].map(uid) } })
await owner(`${O}/groups/${secB.id}/members`, { body: { userIds: ["trn-s3", "trn-s4"].map(uid) } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Transport office", permissions: ["transport.routes"] } })).json
const dutyRole = (await owner(`${O}/roles`, { body: { name: "Bus duty", permissions: ["transport.assign"] } })).json
await owner(`${O}/members/${uid("trn-office")}/roles`, { body: { roleId: officeRole.id } })
await owner(`${O}/members/${uid("trn-duty")}/roles`, { body: { roleId: dutyRole.id, groupId: secA.id } })
await owner(`${O}/parents`, { body: { studentId: uid("trn-s1"), email: "trn-parent@example.com" } })

// ---------- the module
check("a school has transport off until it's switched on", (await owner(`${O}/transport`)).status === 404)
check("a company can't switch it on", (await owner("/orgs/trn-co", { method: "PATCH", body: { modules: { transport: true } } })).json?.error?.code === "module_unavailable")
check("a school can", (await owner(O, { method: "PATCH", body: { modules: { transport: true } } })).status === 200)
check("a student doesn't run transport", (await s1(`${O}/transport`)).status === 403)

// ---------- routes
const R = (name, extra = {}) => ({ name, vehicle: "KA 01 AB 1234", driver: "Ravi", driverPhone: "98450 00000", capacity: 2, stops: [{ name: "Main Gate", pickup: "07:00", drop: "15:40" }, { name: "Market", pickup: "07:15", drop: "15:25" }, { name: "School", pickup: "07:40", drop: "15:00" }], ...extra })
check("pick-ups running backwards are refused", (await office(`${O}/transport`, { body: R("Route 1", { stops: [{ name: "A", pickup: "07:30" }, { name: "B", pickup: "07:00" }] }) })).json?.error?.code === "bad_stops")
check("a stop listed twice is refused", (await office(`${O}/transport`, { body: R("Route 1", { stops: [{ name: "A" }, { name: "a" }] }) })).json?.error?.code === "bad_stops")
check("a bad time is refused", (await office(`${O}/transport`, { body: R("Route 1", { stops: [{ name: "A", pickup: "7am" }] }) })).status === 400)
const r1 = (await office(`${O}/transport`, { body: R("Route 1") })).json
check("the transport office adds a route", r1?.stops.length === 3 && r1.capacity === 2 && r1.seatsLeft === 2, JSON.stringify(r1))
check("the same name twice is refused", (await office(`${O}/transport`, { body: R("route 1") })).json?.error?.code === "duplicate")
const r2 = (await office(`${O}/transport`, { body: R("Route 2", { capacity: null, stops: [{ name: "Lake View", pickup: "07:05" }] }) })).json
check("a route needn't limit seats", r2?.capacity === null && r2.seatsLeft === null)
check("bus duty can't add routes", (await duty(`${O}/transport`, { body: R("Route 9") })).status === 403)

// ---------- riders
const put = (who, h, route, stop) => who(`${O}/transport/riders`, { body: { userId: uid(h), routeId: route.id, stopId: stop.id } })
const [gate, market] = r1.stops
check("the office can't assign riders", (await put(office, "trn-s1", r1, gate)).status === 403)
check("bus duty puts a Section A student on a route", (await put(duty, "trn-s1", r1, gate)).status === 200)
check("...but not a Section B student", (await put(duty, "trn-s3", r1, gate)).status === 403)
check("a stop must be on the route", (await put(duty, "trn-s2", r1, r2.stops[0])).status === 404)
await put(duty, "trn-s2", r1, market)
const full = await put(owner, "trn-s3", r1, gate)
check("a full bus refuses another", full.status === 409 && full.json?.error?.code === "full", JSON.stringify(full.json))
check("moving a rider's stop doesn't count them twice", (await put(duty, "trn-s1", r1, market)).status === 200)
const told = (await s1("/me/notifications")).json.notifications
check("the rider is told", told.some((n) => n.kind === "transport" && n.title === "Your bus: Route 1, from Market"), JSON.stringify(told.map((n) => n.title)))
const parent = await client("trn-parent@example.com")
check("...and so is their parent", (await parent("/me/notifications")).json.notifications.some((n) => n.kind === "child_update" && n.title === "trn-s1 Name: Your bus: Route 1, from Gate".replace("Gate", "Market")))
const ownerRiders = (await owner(`${O}/transport/routes/${r1.id}/riders`)).json
check("the route lists its riders and stops", ownerRiders?.length === 2 && ownerRiders.every((r) => r.stopId === market.id))
check("bus duty sees its section's riders", (await duty(`${O}/transport/routes/${r1.id}/riders`)).json?.every((r) => r.canChange))
const ride = (await s1("/me/campus")).json.find((c) => c.slug === "trn-school")?.transport?.ride
check("the rider sees their bus on My classes", ride?.route === "Route 1" && ride.stop === "Market" && ride.pickup === "07:15" && ride.vehicle === "KA 01 AB 1234")
check("a parent sees it on their child's page", (await parent(`${O}/children/${uid("trn-s1")}`)).json?.campus?.transport?.ride?.stop === "Market")

// ---------- changing a route
const keep = r1.stops.map(({ id, name, pickup, drop }) => ({ id, name, pickup, drop }))
check("seats can't drop below riders", (await office(`${O}/transport/routes/${r1.id}`, { method: "PUT", body: R("Route 1", { capacity: 1, stops: keep }) })).json?.error?.code === "over_capacity")
check("a stop someone uses can't be removed", (await office(`${O}/transport/routes/${r1.id}`, { method: "PUT", body: R("Route 1", { stops: [keep[0], keep[2]] }) })).json?.error?.code === "stop_in_use")
const grown = (await office(`${O}/transport/routes/${r1.id}`, { method: "PUT", body: R("Route 1", { capacity: 3, stops: [keep[0], keep[1], { name: "Temple", pickup: "07:30", drop: "15:10" }, keep[2]] }) })).json
check("a route grows a stop and seats, riders kept", grown?.stops.length === 4 && grown.stops[1].id === market.id && grown.stops[1].riders === 2 && grown.seatsLeft === 1, JSON.stringify(grown))

// ---------- a list, taking off, removing
const imp = (await owner(`${O}/transport/riders/import`, { body: { rows: [
  { email: "trn-s3@example.com", route: "route 2", stop: "lake view" },
  { email: "trn-s4@example.com", route: "Route 7", stop: "x" },
  { email: "trn-s4@example.com", route: "Route 1", stop: "Nowhere" },
  { email: "nobody-trn@example.com", route: "Route 1", stop: "Market" },
] } })).json
check("a list places what it can and reports the rest", imp?.placed === 1 && imp.failed === 3 && imp.report.map((r) => r.line).join() === "2,3,4", JSON.stringify(imp))
check("bus duty takes a rider off", (await duty(`${O}/transport/riders/${uid("trn-s2")}`, { method: "DELETE" })).status === 200)
check("...not a Section B one", (await duty(`${O}/transport/riders/${uid("trn-s3")}`, { method: "DELETE" })).status === 403)
check("removing a route takes its riders off", (await office(`${O}/transport/routes/${r2.id}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from transport_riders where user_id='${uid("trn-s3")}'`) === "0")
const log = (await owner(`${O}/audit`)).json
check("transport is in the activity log", ["transport.route_add", "transport.route_edit", "transport.route_delete", "transport.assign", "transport.unassign", "transport.import"].every((a) => log.some((e) => e.action === a)))

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("trn-o@example.com")
await op.goto(`${BASE}${O}/manage/transport`)
await op.getByTestId("routes").waitFor({ timeout: 30000 })
check("the sidebar lists Transport under Campus", /CAMPUS[\s\S]*Transport/i.test(await op.locator('nav[aria-label="Organization"]').innerText()))
await op.getByRole("button", { name: "Add route" }).click()
const rd = op.getByRole("dialog", { name: "Add route" })
await rd.getByLabel("Route name").fill("Route 5")
await rd.getByLabel("Stop 1 name").fill("Clock Tower")
await rd.getByLabel("Stop 1 pick-up").fill("07:10")
await rd.getByRole("button", { name: "Add stop" }).click()
await rd.getByLabel("Stop 2 name").fill("School")
await rd.getByRole("button", { name: "Save" }).click()
await op.getByTestId("route").filter({ hasText: "Route 5" }).waitFor({ timeout: 15000 }).catch(() => {})
check("a route is added from its dialog", psql(`select count(*) from transport_stops s join transport_routes r on r.id=s.route_id where r.name='Route 5'`) === "2")
await op.getByTestId("route").filter({ hasText: "Route 5" }).getByRole("button", { name: "Riders" }).click()
const rr = op.getByRole("dialog", { name: "Riders of Route 5" })
await rr.getByLabel("Find a member").fill("trn-s4")
await rr.getByRole("button", { name: /trn-s4 Name/ }).click()
await rr.getByTestId("rider").first().waitFor({ timeout: 15000 }).catch(() => {})
check("a rider is added from the riders dialog", (await rr.getByTestId("rider").filter({ hasText: "trn-s4 Name" }).count()) === 1)
await op.screenshot({ path: SHOTS + "transport.png", fullPage: true })
await rr.getByRole("button", { name: "Done" }).click()
const sp = await page("trn-s4@example.com")
await sp.goto(`${BASE}/classes`)
await sp.getByTestId("campus-bus").waitFor({ timeout: 30000 }).catch(() => {})
check("My classes shows the student's bus", (await sp.getByTestId("campus-bus").innerText().catch(() => "")).includes("Route 5, from Clock Tower"))
const phone = await page("trn-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/transport`)
await phone.getByTestId("routes").waitFor({ timeout: 30000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
psql(`delete from users where email = 'trn-parent@example.com'`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
