/**
 * Course checkpoints: a module's quiz, lab and project, attached while writing the course,
 * taken by a class's students (one attempt, timed or not), lab problems scored by graded
 * submissions during the attempt, projects handed in and marked, and the course grade; and
 * readings: lesson pages written in the course, read in order and marked as completed.
 *   node e2e/course-checkpoints.mjs [base-url] [screenshot-dir]
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
  psql(`delete from submissions where user_id in (select id from users where email like 'ckp-%')`)
  psql(`delete from courses where title like 'ckp %'`)
  psql(`delete from questions where title like 'ckp %'`)
  psql(`delete from organizations where slug like 'ckptest-%'`)
  psql(`delete from users where email like 'ckp-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const email of ["ckp-a@example.com", "ckp-b@example.com", "ckp-s1@example.com", "ckp-s2@example.com"]) {
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
const [admin, a, b, s1, s2] = await Promise.all(["admin@example.com", "ckp-a@example.com", "ckp-b@example.com", "ckp-s1@example.com", "ckp-s2@example.com"].map(client))
for (const [slug, owner] of [["ckptest-a", "ckp-a@example.com"], ["ckptest-b", "ckp-b@example.com"]]) {
  await admin("/admin/organizations", { body: { name: `Ckp ${slug.slice(-1).toUpperCase()} College`, slug, type: "college", ownerEmail: owner } })
}
const A = "/orgs/ckptest-a", B = "/orgs/ckptest-b"
const orgA = psql(`select id from organizations where slug='ckptest-a'`)
const lab = (await a(`${A}/groups`, { body: { name: "ckp Lab" } })).json
check("a college and a class", !!lab?.id, JSON.stringify(lab).slice(0, 120))
const ids = {}
for (const who of ["s1", "s2"]) {
  ids[who] = psql(`select id from users where email='ckp-${who}@example.com'`)
  psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgA}','${ids[who]}','active','created')`)
}
await a(`${A}/groups/${lab.id}/members`, { body: { userIds: [ids.s1, ids.s2] } })

// ---------- writing checkpoints
const question = (title) => ({ title, kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1 })
const q1 = (await admin("/admin/questions", { body: question("ckp One") })).json.id
const q2 = (await admin("/admin/questions", { body: question("ckp Two") })).json.id
const essay = (await admin("/admin/questions", { body: { title: "ckp Essay", kind: "written", prompt: "Explain.", points: 2 } })).json.id
const problem = psql(`select id from problems where org_id is null and published and listed and not members_only order by slug limit 1`)
const course = (await admin("/admin/courses", { body: { title: "ckp Course", published: true } })).json
const C = course.id
const outline = (modules) => admin(`/admin/courses/${C}/outline`, { method: "PUT", body: { modules } })
const quiz = { kind: "quiz", title: "Quiz – Basics", instructions: "Two quick ones.", timeLimit: 30, weight: 1, items: [{ id: q1, points: 5 }, { id: q2, points: 5 }] }
const labCp = { kind: "lab", title: "Lab – Basics", timeLimit: null, weight: 1, items: [{ id: problem, points: 100 }] }
const project = { kind: "project", title: "Project – Basics", instructions: "Build **something**.", weight: 2, points: 20 }
check("a quiz takes only questions that mark themselves", (await outline([{ title: "M", checkpoints: [{ ...quiz, items: [{ id: essay, points: 2 }] }] }])).json?.error?.code === "needs_marking")
check("a quiz or lab needs items", (await outline([{ title: "M", checkpoints: [{ ...quiz, items: [] }] }])).status === 400)
check("one of each kind per module", (await outline([{ title: "M", checkpoints: [quiz, quiz] }])).status === 400)
const intro = { kind: "reading", title: "ckp Intro", body: "## What a program is\n\nA list of steps." }
check("a reading needs a title", (await outline([{ title: "M", items: [{ ...intro, title: " " }] }])).status === 400)
const saved = await outline([{ title: "Basics", items: [intro, { kind: "question", id: q1 }], checkpoints: [quiz, labCp, project] }])
const R = saved.json?.modules?.[0]?.items?.[0]
check("a module holds a reading written in the course", R?.kind === "reading" && !!R.id && R.body === intro.body, JSON.stringify(R).slice(0, 150))
const cps = saved.json?.modules?.[0]?.checkpoints ?? []
check("a module carries a quiz, a lab and a project", saved.status === 200 && cps.map((c) => c.kind).join() === "quiz,lab,project" && cps[0].max === 10 && cps[2].max === 20, JSON.stringify(saved.json).slice(0, 200))
const resaved = await outline([{ id: saved.json.modules[0].id, title: "Basics", items: [{ ...intro, id: R.id, body: intro.body + "\n\nAnd more." }, { kind: "question", id: q1 }], checkpoints: [{ ...quiz, title: "Quiz – renamed" }, labCp, project] }])
check("editing a reading keeps its id", resaved.json?.modules?.[0]?.items?.[0]?.id === R.id && resaved.json.modules[0].items[0].body.endsWith("And more."))
check("checkpoints keep their ids across saves", resaved.json?.modules?.[0]?.checkpoints?.[0]?.id === cps[0].id && resaved.json.modules[0].checkpoints[0].title === "Quiz – renamed")
const [QZ, LB, PJ] = cps.map((c) => c.id)

// ---------- a class takes them
await a(`${A}/classes/${lab.id}/courses`, { body: { courseId: C, startsOn: day(-1) } })
const cp = (api, id) => api(`${A}/classes/${lab.id}/courses/${C}/checkpoints/${id}`)
const act = (api, id, what, opts) => api(`${A}/classes/${lab.id}/courses/${C}/checkpoints/${id}/${what}`, opts ?? { body: {} })
let mod = (await s1(`${A}/classes/${lab.id}/courses`)).json.courses[0].modules[0]
check("the module shows its checkpoints and counts them", mod.checkpoints.length === 3 && mod.total === 5 && mod.checkpoints[0].state === "not_started")
const readingPath = `${A}/classes/${lab.id}/courses/${C}/readings/${R.id}`
check("the Course tab links the reading to its page", mod.items[0]?.href === `/orgs/ckptest-a/classes/${lab.id}/courses/${C}/readings/${R.id}` && mod.items[0].body === undefined)
const reading = (await s1(readingPath)).json
check("a student reads it, with the next step", reading?.reading?.body?.includes("What a program is") && reading.next?.id === q1 && reading.previous === null && reading.done === false)
check("outsiders can't read it", (await b(readingPath)).status === 404)
await s1(`${readingPath}/done`, { method: "PUT", body: { done: true } })
let afterRead = (await s1(`${A}/classes/${lab.id}/courses`)).json.courses[0].modules[0]
check("marking it read counts toward the module", afterRead.done === 1 && afterRead.items[0].done === true)
await s1(`${readingPath}/done`, { method: "PUT", body: { done: false } })
check("and it can be unmarked", (await s1(readingPath)).json?.done === false)
await s1(`${readingPath}/done`, { method: "PUT", body: { done: true } })
const before = await cp(s1, QZ)
check("before starting, the questions aren't sent", before.status === 200 && before.json.quiz === null && before.json.state === "not_started")
check("answers can't be saved before starting", (await act(s1, QZ, "answers", { method: "PUT", body: { answers: { [q1]: ["a"] } } })).json?.error?.code === "not_started")
await act(s1, QZ, "start")
const running = await cp(s1, QZ)
check("starting shows the questions with a deadline", running.json?.state === "running" && running.json.quiz.length === 2 && !!running.json.attempt?.endsAt)
check("right answers aren't sent while it runs", running.json.quiz.every((q) => q.result === null) && !JSON.stringify(running.json).includes('"correct":["a"]'))
await act(s1, QZ, "start")
check("starting again keeps the same attempt", psql(`select count(*) from course_attempts where checkpoint_id='${QZ}' and user_id='${ids.s1}'`) === "1")
await act(s1, QZ, "answers", { method: "PUT", body: { answers: { [q1]: ["a"], [q2]: ["b"], [essay]: "sneaky" } } })
check("answers save, only for the quiz's questions", psql(`select count(*) from course_quiz_answers where checkpoint_id='${QZ}' and user_id='${ids.s1}'`) === "2")
await act(s1, QZ, "finish")
const done = await cp(s1, QZ)
check("finishing marks it, with the right answers", done.json?.state === "finished" && done.json.earned === 5 && done.json.quiz[0].result?.correct?.[0] === "a")
check("no changes after finishing", (await act(s1, QZ, "answers", { method: "PUT", body: { answers: { [q2]: ["a"] } } })).json?.error?.code === "attempt_over")
// s2 runs out of time with nothing saved.
await act(s2, QZ, "start")
psql(`update course_attempts set started_at=now()-interval '40 minutes', ends_at=now()-interval '10 minutes' where checkpoint_id='${QZ}' and user_id='${ids.s2}'`)
check("out of time: answers are refused", (await act(s2, QZ, "answers", { method: "PUT", body: { answers: { [q1]: ["a"] } } })).json?.error?.code === "attempt_over")
check("and it's over, at 0", (await cp(s2, QZ)).json?.state === "finished" && (await cp(s2, QZ)).json.earned === 0)

// The lab: graded submissions during the attempt count, earlier ones don't.
const submit = (user, when) => psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,created_at) values ('${user}','${problem}','submit','python','main.py','[]',1000,256,'done','AC',${when})`)
submit(ids.s1, "now()-interval '1 hour'")
await act(s1, LB, "start")
check("a lab lists its problems with links once started", (await cp(s1, LB)).json?.lab?.[0]?.href?.startsWith("/problems/"))
await act(s1, LB, "finish")
check("a problem solved before the lab doesn't count", (await cp(s1, LB)).json?.earned === 0)
await act(s2, LB, "start")
submit(ids.s2, "now()")
await act(s2, LB, "finish")
check("a problem solved during the lab does", (await cp(s2, LB)).json?.earned === 100)

// The project.
check("a bad repository link is refused", (await act(s1, PJ, "project", { body: { repoUrl: "https://gitlab.com/x/y" } })).json?.error?.code === "bad_repository")
check("a student hands in a repository", (await act(s1, PJ, "project", { body: { repoUrl: "https://github.com/ckp-s1/basics", note: "Done." } })).status === 200)
check("teachers can't hand in", (await act(a, PJ, "project", { body: { repoUrl: "https://github.com/x/y" } })).status === 403)
const mark = (api, user, body) => api(`${A}/classes/${lab.id}/courses/${C}/checkpoints/${PJ}/students/${user}/mark`, { method: "PUT", body })
check("a mark can't pass the project's points", (await mark(a, ids.s1, { mark: 25 })).json?.error?.code === "too_many_points")
check("students can't mark", [403, 404].includes((await mark(s2, ids.s1, { mark: 20 })).status))
check("nothing handed in, nothing to mark", (await mark(a, ids.s2, { mark: 5 })).json?.error?.code === "not_handed_in")
check("the teacher marks it", (await mark(a, ids.s1, { mark: 15, feedback: "Nice work." })).status === 200)
const pj = (await cp(s1, PJ)).json
check("the student sees the mark and feedback", pj?.project?.mark === 15 && pj.project.feedback === "Nice work.")

// ---------- grades
const sheet = (await a(`${A}/classes/${lab.id}/courses/${C}/grades`)).json
const row = (who) => sheet?.students?.find((s) => s.id === ids[who])
// s1: quiz 5/10, lab 0/100, project 15/20 (weight 2): (0.5 + 0 + 1.5) / 4 = 50%.
check("the course grade weighs each checkpoint", row("s1")?.grade === 50 && row("s1").sofar === 50, JSON.stringify(row("s1")).slice(0, 200))
// s2: quiz 0, lab 100, project not handed in: (0 + 1 + 0) / 4; so far (0 + 1) / 2.
check("what isn't final counts 0, and 'so far' leaves it out", row("s2")?.grade === 25 && row("s2").sofar === 50)
check("each checkpoint's share is shown", sheet.checkpoints.map((c) => c.share).join() === "25,25,50")
check("students don't see the grade sheet", (await s1(`${A}/classes/${lab.id}/courses/${C}/grades`)).status === 404)
check("outsiders can't open checkpoints", (await cp(b, QZ)).status === 404)
const reset = await a(`${A}/classes/${lab.id}/courses/${C}/checkpoints/${QZ}/students/${ids.s1}/attempt`, { method: "DELETE" })
check("a teacher lets a student take a quiz again", reset.status === 200 && (await cp(s1, QZ)).json?.state === "not_started" && psql(`select count(*) from course_quiz_answers where checkpoint_id='${QZ}' and user_id='${ids.s1}'`) === "0")
check("marking and resets are in the activity log", psql(`select count(*) from audit_log where org_id='${orgA}' and action in ('course.project_mark','course.attempt_reset')`) === "2")
mod = (await s2(`${A}/classes/${lab.id}/courses`)).json.courses[0].modules[0]
check("finished checkpoints count toward the module", mod.done === 2 && mod.checkpoints[1].earned === 100 && mod.total === 5, `${mod.done} of ${mod.total}`)

// A copy keeps them.
const copy = (await a(`${A}/courses/${C}/copy`, { body: {} })).json
const copied = (await a(`${A}/courses/${copy?.id}`)).json
check("a copied course keeps its checkpoints", copied?.modules?.[0]?.checkpoints?.length === 3 && copied.modules[0].checkpoints[0].id !== QZ)
check("and its readings, as its own", copied?.modules?.[0]?.items?.[0]?.kind === "reading" && copied.modules[0].items[0].id !== R.id && copied.modules[0].items[0].body.endsWith("And more."))
const again = (await a(`${A}/courses/${copy?.id}/copy`, { body: {} })).json
check("a college copies its own course for a new round", (await a(`${A}/courses/${again?.id}`)).json?.title === "ckp Course (copy)")
// Taking a reading out of the outline deletes it, with who read it.
await outline([{ id: saved.json.modules[0].id, title: "Basics", items: [{ kind: "question", id: q1 }], checkpoints: [{ ...quiz, title: "Quiz – renamed" }, labCp, project] }])
check("a reading taken out goes, with its progress", psql(`select count(*) from course_readings where id='${R.id}'`) === "0" && psql(`select count(*) from course_reading_progress where reading_id='${R.id}'`) === "0")

// ---------- the pages
const browser = await chromium.launch()
const open = async (email, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const editor = await open("ckp-a@example.com")
await editor.goto(`${BASE}${A}/manage/courses/${copy.id}`)
await editor.getByTestId("course-module").first().waitFor({ timeout: 30000 })
check("the outline lists the module's checkpoints", (await editor.getByTestId("course-module").first().innerText()).includes("Quiz, Lab, Project"))
await editor.getByRole("button", { name: "Edit Basics" }).click()
const dialog = editor.getByTestId("module-dialog")
// An existing module opens on its content; checkpoints have their own tab.
await dialog.getByRole("button", { name: "Write a reading" }).click()
const writer = editor.getByTestId("reading-dialog")
await writer.getByLabel("Reading title").fill("ckp Loops")
await writer.getByRole("textbox", { name: "Reading", exact: true }).fill("## Loops\n\nRepeat steps.")
await writer.getByRole("button", { name: "Done" }).click()
await dialog.getByRole("tab", { name: /^Checkpoints/ }).click()
await dialog.getByTestId("checkpoint-quiz").waitFor({ timeout: 15000 })
await dialog.getByRole("checkbox", { name: "Add a project" }).click()
await dialog.getByRole("checkbox", { name: "Add a lab" }).click()
await dialog.getByRole("checkbox", { name: "Add a lab" }).click()
await dialog.getByLabel("Lab time limit").fill("45")
await dialog.getByLabel("Search problems for the lab").fill("")
await dialog.getByRole("button", { name: /^Add .* to the lab$/ }).first().click()
await editor.waitForTimeout(300)
await editor.screenshot({ path: SHOTS + "course-checkpoints-editor.png", fullPage: true })
await dialog.getByRole("button", { name: "Done" }).click()
await editor.getByRole("button", { name: "Save outline" }).click()
await editor.getByText("Outline saved.").waitFor({ timeout: 15000 }).catch(() => {})
const edited = (await a(`${A}/courses/${copy.id}`)).json?.modules?.[0]?.checkpoints ?? []
check("adding a project and a timed lab from the page", edited.map((c) => c.kind).join() === "quiz,lab" && edited[1].timeLimit === 45 && edited[1].items.length === 1, JSON.stringify(edited).slice(0, 200))
const writtenItems = (await a(`${A}/courses/${copy.id}`)).json?.modules?.[0]?.items ?? []
check("writing a reading from the page", writtenItems.some((i) => i.kind === "reading" && i.title === "ckp Loops" && i.body.includes("Repeat steps")), writtenItems.map((i) => i.title).join(" | "))

const withReading = await outline([{ id: saved.json.modules[0].id, title: "Basics", items: [{ kind: "reading", title: "ckp Variables", body: "## Variables\n\nNames for values.\n\n```python\nx = 1\n```" }, { kind: "question", id: q1 }], checkpoints: [{ ...quiz, title: "Quiz – renamed" }, labCp, project] }])
const R2 = withReading.json?.modules?.[0]?.items?.[0]?.id
const student = await open("ckp-s1@example.com")
await student.goto(`${BASE}${A}/classes/${lab.id}/courses/${C}/readings/${R2}`)
await student.getByTestId("reading-body").waitFor({ timeout: 30000 })
check("the reading page shows the lesson and the module beside it", (await student.getByRole("heading", { name: "Variables", exact: true }).isVisible()) && (await student.getByTestId("reading-module-items").innerText()).includes("ckp One"))
await student.getByRole("button", { name: "Mark as completed" }).click()
await student.getByTestId("reading-done").waitFor({ timeout: 15000 })
check("marking it completed from the page", psql(`select count(*) from course_reading_progress where reading_id='${R2}' and user_id='${ids.s1}'`) === "1")
await student.screenshot({ path: SHOTS + "course-reading.png", fullPage: true })
{
  const small = await open("ckp-s1@example.com", 390)
  await small.goto(`${BASE}${A}/classes/${lab.id}/courses/${C}/readings/${R2}`)
  await small.getByTestId("reading-body").waitFor({ timeout: 30000 })
  check("the reading on a phone, without sideways scrolling", await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await small.screenshot({ path: SHOTS + "course-reading-phone.png", fullPage: true })
}
await student.goto(`${BASE}${A}/classes/${lab.id}/courses/${C}/checkpoints/${QZ}`)
await student.getByRole("button", { name: "Start quiz" }).click()
await student.getByTestId("quiz-question").first().waitFor({ timeout: 15000 })
check("the student starts the quiz with a clock", await student.getByTestId("time-left").isVisible())
await student.getByTestId("quiz-question").nth(0).getByRole("radio", { name: "A", exact: true }).click()
await student.getByTestId("quiz-question").nth(1).getByRole("radio", { name: "A", exact: true }).click()
await student.getByText(/Saved · 2 of 2 answered/).waitFor({ timeout: 15000 })
await student.screenshot({ path: SHOTS + "course-checkpoint-quiz.png", fullPage: true })
await student.getByRole("button", { name: "Finish quiz" }).click()
await student.getByRole("alertdialog").getByRole("button", { name: "Finish" }).click()
await student.getByTestId("checkpoint-score").waitFor({ timeout: 15000 })
check("finishing shows the score", (await student.getByTestId("checkpoint-score").innerText()).includes("10 / 10"))
await student.goto(`${BASE}${A}/classes/${lab.id}?tab=course`)
await student.getByTestId("class-module").first().getByRole("button").first().click()
await student.getByTestId("module-checkpoint").first().waitFor({ timeout: 15000 })
check("the Course tab shows each checkpoint's score", (await student.getByTestId("module-checkpoint").first().innerText()).includes("10 / 10"))
const phone = await open("ckp-s1@example.com", 390)
await phone.goto(`${BASE}${A}/classes/${lab.id}/courses/${C}/checkpoints/${PJ}`)
await phone.getByTestId("project-mark").waitFor({ timeout: 30000 })
check("the project page on a phone, without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
await phone.screenshot({ path: SHOTS + "course-checkpoint-project-phone.png", fullPage: true })

const teacher = await open("ckp-a@example.com")
await teacher.goto(`${BASE}${A}/classes/${lab.id}/courses/${C}/grades`)
await teacher.getByTestId("grade-row").first().waitFor({ timeout: 30000 })
check("the grade sheet has a row per student", (await teacher.getByTestId("grade-row").count()) === 2)
await teacher.getByRole("button", { name: "ckp-s1: Project – Basics" }).click()
const sheetPanel = teacher.getByTestId("work-sheet")
await sheetPanel.getByLabel("Mark").fill("18")
await sheetPanel.getByRole("button", { name: "Save mark" }).click()
await sheetPanel.waitFor({ state: "detached", timeout: 15000 }).catch(() => {})
check("marking a project from the sheet", psql(`select mark from course_project_submissions where checkpoint_id='${PJ}' and user_id='${ids.s1}'`) === "18")
await teacher.screenshot({ path: SHOTS + "course-grades.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
