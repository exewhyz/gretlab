/**
 * GitHub projects: assignments with project work, handing in repository links (checked,
 * pinned to a commit), the time rules, marking from the gradebook, marks in totals and
 * held results, keeping submissions across edits, and the pages. Run with GITHUB_LOOKUP=off
 * on the server so it doesn't depend on GitHub being reachable.
 *   node e2e/projects.mjs [base-url] [screenshot-dir]
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
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()

const cleanup = () => {
  psql(`delete from assignments where title like 'prj %'`)
  psql(`delete from organizations where slug = 'prjtest'`)
  psql(`delete from users where email like 'prj-%'`)
}
cleanup()
for (const h of ["prj-t", "prj-s1", "prj-s2"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Prj College", slug: "prjtest", type: "college", ownerEmail: "prj-t@example.com" } })
const O = "/orgs/prjtest"
const orgId = psql(`select id from organizations where slug='prjtest'`)
const [t, s1, s2] = await Promise.all(["prj-t", "prj-s1", "prj-s2"].map((h) => client(`${h}@example.com`)))
const lab = (await t(`${O}/groups`, { body: { name: "prj Lab" } })).json
for (const h of ["prj-s1", "prj-s2"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await t(`${O}/groups/${lab.id}/members`, { body: { userIds: [uid("prj-s1"), uid("prj-s2")] } })
const projects = [
  { title: "Library manager", instructions: "Build it with **tests**.", points: 20 },
  { title: "README", instructions: "", points: 5 },
]
const body = (extra) => ({ description: "", opensAt: days(-1), dueAt: days(3), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [], questions: [], projects, ...extra })

// ---------- setting projects
check("exams don't have projects", (await t(`${O}/assignments`, { body: body({ title: "prj Exam", slug: "prj-exam", exam: { minutes: 30, fullscreen: true, networks: [], startWithin: null } }) })).status === 400)
const a = (await t(`${O}/assignments`, { body: body({ title: "prj Week 1", slug: "prj-week-1" }) })).json
check("an assignment of projects only", !!a?.id, JSON.stringify(a).slice(0, 150))
const staff = (await t(`${O}/assignments/${a.id}`)).json
check("the form gets them back with ids", staff.projects.length === 2 && !!staff.projects[0].id && staff.projects[0].points === 20)
const view = (await s1("/assignments/prj-week-1")).json
check("students see them, and they count in the total", view.projects.length === 2 && view.projects[0].instructions.includes("tests") && view.total === 25 && view.projects[0].submission === null)
const P1 = view.projects[0].id
const P2 = view.projects[1].id
const hand = (api, slug, id, url, note = "") => api(`/assignments/${slug}/projects/${id}`, { body: { url, note } })

// ---------- handing in
for (const bad of ["https://gitlab.com/ada/calc", "not a link", "https://github.com/ada", "https://github.com/ada/calc/issues/3"]) {
  check(`refused: ${bad}`, (await hand(s1, "prj-week-1", P1, bad)).json?.error?.code === "bad_repository")
}
const pinned = await hand(s1, "prj-week-1", P1, "https://github.com/ada/library/commit/0123456789abcdef0123456789abcdef01234567", "See tests/")
check("a commit link is pinned to that commit", pinned.json?.commitSha === "0123456789abcdef0123456789abcdef01234567" && pinned.json.repoUrl === "https://github.com/ada/library" && !pinned.json.late)
const plain = await hand(s1, "prj-week-1", P2, "git@github.com:ada/library.git")
check("any usual spelling of a repository works", plain.json?.repoUrl === "https://github.com/ada/library")
check("students can't hand in for projects that aren't there", (await hand(s1, "prj-week-1", "00000000-0000-4000-8000-000000000000", "https://github.com/ada/x")).status === 404)
const later = (await t(`${O}/assignments`, { body: body({ title: "prj Later", slug: "prj-later", opensAt: days(1), dueAt: days(4) }) })).json
const laterView = (await t(`${O}/assignments/${later.id}`)).json
check("not before it opens", (await hand(s1, "prj-later", laterView.projects[0].id, "https://github.com/ada/x")).json?.error?.code === "not_open")
const past = (await t(`${O}/assignments`, { body: body({ title: "prj Past", slug: "prj-past", opensAt: days(-5), dueAt: days(-1) }) })).json
const pastP = (await t(`${O}/assignments/${past.id}`)).json.projects[0].id
check("not after the due time without late work", (await hand(s1, "prj-past", pastP, "https://github.com/ada/x")).json?.error?.code === "closed")
const lateOk = (await t(`${O}/assignments`, { body: body({ title: "prj Late ok", slug: "prj-late-ok", opensAt: days(-5), dueAt: days(-1), allowLate: true }) })).json
const lateP = (await t(`${O}/assignments/${lateOk.id}`)).json.projects[0].id
check("with late work: handed in, marked late", (await hand(s1, "prj-late-ok", lateP, "https://github.com/ada/x")).json?.late === true)
await t(`${O}/assignments/${past.id}/extensions`, { method: "PUT", body: { student: "prj-s2@example.com", dueAt: days(2) } })
check("an extension reopens it for that student", (await hand(s2, "prj-past", pastP, "https://github.com/bo/x")).json?.late === false)

// ---------- marking
const book = (await t(`${O}/assignments/${a.id}/gradebook`)).json
const row = book.rows.find((r) => r.email === "prj-s1@example.com")
check("the gradebook: projects column, totals, to mark", book.total === 25 && row.projects.submitted === 2 && row.projects.needsMarking === 2 && book.assignment.projects.length === 2)
const work = (await t(`${O}/assignments/${a.id}/projects?student=prj-s1@example.com`)).json
check("the teacher sees the repository at its commit", work.projects[0].submission.commitSha.startsWith("0123456") && work.projects[0].submission.note === "See tests/")
const mark = (projectId, m, feedback = "") => t(`${O}/assignments/${a.id}/projects`, { method: "PUT", body: { student: "prj-s1@example.com", projectId, mark: m, feedback } })
check("not over the points", (await mark(P1, 21)).json?.error?.code === "too_many_marks")
check("students can't mark", [403, 404].includes((await s2(`${O}/assignments/${a.id}/projects`, { method: "PUT", body: { student: "prj-s1@example.com", projectId: P1, mark: 20, feedback: "" } })).status))
check("not what wasn't handed in", (await t(`${O}/assignments/${a.id}/projects`, { method: "PUT", body: { student: "prj-s2@example.com", projectId: P1, mark: 5, feedback: "" } })).json?.error?.code === "not_submitted")
check("marking", (await mark(P1, 17, "Good tests; add one for returns.")).status === 200)
const after = (await s1("/assignments/prj-week-1")).json
check("the student sees the mark and feedback, in the total", after.projects[0].submission.mark === 17 && after.projects[0].submission.feedback.includes("returns") && after.earned === 17)
check("and was told", (await s1("/me/notifications")).json.notifications.some((n) => n.kind === "project_marked"))
check("the CSV has the column", (await t(`${O}/assignments/${a.id}/gradebook?format=csv`)).text.includes("Projects (25)"))
await hand(s1, "prj-week-1", P1, "https://github.com/ada/library/commit/fedcba9876543210fedcba9876543210fedcba98")
check("handing in again clears the mark", (await s1("/assignments/prj-week-1")).json.projects[0].submission.mark === null)
await mark(P1, 18)

// ---------- held results
await t(`${O}/assignments/${a.id}`, { method: "PUT", body: { ...body({ title: "prj Week 1", slug: "prj-week-1", holdFeedback: true }), projects: staff.projects } })
const held = (await s1("/assignments/prj-week-1")).json
check("held results hide the mark", held.projects[0].submission.mark === null && held.earned === 0)
check("teachers still see it", (await t(`${O}/assignments/${a.id}/gradebook`)).json.rows.find((r) => r.email === "prj-s1@example.com").projects.earned === 18)
await t(`${O}/assignments/${a.id}/release`, { body: {} })
check("released, it shows", (await s1("/assignments/prj-week-1")).json.projects[0].submission.mark === 18)

// ---------- edits keep submissions
check("editing keeps projects (and their work) by id", psql(`select count(*) from project_submissions where project_id='${P1}'`) === "1")
await t(`${O}/assignments/${a.id}`, { method: "PUT", body: { ...body({ title: "prj Week 1", slug: "prj-week-1" }), projects: [staff.projects[0]] } })
check("removing a project removes its work", psql(`select count(*) from project_submissions where project_id='${P2}'`) === "0" && psql(`select count(*) from project_submissions where project_id='${P1}'`) === "1")

// ---------- the pages
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const sp = await open("prj-s2@example.com")
await sp.goto(`${BASE}/assignments/prj-week-1`)
await sp.getByLabel("Repository for Library manager").fill("https://github.com/bo/library/commit/abcdef1")
await sp.getByLabel("Note for Library manager").fill("Run make test")
await sp.getByRole("button", { name: "Hand in", exact: true }).click()
await sp.getByTestId("project-submission").waitFor({ timeout: 15000 })
check("handing in from the page", (await sp.getByTestId("project-submission").innerText()).includes("bo/library"))
await sp.screenshot({ path: SHOTS + "project-student.png", fullPage: true })
const tp = await open("prj-t@example.com")
await tp.goto(`${BASE}${O}/manage/assignments/${a.id}/grades`)
await tp.getByRole("button", { name: "Mark prj-s2@example.com's projects" }).click({ timeout: 30000 })
const dialog = tp.getByTestId("project-marking")
await dialog.getByLabel("Mark for Library manager").fill("19")
await dialog.getByLabel("Feedback for Library manager").fill("Clean structure.")
await dialog.getByRole("button", { name: "Save mark" }).click()
await dialog.getByText("Saved.").waitFor({ timeout: 15000 })
check("marking from the gradebook", psql(`select mark from project_submissions where project_id='${P1}' and user_id='${uid("prj-s2")}'`) === "19")
await tp.screenshot({ path: SHOTS + "project-marking.png", fullPage: true })
await tp.goto(`${BASE}${O}/manage/assignments/${a.id}`)
await tp.getByTestId("projects-editor").waitFor({ timeout: 30000 })
await tp.getByRole("button", { name: "Add a project" }).click()
const pd = tp.getByTestId("project-dialog")
await pd.getByLabel("Project title").fill("Presentation")
await pd.getByLabel("Project points").fill("10")
await pd.getByRole("button", { name: "Done" }).click()
await tp.getByRole("button", { name: "Save changes" }).click()
await tp.getByText(/Published\./).waitFor({ timeout: 15000 })
check("adding a project in the form", psql(`select string_agg(title, ',' order by position) from assignment_projects where assignment_id='${a.id}'`) === "Library manager,Presentation")
await tp.screenshot({ path: SHOTS + "project-form.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
