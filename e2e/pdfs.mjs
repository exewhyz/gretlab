/**
 * PDFs: a student's report card (the student, their parent, staff; nobody else); a whole
 * class's report cards (staff who may see the class; drafts or published only); transfer
 * certificates (issuing marks the student transferred, numbers in a series, kept as issued,
 * who may issue and print); ID cards for a section; names outside the fonts don't break a
 * document; the log; the buttons on the pages.
 *   node e2e/pdfs.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const { PDFDocument } = createRequire(ROOT + "apps/web/")("pdf-lib")
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
  psql(`delete from organizations where slug = 'pdf-school'`)
  psql(`delete from users where email like 'pdf-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["pdf-o", "pdf-t", "pdf-out"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Pdf ${h.slice(4)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  call.pdf = async (path) => {
    const res = await fetch(BASE + "/api/v1" + path, { headers: { cookie } })
    const bytes = new Uint8Array(await res.arrayBuffer())
    let doc = null
    if (res.ok) doc = await PDFDocument.load(bytes).catch(() => null)
    return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), bytes, doc }
  }
  return call
}
const save = (name, r) => r.bytes?.length && writeFileSync(SHOTS + name, r.bytes)
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Pdf Public School", slug: "pdf-school", type: "school", ownerEmail: "pdf-o@example.com" } })
const O = "/orgs/pdf-school", orgId = psql(`select id from organizations where slug='pdf-school'`)
const [owner, teacher, out] = await Promise.all(["pdf-o", "pdf-t", "pdf-out"].map((h) => client(`${h}@example.com`)))
const g = (await owner(`${O}/groups`, { body: { name: "Grade 8" } })).json
const a = (await owner(`${O}/groups`, { body: { name: "A", parentId: g.id } })).json
for (const h of ["pdf-t", "pdf-out"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("pdf-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: a.id } })
const year = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-01-01", endsOn: "2027-12-31", isCurrent: true } })).json
await owner(`${O}/academic-years/${year.id}/class-teachers`, { method: "PUT", body: { assignments: [{ groupId: a.id, teacherId: uid("pdf-t") }] } })
const add = (body) => owner(`${O}/students`, { body: { groupId: a.id, ...body } })
const s1 = (await add({ name: "Zoë Müller", email: "pdf-s1@example.com", rollNo: 1, birthDate: "2013-04-02", gender: "female", phone: "98450 12345" })).json
const s2 = (await add({ name: "आर्यन Sharma", email: "pdf-s2@example.com", rollNo: 2 })).json
const s3 = (await add({ name: "Kabir Rao", rollNo: 3 })).json
await owner(`${O}/parents`, { body: { studentId: s1.id, email: "pdf-p@example.com", name: "Pdf Parent", relation: "mother" } })
const [k1, k2, parent] = await Promise.all(["pdf-s1", "pdf-s2", "pdf-p"].map((h) => client(`${h}@example.com`)))
const maths = (await owner(`${O}/subjects`, { body: { name: "Mathematics" } })).json
const eng = (await owner(`${O}/subjects`, { body: { name: "English" } })).json
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: a.id, teacherId: uid("pdf-t") } })
await owner(`${O}/subjects/${eng.id}/classes`, { body: { groupId: a.id } })
const half = (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Half-yearly", weight: 40 } })).json
const annual = (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Annual", weight: 60 } })).json
for (const e of [half, annual]) await owner(`${O}/exams/${e.id}/papers`, { body: { groupIds: [a.id], maxMarks: 100, passMarks: 33 } })
const paper = (e, sub) => psql(`select id from exam_papers where exam_id='${e.id}' and subject_id='${sub.id}'`)
for (const e of [half, annual]) {
  await owner(`${O}/exam-papers/${paper(e, maths)}/marks`, { method: "PUT", body: { marks: [{ userId: s1.id, marks: 91, remark: "Sharp with algebra." }, { userId: s2.id, marks: 28 }, { userId: s3.id, marks: null, absent: true }] } })
  await owner(`${O}/exam-papers/${paper(e, eng)}/marks`, { method: "PUT", body: { marks: [{ userId: s1.id, marks: 77.5 }, { userId: s2.id, marks: 64 }, { userId: s3.id, marks: 58 }] } })
}
await owner(`${O}/exams/${half.id}/remarks/${a.id}`, { method: "PUT", body: { remarks: [{ userId: s1.id, text: "Zoë is curious and careful; a pleasure to teach." }] } })
await owner(`${O}/exams/${half.id}/publish`, { body: { published: true } })
check("the set-up worked", !!(s1?.id && s2?.id && s3?.id) && psql(`select count(*) from exam_marks`) !== "0")

// ---------- a student's report card
const mine = await k1.pdf(`${O}/report-cards/me/pdf`)
save("report-card.pdf", mine)
check("a student downloads their report card as a PDF", mine.status === 200 && mine.type === "application/pdf" && mine.doc?.getPageCount() === 1, `${mine.status} ${mine.type}`)
check("...named for them, shown inline", mine.doc?.getTitle()?.includes("Zoë Müller") && mine.disposition?.startsWith("inline") && mine.disposition.includes(".pdf"))
check("the parent downloads their child's", (await parent.pdf(`${O}/report-cards/${s1.id}/pdf`)).status === 200)
check("a student can't download another's", (await k1.pdf(`${O}/report-cards/${s2.id}/pdf`)).status === 404)
check("someone else can't", (await out.pdf(`${O}/report-cards/${s1.id}/pdf`)).status === 404)
const odd = await k2.pdf(`${O}/report-cards/me/pdf`)
check("a name outside the fonts doesn't break the PDF", odd.status === 200 && odd.doc?.getPageCount() === 1)

// ---------- a class's report cards
const cls = await teacher.pdf(`${O}/report-cards/class/${a.id}/pdf?yearId=${year.id}`)
save("report-cards-class.pdf", cls)
check("a teacher of the class downloads every report card", cls.status === 200 && cls.doc?.getPageCount() === 3, `${cls.status} ${cls.doc?.getPageCount()}`)
check("...published exams only, when asked", (await teacher.pdf(`${O}/report-cards/class/${a.id}/pdf?published=1`)).status === 200)
check("a student can't download the class's", (await k1.pdf(`${O}/report-cards/class/${a.id}/pdf`)).status === 403)
check("a grade isn't a class", (await owner.pdf(`${O}/report-cards/class/${g.id}/pdf`)).status === 404)
check("printing a class is in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action='exam.print'`) !== "0")

// ---------- transfer certificates
const tcUrl = (s) => `${O}/students/${s.id}/transfer-certificates`
const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
const today = (await owner(`${O}/attendance`)).json?.today ?? new Date().toISOString().slice(0, 10)
check("a teacher can't issue one", (await teacher(tcUrl(s3), { body: { leavingDate: today } })).status === 403)
check("a leaving date after today is refused", (await owner(tcUrl(s3), { body: { leavingDate: future } })).status === 400)
check("a leaving date before admission is refused", (await owner(tcUrl(s3), { body: { leavingDate: "2001-01-01" } })).status === 400)
const tc = (await owner(tcUrl(s1), { body: { leavingDate: today, reason: "Family moving to Pune", conduct: "Very good" } })).json
check("issuing numbers it in a series", new RegExp(`^TC-${today.slice(0, 4)}-0001$`).test(tc?.number ?? ""), JSON.stringify(tc))
check("...and marks the student transferred", psql(`select status from enrolments where user_id='${s1.id}' and year_id='${year.id}'`) === "transferred")
check("...and is kept sealed as issued", psql(`select count(*) from transfer_certificates where id='${tc.id}' and (details like '%"name"%' or details like '%Müller%')`) === "0")
const tcPdf = await owner.pdf(`${O}/transfer-certificates/${tc.id}/pdf`)
save("transfer-certificate.pdf", tcPdf)
check("the certificate prints as a PDF", tcPdf.status === 200 && tcPdf.doc?.getPageCount() === 1 && tcPdf.doc.getTitle().includes(tc.number))
check("a teacher can't print it once they've left the class", (await teacher.pdf(`${O}/transfer-certificates/${tc.id}/pdf`)).status === 404)
check("the student can't either", (await k1.pdf(`${O}/transfer-certificates/${tc.id}/pdf`)).status === 404)
const tc2 = (await owner(tcUrl(s3), { body: { leavingDate: today, markTransferred: false } })).json
check("the next one gets the next number", tc2?.number?.endsWith("-0002"))
check("...and leaves them in class when asked", psql(`select status from enrolments where user_id='${s3.id}' and year_id='${year.id}'`) === "active")
check("the student's certificates are listed", (await owner(tcUrl(s1))).json?.certificates.length === 1)
check("issuing and printing are in the log", psql(`select count(*) from audit_log where org_id='${orgId}' and action in ('records.tc','records.tc_print')`) === "3")

// ---------- ID cards
const ids = await owner.pdf(`${O}/students/id-cards/pdf?groupId=${a.id}`)
save("id-cards.pdf", ids)
check("ID cards for a section print on one sheet", ids.status === 200 && ids.doc?.getPageCount() === 1 && ids.doc.getTitle().includes("Grade 8 › A"))
check("a teacher of the section can print them", (await teacher.pdf(`${O}/students/id-cards/pdf?groupId=${a.id}`)).status === 200)
check("a student can't", (await k1.pdf(`${O}/students/id-cards/pdf?groupId=${a.id}`)).status === 403)
check("a grade isn't a section", (await owner.pdf(`${O}/students/id-cards/pdf?groupId=${g.id}`)).status === 404)
check("a section is needed", (await owner.pdf(`${O}/students/id-cards/pdf`)).status === 400)

// ---------- the buttons
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const pp = await view("pdf-p@example.com", 1440)
await pp.goto(`${BASE}${O}/results/${s1.id}`)
await pp.getByTestId("report-pdf").waitFor({ timeout: 30000 })
check("the report card page links its PDF", (await pp.getByTestId("report-pdf").getAttribute("href")) === `/api/v1${O}/report-cards/${s1.id}/pdf?yearId=${year.id}`)
const op = await view("pdf-o@example.com", 1440)
await op.goto(`${BASE}${O}/manage/exams/${half.id}`)
await op.getByRole("tab", { name: "Results" }).click()
await op.getByTestId("class-report-pdf").waitFor({ timeout: 30000 })
check("the results tab links the class's report cards", (await op.getByTestId("class-report-pdf").getAttribute("href")).includes(`/report-cards/class/${a.id}/pdf`))
await op.goto(`${BASE}${O}/manage/students/${s3.id}`)
await op.getByTestId("tc-link").first().waitFor({ timeout: 30000 })
check("the profile lists the student's certificates", (await op.getByTestId("tc-link").count()) === 1)
const [popup] = await Promise.all([
  op.waitForEvent("popup", { timeout: 15000 }).catch(() => null),
  (async () => {
    await op.getByTestId("transfer-certificates").getByRole("button", { name: "Issue" }).click()
    await op.getByLabel("Reason for leaving").fill("Moving abroad")
    await op.getByRole("button", { name: "Issue and print" }).click()
  })(),
])
await op.getByTestId("tc-link").nth(1).waitFor({ timeout: 15000 })
check("issuing from the profile opens the certificate", !!popup && (await op.getByTestId("tc-link").count()) === 2)
await op.goto(`${BASE}${O}/manage/students`)
await op.getByLabel("Class").first().waitFor({ timeout: 30000 })
check("no ID cards link until a section is chosen", (await op.getByTestId("id-cards").count()) === 0)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
