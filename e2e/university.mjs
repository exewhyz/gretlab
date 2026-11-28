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
const people = ["uni-vc", "uni-reg", "uni-c1o", "uni-c2o", "uni-c3o", "uni-u2o", "uni-t", "uni-out", "uni-s1", "uni-s2", "uni-r1", "uni-r2", "uni-r3"]
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

// ---------- the common syllabus
const grp = async (who, slug, name, parentId) => (await who(`/orgs/${slug}/groups`, { body: { name, ...(parentId ? { parentId } : {}) } })).json
const school = await grp(vc, "uni-u", "Engineering")
const dept = await grp(vc, "uni-u", "Computer Science", school.id)
const prog = await grp(vc, "uni-u", "B.Tech CSE", dept.id)
const subj = async (who, slug, body) => (await who(`/orgs/${slug}/subjects`, { body: { description: "", ...body } })).json
const DS = await subj(vc, "uni-u", { name: "Data Structures", code: "DS301", credits: 4 })
const DBS = await subj(vc, "uni-u", { name: "Database Systems", code: "DB302", credits: 3 })
const LAB = await subj(vc, "uni-u", { name: "Workshop", code: "WS300", credits: null })
check("the university has its courses", Boolean(DS?.id && DBS?.id && LAB?.id), JSON.stringify(DS))
const syl = (await vc(`${U}/syllabus`)).json
check("its programs are the groups at the Program level", syl?.programs?.map((p) => p.path).join() === "Engineering › Computer Science › B.Tech CSE", JSON.stringify(syl?.programs))
const marks = (subjectId, over = {}) => ({ subjectId, internalMax: 40, externalMax: 60, passExternal: 24, passTotal: 40, ...over })
const setSem = (who, n, courses, programId = prog.id) => who(`${U}/syllabus/${programId}/${n}`, { method: "PUT", body: { courses } })
check("a course without credits can't go in", (await setSem(vc, 3, [marks(LAB.id)])).json?.error?.code === "no_credits")
const badMarks = await setSem(vc, 3, [marks(DS.id, { passExternal: 70 })])
check("marks that don't add up are refused, naming the course", badMarks.json?.error?.message === "Data Structures: The external pass mark can't be more than the external marks.", JSON.stringify(badMarks.json))
check("a semester past 12 is refused", (await setSem(vc, 13, [marks(DS.id)])).json?.error?.code === "bad_semester")
check("a group that isn't a program is refused", (await setSem(vc, 3, [marks(DS.id)], dept.id)).status === 404)
const foreign = await subj(u2, "uni-u2", { name: "Elsewhere", code: "EL1", credits: 3 })
check("another organization's course is refused", (await setSem(vc, 3, [marks(foreign.id)])).json?.error?.code === "unknown_course")
check("someone who only oversees can read it but not change it", (await registrar(`${U}/syllabus`)).json?.can?.edit === false && (await setSem(registrar, 3, [marks(DS.id)])).status === 403)
const sem3 = await setSem(vc, 3, [marks(DS.id), marks(DBS.id, { internalMax: 30, externalMax: 70, passExternal: 28 })])
check("the university sets semester 3", sem3.status === 200 && sem3.json?.courses === 2 && sem3.json.classes === 0, JSON.stringify(sem3.json))

// a college follows it
const own = await subj(c1, "uni-c1", { name: "DBMS", code: "db302", credits: 4 })
const cls = await grp(c1, "uni-c1", "CSE 2nd year")
const cp = (await c1("/orgs/uni-c1/university/classes")).json
check("the college sees the university's programs with courses", cp?.programs?.length === 1 && cp.programs[0].semesters[0]?.semester === 3 && cp.programs[0].semesters[0].courses === 2, JSON.stringify(cp))
const follow = (who, slug, body) => who(`/orgs/${slug}/university/classes`, { body })
check("a semester without courses can't be followed", (await follow(c1, "uni-c1", { groupId: cls.id, programId: prog.id, semester: 5 })).json?.error?.code === "no_courses")
check("another organization's class can't be put on it", (await follow(c1, "uni-c1", { groupId: prog.id, programId: prog.id, semester: 3 })).status === 404)
const cls2 = await grp(c2, "uni-c2", "CSE B")
check("a college that isn't affiliated can't follow", (await follow(c2, "uni-c2", { groupId: cls2.id, programId: prog.id, semester: 3 })).json?.error?.code === "not_affiliated")
check("a member without subjects can't", (await teacher("/orgs/uni-c1/university/classes")).status >= 403)
const followed = await follow(c1, "uni-c1", { groupId: cls.id, programId: prog.id, semester: 3 })
check("the college puts a class on semester 3, and it takes both courses", followed.status === 200 && followed.json?.added === 2, JSON.stringify(followed.json))
const theirSubjects = async () => (await c1("/orgs/uni-c1/subjects")).json?.subjects ?? []
let mine2 = await theirSubjects()
const copyDS = mine2.find((s) => s.code === "DS301")
const copyDB = mine2.find((s) => s.id === own.id)
check("the university's course is made the college's own, locked", copyDS?.name === "Data Structures" && copyDS.credits === 4 && copyDS.fromUniversity === true && copyDS.classes.some((c) => c.groupId === cls.id), JSON.stringify(copyDS))
check("…and the college's course with the same code is linked, taking the university's name and credits", copyDB?.name === "Database Systems" && copyDB.code === "DB302" && copyDB.credits === 3 && copyDB.fromUniversity === true, JSON.stringify(copyDB))
check("following again adds nothing", (await follow(c1, "uni-c1", { groupId: cls.id, programId: prog.id, semester: 3 })).json?.added === 0)
check("the college can't rename a locked course", (await c1(`/orgs/uni-c1/subjects/${copyDS.id}`, { method: "PUT", body: { name: "DS", code: "DS301", description: "", credits: 4 } })).json?.error?.code === "from_university")
check("…but can describe it", (await c1(`/orgs/uni-c1/subjects/${copyDS.id}`, { method: "PUT", body: { name: "Data Structures", code: "DS301", description: "Taught in lab 2", credits: 4 } })).status === 200)
check("…nor delete it", (await c1(`/orgs/uni-c1/subjects/${copyDS.id}`, { method: "DELETE" })).json?.error?.code === "from_university")
await vc(`${U}/subjects/${DS.id}`, { method: "PUT", body: { name: "Data Structures and Algorithms", code: "DS301", description: "", credits: 4.5 } })
mine2 = await theirSubjects()
check("a change at the university reaches the college's copy", mine2.find((s) => s.id === copyDS.id)?.name === "Data Structures and Algorithms" && mine2.find((s) => s.id === copyDS.id)?.credits === 4.5)
const OS = await subj(vc, "uni-u", { name: "Operating Systems", code: "OS303", credits: 3 })
const grown = await setSem(vc, 3, [marks(DS.id), marks(DBS.id, { internalMax: 30, externalMax: 70, passExternal: 28 }), marks(OS.id)])
check("a course added at the university reaches the class following it", grown.json?.classes === 1 && psql(`select count(*) from class_subjects where group_id='${cls.id}'`) === "3", JSON.stringify(grown.json))
const mapId = (await c1("/orgs/uni-c1/university/classes")).json?.classes?.[0]?.id
check("the class stops following, keeping its courses", (await c1(`/orgs/uni-c1/university/classes/${mapId}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from class_subjects where group_id='${cls.id}'`) === "3")
await follow(c1, "uni-c1", { groupId: cls.id, programId: prog.id, semester: 3 })
const logged = [psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action='university.syllabus'`), psql(`select count(*) from audit_log where org_id='${id("uni-c1")}' and action='university.class_program'`)]
check("both sides' activity logs have it", logged[0] === "2" && Number(logged[1]) >= 3, logged.join())

// ---------- student registration
const C1 = id("uni-c1")
for (const h of ["uni-r1", "uni-r2", "uni-r3"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${C1}','${uid(h)}','active','created')`)
await c1(`/orgs/uni-c1/groups/${cls.id}/members`, { body: { userIds: ["uni-r1", "uni-r2", "uni-r3"].map(uid) } })
// Students with a record: r1 and r2 (r3 has none).
for (const [h, adm] of [["uni-r1", "A001"], ["uni-r2", "A002"], ["uni-s1", "A003"]]) psql(`insert into student_records(org_id,user_id,admission_no,admitted_on) values ('${C1}','${uid(h)}','${adm}','2026-06-01')`)
const reg = (who, slug, body) => who(`/orgs/${slug}/university/registrations`, { body })
check("an admission year before 2000 is refused", (await reg(c1, "uni-c1", { groupId: cls.id, programId: prog.id, admissionYear: 1999 })).json?.error?.code === "bad_year")
check("a group that isn't the university's program is refused", (await reg(c1, "uni-c1", { groupId: cls.id, programId: dept.id, admissionYear: 2026 })).json?.error?.code === "unknown_program")
check("a college that isn't affiliated can't register", (await reg(c2, "uni-c2", { groupId: cls2.id, programId: prog.id, admissionYear: 2026 })).json?.error?.code === "not_affiliated")
check("someone without student records can't", (await teacher("/orgs/uni-c1/university/registrations")).status >= 403)
check("a person without a student record can't be registered by name", (await reg(c1, "uni-c1", { studentIds: [uid("uni-r3")], programId: prog.id, admissionYear: 2026 })).json?.error?.code === "not_a_student")
const reg1 = await reg(c1, "uni-c1", { groupId: cls.id, programId: prog.id, admissionYear: 2026 })
check("a college registers a class: its students with records, the rest left out", reg1.status === 200 && reg1.json?.registered === 2 && reg1.json.skipped === 1, JSON.stringify(reg1.json))
check("…registering again adds nobody twice", (await reg(c1, "uni-c1", { groupId: cls.id, programId: prog.id, admissionYear: 2026 })).json?.alreadyRegistered === 2)
check("the university is told", Number(psql(`select count(*) from notifications where user_id='${uid("uni-vc")}' and kind='registration'`)) >= 1)
const waitingList = (await vc(`${U}/registrations?status=requested`)).json
check("the university sees them waiting, with the college's admission numbers", waitingList?.items?.length === 2 && waitingList.items.every((r) => r.college === "First College" && /^A00/.test(r.admissionNo)) && waitingList.can.decide === true, JSON.stringify(waitingList).slice(0, 300))
check("…and never their email addresses", !JSON.stringify(waitingList).includes("@example.com"))
check("someone who only oversees sees them but can't decide", (await registrar(`${U}/registrations`)).json?.can?.decide === false && (await registrar(`${U}/registrations/decide`, { body: { ids: [waitingList.items[0].id], action: "approve" } })).status === 403)
check("another university sees none of them", ((await u2("/orgs/uni-u2/registrations")).json?.items ?? []).length === 0)
const approved = await vc(`${U}/registrations/decide`, { body: { ids: waitingList.items.map((r) => r.id), action: "approve" } })
const numbers = psql(`select string_agg(reg_no, ',' order by reg_no) from university_registrations where college_id='${C1}' and status='approved'`)
check("approving numbers them in order: college code, year, sequence", approved.status === 200 && numbers === "FC120260001,FC120260002", numbers)
check("…once: they can't be decided again", (await vc(`${U}/registrations/decide`, { body: { ids: [waitingList.items[0].id], action: "reject" } })).json?.error?.code === "bad_step")
check("the college is told", Number(psql(`select count(*) from notifications where user_id='${uid("uni-c1o")}' and kind='registration'`)) >= 1)
const record = (await c1(`/orgs/uni-c1/students/${uid("uni-r1")}`)).json
check("the student's record shows the university's number", record?.university?.regNo === "FC120260001" && record.university.university === "Uni University", JSON.stringify(record?.university))
const one = await reg(c1, "uni-c1", { studentIds: [uid("uni-s1")], programId: prog.id, admissionYear: 2026 })
const s1Reg = psql(`select id from university_registrations where student_id='${uid("uni-s1")}' and status='requested'`)
check("a single student is registered by name", one.json?.registered === 1 && Boolean(s1Reg))
check("the university rejects with a note", (await vc(`${U}/registrations/decide`, { body: { ids: [s1Reg], action: "reject", note: "Documents missing" } })).status === 200 && psql(`select status || ':' || note from university_registrations where id='${s1Reg}'`) === "rejected:Documents missing")
await reg(c1, "uni-c1", { studentIds: [uid("uni-s1")], programId: prog.id, admissionYear: 2026 })
const again = psql(`select id from university_registrations where student_id='${uid("uni-s1")}' and status='requested'`)
check("the college cancels a waiting one", (await c1(`/orgs/uni-c1/university/registrations/${again}`, { method: "DELETE" })).status === 200 && psql(`select status from university_registrations where id='${again}'`) === "cancelled")
check("…but not a decided one", (await c1(`/orgs/uni-c1/university/registrations/${waitingList.items[0].id}`, { method: "DELETE" })).json?.error?.code === "bad_step")
check("…nor another college's", (await c2(`/orgs/uni-c2/university/registrations/${waitingList.items[0].id}`, { method: "DELETE" })).status === 404)
await reg(c1, "uni-c1", { studentIds: [uid("uni-s1")], programId: prog.id, admissionYear: 2026 })
const mineList = (await c1("/orgs/uni-c1/university/registrations")).json
check("the college lists its registrations with counts", mineList?.counts?.approved === 2 && mineList.counts.requested === 1 && mineList.items.length >= 5, JSON.stringify(mineList?.counts))
check("both activity logs have the registrations", Number(psql(`select count(*) from audit_log where org_id='${C1}' and action='university.registration'`)) >= 4 && Number(psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action='university.registration'`)) >= 2)

// ---------- university exams and results
const UX = `${U}/university-exams`
check("someone who only oversees can't set an exam", (await registrar(UX, { body: { programId: prog.id, semester: 3, name: "Dec 2026" } })).status === 403)
check("a semester without courses can't have an exam", (await vc(UX, { body: { programId: prog.id, semester: 5, name: "Dec 2026" } })).json?.error?.code === "no_courses")
const ex = (await vc(UX, { body: { programId: prog.id, semester: 3, name: "Dec 2026", startsOn: "2026-12-01", endsOn: "2026-12-15" } })).json
check("the university sets an exam for semester 3", Boolean(ex?.id), JSON.stringify(ex))
check("…once by that name", (await vc(UX, { body: { programId: prog.id, semester: 3, name: "dec 2026" } })).json?.error?.code === "duplicate")
const sheet = async (who = vc, qs = "") => (await who(`${UX}/${ex.id}${qs}`)).json
let sh = await sheet()
check("those sitting it: registered students in a class on that semester", sh?.total === 2 && sh.students.map((x) => x.regNo).join() === "FC120260001,FC120260002" && sh.courses.length === 3, JSON.stringify(sh?.students?.map((x) => x.regNo)))
check("someone who only oversees can read the sheet", (await sheet(registrar))?.can?.edit === false)
const CX = `/orgs/uni-c1/university/exams`
check("the college sees the exam its class sits", ((await c1(CX)).json?.exams ?? []).some((e) => e.id === ex.id))
const isheet = (await c1(`${CX}/${ex.id}`)).json
check("the college's internal sheet lists its sitters and the courses with internal marks", isheet?.students?.length === 2 && isheet.courses.length === 3, JSON.stringify(isheet).slice(0, 200))
const DSx = sh.courses.find((c) => c.code === "DS301").subjectId, DBx = sh.courses.find((c) => c.code === "DB302").subjectId, OSx = sh.courses.find((c) => c.code === "OS303").subjectId
const internal = (who, subjectId, marks) => who(`${CX}/${ex.id}`, { method: "PUT", body: { subjectId, marks } })
const R1 = uid("uni-r1"), R2 = uid("uni-r2")
check("internal marks above the course's internal maximum are refused", (await internal(c1, DSx, [{ studentId: R1, internal: 41 }])).json?.error?.code === "bad_mark")
check("…and for someone who doesn't sit it", (await internal(c1, DSx, [{ studentId: uid("uni-r3"), internal: 10 }])).json?.error?.code === "not_sitting")
// A marks clerk for another class of the college.
const other = await grp(c1, "uni-c1", "Elsewhere")
psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${C1}','${uid("uni-out")}','active','created')`)
const clerkRole = (await c1("/orgs/uni-c1/roles", { body: { name: "Marks clerk", permissions: ["exams.marks"] } })).json
await c1(`/orgs/uni-c1/members/${uid("uni-out")}/roles`, { body: { roleId: clerkRole.id, groupId: other.id } })
check("a marks clerk for another class sees none of these students", ((await outsider(`${CX}/${ex.id}`)).json?.students ?? []).length === 0)
check("…and can't enter their marks", (await internal(outsider, DSx, [{ studentId: R1, internal: 30 }])).status === 403)
for (const [sub, a, b] of [[DSx, 32, 10], [DBx, 25, 20], [OSx, 35, 30]]) await internal(c1, sub, [{ studentId: R1, internal: a }, { studentId: R2, internal: b }])
check("the college enters internal marks", psql(`select count(*) from university_marks where exam_id='${ex.id}' and internal is not null`) === "6")
const external = (who, subjectId, marks) => who(`${UX}/${ex.id}/marks`, { method: "PUT", body: { subjectId, marks } })
check("external marks above the maximum are refused", (await external(vc, DSx, [{ studentId: R1, external: 61 }])).json?.error?.code === "bad_mark")
check("a college can't enter external marks", (await external(c1, DSx, [{ studentId: R1, external: 50 }])).status >= 403)
check("the university enters external marks", (await external(vc, DSx, [{ studentId: R1, external: 50 }, { studentId: R2, external: 30 }])).json?.saved === 2)
check("publishing with marks missing asks first", (await vc(`${UX}/${ex.id}/publish`, { body: { publish: true } })).json?.error?.code === "incomplete")
const badCsv = await vc(`${UX}/${ex.id}/import`, { body: { csv: "Registration number,Course code,Marks\nFC120260001,DB302,60\nFC999,DB302,10\nFC120260002,XX1,5" } })
check("an import with a wrong line saves nothing and says which", badCsv.json?.saved === 0 && badCsv.json.problems.map((p) => p.line).join() === "3,4" && psql(`select count(*) from university_marks where exam_id='${ex.id}' and external is not null`) === "2", JSON.stringify(badCsv.json))
const goodCsv = await vc(`${UX}/${ex.id}/import`, { body: { csv: "FC120260001,db302,60\nFC120260002,DB302,AB\nFC120260001,OS303,45\nFC120260002,OS303,40" } })
check("an import of external marks, with AB for absent", goodCsv.json?.saved === 4 && psql(`select absent from university_marks where exam_id='${ex.id}' and student_id='${R2}' and subject_id='${DBx}'`) === "t", JSON.stringify(goodCsv.json))
check("the university closes internal marks", (await vc(`${UX}/${ex.id}/internal-closed`, { method: "PUT", body: { closed: true } })).status === 200)
check("…and the college can't change them", (await internal(c1, DSx, [{ studentId: R1, internal: 40 }])).json?.error?.code === "internal_closed")
check("someone who only oversees can't publish", (await registrar(`${UX}/${ex.id}/publish`, { body: { publish: true } })).status === 403)
const published = await vc(`${UX}/${ex.id}/publish`, { body: { publish: true } })
check("the university publishes, telling each student", published.json?.published === true && published.json.told === 2, JSON.stringify(published.json))
sh = await sheet()
const res = (reg) => sh.students.find((x) => x.regNo === reg)
check("results: internal plus external, graded, SGPA by credits", res("FC120260001").result.sgpa === 9 && res("FC120260001").courses.every((c) => c.grade === "A+"), JSON.stringify(res("FC120260001")))
check("…a course passes at the pass marks, an absence is a backlog", res("FC120260002").courses.find((c) => c.subjectId === DSx).grade === "P" && res("FC120260002").courses.find((c) => c.subjectId === DBx).outcome === "absent" && res("FC120260002").result.backlogs === 1 && res("FC120260002").result.sgpa === 4, JSON.stringify(res("FC120260002").result))
// Report cards need a year with the student enrolled.
const yr = psql(`insert into academic_years(org_id,name,starts_on,ends_on,is_current) values ('${C1}','2026-27','2026-06-01','2027-05-31',true) returning id`).split("\n")[0]
for (const h of ["uni-r1", "uni-r2"]) psql(`insert into enrolments(org_id,year_id,user_id,group_id,status) values ('${C1}','${yr}','${uid(h)}','${cls.id}','active')`)
const [sr1, sr2] = await Promise.all(["uni-r1", "uni-r2"].map((h) => client(`${h}@example.com`)))
const card = (await sr1("/orgs/uni-c1/report-cards/me")).json
check("the student's report card shows the university results and CGPA", card?.university?.regNo === "FC120260001" && card.university.exams[0]?.result.sgpa === 9 && card.university.cgpa === 9, JSON.stringify(card?.university).slice(0, 300))
check("the student was told", Number(psql(`select count(*) from notifications where user_id='${R1}' and kind='results'`)) >= 1)
check("…the college's staff see it on the report card too", (await c1(`/orgs/uni-c1/report-cards/${R2}`)).json?.university?.exams?.[0]?.result?.backlogs === 1)
const pdf = await fetch(`${BASE}/api/v1/orgs/uni-c1/report-cards/me/pdf`, { headers: { cookie: `next-auth.session-token=${await session("uni-r1@example.com")}` } })
check("…and in the report card's PDF", pdf.status === 200 && pdf.headers.get("content-type")?.includes("pdf") && (await pdf.arrayBuffer()).byteLength > 1000)
await external(vc, OSx, [{ studentId: R2, external: 42 }])
check("a change after publishing is logged as a correction", psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action='university.marks_correct'`) === "1")
check("taking the results back hides them", (await vc(`${UX}/${ex.id}/publish`, { body: { publish: false } })).status === 200 && (await sr1("/orgs/uni-c1/report-cards/me")).json?.university === null)
await vc(`${UX}/${ex.id}/publish`, { body: { publish: true } })
check("another university can't open the exam", (await u2(`/orgs/uni-u2/university-exams/${ex.id}`)).status === 404)
check("both activity logs have the exam's steps", Number(psql(`select count(*) from audit_log where org_id='${id("uni-u")}' and action in ('university.exam','university.marks')`)) >= 5 && Number(psql(`select count(*) from audit_log where org_id='${C1}' and action='university.marks'`)) >= 3)

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

  await up.goto(`${BASE}${U}/manage/syllabus`)
  await up.getByRole("button", { name: /^Semester 3/ }).waitFor({ timeout: 30000 })
  check("Syllabus is in the university's sidebar", (await up.getByRole("link", { name: "Syllabus" }).count()) > 0)
  await up.getByRole("button", { name: /^Semester 3/ }).click()
  await up.getByTestId("semester-credits").filter({ hasText: "3 courses · 10.5 credits" }).waitFor({ timeout: 15000 })
  await up.getByLabel("Internal marks for Operating Systems").fill("50")
  await up.getByLabel("External marks for Operating Systems").fill("50")
  await up.getByRole("button", { name: "Save semester 3" }).click()
  await up.getByTestId("syllabus-saved").waitFor({ timeout: 15000 })
  check("the university changes a course's marks from the page", psql(`select internal_max from syllabus_courses where subject_id='${OS.id}'`) === "50")
  await up.screenshot({ path: SHOTS + "university-syllabus.png", fullPage: true })
  await up.goto(`${BASE}${U}/manage/registrations`)
  await up.getByTestId("university-registration").first().waitFor({ timeout: 30000 })
  check("Registrations is in the university's sidebar", (await up.getByRole("link", { name: "Registrations" }).count()) > 0)
  await up.getByRole("checkbox", { name: "Select uni-s1 Name" }).click()
  await up.getByRole("button", { name: "Approve and number" }).click()
  await up.getByRole("button", { name: /^All$/ }).click()
  await up.getByRole("cell", { name: "FC120260003" }).waitFor({ timeout: 15000 })
  check("the university approves from the page, and the next number follows", psql(`select reg_no from university_registrations where student_id='${uid("uni-s1")}' and status='approved'`) === "FC120260003")
  await up.screenshot({ path: SHOTS + "university-registrations.png", fullPage: true })
  const c1p = await open("uni-c1o@example.com", 1440)
  await c1p.goto(`${BASE}/orgs/uni-c1/manage/university`)
  await c1p.getByTestId("class-program").first().waitFor({ timeout: 30000 })
  await c1p.getByTestId("college-registration").first().waitFor({ timeout: 30000 })
  check("the college's page lists its registrations", (await c1p.getByTestId("college-registration").count()) >= 5)
  check("the college's page lists its classes on the university's syllabus", (await c1p.getByTestId("class-program").first().textContent()).includes("CSE 2nd year"))
  await c1p.screenshot({ path: SHOTS + "university-college-classes.png", fullPage: true })
  check("the college's page lists the university exam", (await c1p.getByTestId("college-university-exam").count()) === 1)
  await c1p.goto(`${BASE}/orgs/uni-c1/manage/university/exams/${ex.id}`)
  await c1p.getByTestId("internal-student").first().waitFor({ timeout: 30000 })
  check("the college's internal marks page is read-only once closed", await c1p.getByLabel("Internal marks for uni-r1 Name").isDisabled())
  await c1p.screenshot({ path: SHOTS + "university-internal.png", fullPage: true })
  await c1p.goto(`${BASE}/orgs/uni-c1/manage/subjects`)
  await c1p.getByTestId("from-university").first().waitFor({ timeout: 30000 })
  check("Subjects marks the university's courses", (await c1p.getByTestId("from-university").count()) === 3)
  await c1p.screenshot({ path: SHOTS + "university-college-subjects.png", fullPage: true })
  await up.goto(`${BASE}${U}/manage/university-exams/${ex.id}`)
  await up.getByTestId("exam-student").first().waitFor({ timeout: 30000 })
  check("University exams is in the university's sidebar", (await up.getByRole("link", { name: "University exams" }).count()) > 0)
  await up.getByLabel("Course").selectOption({ label: "OS303 · Operating Systems" })
  await up.getByLabel("External marks for uni-r2 Name").fill("44")
  await up.getByRole("button", { name: "Save Operating Systems marks" }).click()
  await up.getByText("Marks saved.").first().waitFor({ timeout: 15000 })
  check("the university corrects a mark from the page", psql(`select external from university_marks where exam_id='${ex.id}' and student_id='${R2}' and subject_id='${OSx}'`) === "44")
  await up.screenshot({ path: SHOTS + "university-exam.png", fullPage: true })
  const examPhone = await open("uni-vc@example.com", 390)
  await examPhone.goto(`${BASE}${U}/manage/university-exams/${ex.id}`)
  await examPhone.getByTestId("exam-student").first().waitFor({ timeout: 30000 })
  check("the exam page on a phone, without sideways scrolling", await examPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await examPhone.screenshot({ path: SHOTS + "university-exam-phone.png", fullPage: true })
  const rc = await open("uni-r2@example.com", 1440)
  await rc.goto(`${BASE}/orgs/uni-c1/results/me`)
  await rc.getByTestId("university-results").waitFor({ timeout: 30000 })
  check("the report card page shows University results", (await rc.getByTestId("university-sgpa").first().textContent()).trim().length > 0)
  await rc.screenshot({ path: SHOTS + "university-report-card.png", fullPage: true })
  const rcPhone = await open("uni-r2@example.com", 390)
  await rcPhone.goto(`${BASE}/orgs/uni-c1/results/me`)
  await rcPhone.getByTestId("university-results").waitFor({ timeout: 30000 })
  check("…on a phone, without sideways scrolling", await rcPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await rcPhone.screenshot({ path: SHOTS + "university-report-card-phone.png", fullPage: true })
  const regPhone = await open("uni-vc@example.com", 390)
  await regPhone.goto(`${BASE}${U}/manage/registrations`)
  await regPhone.getByRole("heading", { name: "Registrations" }).waitFor({ timeout: 30000 })
  check("registrations on a phone, without sideways scrolling", await regPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await regPhone.screenshot({ path: SHOTS + "university-registrations-phone.png", fullPage: true })
  const sylPhone = await open("uni-vc@example.com", 390)
  await sylPhone.goto(`${BASE}${U}/manage/syllabus`)
  await sylPhone.getByRole("button", { name: /^Semester 3/ }).click()
  await sylPhone.getByTestId("syllabus-course").first().waitFor({ timeout: 30000 })
  check("the syllabus on a phone, without sideways scrolling", await sylPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await sylPhone.screenshot({ path: SHOTS + "university-syllabus-phone.png", fullPage: true })

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
