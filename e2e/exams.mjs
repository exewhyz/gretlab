/**
 * Exams and report cards: the grading scale; exams in a year (weights, duplicates, who may);
 * papers for every subject a class takes (a grade's subjects reach its sections, adding
 * twice adds nothing); entering marks (the subject teacher, an exam-cell role, nobody
 * else; halves, limits, absences, students of another class); corrections logged apart;
 * a class's results (totals, grades, pass and fail, ranks); publishing (refused with marks
 * missing unless forced, students and parents told, marks locked); report cards (the
 * student, their parent, staff; drafts hidden from the family; the year's weighted
 * result); the log; the pages, on a phone too.
 *   node e2e/exams.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug = 'exm-school'`)
  psql(`delete from users where email like 'exm-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["exm-o", "exm-t1", "exm-t2", "exm-cell", "exm-out"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Exm ${h.slice(4)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Exm School", slug: "exm-school", type: "school", ownerEmail: "exm-o@example.com" } })
const O = "/orgs/exm-school", orgId = psql(`select id from organizations where slug='exm-school'`)
const [owner, t1, t2, cell, out] = await Promise.all(["exm-o", "exm-t1", "exm-t2", "exm-cell", "exm-out"].map((h) => client(`${h}@example.com`)))
const g5 = (await owner(`${O}/groups`, { body: { name: "Grade 5" } })).json
const a5 = (await owner(`${O}/groups`, { body: { name: "A", parentId: g5.id } })).json
const b5 = (await owner(`${O}/groups`, { body: { name: "B", parentId: g5.id } })).json
for (const h of ["exm-t1", "exm-t2", "exm-cell", "exm-out"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const roles = (await owner(`${O}/roles`)).json
const teacherRole = roles.find((r) => r.systemKey === "teacher").id
await owner(`${O}/members/${uid("exm-t1")}/roles`, { body: { roleId: teacherRole, groupId: g5.id } })
await owner(`${O}/members/${uid("exm-t2")}/roles`, { body: { roleId: teacherRole, groupId: a5.id } })
const cellRole = (await owner(`${O}/roles`, { body: { name: "Exam cell", permissions: ["exams.marks"] } })).json
await owner(`${O}/members/${uid("exm-cell")}/roles`, { body: { roleId: cellRole.id, groupId: g5.id } })
const year = (await owner(`${O}/academic-years`, { body: { name: "2026-2027", startsOn: "2026-06-01", endsOn: "2027-05-31", isCurrent: true } })).json
const student = async (name, email, groupId, rollNo) => (await owner(`${O}/students`, { body: { name, email, groupId, rollNo } })).json
const s1 = await student("Exm Asha", "exm-s1@example.com", a5.id, 1)
const s2 = await student("Exm Bilal", "exm-s2@example.com", a5.id, 2)
const s3 = await student("Exm Chitra", "exm-s3@example.com", a5.id, 3)
const s4 = await student("Exm Dev", "exm-s4@example.com", b5.id, 1)
await owner(`${O}/parents`, { body: { studentId: s1.id, email: "exm-p@example.com", name: "Exm Parent" } })
const [k1, k2, parent] = await Promise.all(["exm-s1", "exm-s2", "exm-p"].map((h) => client(`${h}@example.com`)))
const maths = (await owner(`${O}/subjects`, { body: { name: "Mathematics" } })).json
const sci = (await owner(`${O}/subjects`, { body: { name: "Science" } })).json
const eng = (await owner(`${O}/subjects`, { body: { name: "English" } })).json
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: a5.id, teacherId: uid("exm-t1") } })
await owner(`${O}/subjects/${maths.id}/classes`, { body: { groupId: b5.id, teacherId: uid("exm-t1") } })
await owner(`${O}/subjects/${sci.id}/classes`, { body: { groupId: a5.id, teacherId: uid("exm-t2") } })
// English is given to the whole grade.
await owner(`${O}/subjects/${eng.id}/classes`, { body: { groupId: g5.id } })
check("the set-up worked", !!(s1?.id && s4?.id && maths?.id && psql(`select count(*) from class_subjects where org_id='${orgId}'`) === "4"), JSON.stringify(s1))

// ---------- the module and the scale
const shell = (await owner(`${O}/shell`)).json
check("a school has exams on by default", shell?.modules.includes("exams"), JSON.stringify(shell?.modules))
const settings = (await owner(`${O}/exams/settings`)).json
check("the default scale is CBSE's", settings?.scale[0].grade === "A1" && settings.scale.at(-1).min === 0)
check("a scale without 0% is refused", (await owner(`${O}/exams/settings`, { method: "PUT", body: { scale: [{ min: 50, grade: "P" }, { min: 90, grade: "D" }] } })).status === 400)
check("a teacher can't change the scale", (await t1(`${O}/exams/settings`, { method: "PUT", body: { scale: [{ min: 0, grade: "F" }, { min: 40, grade: "P" }] } })).status === 403)

// ---------- exams
check("a teacher can't add an exam", (await t1(`${O}/exams`, { body: { yearId: year.id, name: "Sneaky" } })).status === 403)
const half = (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Half-yearly", startsOn: "2026-09-14", endsOn: "2026-09-25", weight: 40 } })).json
const annual = (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Annual", weight: 60 } })).json
check("exams are added", !!(half?.id && annual?.id))
check("two exams can't share a name in a year", (await owner(`${O}/exams`, { body: { yearId: year.id, name: "half-YEARLY" } })).status === 409)
check("an exam can't end before it starts", (await owner(`${O}/exams`, { body: { yearId: year.id, name: "Odd", startsOn: "2026-10-10", endsOn: "2026-10-01" } })).status === 400)
check("someone with nothing to do with exams can't list them", (await out(`${O}/exams`)).status === 403)
check("a student can't list them", (await k1(`${O}/exams`)).status === 403)

// ---------- papers
const added = (await owner(`${O}/exams/${half.id}/papers`, { body: { groupIds: [g5.id], maxMarks: 100, passMarks: 33 } })).json
check("a grade gets a paper per subject per section (its own subjects too)", added?.added === 5 && added.skipped === 0, JSON.stringify(added))
check("adding again adds nothing", (await owner(`${O}/exams/${half.id}/papers`, { body: { groupIds: [a5.id, b5.id], maxMarks: 100, passMarks: 33 } })).json?.added === 0)
check("pass marks above full marks are refused", (await owner(`${O}/exams/${annual.id}/papers`, { body: { groupIds: [a5.id], maxMarks: 50, passMarks: 60 } })).status === 400)
await owner(`${O}/exams/${annual.id}/papers`, { body: { groupIds: [a5.id], subjectIds: [maths.id], maxMarks: 50, passMarks: 17 } })
const paper = (subjectId, groupId, examId = half.id) => psql(`select id from exam_papers where exam_id='${examId}' and subject_id='${subjectId}' and group_id='${groupId}'`)
const [mA, sA, eA, mB] = [paper(maths.id, a5.id), paper(sci.id, a5.id), paper(eng.id, a5.id), paper(maths.id, b5.id)]

const asT2 = (await t2(`${O}/exams/${half.id}`)).json
check("a section's teacher sees its papers, marking only their own subject", asT2?.classes.length === 1 && asT2.classes[0].papers.length === 3 && asT2.classes[0].papers.filter((p) => p.canMark).map((p) => p.subject).join() === "Science", JSON.stringify(asT2?.classes))
const asT1 = (await t1(`${O}/exams/${half.id}`)).json
check("a grade's teacher sees both sections", asT1?.classes.length === 2 && asT1.classes.flatMap((c) => c.papers).filter((p) => p.canMark).length === 2)
check("the paper shows its subject teacher", asT1?.classes[0].papers.find((p) => p.subject === "Mathematics")?.teacher === "Exm t1")

// ---------- marks
const put = (who, id, marks) => who(`${O}/exam-papers/${id}/marks`, { method: "PUT", body: { marks } })
const sheet = (await t2(`${O}/exam-papers/${sA}/marks`)).json
check("the sheet lists the class by roll number", sheet?.students.map((s) => s.name).join() === "Exm Asha,Exm Bilal,Exm Chitra" && sheet.canMark)
check("the subject teacher enters marks", (await put(t2, sA, [{ userId: s1.id, marks: 80 }, { userId: s2.id, marks: 25 }, { userId: s3.id, marks: null, absent: true }])).status === 200)
check("...but not another subject's", (await put(t2, mA, [{ userId: s1.id, marks: 90 }])).status === 403)
check("more than full marks is refused", (await put(t1, mA, [{ userId: s1.id, marks: 101 }])).json?.error?.message?.includes("Exm Asha"))
check("quarter marks are refused", (await put(t1, mA, [{ userId: s1.id, marks: 47.25 }])).status === 400)
check("a student of another class is refused", (await put(t1, mA, [{ userId: s4.id, marks: 50 }])).status === 400)
check("the exam cell enters any subject in its grade", (await put(cell, mA, [{ userId: s1.id, marks: 90 }, { userId: s2.id, marks: 60 }, { userId: s3.id, marks: 70.5 }])).status === 200)
check("someone else can't", (await put(out, mA, [{ userId: s1.id, marks: 1 }])).status === 404)
check("a student can't", (await put(k1, mA, [{ userId: s1.id, marks: 100 }])).status === 404)
await put(owner, eA, [{ userId: s1.id, marks: 75 }, { userId: s2.id, marks: 50 }])
check("a correction is logged apart", (await put(t2, sA, [{ userId: s1.id, marks: 85 }])).status === 200 && psql(`select count(*) from audit_log where org_id='${orgId}' and action='exam.marks_correct'`) === "1")
check("a blank clears a mark", (await put(owner, eA, [{ userId: s2.id, marks: null }])).json?.students.find((s) => s.id === s2.id)?.marks === null)
check("lowering full marks below a mark is refused", (await owner(`${O}/exam-papers/${mA}`, { method: "PATCH", body: { maxMarks: 80 } })).status === 409)

// ---------- results
const results = (await t1(`${O}/exams/${half.id}/results?groupId=${a5.id}`)).json
const row = (id) => results?.rows.find((r) => r.id === id)
check("the class's results add up", row(s1.id)?.obtained === 250 && row(s1.id)?.result === "pass" && row(s1.id)?.grade === "A2", JSON.stringify(row(s1.id)))
check("an unmarked paper leaves a result pending, unranked", row(s2.id)?.result === "incomplete" && row(s2.id)?.rank === null)
check("a missed paper fails", row(s3.id)?.cells.find((c) => c.paperId === sA)?.outcome === "absent")
check("the outsider can't see results", (await out(`${O}/exams/${half.id}/results?groupId=${a5.id}`)).status === 403)
check("a section's teacher can't see another section's", (await t2(`${O}/exams/${half.id}/results?groupId=${b5.id}`)).status === 403)

// ---------- publishing
const pub = (body) => owner(`${O}/exams/${half.id}/publish`, { body })
const early = await pub({ published: true })
check("publishing with marks missing asks first", early.status === 409 && early.json?.error?.code === "incomplete", JSON.stringify(early.json))
check("a teacher can't publish", (await t1(`${O}/exams/${half.id}/publish`, { body: { published: true, force: true } })).status === 403)
check("before publishing, a student sees no report card", (await k1(`${O}/report-cards/me`)).json?.exams.length === 0)
await put(owner, eA, [{ userId: s2.id, marks: 50 }, { userId: s3.id, marks: 60 }])
await put(t1, mB, [{ userId: s4.id, marks: 30 }])
await put(owner, paper(eng.id, b5.id), [{ userId: s4.id, marks: 40 }])
const done = await pub({ published: true })
check("with every mark in, it publishes and tells the students", done.json?.published === true && done.json.told === 4, JSON.stringify(done.json))
check("students get a notification", psql(`select count(*) from notifications where user_id='${s1.id}' and kind='results'`) === "1")
check("...and so do their parents", psql(`select count(*) from notifications where user_id='${uid("exm-p")}' and kind='child_update' and title like '%Half-yearly%'`) === "1")
check("published marks are locked", (await put(t2, sA, [{ userId: s1.id, marks: 10 }])).status === 409)
check("papers can't be added to a published exam", (await owner(`${O}/exams/${half.id}/papers`, { body: { groupIds: [a5.id], maxMarks: 10, passMarks: 1 } })).status === 409)
check("a published exam can't be deleted", (await owner(`${O}/exams/${half.id}`, { method: "DELETE" })).status === 409)
const final = (await t1(`${O}/exams/${half.id}/results?groupId=${a5.id}`)).json
check("ranks: Asha first, then Bilal and Chitra", final?.rows.map((r) => `${r.name}:${r.rank}`).join() === "Exm Asha:1,Exm Bilal:2,Exm Chitra:3", final?.rows.map((r) => `${r.name}:${r.percent}:${r.rank}`).join())
check("the class's stats", final?.stats.passed === 1 && final.stats.complete === 3, JSON.stringify(final?.stats))

// ---------- report cards
const mine = (await k1(`${O}/report-cards/me`)).json
check("the student sees their published exam only", mine?.exams.map((e) => e.name).join() === "Half-yearly" && mine.viewer === "student", JSON.stringify(mine?.exams?.map((e) => e.name)))
check("their marks by subject, with grades", mine?.subjects.map((s) => s.name).join() === "English,Mathematics,Science" && mine.exams[0].papers.find((p) => p.subjectId === maths.id)?.grade === "A2")
check("their rank and result", mine?.exams[0].rank === 1 && mine.exams[0].of === 3 && mine.exams[0].result === "pass")
check("the year's result counts what's published", mine?.final?.percent === 83.3 && mine.final.grade === "A2", JSON.stringify(mine?.final))
check("a student can't open another's", (await k1(`${O}/report-cards/${s2.id}`)).status === 404)
check("the parent sees their child's", (await parent(`${O}/report-cards/${s1.id}`)).json?.viewer === "parent")
check("...but not another child's", (await parent(`${O}/report-cards/${s2.id}`)).status === 404)
const staff = (await t1(`${O}/report-cards/${s1.id}`)).json
check("a teacher of the class sees drafts too", staff?.exams.map((e) => `${e.name}:${e.published}`).join() === "Half-yearly:true,Annual:false", JSON.stringify(staff?.exams?.map((e) => e.name)))
check("a teacher of another section can't", (await t2(`${O}/report-cards/${s4.id}`)).status === 404)
check("the outsider can't", (await out(`${O}/report-cards/${s1.id}`)).status === 404)
check("the parent's child page links the report card", (await parent(`${O}/children/${s1.id}`)).json?.results === true)
check("the staff profile links it", (await t1(`${O}/students/${s1.id}`)).json?.can.results === true)

// ---------- unpublishing
check("unpublishing hides it again", (await pub({ published: false })).json?.published === false && (await k1(`${O}/report-cards/me`)).json?.exams.length === 0)
check("...and unlocks marks", (await put(t2, sA, [{ userId: s1.id, marks: 86 }])).status === 200)
const log = (await owner(`${O}/audit?category=exam&limit=100`)).json?.entries ?? []
check("exams are in the log", ["exam.create", "exam.papers", "exam.marks", "exam.marks_correct", "exam.publish", "exam.unpublish"].every((a) => log.some((e) => e.action === a)), log.map((e) => e.action).join())
await pub({ published: true, force: true })

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const p = await view("exm-o@example.com", 1440)
await p.goto(`${BASE}${O}/manage/exams`)
await p.getByTestId("exam-card").first().waitFor({ timeout: 30000 })
check("the exams page lists the year's exams", (await p.getByTestId("exam-card").count()) === 2)
await p.getByRole("button", { name: "Add exam" }).click()
await p.getByLabel("Name").fill("Unit test 1")
await p.getByRole("dialog").getByRole("button", { name: "Add exam" }).click()
await p.getByText("Unit test 1").waitFor({ timeout: 15000 })
check("an exam is added from the page", psql(`select count(*) from term_exams where name='Unit test 1' and org_id='${orgId}'`) === "1")
await p.getByRole("link", { name: "Unit test 1" }).click()
await p.getByRole("button", { name: "Add papers" }).first().click()
await p.getByRole("dialog").getByRole("checkbox", { name: "Grade 5 › A" }).click()
await p.getByRole("dialog").getByRole("button", { name: "Add papers" }).click()
await p.getByTestId("papers-added").waitFor({ timeout: 15000 })
check("papers are added from the page", (await p.getByTestId("papers-added").innerText()).includes("Added 3 papers"))
await p.getByRole("button", { name: "Done" }).click()
await p.getByTestId("paper-row").first().waitFor({ timeout: 15000 })
check("the exam page lists the papers", (await p.getByTestId("paper-row").count()) === 3)
await p.goto(`${BASE}${O}/manage/exams/${half.id}`)
await p.getByRole("tab", { name: "Results" }).click()
await p.getByTestId("result-row").first().waitFor({ timeout: 15000 })
check("the results tab shows the class", (await p.getByTestId("result-row").count()) === 3)
await p.screenshot({ path: SHOTS + "exam-results.png", fullPage: true })

const t = await view("exm-t2@example.com", 1440)
const unit = psql(`select id from term_exams where name='Unit test 1' and org_id='${orgId}'`)
await t.goto(`${BASE}${O}/manage/exams/${unit}`)
await t.getByRole("link", { name: "Enter marks for Science, Grade 5 › A" }).click()
await t.getByTestId("mark-row").first().waitFor({ timeout: 30000 })
await t.getByLabel("Marks for Exm Asha").fill("18")
await t.keyboard.press("Enter")
check("Enter moves to the next student", await t.getByLabel("Marks for Exm Bilal").evaluate((el) => el === document.activeElement))
await t.keyboard.type("120")
check("a mark over the limit is flagged before saving", await t.getByText("At most 100").isVisible() && await t.getByRole("button", { name: /Save/ }).isDisabled())
await t.getByLabel("Marks for Exm Bilal").fill("44.5")
await t.getByRole("checkbox", { name: "Exm Chitra was absent" }).click()
await t.getByRole("button", { name: "Save 3 changes" }).click()
await t.getByText("Marks saved.").waitFor({ timeout: 15000 })
check("the teacher saves marks from the page", psql(`select string_agg(coalesce(marks::text,'AB'), ',' order by marks) from exam_marks m join exam_papers p on p.id=m.paper_id where p.exam_id='${unit}'`) === "18,44.5,AB")
await t.screenshot({ path: SHOTS + "exam-marks.png", fullPage: true })

const kid = await view("exm-s1@example.com", 390)
await kid.goto(`${BASE}${O}/results/me`)
await kid.getByTestId("report-card").waitFor({ timeout: 30000 })
await kid.waitForLoadState("networkidle")
check("the student's report card shows their marks", (await kid.getByTestId("report-subject").count()) === 3 && (await kid.getByTestId("report-card").innerText()).includes("Exm Asha"))
check("no sideways scrolling on a phone", await kid.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await kid.screenshot({ path: SHOTS + "report-card-phone.png", fullPage: true })
const home = await view("exm-s1@example.com", 1440)
await home.goto(`${BASE}${O}`)
await home.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "Results" }).waitFor({ timeout: 30000 })
check("students have Results in the sidebar", true)
const par = await view("exm-p@example.com", 1440)
await par.goto(`${BASE}${O}/children/${s1.id}`)
await par.getByRole("link", { name: /Report card/ }).click()
await par.getByTestId("report-card").waitFor({ timeout: 30000 })
check("the parent opens the report card from the child page", (await par.getByTestId("report-result").first().innerText()).includes("Pass"))
await par.screenshot({ path: SHOTS + "report-card.png", fullPage: true })
const phone = await view("exm-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/exams/${half.id}`)
await phone.getByTestId("exam-class").first().waitFor({ timeout: 30000 })
await phone.waitForLoadState("networkidle")
check("the exam page fits a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
