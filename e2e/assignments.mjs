/**
 * Assignments: due dates, late penalties, grading from submissions, the gradebook and its
 * CSV, privacy, the feature switch, and the pages students and teachers use.
 *   node e2e/assignments.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
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

const PEOPLE = [["asg-a@example.com", "student", "Asha"], ["asg-b@example.com", "student", "=HYPERLINK(\"x\")"], ["asg-t@example.com", "teacher", "Teacher"], ["asg-admin@example.com", "admin", "Admin"]]
psql(`delete from assignments where slug like 'asg-%'`)
psql(`delete from submissions where user_id in (select id from users where email like 'asg-%')`)
psql(`delete from problems where slug like 'sum-of-two-numbers%' and listed = false`)
psql(`delete from settings where key in ('assignments.enabled','submissions.per_minute')`)
for (const [email, role, name] of PEOPLE) {
  const handle = email.split("@")[0]
  psql(`insert into users(email,name,role,handle) values ('${email}','${name.replaceAll("'", "''")}','${role}','${handle}') on conflict (email) do update set role='${role}', name=excluded.name, disabled=false`)
}
// Grading counts only students, so the gradebook lists exactly the people here.
const studentsBefore = Number(psql(`select count(*) from users where role='student' and not disabled`))

const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body, raw, headers = {} } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (raw) return res
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [a, b, t, admin] = await Promise.all(PEOPLE.map(([email]) => client(email)))
const settle = async (api, id) => {
  for (let i = 0; i < 600; i++) {
    const r = await api(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (api, slug, code, headers) => settle(api, (await api("/submissions", { headers, body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: slug } })).json.id)
const SI = 'principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f"Simple Interest: {si:.2f}")\nprint(f"Total Amount: {principal + si:.2f}")\n'
const WRONG = 'print("no")\n'

const problems = (await t("/admin/problems")).json.problems
const id = (slug) => problems.find((p) => p.slug === slug).id
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const body = (over) => ({ title: "Week 1", slug: "asg-week-1", description: "Do both.", opensAt: hours(-1), dueAt: hours(24), allowLate: true, latePenaltyPercent: 50, published: false, problems: [{ problemId: id("p1"), points: 100 }, { problemId: id("p2"), points: 50 }], ...over })

// ---------- teachers set assignments
const draftProblem = problems.find((p) => !p.published)
if (draftProblem) {
  const refused = await t("/admin/assignments", { body: body({ slug: "asg-draft", problems: [{ problemId: draftProblem.id, points: 10 }] }) })
  check("draft problems can't be assigned", refused.status === 400 && refused.json.error.code === "draft_problem", refused.status)
}
check("due must be after opening", (await t("/admin/assignments", { body: body({ dueAt: hours(-2) }) })).status === 400)
check("a problem can't be listed twice", (await t("/admin/assignments", { body: body({ problems: [{ problemId: id("p1"), points: 1 }, { problemId: id("p1"), points: 1 }] }) })).status === 400)
check("students can't create assignments", (await a("/admin/assignments", { body: body({}) })).status === 403)
const week1 = await t("/admin/assignments", { body: body({}) })
check("teacher creates a draft assignment", week1.status === 200, JSON.stringify(week1.json).slice(0, 150))
check("a draft is hidden from students", (await a("/assignments")).json.every((x) => x.slug !== "asg-week-1") && (await a("/assignments/asg-week-1")).status === 404)
await t(`/admin/assignments/${week1.json.id}`, { method: "PUT", body: body({ published: true }) })
const listed = (await a("/assignments")).json.find((x) => x.slug === "asg-week-1")
check("published: students see it, open, nothing earned yet", listed?.phase === "open" && listed.earned === 0 && listed.total === 150 && listed.problemCount === 2, JSON.stringify(listed))
check("assignments need sign-in", (await fetch(BASE + "/api/v1/assignments")).status === 401)

// ---------- grades come from submissions
await admin("/admin/settings", { method: "PATCH", body: { "submissions.per_minute": 600 } })
check("solve p1", (await submit(a, "p1", SI)).verdict === "AC")
check("fail p2", (await submit(a, "p2", WRONG)).verdict !== "AC")
const mine = (await a("/assignments/asg-week-1")).json
const byProblem = Object.fromEntries(mine.problems.map((p) => [p.slug, p]))
check("solved on time earns full marks", byProblem.p1.status === "solved" && byProblem.p1.earned === 100)
check("a failing submission earns nothing", byProblem.p2.status === "attempted" && byProblem.p2.earned === 0)
check("totals add up", mine.earned === 100 && mine.total === 150 && mine.solved === 1, `${mine.earned}/${mine.total}`)
check("the problem page knows its assignment", (await a("/problems/p1/assignments")).json.some((x) => x.slug === "asg-week-1"))

// Past due with a 50% penalty: today's solution is late.
const late = await t("/admin/assignments", { body: body({ title: "Old", slug: "asg-old", opensAt: hours(-3), dueAt: hours(-2), published: true, problems: [{ problemId: id("p1"), points: 10 }] }) })
const old = (await a("/assignments/asg-old")).json
check("late work loses the penalty", old.phase === "late" && old.problems[0].status === "late" && old.problems[0].earned === 5, JSON.stringify(old.problems[0]))
await t(`/admin/assignments/${late.json.id}`, { method: "PUT", body: body({ title: "Old", slug: "asg-old", opensAt: hours(-3), dueAt: hours(-2), published: true, allowLate: false, problems: [{ problemId: id("p1"), points: 10 }] }) })
const closed = (await a("/assignments/asg-old")).json
check("no late work: closed and nothing counts", closed.phase === "closed" && closed.earned === 0)

// ---------- extensions: one student's later due time, or reopening some problems
const oldId = late.json.id
const extend = (api, over) => api(`/admin/assignments/${oldId}/extensions`, { method: "PUT", body: { student: "asg-a@example.com", dueAt: hours(24), problemIds: [], reason: "Was ill", ...over } })
check("students can't extend", (await extend(a)).status === 403)
check("an extension must be later than the due time", (await extend(t, { dueAt: hours(-3) })).json?.error?.code === "not_later")
check("the teacher extends for one student", (await extend(t)).status === 200)
const notes = async (api) => (await api("/me/notifications")).json
check("the student hears about the extension", (await notes(a)).notifications.some((n) => n.kind === "extension" && n.title === "More time on Old"))
const extendedOld = (await a("/assignments/asg-old")).json
check("their work before the new time is on time, in full", extendedOld.phase === "open" && extendedOld.earned === 10 && extendedOld.extension?.whole === true, JSON.stringify({ phase: extendedOld.phase, earned: extendedOld.earned, ext: extendedOld.extension }))
check("others keep the assignment's own due time", (await b("/assignments/asg-old")).json.phase === "closed")
const oldBook = (await t(`/admin/assignments/${oldId}/gradebook`)).json
check("the gradebook shows the extension and its marks", oldBook.rows.find((r) => r.email === "asg-a@example.com")?.extension?.reason === "Was ill" && oldBook.rows.find((r) => r.email === "asg-a@example.com")?.earned === 10)
check("removing it grades against the due time again", (await t(`/admin/assignments/${oldId}/extensions?student=asg-a@example.com`, { method: "DELETE" })).status === 200 && (await a("/assignments/asg-old")).json.phase === "closed")
// Reopening one problem after feedback.
const reopen = await t("/admin/assignments", { body: body({ title: "Reopen", slug: "asg-reopen", opensAt: hours(-3), dueAt: hours(-2), allowLate: false, published: true, problems: [{ problemId: id("p1"), points: 10 }, { problemId: id("p10"), points: 10 }] }) })
await t(`/admin/assignments/${reopen.json.id}/extensions`, { method: "PUT", body: { student: "asg-a@example.com", dueAt: hours(24), problemIds: [id("p10")] } })
const leap = 'year = int(input())\nif year % 400 == 0 or (year % 4 == 0 and year % 100 != 0):\n    print("Leap year")\n    print("February has 29 days")\nelse:\n    print("Not a leap year")\n    print("February has 28 days")\n'
check("a reopened problem can be resubmitted", (await submit(a, "p10", leap)).verdict === "AC")
const reopened = (await a("/assignments/asg-reopen")).json
check("only the reopened problem counts after the due time", reopened.earned === 10 && reopened.problems.find((p) => p.slug === "p10").earned === 10 && reopened.problems.find((p) => p.slug === "p1").earned === 0 && reopened.extension.problems.join() === "Q2 Leap Year", JSON.stringify(reopened.extension))

// Opens tomorrow: students learn when, not what.
await t("/admin/assignments", { body: body({ title: "Later", slug: "asg-later", opensAt: hours(20), dueAt: hours(40), published: true }) })
const later = (await a("/assignments/asg-later")).json
check("an upcoming assignment hides its problems", later.phase === "upcoming" && later.problems.length === 0)
check("staff see an upcoming assignment's problems", (await t("/assignments/asg-later")).json.problems.length === 2)

// ---------- gradebook
const book = (await t(`/admin/assignments/${week1.json.id}/gradebook`)).json
const rowA = book.rows.find((r) => r.email === "asg-a@example.com")
const rowB = book.rows.find((r) => r.email === "asg-b@example.com")
check("gradebook lists every student, started or not", book.rows.length === studentsBefore && rowB?.cells.every((c) => c.status === "missing"), `${book.rows.length} vs ${studentsBefore}`)
check("gradebook has each student's marks", rowA?.earned === 100 && rowA.cells[0].earned === 100)
check("gradebook never lists staff", !book.rows.some((r) => r.email === "asg-t@example.com"))
check("gradebook summary", book.summary.started >= 1 && book.total === 150)
check("students can't read the gradebook", (await a(`/admin/assignments/${week1.json.id}/gradebook`)).status === 403)
const csv = await t(`/admin/assignments/${week1.json.id}/gradebook?format=csv`, { raw: true })
const text = await csv.text()
check("CSV downloads", csv.headers.get("content-type")?.startsWith("text/csv") && csv.headers.get("content-disposition")?.includes("asg-week-1-grades.csv"))
check("CSV header and a student's row", text.includes("Total (150)") && text.split("\r\n").some((line) => line.startsWith("Asha,asg-a@example.com,asg-a,100,0,100,0")), text.split("\r\n").slice(0, 2).join(" | "))
check("CSV can't run formulas", text.includes(`"'=HYPERLINK(""x"")"`) && !text.includes("\n=HYPERLINK"))

// ---------- the switch
// ---------- drafts: code saved to the account, seen live by teachers, replayed
const DRAFT1 = "principal = float(input())\n"
const DRAFT2 = DRAFT1 + "rate = float(input())\n"
const putDraft = (api, content, extra = {}) => api("/problems/p1/draft", { method: "PUT", body: { language: "python", files: [{ path: "main.py", content }], entry: "main.py", ...extra } })
check("a student's code saves to their account", (await putDraft(a, DRAFT1)).status === 200)
await putDraft(a, DRAFT1)
await putDraft(a, DRAFT2)
const myDraft = (await a("/problems/p1/draft")).json.drafts
check("and comes back, on any computer", myDraft?.length === 1 && myDraft[0].files[0].content === DRAFT2, JSON.stringify(myDraft))
check("other students don't get it", (await b("/problems/p1/draft")).json.drafts.length === 0)
check("a draft needs a real language", (await putDraft(a, "x", { language: "cobol" })).status === 400)
check("and a problem the student can open", (await a("/problems/no-such-problem/draft")).status === 404)
const attemptsPath = `/admin/assignments/${week1.json.id}/attempts?student=asg-a@example.com&problem=${id("p1")}`
check("the teacher sees the code being written", (await t(attemptsPath)).json.draft?.files?.[0]?.content === DRAFT2)
const replay = (await t(attemptsPath + "&history=1")).json.history
check("and how it grew, oldest first, without repeats", replay?.length === 2 && replay[0].files[0].content === DRAFT1 && replay[1].files[0].content === DRAFT2, JSON.stringify(replay?.map((r) => r.files[0].content)))
check("students can't look at each other's code", (await b(attemptsPath)).status === 403)

// ---------- feedback: rubric marks and line comments, held until released
const RUBRIC = [{ id: "names", label: "Readable names", points: 10 }]
const fb = await t("/admin/assignments", { body: body({ title: "Feedback", slug: "asg-fb", published: true, holdFeedback: true, problems: [{ problemId: id("p1"), points: 100, rubric: RUBRIC }] }) })
check("an assignment with a rubric and held feedback", fb.status === 200, JSON.stringify(fb.json).slice(0, 150))
check("rubric criteria need a name", (await t("/admin/assignments", { body: body({ slug: "asg-fb-bad", problems: [{ problemId: id("p1"), points: 10, rubric: [{ id: "x", label: " ", points: 5 }] }] }) })).status === 400)
const fbBase = `/admin/assignments/${fb.json.id}`
const mark = (api, marks, student = "asg-a@example.com") => api(fbBase + "/marks", { method: "PUT", body: { student, problemId: id("p1"), marks } })
check("the teacher marks the rubric", (await mark(t, { names: 8 })).status === 200)
check("marks can't pass a criterion's points", (await mark(t, { names: 11 })).status === 400)
check("or name a criterion that isn't there", (await mark(t, { style: 3 })).status === 400)
check("students can't mark", (await mark(a, { names: 10 })).status === 403)
const fbBook = (await t(fbBase + "/gradebook")).json
const fbRow = fbBook.rows.find((r) => r.email === "asg-a@example.com")
check("the gradebook adds rubric marks to test marks", fbRow?.earned === 108 && fbBook.total === 110 && fbBook.problems[0].tests === 100 && fbBook.problems[0].points === 110 && fbBook.problems[0].rubric[0]?.points === 10, `${fbRow?.earned} / ${fbBook.total}`)
const held = (await a("/assignments/asg-fb")).json
check("held: the student sees test marks only", held.feedbackHeld && held.earned === 100 && held.total === 110 && held.problems[0].rubric[0].mark === null, JSON.stringify(held.problems[0]))
const attempt = (await t(`${fbBase}/attempts?student=asg-a@example.com&problem=${id("p1")}`)).json.attempts.find((x) => x.verdict === "AC")
const comment = (api, extra = {}) => api(fbBase + "/comments", { body: { student: "asg-a@example.com", submissionId: attempt.id, path: "main.py", line: 4, body: "Name this interest, not si.", ...extra } })
const commented = await comment(t)
check("the teacher comments on a line", commented.status === 200, JSON.stringify(commented.json).slice(0, 150))
check("only on a line that exists", (await comment(t, { line: 99 })).status === 400)
check("and on that student's own submission", (await comment(t, { student: "asg-b@example.com" })).status >= 400)
check("students can't comment", (await comment(a)).status === 403)
check("held: comments stay hidden from the student", (await a(`/submissions/${attempt.id}`)).json.comments?.length === 0)
check("students can't release feedback", (await a(fbBase + "/release", { method: "POST" })).status === 403)
check("the teacher releases feedback", (await t(fbBase + "/release", { method: "POST" })).status === 200)
const released = (await a("/assignments/asg-fb")).json
check("released: rubric marks count for the student", !released.feedbackHeld && released.earned === 108 && released.problems[0].rubric[0].mark === 8, JSON.stringify(released.problems[0]))
const afterRelease = await notes(a)
check("students hear when results are released", afterRelease.notifications.some((n) => n.kind === "feedback" && n.title === "Results of Feedback are out"))
check("students hear about new assignments", afterRelease.notifications.some((n) => n.kind === "new_assignment" && n.title === "New assignment: Week 1"))
check("a reminder when work is due within a day", afterRelease.reminders.some((r) => r.id === "due:asg-week-1"), JSON.stringify(afterRelease.reminders))
check("only once, when first published", afterRelease.notifications.filter((n) => n.title === "New assignment: Week 1").length === 1)
check("marking all read", afterRelease.unread > 0 && (await a("/me/notifications", { method: "PATCH", body: { read: "all" } })).status === 200 && (await notes(a)).unread === 0)
check("people only see their own", (await notes(t)).notifications.every((n) => n.kind !== "feedback"))
const seen = (await a(`/submissions/${attempt.id}`)).json.comments
check("and comments show on the submission", seen?.length === 1 && seen[0].line === 4 && seen[0].body.startsWith("Name this"), JSON.stringify(seen))
check("teachers save comments to reuse", (await t("/me/snippets", { body: { body: "Use a clearer name." } })).status === 200 && (await t("/me/snippets")).json.some((x) => x.body === "Use a clearer name."))
check("students have no saved comments", (await a("/me/snippets")).status === 403)

// ---------- lab exams: one timed sitting, from the lab's network
// What Caddy adds in production (deploy/Caddyfile); run.sh starts the app with this secret.
const PROXY_SECRET = "e2e-proxy-secret-0123456789"
const LAB = { "x-proxy-secret": PROXY_SECRET, "x-client-ip": "10.9.1.2" }
const HOME = { "x-proxy-secret": PROXY_SECRET, "x-client-ip": "8.8.8.8" }
const EXAM = { minutes: 30, fullscreen: true, networks: ["10.9.0.0/16"] }
check("an exam can't take late work", (await t("/admin/assignments", { body: body({ slug: "asg-exam-bad", exam: EXAM }) })).status === 400)
check("exam networks must be addresses", (await t("/admin/assignments", { body: body({ slug: "asg-exam-bad", allowLate: false, exam: { ...EXAM, networks: ["lab"] } }) })).status === 400)
const exam = await t("/admin/assignments", { body: body({ title: "Lab exam", slug: "asg-exam", allowLate: false, published: true, exam: EXAM }) })
check("teacher creates a lab exam", exam.status === 200, JSON.stringify(exam.json).slice(0, 150))
const examBase = `/admin/assignments/${exam.json.id}`
const before = (await a("/assignments/asg-exam")).json
check("before starting: the rules, not the problems", before.exam?.sitting.status === "not_started" && before.exam.minutes === 30 && before.exam.restricted && before.problems.length === 0 && before.problemCount === 2, JSON.stringify(before.exam))
check("the networks themselves stay private", !JSON.stringify(before).includes("10.9.0.0"))
check("earlier solutions don't count for an exam", (await a("/assignments")).json.find((x) => x.slug === "asg-exam")?.earned === 0)
const start = (headers) => a("/assignments/asg-exam/exam", { method: "POST", headers })
check("can't start from outside the lab", (await start(HOME)).json?.error?.code === "exam_network")
check("a visitor can't claim the lab's address themselves", (await start({ "x-client-ip": "10.9.1.2", "x-forwarded-for": "10.9.1.2" })).json?.error?.code === "exam_network")
check("nor with a wrong secret", (await start({ "x-proxy-secret": "guessed-secret-0000000000", "x-client-ip": "10.9.1.2" })).json?.error?.code === "exam_network")
const started = await start(LAB)
check("starts from the lab's network", started.status === 200 && started.json.status === "in_progress", JSON.stringify(started.json))
const endsIn = new Date(started.json.endsAt).getTime() - Date.now()
check("with its own 30 minutes", endsIn > 29 * 60_000 && endsIn <= 30 * 60_000, endsIn)
check("starting again gives the same sitting", (await start(LAB)).json.endsAt === started.json.endsAt)
check("its problems show once started", (await a("/assignments/asg-exam")).json.problems.length === 2)
check("editorials are closed during the exam", (await a("/problems/p1/solution")).json?.error?.code === "exam_running")
check("the problem page knows the exam is on", (await a("/problems/p1/assignments")).json.find((x) => x.slug === "asg-exam")?.exam?.sitting.status === "in_progress")
check("submitting from outside the lab is refused", (await a("/submissions", { headers: HOME, body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: SI }], problemSlug: "p1" } })).json?.error?.code === "exam_network")
const examSolve = await submit(a, "p1", SI, LAB)
check("solved from the lab", examSolve.verdict === "AC")
check("work during the sitting counts", (await a("/assignments/asg-exam")).json.earned === 100)
// The whole site is locked to the exam while it runs.
const runCode = (headers, extra = {}) => a("/submissions", { headers, body: { kind: "run", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(1)\n" }], inputs: [""], ...extra } })
check("the site knows the exam is on", (await a("/me/exam")).json?.exam?.slug === "asg-exam" && (await b("/me/exam")).json?.exam === null)
check("locked: no playground runs", (await runCode(LAB)).json?.error?.code === "exam_locked")
check("locked: no other problems", (await runCode(LAB, { problemSlug: "p3" })).json?.error?.code === "exam_locked")
check("locked: the library's problems aren't served", (await a("/problems/p3")).json?.error?.code === "exam_locked")
check("locked: no editorial of any problem", (await a("/problems/p9/solution")).json?.error?.code === "exam_running")
check("locked: notes are closed", (await a("/problems/p1/note")).json?.error?.code === "exam_locked")
check("locked: earlier code on the exam's problems is gone from the list", (await a("/submissions?problem=p1")).json.every((x) => new Date(x.createdAt) >= new Date(started.json.startedAt)))
const earlier = (await t(`/admin/assignments/${week1.json.id}/attempts?student=asg-a@example.com&problem=${id("p1")}`)).json.attempts.at(-1)
check("locked: and can't be opened by id", (await a(`/submissions/${earlier.id}`)).json?.error?.code === "exam_locked")
check("locked: drafts from before the exam don't come back", (await a("/problems/p1/draft")).json?.drafts?.length === 0)
check("locked: no drafts for other problems", (await a("/problems/p3/draft", { method: "PUT", headers: LAB, body: { language: "python", entry: "main.py", files: [{ path: "main.py", content: "x" }] } })).json?.error?.code === "exam_locked")
check("locked: drafts only from the lab's network", (await a("/problems/p1/draft", { method: "PUT", headers: HOME, body: { language: "python", entry: "main.py", files: [{ path: "main.py", content: "x" }] } })).json?.error?.code === "exam_network")
const q1 = (await a("/assignments/asg-exam/problems/1")).json
check("the exam's problems are served on its own pages, numbered by it", q1.problem?.label === "Q1" && q1.summaries.length === 2 && q1.problem.hints.length === 0 && !q1.problem.hasSolution, JSON.stringify(q1.problem ?? q1).slice(0, 150))
check("not to someone who hasn't started", (await b("/assignments/asg-exam/problems/1")).json?.error?.code === "exam_not_started")
check("an ordinary assignment's page keeps its hints", (await a("/assignments/asg-week-1/problems/1")).json.problem?.hints?.length > 0)
check("a started exam stays an exam", (await t(examBase, { method: "PUT", body: body({ title: "Lab exam", slug: "asg-exam", allowLate: false, published: true, exam: null }) })).json?.error?.code === "exam_started")
check("and keeps its problems", (await t(examBase, { method: "PUT", body: body({ title: "Lab exam", slug: "asg-exam", allowLate: false, published: true, exam: EXAM, problems: [{ problemId: id("p1"), points: 100 }] }) })).json?.error?.code === "exam_started")
check("its time can still change", (await t(examBase, { method: "PUT", body: body({ title: "Lab exam", slug: "asg-exam", allowLate: false, published: true, exam: { ...EXAM, minutes: 45 } }) })).status === 200)
const event = (api, kind) => api("/assignments/asg-exam/exam/events", { body: { kind, detail: "test" } })
check("the browser reports leaving the tab", (await event(a, "left_tab")).json?.recorded === true)
check("only known kinds", (await event(a, "hacked")).status === 400)
check("the browser can't report another network itself", (await event(a, "other_network")).status === 400)
check("nothing is recorded for someone not sitting it", (await event(b, "left_tab")).json?.recorded === false)
const examBook = (await t(examBase + "/gradebook")).json
const examRow = examBook.rows.find((r) => r.email === "asg-a@example.com")
check("the gradebook shows the sitting and warnings", examRow?.exam?.status === "in_progress" && examRow.exam.warnings === 2 && examBook.rows.find((r) => r.email === "asg-b@example.com")?.exam?.status === "not_started", JSON.stringify(examRow?.exam))
const record = (await t(`${examBase}/attempts?student=asg-a@example.com&problem=${id("p1")}`)).json.exam
check("and what happened, with where it started", record?.ip === "10.9.1.2" && record.events.map((e) => e.kind).join() === "other_network,left_tab", JSON.stringify(record))
check("finishing early", (await a("/assignments/asg-exam/exam/finish", { method: "POST" })).json?.status === "finished")
await submit(a, "p2", 'n = int(input())\nprint("Leap Year" if n % 4 == 0 and (n % 100 != 0 or n % 400 == 0) else "Not a Leap Year")\n', LAB)
check("work after finishing doesn't count", (await a("/assignments/asg-exam")).json.earned === 100)
check("editorials open again", (await a("/problems/p1/solution")).json?.error?.code !== "exam_running")
check("one attempt only", (await start(LAB)).json?.error?.code === "exam_over")
check("students can't give themselves time", (await a(examBase + "/extend", { body: { student: "asg-a@example.com", minutes: 10 } })).status === 403)
const extended = await t(examBase + "/extend", { body: { student: "asg-a@example.com", minutes: 10 } })
check("a teacher gives more time and the sitting reopens", extended.json?.status === "in_progress" && new Date(extended.json.endsAt).getTime() - Date.now() > 9 * 60_000, JSON.stringify(extended.json))
check("not to someone who never started", (await t(examBase + "/extend", { body: { student: "asg-b@example.com", minutes: 10 } })).status === 409)
await a("/assignments/asg-exam/exam/finish", { method: "POST" })
const examCsv = await (await t(examBase + "/gradebook?format=csv", { raw: true })).text()
check("the CSV has the exam and its warnings", examCsv.includes("Exam,Exam warnings") && examCsv.split("\r\n").some((l) => l.startsWith("Asha,") && l.endsWith(",Finished,2")), examCsv.split("\r\n").slice(0, 2).join(" | "))
check("forgetting the addresses", (await t(examBase + "/forget-addresses", { method: "POST" })).status === 200 && (await t(`${examBase}/attempts?student=asg-a@example.com&problem=${id("p1")}`)).json.exam.ip === null)
const windowExam = await t("/admin/assignments", { body: body({ title: "Window exam", slug: "asg-exam-window", allowLate: false, published: true, opensAt: hours(-2), exam: { minutes: 30, fullscreen: false, networks: [], startWithin: 15 } }) })
check("an exam can limit when students start", windowExam.status === 200 && (await a("/assignments/asg-exam-window/exam", { method: "POST" })).json?.error?.code === "exam_start_closed")
await t(`/admin/assignments/${windowExam.json.id}/extensions`, { method: "PUT", body: { student: "asg-a@example.com", dueAt: hours(48) } })
check("an extension lets an absent student sit it later", (await a("/assignments/asg-exam-window/exam", { method: "POST" })).json?.status === "in_progress")
await a("/assignments/asg-exam-window/exam/finish", { method: "POST" })
// Problems of its own: imported for the assessment, never in the library.
const imported = await t("/admin/problems/import", { body: { file: JSON.parse(readFileSync(ROOT + "apps/web/public/problem-template.json", "utf8")), listed: false, published: true } })
check("problems import from the template file", imported.status === 200 && imported.json.created.length === 1, JSON.stringify(imported.json).slice(0, 150))
const own = imported.json.created[0]
check("a bad file names the problem and field", (await t("/admin/problems/import", { body: { file: { problems: [{ title: "Broken", statement: "x", samples: [] }] }, listed: false, published: true } })).json?.error?.message?.includes("Problem 1 (Broken): samples"))
check("an assessment's own problem isn't in the library", !(await a("/problems")).json.problems?.some?.((p) => p.slug === own.slug) && (await a(`/problems/${own.slug}`)).status === 404)
check("nor can it be practised outside the work that uses it", (await a("/submissions", { body: { kind: "run", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(5)" }], inputs: ["2\n3"], problemSlug: own.slug } })).status === 404)
const ownAsg = await t("/admin/assignments", { body: body({ title: "Own problems", slug: "asg-own", allowLate: false, published: true, problems: [{ problemId: own.id, points: 10 }] }) })
check("an assignment uses it", ownAsg.status === 200)
check("and its students solve it there", (await submit(a, own.slug, "a = int(input())\nb = int(input())\nprint(a + b)\n")).verdict === "AC" && (await a("/assignments/asg-own")).json.earned === 10)
check("the template is served", (await fetch(BASE + "/problem-template.json")).status === 200)

// ---------- quizzes: a question bank, picked like problems
const bankFile = JSON.parse(readFileSync(ROOT + "apps/web/public/question-template.json", "utf8"))
const imported2 = await t("/admin/questions/import", { body: { file: bankFile } })
check("questions import from the template", imported2.status === 200 && imported2.json.created.length === 4, JSON.stringify(imported2.json).slice(0, 150))
check("a bad question file names the question and field", (await t("/admin/questions/import", { body: { file: { questions: [{ kind: "single", question: "Pick", options: ["a"], answer: "A" }] } } })).json?.error?.message?.includes("Question 1"))
check("students can't use the bank", (await a("/admin/questions")).status === 403)
const [qSingle, qMultiple, qShort, qWritten] = imported2.json.created.map((q) => q.id)
const single = (await t(`/admin/questions/${qSingle}`)).json
check("a choice question's right option is stored by letter", single.correct.join() === "b" && single.options[1].text === "def")
const pick = (...ids) => ids.map((questionId) => ({ questionId, points: questionId === qWritten ? 4 : 2 }))
const quizBody = (over) => body({ title: "Quiz 1", slug: "asg-quiz", allowLate: false, published: true, problems: [], questions: pick(qSingle, qMultiple, qShort, qWritten), ...over })
check("an assignment needs a problem, question or project", (await t("/admin/assignments", { body: quizBody({ slug: "asg-quiz-empty", questions: [] }) })).json?.error?.message === "Add at least one problem, question or project")
const quiz = await t("/admin/assignments", { body: quizBody({}) })
check("a quiz: questions alone", quiz.status === 200, JSON.stringify(quiz.json).slice(0, 150))
const quizBase = `/admin/assignments/${quiz.json.id}`
const shown = (await b("/assignments/asg-quiz")).json
check("students see the questions, not the answers", shown.questions.length === 4 && shown.answersOpen && shown.questions.every((q) => q.result === null) && !JSON.stringify(shown.questions).includes('"correct"') && shown.total === 10)
const answer = (api, answers) => api("/assignments/asg-quiz/answers", { method: "PUT", body: { answers } })
check("answers save", (await answer(b, { [qSingle]: ["b"], [qMultiple]: ["c", "a"], [qShort]: "  N LOG N ", [qWritten]: "A function calling itself." })).status === 200)
check("answers are checked against the options", (await answer(b, { [qSingle]: ["z"] })).status === 400 && (await answer(b, { "00000000-0000-4000-8000-000000000000": "x" })).status === 400)
check("and can be changed while open", (await answer(b, { [qSingle]: ["b"], [qMultiple]: ["a", "c"], [qShort]: "n log n", [qWritten]: "A function that calls itself on a smaller input." })).status === 200)
check("results wait for the due time", (await b("/assignments/asg-quiz")).json.earned === 0)
const quizRow = () => t(quizBase + "/gradebook").then((r) => r.json.rows.find((x) => x.email === "asg-b@example.com"))
const firstRow = await quizRow()
check("teachers see automatic marks at once; written answers wait for them", firstRow.quiz.earned === 6 && firstRow.quiz.needsMarking === 1 && firstRow.earned === 6, JSON.stringify(firstRow.quiz))
const markQuiz = (api, marks) => api(quizBase + "/quiz", { method: "PUT", body: { student: "asg-b@example.com", marks } })
check("students can't mark", (await markQuiz(b, { [qWritten]: 4 })).status === 403)
check("marks stay within the points", (await markQuiz(t, { [qWritten]: 5 })).status === 400)
await markQuiz(t, { [qWritten]: 3, [qSingle]: 1 })
check("the teacher marks a written answer and changes an automatic one", (await quizRow()).quiz.earned === 8 && (await quizRow()).quiz.needsMarking === 0)
await markQuiz(t, { [qSingle]: null })
check("and can put it back to automatic", (await quizRow()).quiz.earned === 9)
const panel = (await t(`${quizBase}/quiz?student=asg-b@example.com`)).json
check("the marking panel shows answers with automatic marks", panel.questions[3].answer.startsWith("A function") && panel.questions[3].byTeacher && panel.questions[0].automatic === 2)
check("a used question can't be deleted", (await t(`/admin/questions/${qSingle}`, { method: "DELETE" })).json?.error?.code === "question_in_use")
await t(quizBase, { method: "PUT", body: quizBody({ opensAt: hours(-3), dueAt: hours(-1) }) })
check("after the due time answers are closed", (await answer(b, { [qSingle]: ["a"] })).json?.error?.code === "answers_closed")
const results = (await b("/assignments/asg-quiz")).json
check("and results show: marks, right answers, explanations", results.earned === 9 && results.questions[0].result?.correct.join() === "b" && results.questions[0].result.explanation.includes("def") && results.questions[2].result.accepted.includes("n log n"), JSON.stringify(results.questions[0]))
// Held results come out when released.
const heldQuiz = await t("/admin/assignments", { body: quizBody({ slug: "asg-quiz-held", title: "Held quiz", holdFeedback: true, questions: pick(qSingle) }) })
await b("/assignments/asg-quiz-held/answers", { method: "PUT", body: { answers: { [qSingle]: ["b"] } } })
await t(`/admin/assignments/${heldQuiz.json.id}`, { method: "PUT", body: quizBody({ slug: "asg-quiz-held", title: "Held quiz", holdFeedback: true, opensAt: hours(-3), dueAt: hours(-1), questions: pick(qSingle) }) })
check("held results stay hidden after the due time", (await b("/assignments/asg-quiz-held")).json.questions[0].result === null)
await t(`/admin/assignments/${heldQuiz.json.id}/release`, { method: "POST" })
check("until the teacher releases them", (await b("/assignments/asg-quiz-held")).json.questions[0].result?.earned === 2 && (await b("/me/notifications")).json.notifications.some((n) => n.title === "Results of Held quiz are out"))
// A quiz as an exam: answers only during the sitting.
const qExam = await t("/admin/assignments", { body: quizBody({ slug: "asg-quiz-exam", title: "Quiz exam", exam: { minutes: 30, fullscreen: false, networks: [] }, questions: pick(qSingle, qWritten) }) })
const beforeExam = (await b("/assignments/asg-quiz-exam")).json
check("a quiz exam hides its questions until started", beforeExam.questions.length === 0 && beforeExam.questionCount === 2 && beforeExam.problemCount === 0)
const examAnswer = () => b("/assignments/asg-quiz-exam/answers", { method: "PUT", body: { answers: { [qSingle]: ["b"] } } })
check("no answers before starting", (await examAnswer()).json?.error?.code === "answers_closed")
await b("/assignments/asg-quiz-exam/exam", { method: "POST" })
check("answers during the sitting", (await examAnswer()).status === 200)
check("a started exam keeps its questions", (await t(`/admin/assignments/${qExam.json.id}`, { method: "PUT", body: quizBody({ slug: "asg-quiz-exam", title: "Quiz exam", exam: { minutes: 30, fullscreen: false, networks: [] }, questions: pick(qSingle) }) })).json?.error?.code === "exam_started")
await b("/assignments/asg-quiz-exam/exam/finish", { method: "POST" })
check("closed when the sitting ends", (await examAnswer()).json?.error?.code === "answers_closed")
const examResult = (await b("/assignments/asg-quiz-exam")).json
check("results once the sitting is over; unanswered earns nothing", examResult.questions[0].result?.earned === 2 && examResult.questions[1].result?.earned === 0 && examResult.questions[1].result.needsMarking === false, JSON.stringify(examResult.questions.map((q) => q.result)))
// Contests: questions that mark themselves, answered once, on the board.
const contestBody = (over) => ({ title: "Quiz cup", slug: "asg-quiz-cup", description: "", startsAt: hours(-1), endsAt: hours(2), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [], questions: pick(qSingle, qShort), audience: [], ...over })
check("a contest refuses questions that need marking", (await t("/admin/contests", { body: contestBody({ slug: "asg-quiz-cup-bad", questions: pick(qWritten) }) })).json?.error?.code === "needs_marking")
check("a contest of questions alone", (await t("/admin/contests", { body: contestBody({}) })).status === 200)
check("registering for it", (await b("/contests/asg-quiz-cup/registration", { method: "POST" })).status === 200)
const cupView = (await b("/contests/asg-quiz-cup")).json
check("contestants see the questions, labelled Q1, Q2", cupView.questions.map((q) => q.label).join() === "Q1,Q2" && cupView.questions[0].solution === null)
const answerCup = (qid, value) => b(`/contests/asg-quiz-cup/questions/${qid}`, { body: { answer: value } })
check("an answer is marked at once", (await answerCup(qSingle, ["b"])).json?.correct === true && (await answerCup(qShort, "bubble")).json?.correct === false)
check("and given once", (await answerCup(qSingle, ["a"])).json?.error?.code === "already_answered")
const cupBoard = (await b("/contests/asg-quiz-cup/leaderboard")).json
const myRow = cupBoard.rows.find((r) => r.problems.some((p) => p.label === "Q1"))
check("right answers count on the board like solved problems", cupBoard.problemLabels.join() === "Q1,Q2" && myRow?.solved === 1, JSON.stringify(cupBoard.rows[0]))
// One for the pages: open, two questions.
await t("/admin/assignments", { body: quizBody({ slug: "asg-quiz-page", title: "Page quiz", questions: pick(qSingle, qWritten) }) })
// Save conflicts: a form saved over a newer version is refused, unless the teacher means it.
const opened = (await t(`/admin/assignments/${ownAsg.json.id}`)).json
const putAsg = (expectedUpdatedAt, title) => t(`/admin/assignments/${ownAsg.json.id}`, { method: "PUT", body: body({ title, slug: "asg-own", allowLate: false, published: true, problems: [{ problemId: own.id, points: 10 }], expectedUpdatedAt }) })
const firstSave = await putAsg(opened.updatedAt, "Own problems (tab 1)")
check("saving the version you opened works", firstSave.status === 200 && firstSave.json.updatedAt !== opened.updatedAt)
check("saving over someone else's newer save is refused", (await putAsg(opened.updatedAt, "Own problems (tab 2)")).json?.error?.code === "edited_elsewhere")
check("and nothing of it was saved", (await t(`/admin/assignments/${ownAsg.json.id}`)).json.title === "Own problems (tab 1)")
check("\"keep mine\" saves without the check", (await putAsg(undefined, "Own problems (tab 2)")).status === 200)
const ownProblem = (await t(`/admin/problems/${own.id}`)).json
const putProblem = (expectedUpdatedAt) => t(`/admin/problems/${own.id}`, { method: "PUT", body: { ...ownProblem, expectedUpdatedAt } })
check("problems check the version too", (await putProblem(ownProblem.updatedAt)).status === 200 && (await putProblem(ownProblem.updatedAt)).json?.error?.code === "edited_elsewhere")
// A runner failure on the exam's submission: re-judged after the exam, it still counts.
const beforeFailure = (await a("/assignments/asg-exam")).json.earned
psql(`update submissions set verdict = 'SE', score = 0, passed_tests = 0 where id = '${examSolve.id}'`)
check("a system error costs the marks", (await a("/assignments/asg-exam")).json.earned === beforeFailure - 100, beforeFailure)
check("the student is told it'll be judged again", (await a(`/submissions/${examSolve.id}`)).json.verdict === "SE")
check("students can't re-judge", (await a(examBase + "/rejudge", { method: "POST" })).status === 403)
const rejudged = await t(examBase + "/rejudge", { method: "POST" })
check("the teacher re-judges system errors", rejudged.json?.queued === 1, JSON.stringify(rejudged.json))
check("judged again, it keeps its time and counts after the exam closed", (await settle(a, examSolve.id)).verdict === "AC" && (await a("/assignments/asg-exam")).json.earned === beforeFailure)
// For the pages: an exam without a network rule.
const exam2 = await t("/admin/assignments", { body: body({ title: "Quiz exam", slug: "asg-exam2", allowLate: false, published: true, exam: { minutes: 20, fullscreen: true, networks: [] }, problems: [{ problemId: id("p1"), points: 10 }] }) })

await admin("/admin/settings", { method: "PATCH", body: { "assignments.enabled": false } })
await new Promise((r) => setTimeout(r, 5500))
check("assignments off: refused", (await a("/assignments")).status === 403)
check("assignments off: problem pages stop mentioning them", (await a("/problems/p1/assignments")).json.length === 0)
await admin("/admin/settings", { method: "PATCH", body: { "assignments.enabled": true } })
await new Promise((r) => setTimeout(r, 5500))

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  page.on("console", (m) => {
    if (m.type() === "error" && !/40\d|Failed to load/.test(m.text())) errors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(0, 160)}`)
  })
  return page
}

const s = await open("asg-a@example.com")
await s.goto(`${BASE}/assignments`)
await s.getByTestId("assignment-card").first().waitFor({ timeout: 30000 })
check("nav shows Assignments as the current section", (await s.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assignments" }).getAttribute("aria-current")) === "page")
check("assignments page groups by what to do", await s.getByRole("heading", { name: "To do" }).isVisible() && await s.getByRole("heading", { name: "Coming up" }).isVisible() && await s.getByRole("heading", { name: "Closed" }).isVisible())
await s.getByTestId("notification-bell").click()
await s.getByTestId("notifications").getByTestId("reminder").first().waitFor({ timeout: 15000 })
check("the bell lists reminders and what happened", (await s.getByTestId("notifications").innerText()).includes("Week 1 is due"))
await s.waitForTimeout(300)
await s.screenshot({ path: SHOTS + "notifications.png" })
await s.getByTestId("notification-bell").click()
await s.getByTestId("notifications").waitFor({ state: "hidden", timeout: 15000 })
await s.screenshot({ path: SHOTS + "assignments.png", fullPage: true })
await s.getByRole("link", { name: /Week 1/ }).click()
await s.getByTestId("assignment-problem").first().waitFor({ timeout: 15000 })
check("assignment page shows marks per problem", await s.getByText("100 / 150 points").isVisible() && await s.getByRole("cell", { name: "Solved", exact: true }).isVisible())
await s.screenshot({ path: SHOTS + "assignment.png", fullPage: true })
await s.getByRole("link", { name: "Simple Interest" }).click()
await s.waitForURL(/\/assignments\/asg-week-1\/problems\/1$/, { timeout: 30000 })
await s.getByRole("heading", { name: "Q1. Simple Interest" }).waitFor({ timeout: 30000 })
const assignmentList = await s.getByRole("navigation", { name: "Problems" }).innerText()
check("an assignment's problems open on its own pages, numbered by it", assignmentList.includes("Q1") && assignmentList.includes("Q2") && !/\bP\d/.test(assignmentList), assignmentList)
await s.screenshot({ path: SHOTS + "assignment-problem.png" })
await s.goto(`${BASE}/problems/p1`)
await s.getByTestId("assignment-chip").first().waitFor({ timeout: 30000 })
check("the library page links back to its assignment", (await s.getByTestId("assignment-chip").first().textContent()).includes("Week 1"))

const tp = await open("asg-t@example.com")
await tp.goto(`${BASE}/admin/assignments/new`)
await tp.getByLabel("Title").waitFor({ timeout: 30000 })
await tp.getByLabel("Title").fill("Asg UI made")
check("address follows the title", (await tp.getByLabel("Address").inputValue()) === "asg-ui-made")
await tp.getByRole("button", { name: "Add Leap Year" }).click()
await tp.getByLabel("Points").fill("40")
check("total points follow the points given", await tp.getByText("40 points in total").isVisible())
await tp.getByRole("button", { name: "Rubric for Leap Year" }).click()
await tp.getByRole("button", { name: "Add criterion" }).click()
await tp.getByLabel("Criterion", { exact: true }).fill("Readable names")
await tp.getByLabel("Criterion points").fill("10")
await tp.screenshot({ path: SHOTS + "rubric-editor.png" })
await tp.getByRole("button", { name: "Done" }).click()
check("a rubric adds to the problem's points", await tp.getByText("50 points in total").isVisible() && await tp.getByRole("button", { name: "Rubric for Leap Year" }).innerText() === "+ 10 rubric")
await tp.getByTestId("question-picker").getByRole("button", { name: "Add Keyword for a function" }).click()
await tp.getByTestId("selected-question").first().waitFor({ timeout: 15000 })
await tp.screenshot({ path: SHOTS + "quiz-picker.png", fullPage: true })
await tp.getByRole("button", { name: "Publish" }).click()
await tp.waitForURL(/\/admin\/assignments\/[0-9a-f-]{36}$/, { timeout: 15000 })
await tp.getByText("Published: students can see this assignment.").waitFor({ timeout: 15000 })
await tp.screenshot({ path: SHOTS + "assignment-editor.png", fullPage: true })
const madeProblem = (await t("/assignments/asg-ui-made")).json?.problems?.[0]
check("publishing from the form works, rubric included", madeProblem?.points === 40 && madeProblem.rubric?.[0]?.label === "Readable names", JSON.stringify(madeProblem))
const madeQuiz = (await t(`/admin/assignments/${(await t("/admin/assignments")).json.find((x) => x.slug === "asg-ui-made").id}`)).json.questions
check("and its question from the bank", madeQuiz.length === 1 && madeQuiz[0].questionId === qSingle && madeQuiz[0].points === 1, JSON.stringify(madeQuiz))
// Someone else saves while this form is open: saving it again warns instead of overwriting.
const uiMade = (await t("/admin/assignments")).json.find((x) => x.slug === "asg-ui-made")
const uiStored = (await t(`/admin/assignments/${uiMade.id}`)).json
await t(`/admin/assignments/${uiMade.id}`, { method: "PUT", body: { ...uiStored, title: "Asg UI made (other tab)", problems: uiStored.problems } })
await tp.getByRole("button", { name: "Save changes" }).click()
await tp.getByTestId("save-conflict").waitFor({ timeout: 15000 })
check("a stale form warns instead of overwriting", (await t(`/admin/assignments/${uiMade.id}`)).json.title === "Asg UI made (other tab)")
await tp.screenshot({ path: SHOTS + "save-conflict.png" })
await tp.getByTestId("save-conflict").getByRole("button", { name: "Keep mine" }).click()
await tp.getByRole("alertdialog").getByRole("button", { name: "Keep mine" }).click()
await tp.getByText("Published. Students can see it under Assignments.").waitFor({ timeout: 15000 })
check("and \"keep mine\" saves on purpose", (await t(`/admin/assignments/${uiMade.id}`)).json.title === "Asg UI made")
// The daily challenge: compact rows, edited in a dialog with the question picker.
await tp.goto(`${BASE}/admin/daily`)
await tp.getByTestId("daily-day").first().waitFor({ timeout: 30000 })
const firstDay = await tp.getByTestId("daily-day").first().locator("td").first().innerText()
await tp.getByRole("button", { name: `Edit ${firstDay}` }).click()
const dayDialog = tp.getByRole("dialog")
await dayDialog.getByRole("button", { name: "Add Keyword for a function" }).click()
await dayDialog.getByRole("button", { name: "Add Merge sort complexity" }).click()
check("the day's picker offers only questions that mark themselves", (await dayDialog.getByRole("button", { name: "Add Recursion" }).count()) === 0)
await dayDialog.getByTestId("selected-question").nth(1).getByRole("button", { name: "Move up" }).click()
await tp.screenshot({ path: SHOTS + "daily-dialog.png" })
await dayDialog.getByRole("button", { name: "Save day" }).click()
await dayDialog.waitFor({ state: "hidden", timeout: 15000 })
await tp.getByTestId("daily-day").first().filter({ hasText: "2 questions" }).waitFor({ timeout: 15000 }).catch(() => {})
const dayRow = await tp.getByTestId("daily-day").first().innerText()
check("the row stays one line: a count and the titles, in the new order", dayRow.includes("2 questions: Merge sort complexity, Keyword for a function"), dayRow)
await tp.screenshot({ path: SHOTS + "daily.png" })
await admin("/admin/daily", { method: "PUT", body: { day: firstDay.trim(), problemSlug: null, questionIds: [] } })
await tp.goto(`${BASE}/admin/units`)
await tp.getByTestId("unit-row").first().waitFor({ timeout: 30000 })
await tp.getByTestId("unit-row").first().getByRole("button", { name: /^Edit / }).click()
await tp.getByTestId("unit-problem").first().waitFor({ timeout: 15000 })
check("the units page edits a unit in a dialog, with its problems in order", (await tp.getByTestId("unit-problem").count()) > 1)
const unitCount = await tp.getByTestId("unit-problem").count()
await tp.getByTestId("unit-problem").first().getByRole("combobox").selectOption({ label: "No unit" })
await tp.getByTestId("unit-leaving").waitFor({ timeout: 15000 })
check("a problem can be moved out, and shows where it's going", (await tp.getByTestId("unit-problem").count()) === unitCount - 1 && (await tp.getByTestId("unit-leaving").innerText()).includes("No unit"))
await tp.screenshot({ path: SHOTS + "units.png" })
await tp.getByTestId("unit-leaving").getByRole("button", { name: "Undo" }).click()
check("and brought back before saving", (await tp.getByTestId("unit-problem").count()) === unitCount)
await tp.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
await tp.goto(`${BASE}/admin/assignments/${(await t("/admin/assignments")).json.find((x) => x.slug === "asg-ui-made").id}`)
await tp.getByRole("link", { name: "Gradebook" }).waitFor({ timeout: 30000 })
await tp.getByRole("link", { name: "Gradebook" }).click()
await tp.getByTestId("grade-row").first().waitFor({ timeout: 15000 })
check("gradebook page with a CSV download", await tp.getByRole("link", { name: "Download CSV" }).isVisible())
await tp.goto(`${BASE}/admin/assignments/${week1.json.id}/grades`)
await tp.getByTestId("grade-row").first().waitFor({ timeout: 15000 })
check("gradebook page shows marks", await tp.getByTestId("grade-row").filter({ hasText: "asg-a@example.com" }).getByRole("cell", { name: "100" }).first().isVisible())
await tp.getByRole("button", { name: "Extend for asg-b@example.com" }).click()
await tp.getByRole("dialog").getByRole("checkbox", { name: /Q2\./ }).click()
await tp.getByRole("dialog").getByRole("button", { name: "Save extension" }).click()
await tp.getByTestId("grade-row").filter({ hasText: "asg-b@example.com" }).getByTestId("extension-chip").waitFor({ timeout: 15000 })
check("the gradebook extends one student's problems", (await tp.getByTestId("grade-row").filter({ hasText: "asg-b@example.com" }).getByTestId("extension-chip").innerText()).includes("Q2"))
check("and the student is told", (await b("/assignments/asg-week-1")).json.extension?.whole === false)
await tp.screenshot({ path: SHOTS + "extension.png", fullPage: true })
await tp.screenshot({ path: SHOTS + "gradebook.png", fullPage: true })
// Code saved on one computer is there on another.
const elsewhere = await open("asg-a@example.com")
await elsewhere.goto(`${BASE}/problems/p1`)
await elsewhere.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
// Monaco draws spaces as non-breaking spaces.
const editorText = async (page) => (await page.locator(".monaco-editor .view-lines").first().innerText()).replace(/\u00a0/g, " ")
await elsewhere.waitForFunction(() => document.querySelector(".monaco-editor .view-lines")?.textContent?.replace(/\u00a0/g, " ").startsWith("principal = float(input())rate"), null, { timeout: 15000 }).catch(() => {})
check("code saved to the account opens on another computer", (await editorText(elsewhere)).trim() === DRAFT2.trim(), await editorText(elsewhere))
// The teacher watches it, then replays it.
await tp.getByTestId("grade-row").filter({ hasText: "asg-a@example.com" }).getByTestId("grade-cell").first().click()
await tp.getByTestId("student-code").waitFor({ timeout: 15000 })
await tp.getByTestId("student-code").getByRole("tab", { name: "Working copy" }).click()
await tp.getByTestId("working-copy").waitFor({ timeout: 15000 })
check("the gradebook shows a student's working copy", (await tp.getByTestId("working-copy").innerText()).includes("rate = float(input())"))
await tp.getByTestId("student-code").getByRole("tab", { name: "Playback" }).click()
await tp.getByTestId("playback").waitFor({ timeout: 15000 })
check("and plays back how it was written", (await tp.getByTestId("playback").innerText()).includes("2 of 2"))
await tp.waitForTimeout(300)
await tp.screenshot({ path: SHOTS + "playback.png", fullPage: true })
// Marking and commenting from the gradebook.
await tp.goto(`${BASE}/admin/assignments/${fb.json.id}/grades`)
await tp.getByTestId("grade-row").filter({ hasText: "asg-a@example.com" }).getByTestId("grade-cell").first().click()
await tp.getByTestId("rubric-marking").waitFor({ timeout: 15000 })
await tp.getByLabel("Marks for Readable names").fill("9")
await tp.getByRole("button", { name: "Save marks" }).click()
await tp.getByText("Saved.").waitFor({ timeout: 15000 })
check("marks saved from the gradebook", (await t(fbBase + "/gradebook")).json.rows.find((r) => r.email === "asg-a@example.com")?.earned === 109)
// The submission that already has the comment from the API (newer ones may sit above it).
const code = tp.getByTestId("student-code").getByTestId("commented-code").filter({ has: tp.getByTestId("line-comment") }).first()
await code.getByRole("button", { name: "Comment on line 1" }).click()
await tp.getByLabel("Use a saved comment").selectOption({ label: "Use a clearer name." })
await tp.getByRole("button", { name: "Comment", exact: true }).click()
await code.getByTestId("line-comment").filter({ hasText: "Use a clearer name." }).waitFor({ timeout: 15000 })
check("a saved comment goes on a line", (await code.getByTestId("line-comment").count()) === 2)
await tp.screenshot({ path: SHOTS + "feedback-gradebook.png", fullPage: true })
await s.goto(`${BASE}/submissions/${attempt.id}`)
await s.getByTestId("line-comment").first().waitFor({ timeout: 30000 })
check("the student reads comments under their lines", (await s.getByTestId("line-comment").count()) === 2)
await s.screenshot({ path: SHOTS + "feedback-student.png", fullPage: true })
await s.goto(`${BASE}/assignments/asg-fb`)
await s.getByTestId("rubric-breakdown").waitFor({ timeout: 15000 })
check("the assignment page breaks marks down", (await s.getByTestId("rubric-breakdown").innerText()).includes("Readable names: 9 / 10"))
await s.goto(`${BASE}/assignments/asg-quiz-page`)
await s.getByTestId("quiz").waitFor({ timeout: 30000 })
await s.getByRole("radio", { name: "def" }).click()
await s.getByLabel("Answer to Q2").fill("A function that calls itself.")
await s.getByTestId("quiz-state").filter({ hasText: "2 of 2 answered" }).waitFor({ timeout: 15000 })
check("students answer on the assignment page, saved as they go", (await a("/assignments/asg-quiz-page")).json.questions[1].answer === "A function that calls itself.")
await s.screenshot({ path: SHOTS + "quiz-student.png", fullPage: true })

// A lab exam from the student's side.
const xs = await open("asg-b@example.com")
await xs.goto(`${BASE}/problems/p1`)
await xs.getByRole("heading", { name: "Hints" }).waitFor({ timeout: 30000 })
await xs.waitForTimeout(1000)
check("before the exam, a library problem doesn't say it's in one", (await xs.getByTestId("assignment-chip").filter({ hasText: "Quiz exam" }).count()) === 0)
await xs.goto(`${BASE}/assignments/asg-exam2`)
await xs.getByTestId("exam-panel").waitFor({ timeout: 30000 })
check("the exam page lists the rules, no problems", (await xs.getByTestId("exam-panel").innerText()).includes("20 minutes from when you start") && (await xs.getByTestId("assignment-problem").count()) === 0)
await xs.screenshot({ path: SHOTS + "exam-start.png", fullPage: true })
await xs.getByRole("button", { name: "Start exam" }).click()
await xs.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click()
await xs.getByTestId("exam-clock").waitFor({ timeout: 15000 })
await xs.getByTestId("assignment-problem").first().waitFor({ timeout: 15000 })
check("started: the clock and the problems", /^(19|20):\d\d$/.test(await xs.getByTestId("exam-clock").innerText()), await xs.getByTestId("exam-clock").innerText())
await xs.screenshot({ path: SHOTS + "exam-running.png", fullPage: true })
check("the header shrinks to the exam and its clock", await xs.getByTestId("exam-header").isVisible() && /^\d+:\d\d left$/.test(await xs.getByTestId("exam-timer").innerText()) && (await xs.getByRole("link", { name: "Problems", exact: true }).count()) === 0)
await xs.getByRole("link", { name: "Simple Interest" }).click()
await xs.waitForURL(/\/assignments\/asg-exam2\/problems\/1$/, { timeout: 30000 })
await xs.getByRole("heading", { name: "Q1. Simple Interest" }).waitFor({ timeout: 30000 })
const examList = await xs.getByRole("navigation", { name: "Problems" }).innerText()
check("exam problems are numbered by the exam, alone in the list", examList.includes("Q1") && !examList.includes("Q2") && !/\bP\d/.test(examList) && (await xs.getByText("P1.").count()) === 0, examList)
check("no hints, notes or editorial during the exam", (await xs.getByRole("heading", { name: "Sample Test Cases" }).count()) === 1 && (await xs.getByRole("heading", { name: "Hints" }).count()) === 0 && (await xs.getByRole("tab", { name: "Notes" }).count()) === 0 && (await xs.getByRole("tab", { name: "Editorial" }).count()) === 0)
await xs.screenshot({ path: SHOTS + "exam-problem.png" })
for (const away of ["/problems", "/problems/p9", "/playground", "/contests", "/submissions"]) {
  await xs.goto(BASE + away)
  await xs.waitForURL(/\/assignments\/asg-exam2$/, { timeout: 30000 })
}
check("every other page sends the student back to the exam", xs.url().endsWith("/assignments/asg-exam2"))
await xs.evaluate(() => document.exitFullscreen?.().catch(() => {}))
await xs.getByRole("alertdialog", { name: "Return to fullscreen" }).waitFor({ timeout: 15000 })
check("outside fullscreen nothing else can be reached, keyboard included", await xs.evaluate(() => Boolean(document.querySelector("header")?.closest("[inert]")) && Boolean(document.querySelector("main")?.closest("[inert]")) && !document.querySelector("[role=alertdialog]")?.closest("[inert]")))
await xs.screenshot({ path: SHOTS + "exam-cover.png" })
await xs.getByRole("button", { name: "Return to fullscreen" }).click()
await tp.goto(`${BASE}/admin/assignments/${exam2.json.id}/grades`)
await tp.getByTestId("exam-cell").first().waitFor({ timeout: 15000 })
check("the gradebook shows who is sitting it", (await tp.getByTestId("grade-row").filter({ hasText: "asg-b@example.com" }).getByTestId("exam-cell").innerText()).includes("In progress"))
await tp.getByRole("button", { name: "See asg-a@example.com's exam" }).isVisible()
await tp.goto(`${BASE}/admin/assignments/${exam.json.id}/grades`)
await tp.getByRole("button", { name: "See asg-a@example.com's exam" }).click()
await tp.getByTestId("exam-events").waitFor({ timeout: 15000 })
check("a student's exam record lists what was noticed", (await tp.getByTestId("exam-events").innerText()).includes("Left the page"))
check("submissions outside the sitting are marked", (await tp.getByTestId("student-code").getByText("Outside the exam: doesn't count").count()) >= 1)
await tp.screenshot({ path: SHOTS + "exam-gradebook.png", fullPage: true })
await b("/assignments/asg-exam2/exam/finish", { method: "POST" })

check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" || "))
await browser.close()

psql(`delete from assignments where slug like 'asg-%'`)
psql(`delete from submissions where user_id in (select id from users where email like 'asg-%')`)
psql(`delete from problems where slug like 'sum-of-two-numbers%' and listed = false`)
psql(`delete from contests where slug like 'asg-%'`)
psql(`delete from questions where org_id is null and title in ('Keyword for a function','Mutable types','Merge sort complexity','Recursion')`)
psql(`delete from users where email like 'asg-%'`)
psql(`delete from settings where key in ('assignments.enabled','submissions.per_minute')`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
