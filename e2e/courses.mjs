/**
 * Courses: written once (platform or college) as modules of library problems and
 * questions, shared like the library, given to classes from a start day; modules open by
 * their rules; students practise in them; teachers see how far students are.
 *   node e2e/courses.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

const cleanup = () => {
  psql(`delete from courses where title like 'crs %'`)
  psql(`delete from practice_answers where question_id in (select id from questions where title like 'crs %')`)
  psql(`delete from content_shares where item_id in (select id from questions where title like 'crs %')`)
  psql(`delete from questions where title like 'crs %'`)
  psql(`delete from organizations where slug like 'crstest-%'`)
  psql(`delete from users where email like 'crs-%'`)
}
cleanup()
for (const email of ["crs-a@example.com", "crs-b@example.com", "crs-s1@example.com"]) {
  const h = email.split("@")[0]
  psql(`insert into users(email,name,role,handle) values ('${email}','${h}','student','${h}')`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [admin, a, b, s1] = await Promise.all(["admin@example.com", "crs-a@example.com", "crs-b@example.com", "crs-s1@example.com"].map(client))
for (const [slug, owner] of [["crstest-a", "crs-a@example.com"], ["crstest-b", "crs-b@example.com"]]) {
  await admin("/admin/organizations", { body: { name: `Crs ${slug.slice(-1).toUpperCase()} College`, slug, type: "college", ownerEmail: owner } })
}
const A = "/orgs/crstest-a", B = "/orgs/crstest-b"
const orgA = psql(`select id from organizations where slug='crstest-a'`)
const lab = (await a(`${A}/groups`, { body: { name: "crs Lab" } })).json
const labB = (await b(`${B}/groups`, { body: { name: "crs Lab B" } })).json
check("colleges and a class to teach", !!lab?.id && !!labB?.id, JSON.stringify(lab).slice(0, 120))
psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgA}', id, 'active', 'created' from users where email='crs-s1@example.com'`)
const studentId = psql(`select id from users where email='crs-s1@example.com'`)
await a(`${A}/groups/${lab.id}/members`, { body: { userIds: [studentId] } })

// ---------- the platform writes a course
const question = (title, extra = {}) => ({ title, kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1, ...extra })
const q1 = (await admin("/admin/questions", { body: question("crs Warm-up") })).json.id
const q2 = (await admin("/admin/questions", { body: question("crs Later") })).json.id
const written = (await admin("/admin/questions", { body: { title: "crs Essay", kind: "written", prompt: "Explain.", points: 2 } })).json.id
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only order by slug limit 1`)
const draftProblem = psql(`insert into problems(slug,title,level,statement,description,published) values ('crs-draft-${Date.now()}','crs Draft','easy','[]','x',false) returning id`).split("\n")[0]
const course = await admin("/admin/courses", { body: { title: "crs Python basics", description: "Week by week.", published: true } })
check("the platform creates a course", course.status === 200 && course.json.sharing === "everyone", JSON.stringify(course.json).slice(0, 150))
const C = course.json.id
const outline = (modules, expected) => admin(`/admin/courses/${C}/outline`, { method: "PUT", body: { modules, expectedUpdatedAt: expected } })
check("a course holds only practice: no drafts", (await outline([{ title: "M", items: [{ kind: "problem", id: draftProblem }] }])).json?.error?.code === "not_practice")
check("and no questions that need marking", (await outline([{ title: "M", items: [{ kind: "question", id: written }] }])).json?.error?.code === "needs_marking")
const saved = await outline([
  { title: "Start here", items: [{ kind: "question", id: q1 }] },
  { title: "First problem", afterPrevious: true, items: [{ kind: "problem", id: problem }] },
  { title: "Week two", openAfterDays: 7, items: [{ kind: "question", id: q2 }] },
])
check("writes an outline of modules", saved.status === 200 && saved.json.modules.length === 3 && saved.json.modules[1].afterPrevious === true, JSON.stringify(saved.json).slice(0, 200))
check("a stale outline is refused", (await outline([], "2020-01-01T00:00:00.000Z")).json?.error?.code === "edited_elsewhere")
const reordered = await outline([saved.json.modules[0], saved.json.modules[1], { ...saved.json.modules[2], title: "Week two (renamed)" }].map((m) => ({ ...m, items: m.items.map(({ kind, id }) => ({ kind, id })) })), saved.json.updatedAt)
check("modules keep their ids when edited", reordered.json?.modules?.[2]?.id === saved.json.modules[2].id && reordered.json.modules[2].title === "Week two (renamed)")

// ---------- sharing
const titlesFor = async (api, org) => ((await api(`${org}/courses`)).json ?? []).map((c) => c.title)
check("every college sees a platform course by default", (await titlesFor(a, A)).includes("crs Python basics") && (await titlesFor(b, B)).includes("crs Python basics"))
await admin("/admin/library/sharing", { method: "PUT", body: { items: [{ kind: "course", id: C }], sharing: "selected", orgIds: [orgA] } })
check("shared with chosen colleges, only they see it", (await titlesFor(a, A)).includes("crs Python basics") && !(await titlesFor(b, B)).includes("crs Python basics"))
check("others can't open it or give it", (await b(`${B}/courses/${C}`)).status === 404 && (await b(`${B}/classes/${labB.id}/courses`, { body: { courseId: C, startsOn: day(0) } })).status === 404)

// ---------- a college's own course
const own = await a(`${A}/courses`, { body: { title: "crs A's own", published: false } })
check("a college writes its own course", own.status === 200 && own.json.sharing === "owner")
check("other colleges never see it", (await b(`${B}/courses/${own.json.id}`)).status === 404 && !(await titlesFor(b, B)).includes("crs A's own"))
check("a draft course can't be given to a class", (await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: own.json.id, startsOn: day(0) } })).json?.error?.code === "draft_course")
const sharingBefore = psql(`select sharing from problems where id='${problem}'`)
psql(`update problems set sharing='owner' where id='${problem}'`)
check("public library problems go in any course, shared or not", (await a(`${A}/courses/${own.json.id}/outline`, { method: "PUT", body: { modules: [{ title: "M", items: [{ kind: "problem", id: problem }] }] } })).status === 200)
psql(`update problems set sharing='${sharingBefore}' where id='${problem}'`)
check("students can't write courses", (await s1(`${A}/courses`, { body: { title: "crs Nope" } })).status === 403)

// ---------- a class takes the course
check("students can't give courses", (await s1(`${A}/classes/${lab.id}/courses`, { body: { courseId: C, startsOn: day(-2) } })).status === 403)
check("a teacher gives the class a course from a day", (await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: C, startsOn: day(-2) } })).status === 200)
const view = async (api = s1) => (await api(`${A}/classes/${lab.id}/courses`)).json
let mine = await view()
let mods = mine.courses[0]?.modules ?? []
check("the student sees the course", mine.courses.length === 1 && mods.length === 3)
check("the first module is open with its items", mods[0].open && mods[0].items.length === 1 && !!mine.questions[q1])
check("one after the module before waits for it", !mods[1].open && mods[1].waiting === "previous" && mods[1].items.length === 0)
check("one on a later day waits for the day", !mods[2].open && mods[2].waiting === "date" && mods[2].opensOn === day(5) && !mine.questions[q2])
check("the right answer isn't sent before answering", mine.questions[q1].solution === null && !JSON.stringify(mine).includes('"correct":["a"]'))
check("a question in a closed module can't be answered", (await s1(`${A}/classes/${lab.id}/practice`, { body: { questionId: q2, answer: ["a"] } })).status === 404)
const wrong = await s1(`${A}/classes/${lab.id}/practice`, { body: { questionId: q1, answer: ["b"] } })
check("a wrong answer: marked, no answer shown yet", wrong.status === 200 && wrong.json.correct === false && wrong.json.solution === null)
const right = await s1(`${A}/classes/${lab.id}/practice`, { body: { questionId: q1, answer: ["a"] } })
check("trying again: right, with the explanation", right.json?.correct === true && right.json.solution?.correct?.[0] === "a" && right.json.tries === 2)
mods = (await view()).courses[0].modules
check("finishing a module opens the next", mods[0].done === 1 && mods[1].open && mods[1].items[0]?.href?.startsWith("/problems/"))
const teacherView = await view(a)
check("the teacher sees every module and who finished", teacherView.teacher && teacherView.courses[0].modules[2].items.length === 1 && teacherView.courses[0].modules[0].finishedBy === 1 && teacherView.students === 1)
check("outsiders don't see the class", (await b(`${A}/classes/${lab.id}/courses`)).status === 404)
await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: C, startsOn: day(-10) } })
check("moving the start day opens dated modules", (await view()).courses[0].modules[2].open === true)

// ---------- copies and deleting
const copy = await a(`${A}/courses/${C}/copy`, { body: {} })
const copied = (await a(`${A}/courses/${copy.json?.id}`)).json
check("a college copies a shared course to change it", copy.status === 200 && copied?.editable && !copied.published && copied.modules.length === 3 && copied.copiedFrom === C)
check("it can't change the platform's", (await a(`${A}/courses/${C}/outline`, { method: "PUT", body: { modules: [] } })).status === 404)
check("a course a class uses can't be deleted", (await admin(`/admin/courses/${C}`, { method: "DELETE" })).json?.error?.code === "course_in_use")
check("the student's work stays when the course comes off", (await a(`${A}/classes/${lab.id}/courses/${C}`, { method: "DELETE" })).status === 200 && psql(`select correct from practice_answers where question_id='${q1}'`) === "t")
check("then it can be deleted", (await admin(`/admin/courses/${C}`, { method: "DELETE" })).status === 200)

// ---------- the pages
await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: copy.json.id, startsOn: day(-2) } }).then(() => a(`${A}/courses/${copy.json.id}`, { method: "PUT", body: { title: "crs Python basics (ours)", published: true } }))
await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: copy.json.id, startsOn: day(-2) } })
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const editor = await open("crs-a@example.com")
await editor.goto(`${BASE}${A}/manage/courses/${copy.json.id}`)
await editor.getByTestId("course-module").first().waitFor({ timeout: 30000 })
check("the course page lists its modules", (await editor.getByTestId("course-module").count()) === 3)
await editor.getByRole("button", { name: "Add module" }).click()
const dialog = editor.getByTestId("module-dialog")
await dialog.getByLabel("Module name").fill("Practice set")
await dialog.getByLabel("Search problems and questions").fill("crs Later")
await dialog.getByRole("button", { name: "Add crs Later" }).click()
await editor.waitForTimeout(300)
await editor.screenshot({ path: SHOTS + "course-module.png", fullPage: true })
await dialog.getByRole("button", { name: "Done" }).click()
await editor.getByRole("button", { name: "Move Practice set up" }).click()
await editor.getByRole("button", { name: "Save outline" }).click()
await editor.getByText("Outline saved.").waitFor({ timeout: 15000 }).catch(async () => { await editor.screenshot({ path: SHOTS + "course-save-failed.png", fullPage: true }); console.log("FAIL  saving the outline:", await editor.getByRole("alert").allInnerTexts().catch(() => [])); failures++ })
const after = (await a(`${A}/courses/${copy.json.id}`)).json
check("adding and reordering modules from the page", after.modules.length === 4 && after.modules[2].title === "Practice set" && after.modules[2].items[0]?.id === q2, after.modules.map((m) => m.title).join(" | "))
await editor.screenshot({ path: SHOTS + "course-editor.png", fullPage: true })

const student = await open("crs-s1@example.com")
await student.goto(`${BASE}${A}/classes/${lab.id}?tab=course`)
await student.getByTestId("class-module").first().waitFor({ timeout: 30000 })
await student.getByTestId("class-module").first().getByRole("button").first().click()
await student.getByTestId("daily-question").first().waitFor({ timeout: 15000 })
check("the student practises on the class page", (await student.getByTestId("daily-question").first().innerText()).includes("crs Warm-up"))
await student.waitForTimeout(300)
await student.screenshot({ path: SHOTS + "class-course-student.png", fullPage: true })
const teacher = await open("crs-a@example.com")
await teacher.goto(`${BASE}${A}/classes/${lab.id}?tab=course`)
await teacher.getByTestId("class-module").first().waitFor({ timeout: 30000 })
check("the teacher sees progress per module", (await teacher.getByTestId("class-module").first().innerText()).includes("1 of 1 finished"))
await teacher.screenshot({ path: SHOTS + "class-course-teacher.png", fullPage: true })
await browser.close()

psql(`delete from problems where slug like 'crs-draft-%'`)
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
