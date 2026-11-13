/**
 * A cohort program: a cohort runs between dates (week N of M), each pod has its own mentor
 * (who is given the mentor role on the pod), the Progress page shows each learner's work,
 * attendance, last activity and early warning by pod, a mentor sees only their pod,
 * graduation issues a certificate once per learner, and the learner's home shows their
 * cohort, its week and their mentor. Kinds without runs refuse dates.
 *   node e2e/cohort.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('co-prog','co-school')`)
  psql(`delete from users where email like 'co-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["co-m1", "co-m2", "co-l1", "co-l2", "co-l3"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.replace("co-", "Co ").toUpperCase()}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10)
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Co Program", slug: "co-prog", type: "cohort", ownerEmail: "co-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Co School", slug: "co-school", type: "school", ownerEmail: "co-o@example.com" } })
const O = "/orgs/co-prog"
const orgId = psql(`select id from organizations where slug='co-prog'`)
const owner = await client("co-o@example.com")
const [m1, m2, l1, l3] = await Promise.all(["co-m1", "co-m2", "co-l1", "co-l3"].map((h) => client(`${h}@example.com`)))
for (const h of people) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
// Everyone starts as a plain member; mentors get their role when made a pod's mentor.
const memberRole = psql(`select id from org_roles where org_id='${orgId}' and system_key='member'`)
for (const h of people) psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid(h)}','${memberRole}')`)
const cohort = (await owner(`${O}/groups`, { body: { name: "Spring 2026" } })).json
const podA = (await owner(`${O}/groups`, { body: { name: "Pod A", parentId: cohort.id } })).json
const podB = (await owner(`${O}/groups`, { body: { name: "Pod B", parentId: cohort.id } })).json
await owner(`${O}/groups/${podA.id}/members`, { body: { userIds: [uid("co-l1"), uid("co-l2")] } })
await owner(`${O}/groups/${podB.id}/members`, { body: { userIds: [uid("co-l3")] } })

// ---------- dates and mentors
const run = (g, body, who = owner) => who(`${O}/groups/${g.id}/run`, { method: "PUT", body })
check("a run can't end before it starts", (await run(cohort, { startsOn: day(5), endsOn: day(1) })).status === 400)
check("...and needs both dates", (await run(cohort, { startsOn: day(1) })).status === 400)
// Started 15 days ago, twelve weeks long: week 3.
check("the cohort gets its dates", (await run(cohort, { startsOn: day(-15), endsOn: day(-15 + 83) })).status === 200)
check("a learner can't set them", [403, 404].includes((await run(cohort, { startsOn: null, endsOn: null }, l1)).status))
check("the mentor has to be a member", (await run(podA, { leadId: psql(`select id from users where email='admin@example.com'`) })).status === 400)
check("each pod gets its mentor", (await run(podA, { leadId: uid("co-m1") })).status === 200 && (await run(podB, { leadId: uid("co-m2") })).status === 200)
const mentorRoles = psql(`select r.name || ':' || coalesce(g.name,'-') from role_assignments a join org_roles r on r.id=a.role_id left join org_groups g on g.id=a.group_id where a.user_id='${uid("co-m1")}' and r.system_key='teacher'`)
check("...and is given the mentor role on their pod", mentorRoles === "Mentor:Pod A", mentorRoles)
await run(podA, { leadId: uid("co-m1") })
check("...once", psql(`select count(*) from role_assignments where user_id='${uid("co-m1")}'`) === "2")
check("setting them is in the log", Number(psql(`select count(*) from audit_log where org_id='${orgId}' and action='group.run'`)) >= 3)
const groups = (await owner(`${O}/groups`)).json
check("groups list their run and mentor", groups?.run?.dates === true && groups.run.leadTerm === "Mentor" && groups.groups.find((g) => g.id === podA.id)?.lead?.name === "CO M1" && groups.groups.find((g) => g.id === cohort.id)?.startsOn === day(-15), JSON.stringify(groups?.groups?.find((g) => g.id === podA.id)))
const schoolGroup = (await owner(`/orgs/co-school/groups`, { body: { name: "Grade 1" } })).json
check("a school's classes don't run between dates", (await owner(`/orgs/co-school/groups/${schoolGroup.id}/run`, { method: "PUT", body: { startsOn: day(0), endsOn: day(10) } })).json?.error?.code === "not_for_kind")
check("...nor have a lead per class (that's per year)", (await owner(`/orgs/co-school/groups/${schoolGroup.id}/run`, { method: "PUT", body: { leadId: null } })).json?.error?.code === "not_for_kind")
check("...and have no Progress page", (await owner(`/orgs/co-school/runs`)).status === 404)

// ---------- work, so progress has something to show
await owner(`${O}/assignments`, { body: { title: "Co Week 1", slug: "co-week-1", description: "", opensAt: new Date(Date.now() - 5 * 86400e3).toISOString(), dueAt: new Date(Date.now() - 86400e3).toISOString(), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[cohort.id]], problems: [], questions: [], projects: [{ title: "Landing page", instructions: "", points: 10 }] } })

// ---------- the runs
const runs = (await owner(`${O}/runs`)).json
const r0 = runs?.runs?.[0]
check("the program lists its cohort and where it is", r0?.name === "Spring 2026" && r0.state.status === "running" && r0.state.week === 3 && r0.state.weeks === 12 && r0.people === 3, JSON.stringify(r0))
check("...with its pods and their mentors", r0?.pods.map((p) => `${p.name}:${p.lead}:${p.people}`).join() === "Pod A:CO M1:2,Pod B:CO M2:1", JSON.stringify(r0?.pods))
const prog = (await owner(`${O}/runs/${cohort.id}`)).json
check("progress shows every learner, by pod", prog?.learners.map((l) => `${l.name}:${prog.pods.find((p) => p.id === l.pod)?.name}`).join() === "CO L1:Pod A,CO L2:Pod A,CO L3:Pod B", JSON.stringify(prog?.learners?.map((l) => [l.name, l.pod])))
check("...with work handed in of work due", prog?.learners.every((l) => l.done === 0 && l.due === 1), JSON.stringify(prog?.learners?.map((l) => [l.done, l.due])))
check("...and their early warnings", prog?.learners.every((l) => l.level === "watch" && l.reasons.includes("Missed an assignment")), JSON.stringify(prog?.learners?.[0]))
check("mentors aren't counted as learners", !prog?.learners.some((l) => l.email.startsWith("co-m")))
const mine = (await m1(`${O}/runs/${cohort.id}`)).json
check("a mentor sees only their pod", mine?.whole === false && mine.learners.map((l) => l.name).join() === "CO L1,CO L2" && mine.pods.map((p) => p.name).join() === "Pod A", JSON.stringify(mine?.learners?.map((l) => l.name)))
check("...and their list has just their cohort", (await m1(`${O}/runs`)).json?.runs?.length === 1)
check("a learner can't see progress", [403, 404].includes((await l1(`${O}/runs/${cohort.id}`)).status))

// ---------- graduation
const C = `${O}/classes/${cohort.id}/certificates`
check("a mentor can't graduate the whole cohort", [403, 404].includes((await m1(C, { body: { kind: "graduation", userIds: [uid("co-l1")] } })).status))
check("only people in it graduate", (await owner(C, { body: { kind: "graduation", userIds: [uid("co-m1")] } })).status === 400)
check("graduating issues certificates", (await owner(C, { body: { kind: "graduation", userIds: [uid("co-l1"), uid("co-l3")] } })).json?.issued === 2)
check("...once per learner", (await owner(C, { body: { kind: "graduation", userIds: [uid("co-l1")] } })).json?.issued === 0)
const cert = psql(`select title || '|' || detail from certificates where user_id='${uid("co-l1")}' and kind='graduation'`)
check("...naming the cohort and its dates", cert.startsWith("Spring 2026, Co Program|Completed the cohort,"), cert)
check("progress shows who graduated", (await owner(`${O}/runs/${cohort.id}`)).json?.learners.filter((l) => l.graduated).length === 2)
check("a school class can't graduate anyone", (await owner(`/orgs/co-school/classes/${schoolGroup.id}/certificates`, { body: { kind: "graduation", userIds: [uid("co-l1")] } })).status >= 400)

// ---------- homes
const home = (await l1(`${O}/home`)).json
const mr = home?.runs?.learning?.[0]
check("the learner's home has their cohort, week and mentor", mr?.name === "Spring 2026" && mr.state.week === 3 && mr.pod?.name === "Pod A" && mr.lead === "CO M1", JSON.stringify(home?.runs))
check("the mentor's home has the pods they lead", (await m1(`${O}/home`)).json?.runs?.leading.map((g) => g.name).join() === "Pod A")
check("a school's home has no runs", (await owner(`/orgs/co-school/home`)).json?.runs === null)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const o = await view("co-o@example.com", 1440)
await o.goto(`${BASE}${O}/manage/groups`)
await o.getByRole("button", { name: "Expand all" }).click({ timeout: 30000 })
check("the groups page shows each run and mentor", (await o.getByTestId("group-run").first().innerText()).includes("–") && (await o.getByTestId("group-lead").first().innerText()).includes("Mentor: CO M"))
await o.getByRole("button", { name: "Dates & mentor" }).nth(2).click()
await o.getByLabel("Mentor").selectOption({ label: "CO M2" })
await o.getByRole("button", { name: "Save" }).click()
await o.getByRole("dialog").waitFor({ state: "hidden" })
check("...and sets a pod's mentor from it", psql(`select u.email from org_groups g join users u on u.id=g.lead_id where g.id='${podB.id}'`) === "co-m2@example.com")
await o.goto(`${BASE}${O}/manage`)
const nav = o.getByRole("navigation", { name: "Organization" })
await nav.waitFor({ timeout: 30000 })
check("the program's nav has Progress", (await nav.innerText()).includes("Progress"))
await o.goto(`${BASE}${O}/manage/progress`)
await o.getByTestId("run-card").waitFor({ timeout: 30000 })
check("the Progress page shows the week", (await o.getByTestId("run-status").innerText()) === "Week 3 of 12")
await o.screenshot({ path: SHOTS + "cohort-runs.png", fullPage: true })
await o.getByRole("link", { name: "See progress" }).click()
await o.getByTestId("run-progress").waitFor({ timeout: 30000 })
await o.getByTestId("progress-row").first().waitFor()
check("a run's page lists its learners", (await o.getByTestId("progress-row").count()) === 3 && (await o.getByTestId("graduated").count()) === 2)
await o.getByLabel("Pod").selectOption({ label: "Pod B (CO M2)" })
check("...filtered by pod", (await o.getByTestId("progress-row").count()) === 1)
await o.getByLabel("Pod").selectOption({ index: 0 })
await o.getByRole("checkbox", { name: "Choose CO L2" }).click()
await o.getByRole("button", { name: "Graduate 1" }).click()
await o.getByText("1 graduated").waitFor({ timeout: 15000 })
check("...and graduates from it", psql(`select count(*) from certificates where kind='graduation' and source_id='${cohort.id}'`) === "3")
await o.screenshot({ path: SHOTS + "cohort-progress.png", fullPage: true })
const lp = await view("co-l1@example.com", 390)
await lp.goto(`${BASE}${O}`)
await lp.getByTestId("my-run").waitFor({ timeout: 30000 })
check("the learner's home shows week and mentor", (await lp.getByTestId("my-run-week").innerText()) === "Week 3 of 12" && (await lp.getByTestId("my-run-lead").innerText()).includes("Mentor: CO M1"))
check("...without scrolling sideways on a phone", await lp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await lp.screenshot({ path: SHOTS + "cohort-learner-home.png", fullPage: true })
const mp = await view("co-m1@example.com", 1440)
await mp.goto(`${BASE}${O}`)
await mp.getByTestId("leading-runs").waitFor({ timeout: 30000 })
await mp.getByTestId("leading-runs").getByRole("link").first().click()
await mp.getByTestId("run-progress").waitFor({ timeout: 30000 })
await mp.getByTestId("progress-row").first().waitFor()
check("the mentor goes from home to their pod's progress", (await mp.getByTestId("progress-row").count()) === 2)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
