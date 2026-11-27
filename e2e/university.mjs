/**
 * Universities and their affiliated colleges. This part: the University kind (its levels, words and
 * suggested roles), a college asking to affiliate (only a college, only to a university, once at a
 * time), the university approving with a college code (checked, one college each), refusing and
 * ending, the college withdrawing and leaving, who may do what on each side, both activity logs,
 * the notices, and both pages on a laptop and a phone. Shared content: a university shares its own
 * problems, questions, courses and templates with its affiliated colleges (and stops), only its
 * own and never public ones, by those allowed; affiliated colleges see and use them, others
 * don't; edits keep the sharing; a college's students reach a shared members-only problem through
 * the college's assignment.
 *   node e2e/university.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()

const SLUGS = ["uni-u", "uni-u2", "uni-c1", "uni-c2", "uni-c3", "uni-co"]
const cleanup = () => {
  psql(`delete from organizations where slug in (${SLUGS.map((s) => `'${s}'`).join(",")})`)
  psql(`delete from users where email like 'uni-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["uni-vc", "uni-reg", "uni-c1o", "uni-c2o", "uni-c3o", "uni-u2o", "uni-t", "uni-out", "uni-s1", "uni-s2"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const session = (email) => encode({ token: { email }, secret: SECRET })
const client = async (email) => {
  const cookie = `next-auth.session-token=${await session(email)}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const made = await admin("/admin/organizations", { body: { name: "Uni University", slug: "uni-u", type: "university", ownerEmail: "uni-vc@example.com" } })
check("a university is made", made.status === 200 || made.status === 201, JSON.stringify(made.json))
await admin("/admin/organizations", { body: { name: "Other University", slug: "uni-u2", type: "university", ownerEmail: "uni-u2o@example.com" } })
for (const [slug, name, owner] of [["uni-c1", "First College", "uni-c1o"], ["uni-c2", "Second College", "uni-c2o"], ["uni-c3", "Third College", "uni-c3o"]])
  await admin("/admin/organizations", { body: { name, slug, type: "college", ownerEmail: `${owner}@example.com` } })
await admin("/admin/organizations", { body: { name: "Uni Co", slug: "uni-co", type: "company", ownerEmail: "uni-c1o@example.com" } })
const [vc, registrar, c1, c2, c3, u2, teacher, outsider, s1, s2] = await Promise.all(people.map((h) => client(`${h}@example.com`)))
const id = (slug) => psql(`select id from organizations where slug='${slug}'`)
const U = "/orgs/uni-u"

// ---------- the kind
const shell = (await vc(`${U}/shell`)).json
check("its levels are School, Department, Program", psql(`select group_levels::text from organizations where slug='uni-u'`).includes("Program"), psql(`select group_levels::text from organizations where slug='uni-u'`))
check("it starts with its suggested roles", ["Vice chancellor", "Registrar", "Controller of examinations"].every((n) => psql(`select count(*) from org_roles where org_id='${id("uni-u")}' and name='${n}'`) === "1"))
check("affiliated colleges are on from the start", shell?.modules?.includes("affiliation") && shell.permissions.includes("university.colleges"), JSON.stringify(shell?.modules))
check("…and never for a college", !(await c1("/orgs/uni-c1/shell")).json?.modules?.includes("affiliation"))
check("the kind can't be changed to a college", (await vc(U, { method: "PATCH", body: { type: "college" } })).json?.error?.code === "kind_locked")

// ---------- asking
const ask = (who, slug, university, note = "") => who(`/orgs/${slug}/university`, { body: { university, note } })
check("a company can't ask to affiliate", (await c1("/orgs/uni-co/university")).status === 404)
check("only a university can be asked", (await ask(c1, "uni-c1", "uni-c2")).json?.error?.code === "not_a_university")
check("…and an address that isn't there is the same answer", (await ask(c1, "uni-c1", "no-such-place")).json?.error?.code === "not_a_university")
const r1 = await ask(c1, "uni-c1", "uni-u", "Letter 42")
check("a college asks a university by its address", r1.status === 200 && Boolean(r1.json?.id), JSON.stringify(r1.json))
check("…once at a time", (await ask(c1, "uni-c1", "uni-u2")).json?.error?.code === "affiliation_exists")
const mine = (await c1("/orgs/uni-c1/university")).json
check("the college sees it waiting", mine?.current?.status === "requested" && mine.current.university.name === "Uni University", JSON.stringify(mine))
check("someone without settings in the college can't ask or look", (await outsider("/orgs/uni-c1/university")).status >= 403)
await ask(c2, "uni-c2", "uni-u")
await ask(c3, "uni-c3", "uni-u")
check("the university is told of each request", Number(psql(`select count(*) from notifications where user_id='${uid("uni-vc")}' and kind='affiliation'`)) === 3)

// ---------- the university decides
const list = async (who = vc, q = "") => (await who(`${U}/colleges${q}`)).json
let colleges = await list()
check("the university lists the requests", colleges?.items?.length === 3 && colleges.counts.requested === 3 && colleges.can.decide === true, JSON.stringify(colleges).slice(0, 300))
const row = (slug) => colleges.items.find((c) => c.college.slug === slug)
check("…with the college's note", row("uni-c1")?.note === "Letter 42")
const decide = (who, slug, body) => who(`${U}/colleges/${row(slug).id}`, { body })
check("a bad college code is refused", (await decide(vc, "uni-c1", { action: "approve", code: "a b" })).json?.error?.code === "bad_code")
const ok1 = await decide(vc, "uni-c1", { action: "approve", code: "fc1" })
check("approving takes a college code, kept in capitals", ok1.status === 200 && psql(`select college_code from org_affiliations where college_id='${id("uni-c1")}' and status='active'`) === "FC1", JSON.stringify(ok1.json))
check("…a code another college has is refused", (await decide(vc, "uni-c2", { action: "approve", code: "FC1" })).json?.error?.code === "code_taken")
check("…another is fine", (await decide(vc, "uni-c2", { action: "approve", code: "SC2" })).status === 200)
check("refusing a request", (await decide(vc, "uni-c3", { action: "refuse" })).status === 200 && psql(`select status from org_affiliations where college_id='${id("uni-c3")}'`) === "refused")
check("…and it can't be approved afterwards", (await decide(vc, "uni-c3", { action: "approve", code: "TC3" })).json?.error?.code === "bad_step")
check("the colleges are told", psql(`select count(*) from notifications where kind='affiliation' and user_id in ('${uid("uni-c1o")}','${uid("uni-c3o")}')`) === "2")
check("the college sees it affiliated with its code", (await c1("/orgs/uni-c1/university")).json?.current?.collegeCode === "FC1")
const refusedAgain = await ask(c3, "uni-c3", "uni-u2")
check("a refused college may ask another university", refusedAgain.status === 200, JSON.stringify(refusedAgain.json))
check("…and its refusal stays in its history", (await c3("/orgs/uni-c3/university")).json?.history?.[0]?.status === "refused")

// ---------- the list
colleges = await list()
check("the list counts affiliated and waiting", colleges.counts.active === 2 && colleges.counts.requested === 0, JSON.stringify(colleges.counts))
check("…searches by college code", (await list(vc, "?q=sc2")).items?.map((c) => c.college.slug).join() === "uni-c2")
check("…and filters by status", (await list(vc, "?status=active")).items?.length === 2)
check("another university doesn't see them", ((await list(u2)) ?? {}).items === undefined || (await list(u2)).items.every((c) => !["uni-c1", "uni-c2"].includes(c.college.slug)))
check("…nor can decide on them", [403, 404].includes((await u2(`/orgs/uni-u2/colleges/${row("uni-c1").id}`, { body: { action: "end" } })).status))

// ---------- who may do what at the university
const viewer = (await vc(`${U}/roles`, { body: { name: "Oversight", permissions: ["university.view"] } })).json
psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${id("uni-u")}','${uid("uni-reg")}','active','created'), ('${id("uni-u")}','${uid("uni-t")}','active','created')`)
await vc(`${U}/members/${uid("uni-reg")}/roles`, { body: { roleId: viewer.id } })
const seen = await list(registrar)
check("someone who only oversees sees the colleges", seen?.items?.length === 2 && seen.can.decide === false, JSON.stringify(seen).slice(0, 200))
check("…but can't decide", (await registrar(`${U}/colleges/${row("uni-c1").id}`, { body: { action: "end" } })).status === 403)
check("a member with neither sees nothing", (await teacher(`${U}/colleges`)).status === 403)
check("a university doesn't have a University page", (await vc(`${U}/university`)).status === 404)

// ---------- withdrawing, leaving, ending
check("the college withdraws a waiting request", (await c3("/orgs/uni-c3/university", { method: "DELETE" })).status === 200 && psql(`select count(*) from org_affiliations where college_id='${id("uni-c3")}' and status='withdrawn'`) === "1")
check("a college leaves its university", (await c2("/orgs/uni-c2/university", { method: "DELETE" })).status === 200 && psql(`select status from org_affiliations where college_id='${id("uni-c2")}'`) === "ended")
check("…which frees its code", (await vc(`${U}/colleges?status=active`)).json?.items?.length === 1)
check("the university ends one", (await decide(vc, "uni-c1", { action: "end" })).status === 200 && psql(`select count(*) from org_affiliations where college_id='${id("uni-c1")}' and status='active'`) === "0")
check("…and nothing is left to leave", (await c1("/orgs/uni-c1/university", { method: "DELETE" })).status === 404)
const back = await ask(c1, "uni-c1", "uni-u")
check("a college may ask again after it ended", back.status === 200)
colleges = await list()
check("…and is approved with its old code, free again", (await decide(vc, "uni-c1", { action: "approve", code: "FC1" })).status === 200)
check("both activity logs record every step", Number(psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action='university.affiliation'`)) >= 9 && Number(psql(`select count(*) from audit_log where org_id='${id("uni-c1")}' and action='university.affiliation'`)) >= 4)

// ---------- shared content
const libraryId = psql(`select id from problems where published and listed and not members_only and org_id is null order by slug limit 1`)
const base = (await admin(`/admin/problems/${libraryId}`)).json
const problemBody = (over) => ({ ...base, tests: base.tests.map(({ input, expected, isSample, points }) => ({ input, expected, isSample, points })), tags: [], ...over })
const P = (await vc(`${U}/problems`, { body: problemBody({ slug: "uni-members", title: "Uni Members Problem", published: true, membersOnly: true }) })).json
const pub = (await vc(`${U}/problems`, { body: problemBody({ slug: "uni-public", title: "Uni Public Problem", published: true, listed: true, membersOnly: false }) })).json
const Q = (await vc(`${U}/questions`, { body: { title: "Uni Q1", kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1, published: true } })).json
const C = (await vc(`${U}/courses`, { body: { title: "Uni Course", published: true } })).json
check("the university writes its own content", Boolean(P?.id && pub?.id && Q?.id && C?.id), JSON.stringify([P, Q, C]).slice(0, 300))
const lib = async (who, slug) => (await who(`/orgs/${slug}/library`)).json
check("its library says it may share with its colleges", (await lib(vc, "uni-u"))?.shareWithColleges === true)
check("…a college's doesn't", (await lib(c1, "uni-c1"))?.shareWithColleges === false)
const has = (l, id) => [...(l?.problems ?? []), ...(l?.questions ?? [])].some((r) => r.id === id)
check("before sharing, a college doesn't see the university's own problems", !has(await lib(c1, "uni-c1"), P.id) && !has(await lib(c1, "uni-c1"), Q.id))
const share = (who, items, sharing = "affiliates", slug = "uni-u") => who(`/orgs/${slug}/library/affiliates`, { body: { items, sharing } })
const items = [{ kind: "problem", id: P.id }, { kind: "question", id: Q.id }, { kind: "course", id: C.id }]
check("someone who only oversees can't share", (await share(registrar, items)).status === 403)
check("a college has nothing to share with colleges", (await share(c1, items, "affiliates", "uni-c1")).status === 404)
check("another organization's items are refused", (await share(vc, [{ kind: "course", id: psql(`select id from courses where org_id is null limit 1`) || C.id }])).json?.error?.code === "not_ours" || !psql(`select id from courses where org_id is null limit 1`))
check("public library problems already reach everyone", (await share(vc, [{ kind: "problem", id: pub.id }])).json?.error?.code === "already_public")
const shared = await share(vc, items)
check("the university shares a problem, a question and a course", shared.status === 200 && shared.json?.changed === 3, JSON.stringify(shared.json))
check("…logged", psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action='university.share'`) === "1")
const l1 = await lib(c1, "uni-c1")
check("an affiliated college sees them in its library, from the university", has(l1, P.id) && has(l1, Q.id) && l1.problems.find((r) => r.id === P.id)?.owner === "Uni University", JSON.stringify(l1?.problems?.map((r) => r.title)))
check("…and the course in its courses", ((await c1("/orgs/uni-c1/courses")).json ?? []).some((c) => c.id === C.id))
check("a college that left doesn't", !has(await lib(c2, "uni-c2"), P.id) && !((await c2("/orgs/uni-c2/courses")).json ?? []).some((c) => c.id === C.id))
check("…nor does another university", !has(await lib(u2, "uni-u2"), P.id))
// editing keeps the sharing
await vc(`${U}/problems/${P.id}`, { method: "PUT", body: problemBody({ slug: "uni-members", title: "Uni Members Problem (v2)", published: true, membersOnly: true, expectedUpdatedAt: P.updatedAt }) })
await vc(`${U}/questions/${Q.id}`, { method: "PUT", body: { title: "Uni Q1 (v2)", kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1, published: true, expectedUpdatedAt: Q.updatedAt } })
check("editing them keeps them shared", psql(`select sharing from problems where id='${P.id}'`) === "affiliates" && psql(`select sharing from questions where id='${Q.id}'`) === "affiliates" && psql(`select title from problems where id='${P.id}'`).endsWith("(v2)"))
// a college uses the shared members-only problem in an assignment
const sec = (await c1("/orgs/uni-c1/groups", { body: { name: "CSE-A" } })).json
psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${id("uni-c1")}','${uid("uni-s1")}','active','created'), ('${id("uni-c2")}','${uid("uni-s2")}','active','created')`)
await c1(`/orgs/uni-c1/groups/${sec.id}/members`, { body: { userIds: [uid("uni-s1")] } })
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()
const work = await c1("/orgs/uni-c1/assignments", { body: { title: "Uni Week 1", slug: "uni-week-1", description: "", opensAt: hours(-1), dueAt: hours(48), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: P.id, points: 100 }], audience: [[sec.id]] } })
check("an affiliated college sets the shared problem as work", work.status === 200, JSON.stringify(work.json).slice(0, 200))
check("…a college that left can't", (await c2("/orgs/uni-c2/assignments", { body: { title: "Uni Nope", slug: "uni-nope", description: "", opensAt: hours(-1), dueAt: hours(48), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: P.id, points: 100 }], audience: [] } })).json?.error?.code === "private_problem")
const run = (who) => who("/submissions", { body: { kind: "run", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(5)" }], inputs: ["1"], problemSlug: "uni-members" } })
check("the college's student runs code on it through that work", (await run(s1)).status === 200)
check("…another college's student can't reach it", [403, 404].includes((await run(s2)).status))
check("stopping sharing takes it from the colleges' library", (await share(vc, [{ kind: "question", id: Q.id }], "owner")).status === 200 && !has(await lib(c1, "uni-c1"), Q.id))
check("…a template too", await (async () => {
  const T = (await vc(`${U}/templates`, { body: { title: "Uni Tpl", slug: "x", description: "", opensAt: hours(0), dueAt: hours(1), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [], problems: [{ problemId: P.id, points: 10, rubric: [], outcomes: [] }], questions: [] } })).json?.template
  if (!T) return false
  await share(vc, [{ kind: "template", id: T.id }])
  return ((await c1("/orgs/uni-c1/templates")).json ?? []).some((t) => t.id === T.id)
})())

// ---------- the pages
const browser = await chromium.launch()
const errors = []
try {
  const open = async (email, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addCookies([{ name: "next-auth.session-token", value: await session(email), url: BASE }])
    const p = await ctx.newPage()
    p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
    return p
  }
  // the college asks from its page
  const cp = await open("uni-c2o@example.com", 1440)
  await cp.goto(`${BASE}/orgs/uni-c2/manage/university`)
  await cp.getByLabel("University's address").fill("uni-u")
  await cp.getByLabel("Note (optional)").fill("Second letter")
  await cp.getByRole("button", { name: "Ask to affiliate" }).click()
  await cp.getByTestId("affiliation-waiting").waitFor({ timeout: 30000 })
  check("the college asks from Manage › University", (await cp.getByText("Waiting for Uni University").count()) === 1)
  check("University is in the college's sidebar", (await cp.getByRole("link", { name: "University" }).count()) > 0)
  check("…its earlier affiliation is listed below", (await cp.getByRole("cell", { name: "Ended" }).count()) === 1)
  await cp.screenshot({ path: SHOTS + "university-college.png", fullPage: true })

  // the university approves from its page
  const up = await open("uni-vc@example.com", 1440)
  await up.goto(`${BASE}${U}/manage/colleges`)
  await up.getByTestId("affiliated-college").first().waitFor({ timeout: 30000 })
  check("Affiliated colleges is in the university's sidebar", (await up.getByRole("link", { name: "Affiliated colleges" }).count()) > 0)
  await up.getByRole("button", { name: "Approve Second College" }).click()
  await up.getByLabel("College code").fill("FC1")
  await up.getByRole("dialog").getByRole("button", { name: "Approve" }).click()
  await up.getByText("Another college already has that code.").waitFor({ timeout: 15000 })
  check("…a taken code is explained in the dialog", true)
  await up.screenshot({ path: SHOTS + "university-approve.png" })
  await up.getByLabel("College code").fill("SC9")
  await up.getByRole("dialog").getByRole("button", { name: "Approve" }).click()
  await up.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 })
  await up.getByRole("cell", { name: "SC9" }).waitFor({ timeout: 15000 })
  check("…approved, the college shows with its code", psql(`select college_code from org_affiliations where college_id='${id("uni-c2")}' and status='active'`) === "SC9")
  await up.screenshot({ path: SHOTS + "university-colleges.png", fullPage: true })

  await cp.reload()
  await cp.getByTestId("affiliation-active").waitFor({ timeout: 30000 })
  check("the college's page shows it affiliated", (await cp.getByText("Affiliated to Uni University").count()) === 1)

  await up.goto(`${BASE}${U}/manage/library`)
  await up.getByRole("tab", { name: "Questions" }).click()
  await up.getByRole("checkbox", { name: "Select Uni Q1 (v2)" }).click()
  await up.getByRole("button", { name: "Share with colleges" }).click()
  await up.getByText(/Shared 1 with your affiliated colleges/).waitFor({ timeout: 15000 })
  check("the library shares a question with the colleges", psql(`select sharing from questions where title='Uni Q1 (v2)'`) === "affiliates")
  await up.getByTestId("sharing-cell").first().waitFor()
  await up.screenshot({ path: SHOTS + "university-library.png", fullPage: true })

  const phone = await open("uni-vc@example.com", 390)
  await phone.goto(`${BASE}${U}/manage/colleges`)
  await phone.getByTestId("affiliated-college").first().waitFor({ timeout: 30000 })
  check("the colleges page on a phone, without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.screenshot({ path: SHOTS + "university-colleges-phone.png", fullPage: true })
  const cphone = await open("uni-c2o@example.com", 390)
  await cphone.goto(`${BASE}/orgs/uni-c2/manage/university`)
  await cphone.getByTestId("affiliation-active").waitFor({ timeout: 30000 })
  check("the college's page on a phone, without sideways scrolling", await cphone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await cphone.screenshot({ path: SHOTS + "university-college-phone.png", fullPage: true })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll university checks passed")
process.exit(failures ? 1 : 0)
