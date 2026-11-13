/**
 * A community: members have a home before joining any group, find open groups and join or
 * leave them themselves (closed ones only through a moderator); a group's moderator runs
 * its events; events for everyone or one group, places and a waitlist (the last place
 * goes to one person even when many ask at once), the online link only for people going,
 * dropping out moves the waitlist up, changes and cancellations reach people coming, the
 * calendar and the bell; kinds without open groups or events don't have them.
 *   node e2e/community.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('cm-club','cm-school','cm-co')`)
  psql(`delete from users where email like 'cm-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["cm-mod", "cm-a", "cm-b", "cm-c", "cm-x1", "cm-x2", "cm-x3", "cm-x4", "cm-x5"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.replace("cm-", "Cm ").toUpperCase()}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Cm Club", slug: "cm-club", type: "community", ownerEmail: "cm-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Cm School", slug: "cm-school", type: "school", ownerEmail: "cm-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Cm Co", slug: "cm-co", type: "company", ownerEmail: "cm-o@example.com" } })
const O = "/orgs/cm-club"
const orgId = psql(`select id from organizations where slug='cm-club'`)
const owner = await client("cm-o@example.com")
const [mod, a, b, c, ...xs] = await Promise.all(people.map((h) => client(`${h}@example.com`)))
const memberRole = psql(`select id from org_roles where org_id='${orgId}' and system_key='member'`)
for (const h of people) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
  psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid(h)}','${memberRole}')`)
}
const rust = (await owner(`${O}/groups`, { body: { name: "Rust" } })).json
const web = (await owner(`${O}/groups`, { body: { name: "Web" } })).json
const core = (await owner(`${O}/groups`, { body: { name: "Core team" } })).json

// ---------- groups
const set = (g, body, who = owner) => who(`${O}/groups/${g.id}/run`, { method: "PUT", body })
check("a group is opened to join", (await set(rust, { open: true, leadId: uid("cm-mod") })).status === 200 && (await set(web, { open: true })).status === 200)
check("...and its moderator gets the Moderator role on it", psql(`select r.name || ':' || g.name from role_assignments x join org_roles r on r.id=x.role_id join org_groups g on g.id=x.group_id where x.user_id='${uid("cm-mod")}'`) === "Moderator:Rust")
const schoolGroup = (await owner(`/orgs/cm-school/groups`, { body: { name: "Grade 1" } })).json
check("a school's classes can't be opened to join", (await owner(`/orgs/cm-school/groups/${schoolGroup.id}/run`, { method: "PUT", body: { open: true } })).json?.error?.code === "not_for_kind")
check("...and it has no open groups", (await owner(`/orgs/cm-school/open-groups`)).status === 404)
const home0 = (await a(`${O}/home`)).json
check("a member in no group still has a home, pointing to groups", home0?.views?.includes("student") && home0.openGroups === true, JSON.stringify(home0?.views))
const og = (await a(`${O}/open-groups`)).json
check("members see the open groups, not closed ones", og?.groups.map((g) => g.name).join() === "Rust,Web" && og.groups[0].lead === "CM MOD", JSON.stringify(og?.groups))
check("they join one", (await a(`${O}/open-groups/${rust.id}`, { method: "POST" })).json?.groups.find((g) => g.id === rust.id)?.mine === true)
check("...and joining twice is fine", (await a(`${O}/open-groups/${rust.id}`, { method: "POST" })).status === 200 && psql(`select count(*) from group_members where group_id='${rust.id}'`) === "1")
check("a closed group can't be joined", (await a(`${O}/open-groups/${core.id}`, { method: "POST" })).status === 403)
await a(`${O}/open-groups/${web.id}`, { method: "POST" })
check("they leave one", (await a(`${O}/open-groups/${web.id}`, { method: "DELETE" })).json?.groups.find((g) => g.id === web.id)?.mine === false)
check("joining and leaving are in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action in ('group.join','group.leave')`) === "3")
check("a non-member can't join", (await (await client("admin@example.com"))(`${O}/open-groups/${rust.id}`, { method: "POST" })).status !== 200)

// ---------- events
const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
const ev = (title, extra) => ({ title, description: "", startsAt: at(48), endsAt: at(50), location: "", link: "https://meet.example.com/rust", capacity: null, groupId: rust.id, ...extra })
check("a community has events from the start", (await owner(`${O}/manage`)).json?.org.modules.includes("events"))
check("a company can have them, but they're off until it switches them on", (await owner(`/orgs/cm-co/events`)).status === 404 && (await owner(`/orgs/cm-co/manage`)).json?.org.moduleOptions.some((o) => o.key === "events" && o.level === "optional"))
check("an event needs a place or a link", (await mod(`${O}/events`, { body: ev("No place", { link: "" }) })).status === 400)
check("...and to end after it starts", (await mod(`${O}/events`, { body: ev("Backwards", { endsAt: at(47) }) })).status === 400)
check("a member can't make events", (await a(`${O}/events`, { body: ev("Mine") })).status === 403)
check("a moderator can't make one for everyone", (await mod(`${O}/events`, { body: ev("All", { groupId: null }) })).status === 403)
const night = (await mod(`${O}/events`, { body: ev("Rust night", { capacity: 2 }) })).json
check("a moderator makes one for their group", !!night?.id && night.canManage)
const meetup = (await owner(`${O}/events`, { body: ev("Club meetup", { groupId: null, link: "", location: "Hall A", startsAt: at(5), endsAt: at(7) }) })).json
check("the owner makes one for everyone", !!meetup?.id)
check("events are in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action='event.create'`) === "2")
const seen = async (who) => (await who(`${O}/events`)).json?.events.map((e) => e.title).join()
check("a group's member sees its events and everyone's", (await seen(a)) === "Club meetup,Rust night", await seen(a))
check("others see only everyone's", (await seen(b)) === "Club meetup" && (await b(`${O}/events/${night.id}`)).status === 404)
await b(`${O}/open-groups/${rust.id}`, { method: "POST" })
await c(`${O}/open-groups/${rust.id}`, { method: "POST" })
check("...until they join the group", (await seen(b)) === "Club meetup,Rust night")

// ---------- places
const rsvp = (who, id, going) => who(`${O}/events/${id}/rsvp`, { method: "PUT", body: { going } })
const r1 = (await rsvp(a, night.id, true)).json
check("going takes a place, and shows the online link", r1?.mine === "going" && r1.link === "https://meet.example.com/rust")
await rsvp(b, night.id, true)
const r3 = (await rsvp(c, night.id, true)).json
check("when it's full, people wait", r3?.mine === "waitlist" && r3.full === true && r3.link === null, JSON.stringify(r3))
check("...and the moderator sees who's coming", (await mod(`${O}/events/${night.id}`)).json?.people.map((p) => `${p.name}:${p.status}`).join() === "CM A:going,CM B:going,CM C:waitlist")
check("members don't", (await a(`${O}/events/${night.id}`)).json?.people === null)
const cal = (await a(`/me/calendar`)).json
check("going puts it on their calendar", cal?.events?.some((e) => e.kind === "event" && e.title === "Rust night"), JSON.stringify(cal?.events?.map((e) => e.kind)))
await rsvp(a, night.id, false)
check("dropping out moves the longest waiting up", psql(`select status from event_rsvps where event_id='${night.id}' and user_id='${uid("cm-c")}'`) === "going")
check("...and tells them", psql(`select count(*) from notifications where user_id='${uid("cm-c")}' and kind='event_place'`) === "1")
// The last place, asked for by five people at once.
const last = (await owner(`${O}/events`, { body: ev("One seat", { groupId: null, capacity: 1 }) })).json
await Promise.all(xs.map((x) => rsvp(x, last.id, true)))
check("the last place goes to one person, however many ask at once", psql(`select count(*) filter (where status='going') || '/' || count(*) filter (where status='waitlist') from event_rsvps where event_id='${last.id}'`) === "1/4")
const grown = await owner(`${O}/events/${last.id}`, { method: "PUT", body: ev("One seat", { groupId: null, capacity: 3 }) })
check("more places move the waitlist up, in order", grown.json?.going === 3 && grown.json.waiting === 2, JSON.stringify(grown.json))

// ---------- reminders, changes, cancelling
await rsvp(a, meetup.id, true)
check("the bell reminds them of an event that's coming soon", (await a(`/me/notifications`)).json?.reminders.some((r) => r.kind === "event_soon"))
await owner(`${O}/events/${meetup.id}`, { method: "PUT", body: ev("Club meetup", { groupId: null, link: "", location: "Hall B", startsAt: at(5), endsAt: at(7) }) })
check("moving it tells everyone coming", psql(`select count(*) from notifications where user_id='${uid("cm-a")}' and kind='event_update'`) === "1")
check("a member can't cancel it", (await a(`${O}/events/${meetup.id}`, { method: "DELETE" })).status === 404)
await owner(`${O}/events/${meetup.id}`, { method: "DELETE" })
check("cancelling tells them too", psql(`select count(*) from notifications where user_id='${uid("cm-a")}' and kind='event_update'`) === "2")
check("...it stays listed, marked cancelled", (await a(`${O}/events`)).json?.events.find((e) => e.id === meetup.id)?.cancelled === true)
check("...and nobody can say they're going", (await rsvp(b, meetup.id, true)).status === 409)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const x = await view("cm-x5@example.com", 390)
await x.goto(`${BASE}${O}`)
await x.getByTestId("find-a-group").waitFor({ timeout: 30000 })
check("a new member's home points to the groups", true)
await x.getByRole("link", { name: "Browse groups" }).click()
await x.getByTestId("open-group").first().waitFor({ timeout: 30000 })
await x.getByRole("button", { name: "Join Rust" }).click()
await x.getByRole("button", { name: "Leave Rust" }).waitFor({ timeout: 15000 })
check("they join a group from the page", psql(`select count(*) from group_members where group_id='${rust.id}' and user_id='${uid("cm-x5")}'`) === "1")
check("...without scrolling sideways on a phone", await x.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await x.screenshot({ path: SHOTS + "community-groups.png", fullPage: true })
await x.goto(`${BASE}${O}/events/${night.id}`)
await x.getByTestId("event-page").waitFor({ timeout: 30000 })
await x.getByRole("button", { name: "Join the waitlist" }).click()
await x.getByText("You're on the waitlist").waitFor({ timeout: 15000 })
check("they join the waitlist from the event's page", psql(`select status from event_rsvps where event_id='${night.id}' and user_id='${uid("cm-x5")}'`) === "waitlist")
await x.screenshot({ path: SHOTS + "community-event.png", fullPage: true })
const m = await view("cm-mod@example.com", 1440)
await m.goto(`${BASE}${O}/events`)
await m.getByRole("button", { name: "New event" }).click({ timeout: 30000 })
await m.getByLabel("Title").fill("Cm Borrow checker clinic")
await m.getByLabel("Starts").fill("2030-01-10T18:00")
await m.getByLabel("Ends").fill("2030-01-10T20:00")
await m.getByLabel("Place", { exact: true }).fill("Lab 3")
await m.getByLabel("Places").fill("10")
await m.getByRole("button", { name: "Create event" }).click()
await m.getByText("Cm Borrow checker clinic").waitFor({ timeout: 15000 })
check("a moderator makes an event from the page", psql(`select capacity || ':' || (group_id='${rust.id}') from org_events where title='Cm Borrow checker clinic'`) === "10:true")
await m.screenshot({ path: SHOTS + "community-events.png", fullPage: true })
await m.goto(`${BASE}${O}/events/${night.id}`)
await m.getByTestId("attendee").first().waitFor({ timeout: 30000 })
check("...and sees who's coming", (await m.getByTestId("attendee").count()) === 3)
const ah = await view("cm-a@example.com", 1440)
await ah.goto(`${BASE}${O}`)
await ah.getByTestId("upcoming-events").waitFor({ timeout: 30000 })
check("a member's home lists events", (await ah.getByTestId("event-card").count()) >= 1)
const nav = ah.getByRole("navigation", { name: "Organization" })
check("...and the sidebar has Groups and Events", (await nav.innerText()).includes("Events") && (await nav.innerText()).includes("Groups"))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
