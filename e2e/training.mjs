/**
 * Assigned training in a company: a course assigned to a department with a due date and
 * yearly renewal; each employee's status (to do, due soon, overdue, done, expiring,
 * expired); renewal makes old work stop counting; a manager sees only their team; reminders
 * to the bell; certificates that expire with the renewal; the employee's and manager's
 * homes; kinds without the module don't have it.
 *   node e2e/training.mjs [base-url] [screenshot-dir]
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
  psql(`delete from courses where title like 'tr %'`)
  psql(`delete from practice_answers where question_id in (select id from questions where title like 'tr %')`)
  psql(`delete from questions where title like 'tr %'`)
  psql(`delete from organizations where slug in ('tr-co','tr-school')`)
  psql(`delete from users where email like 'tr-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["tr-mgr", "tr-e1", "tr-e2", "tr-e3"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.replace("tr-", "Tr ").toUpperCase()}','student','${h}')`)
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
await admin("/admin/organizations", { body: { name: "Tr Company", slug: "tr-co", type: "company", ownerEmail: "tr-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Tr School", slug: "tr-school", type: "school", ownerEmail: "tr-o@example.com" } })
const O = "/orgs/tr-co"
const orgId = psql(`select id from organizations where slug='tr-co'`)
const owner = await client("tr-o@example.com")
const [mgr, e1, e2, e3] = await Promise.all(people.map((h) => client(`${h}@example.com`)))
const memberRole = psql(`select id from org_roles where org_id='${orgId}' and system_key='member'`)
for (const h of people) {
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
  psql(`insert into role_assignments(org_id,user_id,role_id) values ('${orgId}','${uid(h)}','${memberRole}')`)
}
const eng = (await owner(`${O}/groups`, { body: { name: "Engineering" } })).json
const platform = (await owner(`${O}/groups`, { body: { name: "Platform", parentId: eng.id } })).json
const apps = (await owner(`${O}/groups`, { body: { name: "Apps", parentId: eng.id } })).json
await owner(`${O}/groups/${platform.id}/members`, { body: { userIds: [uid("tr-e1"), uid("tr-e2")] } })
await owner(`${O}/groups/${apps.id}/members`, { body: { userIds: [uid("tr-e3")] } })
await owner(`${O}/groups/${platform.id}/run`, { method: "PUT", body: { leadId: uid("tr-mgr") } })
// A one-question course: "tr Security basics".
const q = (await owner(`${O}/questions`, { body: { title: "tr Q", kind: "single", prompt: "Lock your screen when you leave?", options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }], correct: ["a"], points: 1 } })).json.id
const course = (await owner(`${O}/courses`, { body: { title: "tr Security basics", published: true } })).json
await owner(`${O}/courses/${course.id}/outline`, { method: "PUT", body: { modules: [{ title: "Basics", items: [{ kind: "question", id: q }] }] } })
const course2 = (await owner(`${O}/courses`, { body: { title: "tr Code of conduct", published: true } })).json
await owner(`${O}/courses/${course2.id}/outline`, { method: "PUT", body: { modules: [{ title: "Read", items: [{ kind: "question", id: q }] }] } })

// ---------- modules by kind
const opts = (await owner(`${O}/manage`)).json?.org
check("a company has assigned training from the start", opts?.modules.includes("training") && opts.moduleOptions.find((o) => o.key === "training")?.level === "default", JSON.stringify(opts?.moduleOptions))
check("a school doesn't have it", (await owner(`/orgs/tr-school/training`)).status === 404 && !(await owner(`/orgs/tr-school/manage`)).json?.org.moduleOptions.some((o) => o.key === "training"))

// ---------- assigning
const assign = (body, who = owner) => who(`${O}/training`, { body })
check("a due date can't be in the past", (await assign({ courseId: course.id, groupId: eng.id, dueOn: day(-1), renewMonths: 12 })).status === 400)
check("an employee can't assign training", [403, 404].includes((await assign({ courseId: course.id, groupId: platform.id, dueOn: null, renewMonths: null }, e1)).status))
const made = await assign({ courseId: course.id, groupId: eng.id, dueOn: day(3), renewMonths: 12 })
check("the L&D admin assigns a course to a department, due in 3 days, renewed yearly", made.status === 200 && made.json?.people.length === 3, JSON.stringify(made.json).slice(0, 300))
check("...and everyone in its teams is due soon", made.json?.people.every((p) => p.status === "due" && p.needBy === day(3)), JSON.stringify(made.json?.people?.map((p) => [p.name, p.status, p.team])))
check("...each with their own team", made.json?.people.map((p) => `${p.name}:${p.team}`).join() === "TR E1:Platform,TR E2:Platform,TR E3:Apps")
await assign({ courseId: course2.id, groupId: platform.id, dueOn: day(10), renewMonths: null })
psql(`update course_classes set due_on='${day(-2)}' where course_id='${course2.id}'`)
check("assigning is in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action='training.assign'`) === "2")

// ---------- doing it
await e1(`${O}/classes/${platform.id}/practice`, { body: { questionId: q, answer: ["a"] } })
const detail = async (who = owner, c = course, g = eng) => (await who(`${O}/training/${g.id}/${c.id}`)).json
const d1 = await detail()
const p1 = d1?.people.find((p) => p.name === "TR E1")
check("finishing it makes it done, valid for a year", p1?.status === "done" && p1.completedOn === day(0) && p1.validUntil?.slice(0, 4) === String(Number(day(0).slice(0, 4)) + 1), JSON.stringify(p1))
check("...and the others are still due", d1?.counts.due === 2 && d1.counts.done === 1, JSON.stringify(d1?.counts))
const d2 = await detail(owner, course2, platform)
check("past its due date, it's overdue (and the same answer counts for both courses)", d2?.people.find((p) => p.name === "TR E2")?.status === "overdue" && d2.people.find((p) => p.name === "TR E1")?.status === "done", JSON.stringify(d2?.people?.map((p) => [p.name, p.status])))

// ---------- the list and the manager's team view
const list = (await owner(`${O}/training`)).json
check("the list counts each training's people by status", list?.trainings.length === 2 && list.trainings.find((t) => t.courseId === course2.id)?.counts.overdue === 1, JSON.stringify(list?.trainings?.map((t) => t.counts)))
const ml = (await mgr(`${O}/training`)).json
check("a manager sees their team's part of the department's training", ml?.trainings.find((t) => t.courseId === course.id)?.people === 2 && ml.trainings.find((t) => t.courseId === course.id)?.whole === false, JSON.stringify(ml?.trainings))
check("...and its people, not other teams'", (await detail(mgr))?.people.map((p) => p.name).join() === "TR E1,TR E2")
check("an employee can't see others' training", [403, 404].includes((await e1(`${O}/training/${eng.id}/${course.id}`)).status))

// ---------- reminders
const reminded = (await mgr(`${O}/training/${eng.id}/${course.id}/remind`, { body: {} })).json
check("a manager reminds those not done in their team", reminded?.reminded === 1, JSON.stringify(reminded))
check("...to their bell", psql(`select count(*) from notifications where user_id='${uid("tr-e2")}' and kind='training_due'`) === "1" && psql(`select count(*) from notifications where user_id='${uid("tr-e3")}' and kind='training_due'`) === "0")
const bell = (await e2(`/me/notifications`)).json
check("the bell also lists training that's overdue or due soon", bell?.reminders?.filter((r) => r.kind === "training_due").length === 2, JSON.stringify(bell).slice(0, 400))

// ---------- certificates that expire
const issued = (await owner(`${O}/classes/${eng.id}/certificates`, { body: { kind: "course", courseId: course.id } })).json
check("certifying issues one to whoever finished", issued?.issued === 1)
const cert = psql(`select code || '|' || coalesce(expires_on,'') from certificates where user_id='${uid("tr-e1")}' and source_id='${course.id}'`)
const [code, expires] = cert.split("|")
check("...valid until the renewal", expires === p1?.validUntil, cert)
const pub = await (await fetch(`${BASE}/certificates/${code}`)).text()
check("its public page says until when", pub.includes("Valid until"))
check("...and the training shows it", (await detail())?.people.find((p) => p.name === "TR E1")?.certificate === code)
check("certifying again doesn't make another", (await owner(`${O}/classes/${eng.id}/certificates`, { body: { kind: "course", courseId: course.id } })).json?.issued === 0)

// ---------- renewal
psql(`update practice_answers set answered_at = now() - interval '13 months' where user_id='${uid("tr-e1")}' and question_id='${q}'`)
const r1 = (await detail())?.people.find((p) => p.name === "TR E1")
check("work older than the renewal stops counting: it's to be done again", r1?.status === "due" && r1.progress.done === 0, JSON.stringify(r1))
const cls = (await e1(`${O}/classes/${platform.id}/courses`)).json
check("...and the course asks the question afresh", cls?.questions[q]?.answer === null && cls.courses.find((c) => c.id === course.id)?.dueOn === day(3), JSON.stringify(cls?.questions?.[q]))
check("...but the course without renewal still counts it", (await detail(owner, course2, platform))?.people.find((p) => p.name === "TR E1")?.status === "done")
await e1(`${O}/classes/${platform.id}/practice`, { body: { questionId: q, answer: ["a"] } })
check("answering again renews it", (await detail())?.people.find((p) => p.name === "TR E1")?.status === "done")
psql(`update certificates set expires_on='${day(-1)}' where code='${code}'`)
check("an expired certificate says so", (await (await fetch(`${BASE}/certificates/${code}`)).text()).includes("Expired on"))
check("...and a new one can be issued", (await owner(`${O}/classes/${eng.id}/certificates`, { body: { kind: "course", courseId: course.id } })).json?.issued === 1)

// ---------- homes
const h1 = (await e1(`${O}/home`)).json
check("the employee's home lists their training, done and until when", h1?.training?.mine?.length === 2 && h1.training.mine.every((t) => t.status === "done") && h1.training.mine.some((t) => t.validUntil), JSON.stringify(h1?.training))
const h2 = (await e2(`${O}/home`)).json
check("...overdue first", h2?.training?.mine?.[0]?.status === "overdue" && h2.training.mine[1]?.status === "due", JSON.stringify(h2?.training?.mine?.map((t) => t.status)))
const hm = (await mgr(`${O}/home`)).json
check("the manager's home has their team's training", hm?.training?.team?.assigned === 4 && hm.training.team.late === 1, JSON.stringify(hm?.training?.team))

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const o = await view("tr-o@example.com", 1440)
await o.goto(`${BASE}${O}/manage/training`)
await o.getByTestId("training-row").first().waitFor({ timeout: 30000 })
check("the Training page lists what's assigned", (await o.getByTestId("training-row").count()) === 2)
check("...and what's late", (await o.getByTestId("training-tile-overdue").innerText()).includes("1"))
await o.screenshot({ path: SHOTS + "training-list.png", fullPage: true })
await o.getByRole("button", { name: "Assign training" }).click()
await o.getByLabel("Course").selectOption({ label: "tr Code of conduct" })
await o.getByRole("button", { name: "Assign to" }).click()
await o.getByRole("option", { name: /Apps/ }).click()
await o.getByLabel("Renewal").selectOption("12")
await o.getByRole("button", { name: "Assign", exact: true }).click()
await o.getByTestId("training-detail").waitFor({ timeout: 30000 })
check("assigning from the page opens the training", psql(`select renew_months from course_classes where course_id='${course2.id}' and group_id='${apps.id}'`) === "12")
await o.goto(`${BASE}${O}/manage/training/${eng.id}/${course.id}`)
await o.getByTestId("training-person").first().waitFor({ timeout: 30000 })
check("a training's page lists each person", (await o.getByTestId("training-person").count()) === 3)
await o.getByLabel("Show").selectOption("done")
check("...filtered by status", (await o.getByTestId("training-person").count()) === 1)
await o.screenshot({ path: SHOTS + "training-detail.png", fullPage: true })
const ep = await view("tr-e2@example.com", 390)
await ep.goto(`${BASE}${O}`)
await ep.getByTestId("my-training").waitFor({ timeout: 30000 })
check("the employee's home shows their training", (await ep.getByTestId("my-training-item").count()) === 2 && (await ep.getByTestId("my-training").innerText()).includes("Overdue"))
check("...without scrolling sideways on a phone", await ep.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await ep.screenshot({ path: SHOTS + "training-employee-home.png", fullPage: true })
const mp = await view("tr-mgr@example.com", 1440)
await mp.goto(`${BASE}${O}`)
await mp.getByTestId("team-training").waitFor({ timeout: 30000 })
check("the manager's home shows their team's training", (await mp.getByTestId("team-late").innerText()) === "1 late")
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
