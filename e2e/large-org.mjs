/**
 * One organization at a size real ones reach (a university of tens of thousands): what works
 * for a class must work for all of them. The people are written straight into the database
 * (the API adds them one at a time), then each check goes through the API as a person would.
 *   - a notice to a grade of 20,000 students reaches every one of them, in the bell and by email
 *   - with parent accounts, 5,000 parents each get a copy naming their own child
 *   - an assignment's gradebook for all 20,000: the summary counts everyone, the screen gets a
 *     page at a time and searches on the server, and the CSV still has everyone
 *   - member pickers ask for a page; the whole list stays complete for integrations
 *   - the largest imports allowed (5,000 members, 3,000 student records), timed
 *   - a year of 40,000 students made current, then promoted to the next, each in one request
 *   node e2e/large-org.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/large-org/"
mkdirSync(SHOTS, { recursive: true })
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const STUDENTS = Number(process.env.LARGE_ORG_STUDENTS ?? 20_000)
const SECTIONS = 4
const PARENTS = Math.min(5_000, STUDENTS)
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 2000)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q], { maxBuffer: 64 * 1024 * 1024 }).toString().trim()
const cleanup = () => {
  psql(`delete from email_outbox where to_address like 'lo-%@example.com'`)
  psql(`delete from submissions where user_id in (select id from users where email like 'lo-%@example.com')`)
  psql(`delete from organizations where slug = 'lo-uni'`)
  psql(`delete from users where email like 'lo-%@example.com' or email like 'lo-twin@%'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('lo-o@example.com','Lo Owner','student','lo-o')`)

// ---------- a university: one grade, its sections, and STUDENTS students spread across them
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Lo University", slug: "lo-uni", type: "college", ownerEmail: "lo-o@example.com" } })
const O = "/orgs/lo-uni"
const orgId = psql(`select id from organizations where slug = 'lo-uni'`)
const owner = await client("lo-o@example.com")
const year = (await owner(`${O}/groups`, { body: { name: "First year" } })).json
const sections = []
for (let i = 1; i <= SECTIONS; i++) sections.push((await owner(`${O}/groups`, { body: { name: `Section ${i}`, parentId: year.id } })).json)
let started = Date.now()
psql(`
  insert into users (email, name, role, handle)
    select 'lo-s-' || g || '@example.com', 'Lo Student ' || g, 'student', 'lo-s-' || g
    from generate_series(1, ${STUDENTS}) g;
  insert into org_members (org_id, user_id, status, joined_via)
    select '${orgId}', id, 'active', 'created' from users where email like 'lo-s-%@example.com';
  insert into group_members (group_id, user_id)
    select (array[${sections.map((s) => `'${s.id}'::uuid`).join(",")}])[1 + (substring(email from 'lo-s-([0-9]+)@')::int % ${SECTIONS})], id
    from users where email like 'lo-s-%@example.com';
`)
const placed = Number(psql(`select count(*) from group_members gm join org_groups g on g.id = gm.group_id where g.org_id = '${orgId}'`))
// Parents for the first PARENTS students, with the module on.
await owner(O, { method: "PATCH", body: { modules: { parents: true } } })
psql(`
  insert into users (email, name, role, handle)
    select 'lo-p-' || g || '@example.com', 'Lo Parent ' || g, 'student', 'lo-p-' || g
    from generate_series(1, ${PARENTS}) g;
  insert into guardians (org_id, parent_id, student_id, relation)
    select '${orgId}', p.id, s.id, 'mother'
    from generate_series(1, ${PARENTS}) g
    join users p on p.email = 'lo-p-' || g || '@example.com'
    join users s on s.email = 'lo-s-' || g || '@example.com';
`)
check(`the set-up worked: ${STUDENTS} students in ${SECTIONS} sections (${Date.now() - started} ms)`, !!year?.id && sections.every((s) => s?.id) && placed === STUDENTS, JSON.stringify({ year, placed }))

// ---------- a notice to the whole year reaches everyone
started = Date.now()
const notice = await owner(`${O}/classes/${year.id}/stream`, { body: { text: "Exams start on Monday." } })
const took = Date.now() - started
check(`posting a notice to ${STUDENTS} students answers (${took} ms)`, notice.status === 200, JSON.stringify(notice.json))
const bells = Number(psql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email like 'lo-s-%@example.com' and n.kind = 'notice'`))
check(`every student has it in their bell (${bells} of ${STUDENTS})`, bells === STUDENTS)
const emails = Number(psql(`select count(*) from email_outbox where to_address like 'lo-s-%@example.com'`))
check(`an email is queued for every student (${emails} of ${STUDENTS})`, emails === STUDENTS)
const copies = Number(psql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email like 'lo-p-%@example.com' and n.kind = 'child_update'`))
check(`every parent gets a copy (${copies} of ${PARENTS})`, copies === PARENTS)
const named = psql(`select n.title || '|' || n.href from notifications n join users u on u.id = n.user_id where u.email = 'lo-p-42@example.com' and n.kind = 'child_update'`)
const child42 = psql(`select id from users where email = 'lo-s-42@example.com'`)
check("…naming their own child and linking to them", named.startsWith("Lo Student 42: New notice in First year|") && named.endsWith(`/children/${child42}`), named)
const parentEmails = Number(psql(`select count(*) from email_outbox where to_address like 'lo-p-%@example.com'`))
check(`…and by email (${parentEmails} of ${PARENTS})`, parentEmails === PARENTS)
const shared = psql(`select count(distinct content_id) || '|' || count(*) filter (where content_id is null) from email_outbox where to_address like 'lo-s-%@example.com'`)
const words = psql(`select subject from email_contents where id = (select content_id from email_outbox where to_address = 'lo-s-1@example.com')`)
check("…its words stored once, shared by all 20,000 emails", shared === "1|0" && words.includes("New notice in First year"), JSON.stringify({ shared, words }))
const student = await client("lo-s-7@example.com")
const mine = (await student("/me/notifications")).json
check("a student sees the notice in their bell", JSON.stringify(mine ?? "").includes("New notice in First year"), JSON.stringify(mine).slice(0, 300))

// ---------- an assignment for the whole year, with half of them already done
const problemId = psql(`select id from problems where slug = 'integer-operations'`)
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const work = await owner(`${O}/assignments`, { body: { title: "Week 1", slug: "lo-week-1", description: "", opensAt: hours(-2), dueAt: hours(48), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId, points: 100 }], audience: [[year.id]] } })
check("an assignment for the whole year", work.status === 200, JSON.stringify(work.json).slice(0, 200))
const DONE = STUDENTS / 2
psql(`
  insert into submissions (user_id, problem_id, kind, language, entry, files, time_limit_ms, memory_limit_mb, status, verdict, passed_tests, total_tests, finished_at)
    select id, '${problemId}', 'submit', 'python', 'main.py', '[]', 1000, 256, 'done', 'AC', 1, 1, now()
    from users where email like 'lo-s-%@example.com' and substring(email from 'lo-s-([0-9]+)@')::int <= ${DONE};
`)
const book = `${O}/assignments/${work.json?.id}/gradebook`
started = Date.now()
const whole = await owner(book)
const wholeMs = Date.now() - started
const summary = whole.json?.summary
check(`the gradebook counts all ${STUDENTS} (${wholeMs} ms)`, summary?.students === STUDENTS && summary?.started === DONE && summary?.average === 50, JSON.stringify(summary))
started = Date.now()
const first = await owner(`${book}?page=1`)
const pageMs = Date.now() - started
check(`the screen gets one page of 100, with the same summary (${pageMs} ms)`, first.json?.rows?.length === 100 && first.json?.paging?.total === STUDENTS && first.json?.paging?.pages === STUDENTS / 100 && first.json?.total === 100 && JSON.stringify(first.json?.summary) === JSON.stringify(summary), JSON.stringify({ rows: first.json?.rows?.length, paging: first.json?.paging, points: first.json?.total, summary: first.json?.summary }))
check("…sorted by name, numbers by value", first.json?.rows?.[0]?.name === "Lo Student 1" && first.json?.rows?.[1]?.name === "Lo Student 2", first.json?.rows?.slice(0, 3).map((r) => r.name).join(", "))
const last = await owner(`${book}?page=${STUDENTS / 100}`)
check("the last page ends with the last student", last.json?.rows?.at(-1)?.name === `Lo Student ${STUDENTS}`, last.json?.rows?.at(-1)?.name)
const found = await owner(`${book}?page=1&q=${encodeURIComponent("lo-s-4321@")}`)
check("searching finds one student, on the server", found.json?.paging?.total === 1 && found.json?.rows?.[0]?.email === "lo-s-4321@example.com" && found.json?.rows?.[0]?.earned === 100, JSON.stringify(found.json?.rows?.[0]).slice(0, 200))
check("a page and the whole gradebook agree on a student", JSON.stringify(found.json?.rows?.[0]) === JSON.stringify(whole.json?.rows?.find((r) => r.email === "lo-s-4321@example.com")))
// The screen's next page comes from the kept copy; a new graded submission is seen at once.
started = Date.now()
const second = await owner(`${book}?page=2`)
const keptMs = Date.now() - started
check(`the next page is served from the kept gradebook (${keptMs} ms, ${pageMs} ms worked out)`, second.json?.rows?.length === 100 && keptMs < pageMs, JSON.stringify({ keptMs, pageMs }))
const late = STUDENTS - 1
psql(`insert into submissions (user_id, problem_id, kind, language, entry, files, time_limit_ms, memory_limit_mb, status, verdict, passed_tests, total_tests, finished_at)
  select id, '${problemId}', 'submit', 'python', 'main.py', '[]', 1000, 256, 'done', 'AC', 1, 1, now() from users where email = 'lo-s-${late}@example.com'`)
const after = await owner(`${book}?page=1&q=${encodeURIComponent(`lo-s-${late}@`)}`)
check("a new graded submission shows on the next request, not a stale copy", after.json?.rows?.[0]?.earned === 100 && after.json?.summary?.started === DONE + 1, JSON.stringify({ earned: after.json?.rows?.[0]?.earned, started: after.json?.summary?.started }))
// Whose judges run it: work for this organization's assignment is its own, practice is shared.
const someone = await client("lo-s-3@example.com")
const forWork = await someone("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(1)" }], problemSlug: "integer-operations", assignmentSlug: "lo-week-1" } })
const practice = await someone("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(1)" }], problemSlug: "integer-operations" } })
const poolOf = (id) => psql(`select coalesce(pool_org_id::text, 'shared') from submissions where id = '${id}'`)
check("work for the organization's assignment goes to its judges; personal practice to the shared ones", forWork.json?.id && practice.json?.id && poolOf(forWork.json.id) === orgId && poolOf(practice.json.id) === "shared", JSON.stringify({ forWork: forWork.status, practice: practice.status, pools: forWork.json?.id && [poolOf(forWork.json.id), practice.json?.id && poolOf(practice.json.id)] }))
const csv = await fetch(`${BASE}/api/v1${book}?format=csv`, { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: "lo-o@example.com" }, secret: SECRET })}` } })
const lines = (await csv.text()).trim().split("\n")
check(`the CSV still has everyone (${lines.length - 1} rows)`, csv.status === 200 && lines.length - 1 === STUDENTS)
// The same as background jobs (features/jobs), as the pages now do it: in steps, any size.
const jobDone = async (job) => {
  for (let i = 0; i < 240; i++) {
    const j = (await owner(`/jobs/${job}`)).json
    if (j && !["queued", "running"].includes(j.status)) return j
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}
const fileOf = async (job) => (await fetch(`${BASE}/api/v1/jobs/${job}/file`, { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: "lo-o@example.com" }, secret: SECRET })}` } })).text()
started = Date.now()
const bookJob = (await owner(`${book}/export`, { method: "POST" })).json?.job
const bookDone = await jobDone(bookJob)
const bookFile = await fileOf(bookJob)
check(`the gradebook export job gives the same CSV for all ${STUDENTS} (${Date.now() - started} ms)`, bookDone?.status === "done" && bookFile.trim() === lines.join("\n"), JSON.stringify({ status: bookDone?.status, rows: bookFile.trim().split("\n").length - 1 }))
const reportCsv = (await (await fetch(`${BASE}/api/v1${O}/reports?format=csv`, { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: "lo-o@example.com" }, secret: SECRET })}` } })).text()).trim().split("\r\n")
started = Date.now()
const reportJob = (await owner(`${O}/reports/export`, { body: { group: null } })).json?.job
const reportDone = await jobDone(reportJob)
const reportFile = (await fileOf(reportJob)).trim().split("\r\n")
// The job lists students in the on-screen table's order; the same header and the same lines.
check(`the Reports export job has every student, as the CSV does (${Date.now() - started} ms)`, reportDone?.status === "done" && reportFile.length === reportCsv.length && reportFile[0] === reportCsv[0] && [...reportFile].sort().join() === [...reportCsv].sort().join() && reportFile.length - 1 >= STUDENTS, JSON.stringify({ status: reportDone?.status, job: reportFile.length, csv: reportCsv.length }))

// ---------- members: pickers ask for a page, never everyone
started = Date.now()
const picker = await owner(`${O}/members?${new URLSearchParams({ q: "", page: "1", perPage: "50" })}`)
check(`"Add people" gets 50 of everyone (${Date.now() - started} ms)`, picker.json?.members?.length === 50 && picker.json?.total >= STUDENTS, JSON.stringify({ n: picker.json?.members?.length, total: picker.json?.total }))
const staffOnly = await owner(`${O}/members?${new URLSearchParams({ status: "active", kind: "staff", page: "1", perPage: "200" })}`)
check("the lead picker gets only staff", staffOnly.json?.total === 1 && staffOnly.json?.members?.[0]?.email === "lo-o@example.com", JSON.stringify({ total: staffOnly.json?.total }))
started = Date.now()
const everyone = await owner(`${O}/members`)
check(`without ?page the list is still complete, for integrations (${everyone.json?.length} in ${Date.now() - started} ms)`,
  // Parents aren't members: a parent holds only their link to a child.
  everyone.json?.length === STUDENTS + 1, everyone.json?.length)

// ---------- the gradebook page in a browser
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const token = await encode({ token: { email: "lo-o@example.com" }, secret: SECRET })
await context.addCookies([{ name: "next-auth.session-token", value: token, url: BASE }])
const tab = await context.newPage()
await tab.goto(`${BASE}${O}/manage/assignments/${work.json?.id}/grades`)
await tab.getByTestId("grade-row").first().waitFor({ timeout: 30_000 })
check("the page shows one page of students", (await tab.getByTestId("grade-row").count()) === 100)
check("…and says how many there are", await tab.getByText(/20,000|20000/).first().isVisible().catch(() => false))
await tab.getByLabel("Search students").fill("lo-s-4321@")
await tab.waitForFunction(() => document.querySelectorAll('[data-testid="grade-row"]').length === 1, null, { timeout: 15_000 }).catch(() => {})
check("searching asks the server and shows the one student", (await tab.getByTestId("grade-row").count()) === 1 && (await tab.getByTestId("grade-row").first().innerText()).includes("lo-s-4321@example.com"))
await tab.screenshot({ path: SHOTS + "gradebook.png", fullPage: false }).catch(() => {})
await browser.close()

// ---------- the biggest imports allowed, into an organization this size
const members = Array.from({ length: 5000 }, (_, i) => ({ email: `lo-m-${i + 1}@example.com`, name: `Lo Member ${i + 1}`, group: "First year / Section 1", role: "" }))
started = Date.now()
const checked = await owner(`${O}/import`, { body: { rows: members, commit: false } })
const checkMs = Date.now() - started
started = Date.now()
const imported = await owner(`${O}/import`, { body: { rows: members, commit: true } })
const importMs = Date.now() - started
const inSection = Number(psql(`select count(*) from group_members gm join users u on u.id = gm.user_id where gm.group_id = '${sections[0].id}' and u.email like 'lo-m-%@example.com'`))
check(`importing 5,000 members: checked in ${checkMs} ms, added in ${importMs} ms`, checked.status === 200 && imported.status === 200 && inSection === 5000 && importMs < 10_000, JSON.stringify({ checked: checked.status, imported: imported.status, inSection, body: JSON.stringify(imported.json).slice(0, 200) }))
await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })
const students = Array.from({ length: 3000 }, (_, i) => ({ name: `Lo New ${i + 1}`, email: `lo-n-${i + 1}@example.com`, admissionNo: "", gender: "", birthDate: "", phone: "", address: "", class: "First year / Section 2", rollNo: String(i + 1) }))
started = Date.now()
const enrolled = await owner(`${O}/students/import`, { body: { rows: students, commit: true } })
const enrolMs = Date.now() - started
const recorded = Number(psql(`select count(*) from student_records r join users u on u.id = r.user_id where r.org_id = '${orgId}' and u.email like 'lo-n-%@example.com'`))
check(`importing 3,000 student records: added in ${enrolMs} ms`, enrolled.status === 200 && recorded === 3000 && enrolMs < 10_000, JSON.stringify({ status: enrolled.status, recorded, body: JSON.stringify(enrolled.json).slice(0, 300) }))

// Two people whose emails share a name: each gets their own handle, and both get in.
const twins = await owner(`${O}/import`, { body: { rows: [
  { email: "lo-twin@school-a.example", name: "Twin A", group: "First year / Section 3", role: "" },
  { email: "lo-twin@school-b.example", name: "Twin B", group: "First year / Section 3", role: "" },
], commit: true } })
const twinHandles = psql(`select handle from users where email like 'lo-twin@%' order by email`).split("\n")
check("two people named lo-twin@ in one file both get in, with their own handles", twins.status === 200 && twinHandles.length === 2 && twinHandles[0] !== twinHandles[1], JSON.stringify({ status: twins.status, twinHandles, body: JSON.stringify(twins.json).slice(0, 200) }))

// ---------- a year of 40,000 students: made current, then promoted
// Past 32,768 people, anything sending one parameter per person fails (Postgres allows 65,535).
const YEAR_STUDENTS = 40_000
const nextYear = (await owner(`${O}/academic-years`, { body: { name: "2027-2028", startsOn: "2028-01-01", endsOn: "2028-12-31" } })).json
const lastYear = (await owner(`${O}/academic-years`, { body: { name: "2028-2029", startsOn: "2029-01-01", endsOn: "2029-12-31" } })).json
psql(`
  insert into users (email, name, role, handle)
    select 'lo-y-' || g || '@example.com', 'Lo Year ' || g, 'student', 'lo-y-' || g from generate_series(1, ${YEAR_STUDENTS}) g;
  insert into org_members (org_id, user_id, status, joined_via)
    select '${orgId}', id, 'active', 'created' from users where email like 'lo-y-%@example.com';
  insert into student_records (org_id, user_id, admission_no, admitted_on)
    select '${orgId}', id, 'Y' || substring(email from 'lo-y-([0-9]+)@'), '2026-01-01' from users where email like 'lo-y-%@example.com';
  insert into enrolments (org_id, year_id, user_id, group_id, status)
    select '${orgId}', '${nextYear.id}', id, (array[${sections.map((s) => `'${s.id}'::uuid`).join(",")}])[1 + (substring(email from 'lo-y-([0-9]+)@')::int % ${SECTIONS})], 'active'
    from users where email like 'lo-y-%@example.com';
`)
const seated = () => Number(psql(`select count(*) from group_members gm join users u on u.id = gm.user_id where u.email like 'lo-y-%@example.com'`))
started = Date.now()
const madeCurrent = await owner(`${O}/academic-years/${nextYear.id}`, { method: "PATCH", body: { isCurrent: true } })
const currentMs = Date.now() - started
check(`making a year of ${YEAR_STUDENTS} students current places every one (${currentMs} ms)`, madeCurrent.status === 200 && seated() === YEAR_STUDENTS && currentMs < 20_000, JSON.stringify({ status: madeCurrent.status, seated: seated(), body: JSON.stringify(madeCurrent.json).slice(0, 300) }))
started = Date.now()
const promoted = await owner(`${O}/academic-years/promotion`, { body: { fromYearId: nextYear.id, toYearId: lastYear.id, sections: Object.fromEntries(sections.map((s) => [s.id, s.id])), exceptions: {}, apply: true, makeCurrent: true } })
const promoteMs = Date.now() - started
const enrolledNext = Number(psql(`select count(*) from enrolments where year_id = '${lastYear.id}'`))
check(`promoting ${YEAR_STUDENTS} students to the next year, and making it current (${promoteMs} ms)`, promoted.status === 200 && promoted.json?.counts?.moved === YEAR_STUDENTS && enrolledNext === YEAR_STUDENTS && seated() === YEAR_STUDENTS && promoteMs < 30_000, JSON.stringify({ status: promoted.status, counts: promoted.json?.counts, enrolledNext, seated: seated(), body: JSON.stringify(promoted.json).slice(0, 300) }))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
