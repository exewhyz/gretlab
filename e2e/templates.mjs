/**
 * Templates: an assignment or exam written once and used for many classes with their own
 * dates; shared like the library; edits reach uses until they open; saving an assignment
 * as a template; copies; the pages.
 *   node e2e/templates.mjs [base-url] [screenshot-dir]
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
const at = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

const cleanup = () => {
  psql(`delete from assignments where title like 'tpl %'`)
  psql(`delete from templates where title like 'tpl %'`)
  psql(`delete from questions where title like 'tpl %'`)
  psql(`delete from test_cases where problem_id in (select id from problems where slug like 'tpl-%')`)
  psql(`delete from problems where slug like 'tpl-%'`)
  psql(`delete from organizations where slug like 'tpltest-%'`)
  psql(`delete from users where email like 'tpl-%'`)
}
cleanup()
for (const email of ["tpl-a@example.com", "tpl-b@example.com", "tpl-s1@example.com"]) {
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
const [admin, a, b, s1] = await Promise.all(["admin@example.com", "tpl-a@example.com", "tpl-b@example.com", "tpl-s1@example.com"].map(client))
for (const [slug, owner] of [["tpltest-a", "tpl-a@example.com"], ["tpltest-b", "tpl-b@example.com"]]) {
  await admin("/admin/organizations", { body: { name: `Tpl ${slug.slice(-1).toUpperCase()} College`, slug, type: "college", ownerEmail: owner } })
}
const A = "/orgs/tpltest-a", B = "/orgs/tpltest-b"
const orgA = psql(`select id from organizations where slug='tpltest-a'`)
const sec1 = (await a(`${A}/groups`, { body: { name: "tpl Sec 1" } })).json
const sec2 = (await a(`${A}/groups`, { body: { name: "tpl Sec 2" } })).json
const secB = (await b(`${B}/groups`, { body: { name: "tpl Sec B" } })).json
check("colleges with classes", !!sec1?.id && !!sec2?.id && !!secB?.id)
psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgA}', id, 'active', 'created' from users where email='tpl-s1@example.com'`)
await a(`${A}/groups/${sec1.id}/members`, { body: { userIds: [psql(`select id from users where email='tpl-s1@example.com'`)] } })

// ---------- the platform writes a template, with a problem written for assessments
const hidden = psql(`insert into problems(slug,title,level,statement,description,published,listed,sharing) values ('tpl-hidden','tpl Hidden','easy','[]','Solve it.',true,false,'owner') returning id`).split("\n")[0]
const q1 = (await admin("/admin/questions", { body: { title: "tpl Q1", kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1 } })).json.id
const body = (extra = {}) => ({
  title: "tpl Week 1",
  slug: "ignored",
  description: "Loops.",
  opensAt: at(0),
  dueAt: at(1),
  allowLate: true,
  latePenaltyPercent: 20,
  published: true,
  holdFeedback: false,
  exam: null,
  audience: [],
  problems: [{ problemId: hidden, points: 50, rubric: [{ id: "r1", label: "Style", points: 5 }], outcomes: [] }],
  questions: [{ questionId: q1, points: 2 }],
  ...extra,
})
const created = await admin("/admin/templates", { body: body() })
const T = created.json?.template?.id
check("the platform writes a template", created.status === 200 && !!T && created.json.template.sharing === "everyone", JSON.stringify(created.json).slice(0, 150))
const tpl = (await admin(`/admin/templates/${T}`)).json
check("it keeps content, not dates or audience", tpl.problems[0].points === 50 && tpl.problems[0].rubric.length === 1 && tpl.questions[0].points === 2 && tpl.latePenaltyPercent === 20 && tpl.opensAt === undefined)
check("not an assignment: students never see it", !JSON.stringify((await s1("/assignments")).json).includes("tpl Week 1"))
const titles = async (api, org) => ((await api(`${org}/templates`)).json ?? []).map((t) => t.title)
check("every college sees a platform template", (await titles(a, A)).includes("tpl Week 1") && (await titles(b, B)).includes("tpl Week 1"))
await admin("/admin/library/sharing", { method: "PUT", body: { items: [{ kind: "template", id: T }], sharing: "selected", orgIds: [orgA] } })
check("shared with chosen colleges, only they see it", (await titles(a, A)).includes("tpl Week 1") && !(await titles(b, B)).includes("tpl Week 1"))
check("others can't use it", (await b(`${B}/templates/${T}/use`, { body: { uses: [{ groupId: secB.id, opensAt: at(1), dueAt: at(5) }] } })).status === 404)

// ---------- a college uses it for two classes, each with its own dates
check("students can't use templates", (await s1(`${A}/templates/${T}/use`, { body: { uses: [{ groupId: sec1.id, opensAt: at(1), dueAt: at(5) }] } })).status === 403)
check("dates must make sense", (await a(`${A}/templates/${T}/use`, { body: { uses: [{ groupId: sec1.id, opensAt: at(5), dueAt: at(1) }] } })).status === 400)
const used = await a(`${A}/templates/${T}/use`, {
  body: {
    published: true,
    uses: [
      { groupId: sec1.id, opensAt: at(24), dueAt: at(48) },
      { groupId: sec2.id, opensAt: at(-24), dueAt: at(24) },
    ],
  },
})
check("one assignment per class", used.status === 200 && used.json.created.length === 2, JSON.stringify(used.json).slice(0, 200))
const [use1, use2] = used.json.created
check("each with its own address", use1.slug !== use2.slug && use1.slug.includes("sec-1") && use2.slug.includes("sec-2"))
const row1 = (await a(`${A}/assignments/${use1.id}`)).json
check("aimed at its class, with the template's content and the shared problem", JSON.stringify(row1.audience) === JSON.stringify([[sec1.id]]) && row1.problems[0].problemId === hidden && row1.problems[0].rubric[0].points === 5 && row1.questions.length === 1 && row1.templateId === T && row1.latePenaltyPercent === 20)
check("its students see it", (await s1("/assignments")).json.some((x) => x.slug === use1.slug) && !(await s1("/assignments")).json.some((x) => x.slug === use2.slug))
check("the shared problem still can't be put in other work", (await a(`${A}/assignments`, { body: { ...body(), slug: "tpl-direct", audience: [[sec1.id]] } })).json?.error?.code === "private_problem")
const asForm = (r) => ({ title: r.title, slug: r.slug, description: r.description, opensAt: r.opensAt, dueAt: r.dueAt, allowLate: r.allowLate, latePenaltyPercent: r.latePenaltyPercent, published: r.published, holdFeedback: r.holdFeedback, exam: r.exam, audience: r.audience, problems: r.problems, questions: r.questions, expectedUpdatedAt: r.updatedAt })
check("but a use keeps it when edited", (await a(`${A}/assignments/${use1.id}`, { method: "PUT", body: { ...asForm(row1), dueAt: at(50) } })).status === 200)

// ---------- edits reach uses that haven't opened
const q2 = (await admin("/admin/questions", { body: { title: "tpl Q2", kind: "single", prompt: "Pick B.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["b"], points: 1 } })).json.id
const edited = await admin(`/admin/templates/${T}`, { method: "PUT", body: { ...body({ title: "tpl Week 1 (revised)", problems: [{ problemId: hidden, points: 60, rubric: [], outcomes: [] }], questions: [{ questionId: q1, points: 2 }, { questionId: q2, points: 3 }] }), expectedUpdatedAt: tpl.updatedAt } })
check("saving the template updates unopened uses, keeps opened ones", edited.json?.updated === 1 && edited.json?.kept === 1, JSON.stringify(edited.json).slice(0, 200))
const after1 = (await a(`${A}/assignments/${use1.id}`)).json
const after2 = (await a(`${A}/assignments/${use2.id}`)).json
check("the unopened one has the changes, its own dates and class", after1.title === "tpl Week 1 (revised)" && after1.problems[0].points === 60 && after1.questions.length === 2 && JSON.stringify(after1.audience) === JSON.stringify([[sec1.id]]) && Math.abs(new Date(after1.dueAt) - new Date(at(50))) < 120_000)
check("the opened one is left alone", after2.title === "tpl Week 1" && after2.problems[0].points === 50 && after2.questions.length === 1)
check("a stale template save is refused", (await admin(`/admin/templates/${T}`, { method: "PUT", body: { ...body(), expectedUpdatedAt: tpl.updatedAt } })).json?.error?.code === "edited_elsewhere")
check("the template lists its uses", (await a(`${A}/templates/${T}`)).json.uses.length === 2 && (await admin(`/admin/templates/${T}`)).json.uses.length === 0)

// ---------- a college's own templates
const draft = await a(`${A}/templates`, { body: body({ title: "tpl Draft", published: false, problems: [], questions: [{ questionId: q1, points: 1 }] }) })
check("a college writes its own template", draft.status === 200 && draft.json.template.sharing === "owner")
check("a draft can't be used yet", (await a(`${A}/templates/${draft.json.template.id}/use`, { body: { uses: [{ groupId: sec1.id, opensAt: at(1), dueAt: at(5) }] } })).json?.error?.code === "draft_template")
check("other colleges never see it", (await b(`${B}/templates/${draft.json.template.id}`)).status === 404)
const fromAssignment = await a(`${A}/templates/from-assignment`, { body: { assignmentId: use2.id } })
const saved = (await a(`${A}/templates/${fromAssignment.json?.id}`)).json
check("an assignment saved as a template", fromAssignment.status === 200 && saved.editable && saved.problems[0].problemId === hidden && saved.questions.length === 1)
check("an assignment from another college can't be", (await b(`${B}/templates/from-assignment`, { body: { assignmentId: use2.id } })).status === 404)
const copy = await a(`${A}/templates/${T}/copy`, { body: {} })
check("a college copies a shared template to change it", copy.status === 200 && (await a(`${A}/templates/${copy.json.id}`)).json.editable === true && (await a(`${A}/templates/${T}`)).json.editable === false)
check("it can't change the platform's", (await a(`${A}/templates/${T}`, { method: "PUT", body: body() })).status === 404)
check("deleting a template keeps its uses", (await a(`${A}/templates/${fromAssignment.json.id}`, { method: "DELETE" })).status === 200 && (await admin(`/admin/templates/${T}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from assignments where title like 'tpl Week 1%' and template_id is null`) === "2")
const platformUse = await admin(`/admin/templates/${copy.json.id}/use`, { body: { uses: [{ groupId: null, opensAt: at(1), dueAt: at(5) }] } })
check("the platform can't use a college's template", platformUse.status === 404)

// ---------- the pages
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const page = await open("tpl-a@example.com")
await page.goto(`${BASE}${A}/manage/templates`)
await page.getByTestId("template-row").first().waitFor({ timeout: 30000 })
check("the templates list", (await page.getByTestId("template-row").count()) === 2)
await page.screenshot({ path: SHOTS + "templates.png", fullPage: true })
await page.getByRole("button", { name: "Use tpl Week 1 (revised)" }).click()
const dialog = page.getByTestId("apply-dialog")
await dialog.getByLabel("Class for use 1").click()
const picker = page.getByTestId("group-picker")
await picker.getByLabel("Search groups").fill("tpl Sec 2")
await picker.getByRole("option", { name: "tpl Sec 2", exact: true }).click()
await picker.waitFor({ state: "hidden", timeout: 15000 })
await dialog.getByRole("button", { name: "+ Another class" }).click()
await dialog.getByLabel("Class for use 2").click()
await picker.getByLabel("Search groups").fill("tpl Sec 1")
await picker.getByRole("option", { name: "tpl Sec 1", exact: true }).click()
// Uses that open later get the template's changes.
for (const n of [1, 2]) {
  await dialog.getByLabel(`Opens, use ${n}`).fill("2030-01-0" + n + "T09:00")
  await dialog.getByLabel(`Due, use ${n}`).fill("2030-01-0" + n + "T17:00")
}
await page.waitForTimeout(300)
await page.screenshot({ path: SHOTS + "template-use.png", fullPage: true })
await dialog.getByRole("button", { name: "Make 2 assignments" }).click()
await dialog.getByTestId("apply-done").waitFor({ timeout: 15000 })
check("using a template for two classes from the page", psql(`select count(*) from assignments where template_id='${copy.json.id}'`) === "2")
await page.goto(`${BASE}${A}/manage/templates/${copy.json.id}`)
await page.getByTestId("template-use").first().waitFor({ timeout: 30000 })
await page.getByRole("button", { name: "Save template" }).waitFor({ timeout: 30000 })
check("the template page: the form without dates, and its uses", (await page.getByLabel("Opens", { exact: true }).count()) === 0 && (await page.getByText("Unknown problem").count()) === 0 && (await page.getByTestId("template-use").count()) === 2 && (await page.getByRole("button", { name: "Save template" }).isVisible()))
await page.screenshot({ path: SHOTS + "template-editor.png", fullPage: true })
await page.getByRole("button", { name: "Save template" }).click()
await page.getByText(/Saved\. Ready to use\./).waitFor({ timeout: 15000 })
check("saving from the page says what it updated", /2 uses that haven't opened have the changes/.test(await page.getByText(/Saved\. Ready to use\./).innerText()))
const use = (await a(`${A}/templates/${copy.json.id}`)).json.uses[0]
await page.goto(`${BASE}${A}/manage/assignments/${use.id}`)
await page.getByTestId("from-template").waitFor({ timeout: 30000 })
check("a use says it comes from a template, and has its own dates", (await page.getByRole("button", { name: "Save as template" }).count()) === 1 && (await page.getByLabel("Opens", { exact: true }).count()) === 1 && (await page.getByText("Unknown problem").count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
