/**
 * Who hears about what: the platform's switches, an organization's within them, and a
 * person's own; email through the outbox to a fake provider this runs; the copy to a
 * class's other teachers; join requests; the weekly summary; the three settings pages.
 * The web app must run with RESEND_API_KEY, RESEND_API_URL=http://127.0.0.1:3198 and
 * CRON_SECRET (e2e/run.sh sets them).
 *   node e2e/notifications.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- a fake email provider (Resend's API shape)
let inbox = []
const provider = createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    const body = JSON.parse(raw)
    for (const m of Array.isArray(body) ? body : [body]) inbox.push({ to: m.to[0], subject: m.subject, text: m.text })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: [] }))
  })
})
await new Promise((r) => provider.listen(3198, "127.0.0.1", r))
/** Emails sent to this suite's people since the last call, once the outbox has settled. */
const mails = async () => {
  for (let i = 0; i < 40; i++) {
    await sleep(150)
    if (psql(`select count(*) from email_outbox where status in ('queued','sending') and to_address like 'ntf-%'`) === "0") break
  }
  const got = inbox.filter((m) => m.to.startsWith("ntf-"))
  inbox = []
  return got
}
const to = (list) => list.map((m) => m.to.split("@")[0]).sort().join(",")

const cleanup = () => {
  psql(`delete from email_outbox where to_address like 'ntf-%'`)
  psql(`delete from assignments where title like 'ntf %'`)
  psql(`delete from organizations where slug = 'ntftest'`)
  psql(`delete from users where email like 'ntf-%'`)
}
cleanup()
const platformBefore = psql(`select value from settings where key = 'notifications.policy'`)
psql(`delete from settings where key = 'notifications.policy'`)
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["ntf-o", "ntf-t1", "ntf-t2", "ntf-s1", "ntf-s2", "ntf-j"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = email ? `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}` : ""
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Ntf College", slug: "ntftest", type: "college", ownerEmail: "ntf-o@example.com" } })
const O = "/orgs/ntftest"
const orgId = psql(`select id from organizations where slug='ntftest'`)
const [owner, t1, t2, s1, s2, joiner] = await Promise.all(["ntf-o", "ntf-t1", "ntf-t2", "ntf-s1", "ntf-s2", "ntf-j"].map((h) => client(`${h}@example.com`)))
const lab = (await owner(`${O}/groups`, { body: { name: "ntf Lab" } })).json
for (const h of ["ntf-t1", "ntf-t2", "ntf-s1", "ntf-s2"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${lab.id}/members`, { body: { userIds: ["ntf-t1", "ntf-t2", "ntf-s1", "ntf-s2"].map(uid) } })
const teacherRole = (await owner(`${O}/roles`)).json.find((r) => r.systemKey === "teacher")
for (const h of ["ntf-t1", "ntf-t2"]) await owner(`${O}/members/${uid(h)}/roles`, { body: { roleId: teacherRole.id, groupId: lab.id } })

const N = `${O}/notifications`
const row = (view, event) => view.json.events.find((e) => e.event === event)
const notice = (text) => t1(`${O}/classes/${lab.id}/stream`, { body: { text } })
const bell = async (who, title) => (await who("/me/notifications")).json.notifications.filter((n) => n.title.includes(title) || n.body.includes(title)).length
const setOrg = (changes) => owner(N, { method: "PUT", body: changes })
const setPlatform = (changes) => admin("/admin/notifications", { method: "PUT", body: changes })

// ---------- who may manage
check("students can't see the organization's switches", [403, 404].includes((await s1(N)).status))
check("teachers can't change them", [403, 404].includes((await t1(N, { method: "PUT", body: {} })).status))
check("its owner can", (await owner(N)).json?.events.length === 11)
// A role with only notification management can manage them, nothing else in settings.
const comms = (await owner(`${O}/roles`, { body: { name: "Comms", permissions: ["org.notifications.manage"] } })).json
await owner(`${O}/members/${uid("ntf-t1")}/roles`, { body: { roleId: comms.id, groupId: null } })
check("a notifications-only role can open and save them", (await t1(N)).status === 200 && (await t1(N, { method: "PUT", body: {} })).status === 200)
check("...but can't change other organization settings", [403, 404].includes((await t1(O, { method: "PATCH", body: { description: "x" } })).status))
check("only platform staff see the platform's", (await owner("/admin/notifications")).status === 403 && (await admin("/admin/notifications")).status === 200)
check("an unknown event is refused", (await setOrg({ "made.up": { email: false } })).status === 400)
check("an unknown switch is refused", (await setOrg({ "class.notice": { sms: true } })).status === 400)
check("email is set up here", (await owner(N)).json.mail === true)

// ---------- defaults
await notice("first one")
check("by default students get the bell", (await bell(s1, "first one")) === 1 && (await bell(s2, "first one")) === 1)
let got = await mails()
check("...and the email; the teacher gets neither", to(got) === "ntf-s1,ntf-s2" && got[0].subject.startsWith("New notice in"), to(got))

// ---------- the platform decides first
await setPlatform({ "class.notice": { email: false } })
const locked = row(await owner(N), "class.notice")
check("what the platform turns off shows as locked to the organization", locked.locked.email === true && locked.locked.inApp === false, JSON.stringify(locked))
await setOrg({ "class.notice": { email: true, inApp: true, userChoice: true } })
await notice("platform off")
check("no organization can turn it back on: bell only", (await bell(s1, "platform off")) === 1 && to(await mails()) === "")
await setPlatform({})

// ---------- then the organization
await setOrg({ "class.notice": { email: false } })
check("only what's off is kept", JSON.stringify(psql(`select notifications from organizations where id='${orgId}'`)).includes("email") && row(await owner(N), "class.notice").own.email === false)
await notice("org off")
check("the organization turns the email off: bell only", (await bell(s2, "org off")) === 1 && to(await mails()) === "")
await setOrg({ "class.notice": { inApp: false } })
await notice("bell off")
check("...or the bell off: email only", (await bell(s2, "bell off")) === 0 && to(await mails()) === "ntf-s1,ntf-s2")
await setOrg({})

// ---------- then the person
const mine = "/me/notifications"
check("a student sees no staff events in their settings", !(await s1(`${mine}/settings`)).json.events.some((e) => e.audience === "staff"))
check("a teacher does", (await t2(`${mine}/settings`)).json.events.some((e) => e.event === "staff.assignment_published"))
await s1(mine, { method: "PATCH", body: { events: { "class.notice": false } } })
check("a student turns one event's email off", row(await s1(`${mine}/settings`), "class.notice").on === false)
await notice("opted out")
check("they keep the bell, lose the email; others unaffected", (await bell(s1, "opted out")) === 1 && to(await mails()) === "ntf-s2")
await setOrg({ "class.notice": { userChoice: false } })
const forced = row(await s1(`${mine}/settings`), "class.notice")
check("the organization takes the choice away: their settings say so", forced.canChoose === false && forced.alwaysIn.includes("Ntf College"), JSON.stringify(forced))
await notice("no choice")
check("...and everyone is emailed", to(await mails()) === "ntf-s1,ntf-s2")
await setOrg({})
await s1(mine, { method: "PATCH", body: { email: false, events: { "class.notice": true } } })
await notice("all email off")
check("all email off: not emailed", to(await mails()) === "ntf-s2")
check("an unknown event in someone's settings is refused", (await s1(mine, { method: "PATCH", body: { events: { nope: true } } })).status === 400)
await s1(mine, { method: "PATCH", body: { email: true } })

// ---------- a copy to the class's other teachers
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing = 'everyone' order by slug limit 1`)
const publish = (title) => t1(`${O}/assignments`, { body: { title, slug: title.replace(/ /g, "-"), description: "", opensAt: days(-1), dueAt: days(2), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [{ problemId: problem, points: 100, rubric: [], outcomes: [] }], questions: [] } })
check("a teacher publishes an assignment", (await publish("ntf lab one")).status === 200)
check("the class's other teacher gets a copy in the bell", (await bell(t2, "published the assignment ntf lab one")) === 1)
check("the publisher and the owner don't", (await bell(t1, "ntf lab one")) === 0 && (await bell(owner, "ntf lab one")) === 0)
got = await mails()
check("students are emailed; the copy isn't emailed unless asked for", to(got) === "ntf-s1,ntf-s2", to(got))
await t2(mine, { method: "PATCH", body: { events: { "staff.assignment_published": true } } })
await publish("ntf lab two")
got = await mails()
check("a teacher who asks for the copy by email gets it", to(got) === "ntf-s1,ntf-s2,ntf-t2", to(got))
await setOrg({ "staff.assignment_published": { inApp: false, email: false } })
await publish("ntf lab three")
check("the organization can stop the copies", (await bell(t2, "ntf lab three")) === 0 && to(await mails()) === "ntf-s1,ntf-s2")
await setOrg({})

// ---------- a request to join
check("someone asks to join", (await joiner(`${O}/join`, { body: { shareProgress: false } })).json?.status === "pending")
check("the owner hears about it", (await bell(owner, "asked to join Ntf College")) === 1 && (await bell(t1, "asked to join")) === 0)
check("...by email too", to(await mails()) === "ntf-o")

// ---------- the weekly summary
const cron = async () => (await fetch(`${BASE}/api/cron/outbox`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } })).json()
psql(`update organizations set digest_week = null where id = '${orgId}'`)
const ran = await cron()
got = (await mails()).filter((m) => m.subject.includes("weekly summary"))
check("the scheduler sends the week's summary to the owner", ran.digests?.organizations >= 1 && to(got) === "ntf-o", JSON.stringify(ran) + to(got))
check("it says what happened", /assignments or exams were published/.test(got[0]?.text ?? "") && /waiting for approval/.test(got[0]?.text ?? "") && /notices were posted/.test(got[0]?.text ?? ""), got[0]?.text)
await cron()
check("once a week only", (await mails()).filter((m) => m.subject.includes("weekly summary")).length === 0)
psql(`update organizations set digest_week = null where id = '${orgId}'`)
await setOrg({ "staff.weekly_digest": { email: false } })
await cron()
check("an organization can turn its summary off", (await mails()).filter((m) => m.subject.includes("weekly summary")).length === 0)
await setOrg({})
check("the scheduler's address needs its secret", (await fetch(`${BASE}/api/cron/outbox`, { method: "POST" })).status === 401)

// ---------- the record
const log = (await owner(`${O}/audit`)).json
check("changes are in the organization's activity log", log.some((e) => e.action === "notifications.update"))
check("...and the platform's", Number(psql(`select count(*) from audit_log where org_id is null and action = 'notifications.update'`)) >= 1)

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1280) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const ap = await page("admin@example.com")
await ap.goto(`${BASE}/admin/notifications`)
await ap.getByTestId("policy-class.notice").waitFor({ timeout: 30000 })
check("the platform's page lists every event", (await ap.locator('[data-testid^="policy-"]').count()) === 11)
await ap.screenshot({ path: SHOTS + "notifications-platform.png", fullPage: true })

await setPlatform({ "certificate.issued": { email: false } })
const op = await page("ntf-o@example.com")
await op.goto(`${BASE}${O}/manage/notifications`)
await op.getByTestId("policy-class.notice").waitFor({ timeout: 30000 })
check("the organization's page shows what the platform locked", (await op.getByTestId("policy-certificate.issued").innerText()).includes("Off for everyone"))
await op.getByLabel("Class notice: Email").click()
await op.getByRole("button", { name: "Save" }).click()
await op.getByText("Saved.").waitFor({ timeout: 15000 })
check("unticking and saving turns it off", row(await owner(N), "class.notice").own.email === false)
await op.screenshot({ path: SHOTS + "notifications-org.png", fullPage: true })
await setPlatform({})
await setOrg({ "class.notice": { userChoice: false } })

const sp = await page("ntf-s1@example.com", 390)
await sp.goto(`${BASE}/notifications`)
await sp.getByTestId("pref-class.notice").waitFor({ timeout: 30000 })
check("a person's page says what isn't theirs to choose", (await sp.getByTestId("pref-class.notice").innerText()).includes("Always emailed in Ntf College"))
await sp.getByLabel("Email me: Certificate").click()
await sp.waitForTimeout(800)
check("unticking an event saves at once", row(await s1(`${mine}/settings`), "certificate.issued").on === false)
check("no sideways scrolling on a phone", await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await sp.screenshot({ path: SHOTS + "notifications-mine.png", fullPage: true })
await browser.close()

cleanup()
if (platformBefore) psql(`insert into settings(key,value) values ('notifications.policy', '${platformBefore.replace(/'/g, "''")}'::jsonb) on conflict (key) do update set value = excluded.value`)
else psql(`delete from settings where key = 'notifications.policy'`)
provider.close()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
