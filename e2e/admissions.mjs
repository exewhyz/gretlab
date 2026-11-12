/**
 * Admissions: closed by default; opening for a year and classes (who may); parents apply
 * (signed in; checks, duplicates, a limit, numbers, sealed details); the office is told and
 * sees the list (filters, search, the sidebar count); reviewing, waitlisting, turning down
 * with a message (the parent is told); admitting creates the student's record and
 * enrolment, places them now for the current year (not for next year), and links the
 * parent; a student applying for themselves becomes their own record; withdrawing; the log;
 * the pages, on a phone too.
 *   node e2e/admissions.mjs [base-url] [screenshot-dir]
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
const cleanup = () => {
  psql(`delete from organizations where slug = 'adm-school'`)
  psql(`delete from users where email like 'adm-%' or (email like 'no-login+%' and name in ('Asha Rao','Kiran Rao','Page Kid'))`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["adm-o", "adm-office", "adm-t", "adm-p1", "adm-p2", "adm-p3", "adm-self"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com',${h === "adm-p1" ? "NULL" : `'Adm ${h.slice(4)}'`},'student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Adm School", slug: "adm-school", type: "school", ownerEmail: "adm-o@example.com" } })
const O = "/orgs/adm-school", orgId = psql(`select id from organizations where slug='adm-school'`)
const [owner, office, teacher, p1, p2, self] = await Promise.all(["adm-o", "adm-office", "adm-t", "adm-p1", "adm-p2", "adm-self"].map((h) => client(`${h}@example.com`)))
const G1 = (await owner(`${O}/groups`, { body: { name: "Grade 1" } })).json
const G1A = (await owner(`${O}/groups`, { body: { name: "A", parentId: G1.id } })).json
const G1B = (await owner(`${O}/groups`, { body: { name: "B", parentId: G1.id } })).json
const G2 = (await owner(`${O}/groups`, { body: { name: "Grade 2" } })).json
const G2A = (await owner(`${O}/groups`, { body: { name: "A", parentId: G2.id } })).json
for (const h of ["adm-office", "adm-t"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("adm-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: G1A.id } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Admissions office", permissions: ["admissions.manage"] } })).json
await owner(`${O}/members/${uid("adm-office")}/roles`, { body: { roleId: officeRole.id } })
const y1 = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31", isCurrent: true } })).json
const y2 = (await owner(`${O}/academic-years`, { body: { name: "2027-2028", startsOn: "2027-06-01", endsOn: "2028-05-31" } })).json
check("the set-up worked", !!(y1?.id && y2?.id && G2A?.id))

// ---------- closed, then opened
check("a school has admissions on by default", (await owner(`${O}/shell`)).json?.modules.includes("admissions"))
const kid = { gradeId: G1.id, studentName: "Asha Rao", birthDate: "2020-06-15", gender: "female", parentName: "Priya Rao", relation: "mother", phone: "+91 98450 12345", address: "12 Lake Road", notes: "Allergic to peanuts" }
check("admissions start closed", (await p1(`${O}/admissions/form`)).json?.open === false && (await p1(`${O}`)).json?.admissionsOpen === false)
check("...so applying is refused", (await p1(`${O}/admissions`, { body: kid })).json?.error?.code === "closed")
const settings = (body, who = office) => who(`${O}/admissions/settings`, { method: "PUT", body: { gradeIds: [], instructions: "", ...body } })
check("a teacher can't open admissions", (await settings({ open: true, yearId: y1.id }, teacher)).status === 403)
check("opening needs a year", (await settings({ open: true, yearId: null })).status === 400)
check("only grades can be chosen", (await settings({ open: true, yearId: y1.id, gradeIds: [G1A.id] })).status === 400)
await settings({ open: true, yearId: y1.id, gradeIds: [G1.id], instructions: "Bring the birth certificate." })
const form = (await p1(`${O}/admissions/form`)).json
check("the form shows the year, the classes and instructions", form?.open === true && form.year.name === "2026-2027" && form.grades.map((g) => g.name).join() === "Grade 1" && form.instructions.includes("birth certificate"), JSON.stringify(form))
check("the public page offers to apply", (await p1(`${O}`)).json?.admissionsOpen === true)

// ---------- applying
const app = (who, body) => who(`${O}/admissions`, { body: { ...kid, ...body } })
check("a class not taking applications is refused", (await app(p1, { gradeId: G2.id })).status === 400)
check("a bad phone is refused", (await app(p1, { phone: "call me" })).json?.error?.message?.includes("phone"))
check("a birth date in the future is refused", (await app(p1, { birthDate: "2030-01-01" })).status === 400)
const a1 = await app(p1, {})
check("a parent applies, and gets a number", a1.status === 200 && a1.json?.number === "APP-2026-0001" && a1.json.status === "submitted", JSON.stringify(a1.json))
check("their name is kept from the form", psql(`select name from users where id='${uid("adm-p1")}'`) === "Priya Rao")
check("the office is told", psql(`select count(*) from notifications where user_id='${uid("adm-office")}' and kind='admission_new'`) === "1")
check("the same child twice is refused", (await app(p1, { studentName: "asha rao" })).json?.error?.code === "duplicate")
const a2 = (await app(p1, { studentName: "Ravi Rao", birthDate: "2019-02-01", gender: "male" })).json
check("a second child gets the next number", a2?.number === "APP-2026-0002")
check("details are sealed at rest", psql(`select count(*) from admission_applications where org_id='${orgId}' and (birth_date like '20%' or phone like '+91%')`) === "0")
check("the parent sees their applications", (await p1(`${O}/admissions/form`)).json?.mine.length === 2)
check("another parent can't open one", (await p2(`${O}/admissions/${a1.json.id}`)).status === 403)
check("...or withdraw it", (await p2(`${O}/admissions/${a1.json.id}/withdraw`, { body: {} })).status === 404)

// ---------- the office
const list = (q = "") => office(`${O}/admissions${q}`)
const all = (await list()).json
check("the office lists them, newest first", all?.total === 2 && all.applications[0].studentName === "Ravi Rao" && all.counts.submitted === 2, JSON.stringify(all?.counts))
check("search finds by name", (await list("?q=ravi")).json?.total === 1)
check("filters by class and status", (await list(`?gradeId=${G1.id}&status=submitted`)).json?.total === 2 && (await list("?status=admitted")).json?.total === 0)
check("a teacher can't see them", (await teacher(`${O}/admissions`)).status === 403)
check("the sidebar counts new ones", (await office(`${O}/shell`)).json?.admissionsNew === 2)
check("the owner's home flags new applications", (await owner(`${O}/home`)).json?.admin?.attention.some((x) => x.kind === "Admissions" && x.text === "2 new applications"))
const detail = (await office(`${O}/admissions/${a1.json.id}`)).json
check("the office sees the details unsealed", detail?.birthDate === "2020-06-15" && detail.phone === "+91 98450 12345" && detail.notes === "Allergic to peanuts" && detail.applicant.email === "adm-p1@example.com", JSON.stringify(detail)?.slice(0, 300))
check("...and what admitting needs", detail?.admit?.sections.map((s) => s.name).join() === "Grade 1 › A,Grade 1 › B" && detail.admit.linksParent === true && /^[A-Z]+-2026-\d{4}$/.test(detail.admit.admissionNo), JSON.stringify(detail?.admit))
const move = (id, body, who = office) => who(`${O}/admissions/${id}/status`, { body })
check("start reviewing, with a message", (await move(a1.json.id, { status: "reviewing", message: "Interview on Monday at 10" })).json?.status === "reviewing")
check("the parent is told", psql(`select count(*) from notifications where user_id='${uid("adm-p1")}' and kind='admission_update' and body like '%Interview%'`) === "1")
check("the same move twice is refused", (await move(a1.json.id, { status: "reviewing" })).status === 409)
check("a teacher can't move one", (await move(a1.json.id, { status: "rejected" }, teacher)).status === 403)

// ---------- admitting into the current year
const admitIt = (id, body) => office(`${O}/admissions/${id}/admit`, { body })
check("only a section of the class applied for", (await admitIt(a1.json.id, { groupId: G2A.id })).status === 400)
const ad = await admitIt(a1.json.id, { groupId: G1A.id, rollNo: 5, message: "Welcome!" })
const sid = ad.json?.studentId
check("admitting creates the student", ad.status === 200 && !!sid && psql(`select admission_no from student_records where user_id='${sid}'`) === ad.json.admissionNo, JSON.stringify(ad.json))
check("...enrolled in the year's section with the roll number", psql(`select group_id||':'||roll_no from enrolments where user_id='${sid}' and year_id='${y1.id}'`) === `${G1A.id}:5`)
check("...placed in the class now, it being the current year", psql(`select count(*) from group_members where user_id='${sid}' and group_id='${G1A.id}'`) === "1")
check("...with the details from the form", (await owner(`${O}/students/${sid}`)).json?.birthDate === "2020-06-15")
check("...and the parent linked", psql(`select relation from guardians where student_id='${sid}' and parent_id='${uid("adm-p1")}'`) === "mother")
check("the parent now has a parent's home here", (await p1(`${O}/home`)).json?.views.includes("parent"))
check("they're told, with the message", psql(`select count(*) from notifications where user_id='${uid("adm-p1")}' and kind='admission_update' and title like '%admitted%' and body='Welcome!'`) === "1")
check("admitting twice is refused", (await admitIt(a1.json.id, { groupId: G1A.id })).status === 409)
const admitted = (await office(`${O}/admissions/${a1.json.id}`)).json
check("the application is marked admitted", admitted?.status === "admitted" && admitted.admittedAs === true && admitted.admit === null && admitted.student === null)
check("...linking to the student for those who see records", (await owner(`${O}/admissions/${a1.json.id}`)).json?.student?.id === sid)

check("turning one down, with a message", (await move(a2.id, { status: "rejected", message: "No seats left in Grade 1" })).json?.status === "rejected")
check("the parent sees it with the message", (await p1(`${O}/admissions/form`)).json?.mine.find((m) => m.id === a2.id)?.message === "No seats left in Grade 1")
check("a decided application can't be withdrawn", (await p1(`${O}/admissions/${a2.id}/withdraw`, { body: {} })).status === 409)
const a3 = (await app(p2, { studentName: "Mira Das", parentName: "Adm p2" })).json
check("a parent withdraws one still waiting", (await p2(`${O}/admissions/${a3.id}/withdraw`, { body: {} })).status === 200 && psql(`select status from admission_applications where id='${a3.id}'`) === "withdrawn")

// ---------- next year, and a student applying for themselves
await settings({ open: true, yearId: y2.id, gradeIds: [] })
const a4 = (await app(p2, { gradeId: G2.id, studentName: "Kiran Rao", birthDate: "2019-09-09", parentName: "Adm p2", relation: "father" })).json
check("numbers follow the year applied for", a4?.number === "APP-2027-0001", JSON.stringify(a4))
const k = (await admitIt(a4.id, { groupId: G2A.id })).json
check("admitting for next year enrols them in it", psql(`select group_id from enrolments where user_id='${k?.studentId}' and year_id='${y2.id}'`) === G2A.id)
check("...without moving them into the class yet", psql(`select count(*) from group_members where user_id='${k?.studentId}'`) === "0")
const s1 = (await app(self, { gradeId: G2.id, studentName: "Adm self", birthDate: "2008-01-01", parentName: "Adm self", relation: "self" })).json
const sAd = (await admitIt(s1.id, { groupId: G2A.id })).json
check("a student applying for themselves is admitted as their own account", sAd?.studentId === uid("adm-self") && psql(`select count(*) from guardians where student_id='${uid("adm-self")}'`) === "0")
for (const n of ["One", "Two", "Three", "Four", "Five"]) await app(p1, { gradeId: G2.id, studentName: `Kid ${n}` })
check("at most five applications waiting at once", (await app(p1, { gradeId: G2.id, studentName: "Kid Six" })).json?.error?.code === "too_many")

const log = (await owner(`${O}/audit?category=admission&limit=100`)).json?.entries ?? []
check("admissions are in the log", ["admission.settings", "admission.apply", "admission.review", "admission.admit", "admission.reject", "admission.withdraw"].every((a) => log.some((e) => e.action === a)), log.map((e) => e.action).join())
await settings({ open: false, yearId: y2.id })
check("closing stops applications", (await app(p2, { gradeId: G2.id, studentName: "Late Kid" })).json?.error?.code === "closed")

// ---------- the pages
await settings({ open: true, yearId: y1.id, gradeIds: [], instructions: "Bring the birth certificate." })
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const pp = await view("adm-p3@example.com", 390)
await pp.goto(`${BASE}${O}`)
await pp.getByTestId("admissions-open").getByRole("link", { name: "Apply for admission" }).click()
await pp.getByRole("heading", { name: "Apply for admission" }).waitFor({ timeout: 30000 })
await pp.getByLabel("Applying for").selectOption({ label: "Grade 1" })
await pp.getByLabel("Student's full name").fill("Page Kid")
await pp.getByLabel("Date of birth").fill("2020-03-03")
await pp.getByLabel("Phone").fill("98765 43210")
await pp.getByRole("button", { name: "Send application" }).click()
await pp.getByText("Application sent.").waitFor({ timeout: 15000 })
check("a parent applies from the public page", psql(`select status from admission_applications where student_name='Page Kid'`) === "submitted")
check("...and sees it listed", (await pp.getByTestId("my-application").filter({ hasText: "Page Kid" }).count()) === 1)
check("no sideways scrolling on a phone", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await pp.screenshot({ path: SHOTS + "admission-apply.png", fullPage: true })

const op = await view("adm-office@example.com", 1440)
await op.goto(`${BASE}${O}/manage/admissions`)
await op.getByTestId("application-row").first().waitFor({ timeout: 30000 })
await op.screenshot({ path: SHOTS + "admissions.png", fullPage: true })
await op.getByRole("link", { name: "Page Kid" }).click()
await op.getByTestId("application-details").waitFor({ timeout: 30000 })
await op.getByRole("button", { name: "Admit", exact: true }).click()
await op.getByLabel("Section").selectOption({ label: "Grade 1 › B" })
await op.getByRole("dialog").getByRole("button", { name: "Admit", exact: true }).click()
await op.getByTestId("application-status").filter({ hasText: "Admitted" }).waitFor({ timeout: 15000 })
check("the office admits from the page", true)
check("an office without student records gets no link to the record", (await op.getByText("Open the student's record").count()) === 0)
await op.screenshot({ path: SHOTS + "admission-admitted.png", fullPage: true })
const ow = await view("adm-o@example.com", 1440)
await ow.goto(op.url())
await ow.getByText("Open the student's record").click()
await ow.getByTestId("student-profile").waitFor({ timeout: 30000 })
check("the owner opens the new student's record from it", (await ow.getByTestId("student-profile").innerText()).includes("Grade 1 › B"))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
